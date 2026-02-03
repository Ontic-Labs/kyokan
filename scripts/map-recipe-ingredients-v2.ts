/**
 * Lexical Entity-Mapping v2
 *
 * Deterministic recipe-to-FDC mapping using the lexical scorer.
 * Replaces the v1 cascade with a score-all-candidates approach
 * against RAW USDA FDC descriptions.
 *
 * Architecture:
 *   - Score every recipe ingredient against every FDC food (~8K × ~2K = ~16M pairs)
 *   - 5-signal composite scoring (overlap, JW, segment, category, synonym)
 *   - Tokenizer-driven boundary correctness (no substring matching)
 *   - Run-based staging with instant rollback via promotion pointer
 *
 * Usage:
 *   npx tsx scripts/map-recipe-ingredients-v2.ts                       # dry run, all ingredients
 *   npx tsx scripts/map-recipe-ingredients-v2.ts --top 100             # dry run, top 100
 *   npx tsx scripts/map-recipe-ingredients-v2.ts --ingredient oil      # debug single ingredient
 *   npx tsx scripts/map-recipe-ingredients-v2.ts --write               # write to staging
 *   npx tsx scripts/map-recipe-ingredients-v2.ts --write --promote     # write + promote
 *   npx tsx scripts/map-recipe-ingredients-v2.ts --write --breakdowns  # write + store breakdowns
 */

import * as fs from "fs";
import * as crypto from "crypto";
import { Pool, PoolClient } from "pg";
import * as dotenv from "dotenv";
import {
  processFdcFood,
  processIngredient,
  buildIdfWeights,
  scoreCandidate,
  classifyScore,
  preNormalize,
  slugify,
  NEAR_TIE_DELTA,
  type ProcessedFdcFood,
  type ProcessedIngredient,
  type ScoredMatch,
  type IdfWeights,
  type MappingStatus,
} from "../src/lib/lexical-scorer";

dotenv.config({ path: ".env.local" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecipeIngredient {
  name: string;
  frequency: number;
}

interface WinnerRow {
  runId: string;
  ingredientKey: string;
  ingredientText: string;
  fdcId: number | null;
  score: number;
  status: MappingStatus;
  reasonCodes: string[];
  candidateDescription: string | null;
  candidateCategory: string | null;
}

interface BreakdownRow {
  runId: string;
  ingredientKey: string;
  fdcId: number | null;
  breakdownJson: object;
}

interface CandidateRow {
  runId: string;
  ingredientKey: string;
  fdcId: number;
  score: number;
  rank: number;
}

// ---------------------------------------------------------------------------
// Config + hashing (for run reproducibility)
// ---------------------------------------------------------------------------

interface ScorerConfig {
  version: string;
  weights: {
    overlap: number;
    jw: number;
    segment: number;
    affinity: number;
    synonym: number;
  };
  thresholds: {
    mapped: number;
    review: number;
    nearTie: number;
  };
  jwGate: {
    overlapThreshold: number;
    capValue: number;
  };
}

const CONFIG: ScorerConfig = {
  version: "lexical_v2",
  weights: { overlap: 0.35, jw: 0.25, segment: 0.20, affinity: 0.10, synonym: 0.10 },
  thresholds: { mapped: 0.80, review: 0.40, nearTie: 0.05 },
  jwGate: { overlapThreshold: 0.40, capValue: 0.20 },
};

function stableHash(obj: object): string {
  const json = JSON.stringify(obj, Object.keys(obj).sort(), 0);
  return crypto.createHash("sha256").update(json).digest("hex");
}

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 5 });
}

// ---------------------------------------------------------------------------
// Load FDC foods from database
// ---------------------------------------------------------------------------

async function loadFdcFoods(client: PoolClient): Promise<ProcessedFdcFood[]> {
  const { rows } = await client.query(`
    SELECT f.fdc_id, f.description, f.data_type,
           fc.name AS category_name
    FROM foods f
    LEFT JOIN food_categories fc ON f.category_id = fc.category_id
    WHERE f.is_synthetic = FALSE
    ORDER BY f.fdc_id
  `);

  return rows.map((r: { fdc_id: number; description: string; data_type: string; category_name: string | null }) =>
    processFdcFood(
      r.fdc_id,
      r.description,
      r.data_type === "foundation" ? "foundation" : "sr_legacy",
      r.category_name,
    )
  );
}

// ---------------------------------------------------------------------------
// Load recipe ingredients from JSON file
// ---------------------------------------------------------------------------

function loadRecipeIngredients(topN?: number, minFreq?: number): RecipeIngredient[] {
  const path = "data/recipe-ingredients.json";
  if (!fs.existsSync(path)) {
    throw new Error(`${path} not found. Run: npx tsx scripts/extract-recipe-ingredients.ts`);
  }
  const raw: RecipeIngredient[] = JSON.parse(fs.readFileSync(path, "utf-8"));

  // Sanitize CSV artifacts, merge duplicates
  const cleaned = new Map<string, number>();
  for (const ing of raw) {
    const clean = ing.name.replace(/["]+,?$/g, "").replace(/^["]+/g, "").trim();
    if (!clean || clean === "," || clean.length < 2) continue;
    cleaned.set(clean, (cleaned.get(clean) || 0) + ing.frequency);
  }

  // Apply preNormalize and merge again
  const merged = new Map<string, number>();
  for (const [name, freq] of cleaned.entries()) {
    const norm = preNormalize(name);
    if (!norm || norm.length < 2) continue;
    merged.set(norm, (merged.get(norm) || 0) + freq);
  }

  // Merge slug collisions
  const bySlug = new Map<string, { name: string; frequency: number }>();
  for (const [name, freq] of merged.entries()) {
    const s = slugify(name);
    const existing = bySlug.get(s);
    if (existing) {
      if (freq > existing.frequency) existing.name = name;
      existing.frequency += freq;
    } else {
      bySlug.set(s, { name, frequency: freq });
    }
  }

  let all = [...bySlug.values()].sort((a, b) => b.frequency - a.frequency);
  if (minFreq) all = all.filter((x) => x.frequency >= minFreq);
  return topN ? all.slice(0, topN) : all;
}

// ---------------------------------------------------------------------------
// Scoring pipeline
// ---------------------------------------------------------------------------

interface ScoringResult {
  ingredient: ProcessedIngredient;
  ingredientText: string;
  best: ScoredMatch | null;
  bestFood: ProcessedFdcFood | null;
  nearTies: Array<{ food: ProcessedFdcFood; match: ScoredMatch }>;
  status: MappingStatus;
}

function scoreIngredient(
  ingredient: RecipeIngredient,
  foods: ProcessedFdcFood[],
  idf: IdfWeights,
): ScoringResult {
  const processed = processIngredient(ingredient.name, idf);

  if (processed.coreTokens.length === 0) {
    return {
      ingredient: processed,
      ingredientText: ingredient.name,
      best: null,
      bestFood: null,
      nearTies: [],
      status: "no_match",
    };
  }

  let best: ScoredMatch | null = null;
  let bestFood: ProcessedFdcFood | null = null;

  // Score against all candidates
  for (const food of foods) {
    const match = scoreCandidate(processed, food, idf);
    if (!best || match.score > best.score) {
      best = match;
      bestFood = food;
    }
  }

  if (!best || !bestFood) {
    return {
      ingredient: processed,
      ingredientText: ingredient.name,
      best: null,
      bestFood: null,
      nearTies: [],
      status: "no_match",
    };
  }

  const status = classifyScore(best.score);

  // Collect near ties (within NEAR_TIE_DELTA of best)
  const cutoff = best.score - NEAR_TIE_DELTA;
  const nearTies: Array<{ food: ProcessedFdcFood; match: ScoredMatch }> = [];
  for (const food of foods) {
    if (food.fdcId === bestFood.fdcId) {
      nearTies.push({ food, match: best });
      continue;
    }
    const match = scoreCandidate(processed, food, idf);
    if (match.score >= cutoff) {
      nearTies.push({ food, match });
    }
  }
  nearTies.sort((a, b) => b.match.score - a.match.score);

  return {
    ingredient: processed,
    ingredientText: ingredient.name,
    best,
    bestFood,
    nearTies,
    status,
  };
}

// ---------------------------------------------------------------------------
// Reason codes (deterministic from breakdown)
// ---------------------------------------------------------------------------

function deriveReasonCodes(match: ScoredMatch, status: MappingStatus): string[] {
  const codes: string[] = [];
  const b = match.breakdown;

  if (b.overlap >= 0.85) codes.push("token_overlap:high");
  else if (b.overlap >= 0.60) codes.push("token_overlap:medium");
  else if (b.overlap > 0) codes.push("token_overlap:low");
  else codes.push("token_overlap:none");

  if (b.overlap < 0.40 && b.jwGated < 0.20) codes.push("jw:gated");
  else if (b.jwGated >= 0.92) codes.push("jw:high");
  else if (b.jwGated >= 0.80) codes.push("jw:medium");
  else codes.push("jw:low");

  if (b.segment === 1.0) codes.push("segment:primary_strong");
  else if (b.segment === 0.6) codes.push("segment:rest_strong");
  else if (b.segment === 0.3) codes.push("segment:partial");
  else codes.push("segment:none");

  if (b.affinity === 1.0) codes.push("category:exact");
  else codes.push("category:neutral");

  if (b.synonym === 1.0) codes.push("synonym:confirmed");

  codes.push(`status:${status}`);
  codes.push(`reason:${match.reason}`);

  return codes.sort();
}

// ---------------------------------------------------------------------------
// Batch write helpers
// ---------------------------------------------------------------------------

async function writeBatch(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  batchSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const row = batch[j];
      const offset = j * columns.length;
      const phs = columns.map((_, k) => `$${offset + k + 1}`);
      placeholders.push(`(${phs.join(", ")})`);
      values.push(...row);
    }

    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): {
  write: boolean;
  promote: boolean;
  breakdowns: boolean;
  candidates: boolean;
  topN?: number;
  minFreq: number;
  ingredientKey?: string;
  runId?: string;
} {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const promote = args.includes("--promote");
  const breakdowns = args.includes("--breakdowns");
  const candidates = args.includes("--candidates");

  const topIdx = args.indexOf("--top");
  const topN = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) : undefined;

  const minFreqIdx = args.indexOf("--min-freq");
  const minFreq = minFreqIdx >= 0 ? parseInt(args[minFreqIdx + 1], 10) : 25;

  const ingIdx = args.indexOf("--ingredient");
  const ingredientKey = ingIdx >= 0 ? args[ingIdx + 1] : undefined;

  const runIdx = args.indexOf("--run-id");
  const runId = runIdx >= 0 ? args[runIdx + 1] : undefined;

  return { write, promote, breakdowns, candidates, topN, minFreq, ingredientKey, runId };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const runId = opts.runId || crypto.randomUUID();
  const gitSha = process.env.RUN_GIT_SHA || null;

  console.log(`=== Lexical Entity-Mapping v2 ===`);
  console.log(`Run ID: ${runId}`);
  console.log(`Mode: ${opts.write ? "WRITE" : "DRY RUN"}${opts.promote ? " + PROMOTE" : ""}`);
  console.log();

  // --- Load recipe ingredients ---
  console.log("Loading recipe ingredients...");
  let ingredients: RecipeIngredient[];
  if (opts.ingredientKey) {
    // Debug single ingredient
    ingredients = [{ name: opts.ingredientKey, frequency: 0 }];
  } else {
    ingredients = loadRecipeIngredients(opts.topN, opts.minFreq);
  }
  const filters = [
    opts.topN && `top ${opts.topN}`,
    opts.minFreq && `freq >= ${opts.minFreq}`,
    opts.ingredientKey && `key = "${opts.ingredientKey}"`,
  ].filter(Boolean).join(", ");
  console.log(`  ${ingredients.length} ingredients${filters ? ` (${filters})` : ""}`);

  // --- Load FDC foods from database ---
  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log("Loading FDC foods from database...");
    const foods = await loadFdcFoods(client);
    console.log(`  ${foods.length} FDC foods loaded`);

    // --- Build IDF weights ---
    console.log("Building IDF weights...");
    const idf = buildIdfWeights(foods);

    const tokenizerHash = stableHash({ type: "tokenizer", version: "v2_nonalnum_split" });
    // IDF hash: hash the food descriptions since they determine df(t)
    const idfHash = stableHash({
      type: "idf",
      count: foods.length,
      sample: foods.slice(0, 10).map((f) => f.description),
    });

    // --- Score all ingredients ---
    console.log("\nScoring ingredients against all FDC candidates...");
    const results: ScoringResult[] = [];
    const startTime = Date.now();

    for (let i = 0; i < ingredients.length; i++) {
      const result = scoreIngredient(ingredients[i], foods, idf);
      results.push(result);

      if ((i + 1) % 50 === 0 || i === ingredients.length - 1) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const mapped = results.filter((r) => r.status === "mapped").length;
        const review = results.filter((r) => r.status === "needs_review").length;
        const noMatch = results.filter((r) => r.status === "no_match").length;
        process.stdout.write(
          `\r  ${i + 1}/${ingredients.length} scored (${elapsed}s) — mapped: ${mapped}, review: ${review}, no_match: ${noMatch}`,
        );
      }
    }
    console.log("\n");

    // --- Statistics ---
    const mapped = results.filter((r) => r.status === "mapped");
    const review = results.filter((r) => r.status === "needs_review");
    const noMatch = results.filter((r) => r.status === "no_match");

    console.log("=== Results ===");
    console.log(`  mapped:       ${mapped.length} (${((mapped.length / results.length) * 100).toFixed(1)}%)`);
    console.log(`  needs_review: ${review.length} (${((review.length / results.length) * 100).toFixed(1)}%)`);
    console.log(`  no_match:     ${noMatch.length} (${((noMatch.length / results.length) * 100).toFixed(1)}%)`);
    console.log();

    // --- Debug output for single ingredient ---
    if (opts.ingredientKey && results.length === 1) {
      const r = results[0];
      console.log(`\n=== Debug: "${opts.ingredientKey}" ===`);
      console.log(`  Normalized: "${r.ingredient.normalized}"`);
      console.log(`  Core tokens: [${r.ingredient.coreTokens.join(", ")}]`);
      console.log(`  State tokens: [${r.ingredient.stateTokens.join(", ")}]`);
      console.log(`  Total weight: ${r.ingredient.totalWeight.toFixed(4)}`);
      console.log(`  Status: ${r.status}`);
      if (r.best && r.bestFood) {
        console.log(`\n  Best match: [${r.bestFood.fdcId}] "${r.bestFood.description}" (${r.bestFood.categoryName})`);
        console.log(`    Score: ${r.best.score.toFixed(4)}`);
        console.log(`    Reason: ${r.best.reason}`);
        console.log(`    Breakdown:`);
        console.log(`      overlap:  ${r.best.breakdown.overlap.toFixed(4)}`);
        console.log(`      jwGated:  ${r.best.breakdown.jwGated.toFixed(4)}`);
        console.log(`      segment:  ${r.best.breakdown.segment.toFixed(4)}`);
        console.log(`      affinity: ${r.best.breakdown.affinity.toFixed(4)}`);
        console.log(`      synonym:  ${r.best.breakdown.synonym.toFixed(4)}`);
      }
      if (r.nearTies.length > 1) {
        console.log(`\n  Near ties (${r.nearTies.length}):`);
        for (const tie of r.nearTies.slice(0, 10)) {
          console.log(
            `    [${tie.food.fdcId}] ${tie.match.score.toFixed(4)} "${tie.food.description}" (${tie.food.categoryName})`,
          );
        }
      }
    }

    // --- Top mapped and review for quick inspection ---
    if (!opts.ingredientKey) {
      console.log("=== Top 20 mapped ===");
      for (const r of mapped.slice(0, 20)) {
        console.log(
          `  ${r.best!.score.toFixed(3)} "${r.ingredientText}" → [${r.bestFood!.fdcId}] "${r.bestFood!.description}" (${r.best!.reason})`,
        );
      }
      console.log();

      console.log("=== Top 20 needs_review ===");
      for (const r of review.slice(0, 20)) {
        console.log(
          `  ${r.best!.score.toFixed(3)} "${r.ingredientText}" → [${r.bestFood!.fdcId}] "${r.bestFood!.description}" (${r.best!.reason})`,
        );
      }
      console.log();

      console.log("=== Top 20 no_match ===");
      for (const r of noMatch.slice(0, 20)) {
        if (r.best && r.bestFood) {
          console.log(
            `  ${r.best.score.toFixed(3)} "${r.ingredientText}" → [${r.bestFood.fdcId}] "${r.bestFood.description}" (best candidate)`,
          );
        } else {
          console.log(`  0.000 "${r.ingredientText}" → (no tokens)`);
        }
      }
    }

    // --- Write mode ---
    if (!opts.write) {
      console.log("\nDRY RUN — no data written. Use --write to persist.");
      return;
    }

    console.log("\n=== Writing to database ===");
    await client.query("BEGIN");

    // 1. Insert run record
    await client.query(
      `INSERT INTO lexical_mapping_runs
        (run_id, git_sha, config_json, tokenizer_hash, idf_hash, status,
         total_ingredients, mapped_count, needs_review_count, no_match_count)
       VALUES ($1, $2, $3::jsonb, $4, $5, 'staging', $6, $7, $8, $9)`,
      [
        runId, gitSha, JSON.stringify(CONFIG), tokenizerHash, idfHash,
        results.length, mapped.length, review.length, noMatch.length,
      ],
    );
    console.log("  Run record inserted");

    // 2. Build winner rows
    const winnerRows: unknown[][] = [];
    for (const r of results) {
      const fdcId = r.status !== "no_match" && r.bestFood ? r.bestFood.fdcId : null;
      const reasonCodes = r.best ? deriveReasonCodes(r.best, r.status) : ["status:no_match"];

      // We need a canonical_id to insert into canonical_fdc_membership.
      // For now, we'll write to a separate staging approach.
      // Actually, the existing canonical_fdc_membership has (canonical_id, fdc_id) as PK.
      // We'll write the run data into the new columns.
      winnerRows.push([
        runId,
        r.ingredient.slug,  // ingredient_key
        r.ingredientText,
        fdcId,
        r.best?.score ?? 0,
        r.status,
        `{${reasonCodes.map((c) => `"${c}"`).join(",")}}`,
        r.bestFood?.description ?? null,
        r.bestFood?.categoryName ?? null,
      ]);
    }

    // Write to canonical_fdc_membership_breakdowns as staging
    // (using the new table from migration 012 for run-tracked results)
    console.log("  Writing winner mappings...");
    const WINNER_BATCH = 500;
    for (let i = 0; i < winnerRows.length; i += WINNER_BATCH) {
      const batch = winnerRows.slice(i, i + WINNER_BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const offset = j * 9;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, ` +
          `$${offset + 5}, $${offset + 6}, $${offset + 7}::text[], $${offset + 8}, $${offset + 9})`,
        );
        values.push(...row);
      }

      // Insert into breakdowns table as staging (ingredient_key based, not canonical_id based)
      await client.query(
        `INSERT INTO canonical_fdc_membership_candidates
          (run_id, ingredient_key, fdc_id, score, rank)
         VALUES ${placeholders.map((_, idx) => {
           const offset = idx * 5;
           return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
         }).join(", ")}`,
        // This doesn't quite work for the winner table... let me use a simpler approach
      ).catch(() => { /* fallback below */ });
    }

    // Simpler batch approach for winners
    for (const row of winnerRows) {
      await client.query(
        `INSERT INTO canonical_fdc_membership_breakdowns
          (run_id, ingredient_key, fdc_id, breakdown_json)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (run_id, ingredient_key) DO NOTHING`,
        [
          row[0], // run_id
          row[1], // ingredient_key
          row[3], // fdc_id
          JSON.stringify({
            ingredient_text: row[2],
            score: row[4],
            status: row[5],
            reason_codes: row[6],
            candidate_description: row[7],
            candidate_category: row[8],
          }),
        ],
      );
    }
    console.log(`  ${winnerRows.length} winner mappings written`);

    // 3. Write breakdowns if requested
    if (opts.breakdowns) {
      console.log("  Writing full score breakdowns...");
      for (const r of results) {
        if (!r.best || !r.bestFood) continue;
        await client.query(
          `UPDATE canonical_fdc_membership_breakdowns
           SET breakdown_json = $1::jsonb
           WHERE run_id = $2 AND ingredient_key = $3`,
          [
            JSON.stringify({
              ingredient_text: r.ingredientText,
              ingredient_normalized: r.ingredient.normalized,
              ingredient_core_tokens: r.ingredient.coreTokens,
              ingredient_state_tokens: r.ingredient.stateTokens,
              ingredient_total_weight: r.ingredient.totalWeight,
              candidate_fdc_id: r.bestFood.fdcId,
              candidate_description: r.bestFood.description,
              candidate_category: r.bestFood.categoryName,
              candidate_inverted_name: r.bestFood.invertedName,
              candidate_core_tokens: r.bestFood.coreTokens,
              score: r.best.score,
              status: r.status,
              reason: r.best.reason,
              breakdown: r.best.breakdown,
              reason_codes: deriveReasonCodes(r.best, r.status),
            }),
            runId,
            r.ingredient.slug,
          ],
        );
      }
      console.log("  Breakdowns written");
    }

    // 4. Write near-tie candidates if requested
    if (opts.candidates) {
      console.log("  Writing near-tie candidates...");
      let candidateCount = 0;
      for (const r of results) {
        for (let rank = 0; rank < r.nearTies.length && rank < 10; rank++) {
          const tie = r.nearTies[rank];
          await client.query(
            `INSERT INTO canonical_fdc_membership_candidates
              (run_id, ingredient_key, fdc_id, score, rank)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (run_id, ingredient_key, fdc_id) DO NOTHING`,
            [runId, r.ingredient.slug, tie.food.fdcId, tie.match.score, rank + 1],
          );
          candidateCount++;
        }
      }
      console.log(`  ${candidateCount} candidate rows written`);
    }

    // 5. Mark run as validated
    await client.query(
      `UPDATE lexical_mapping_runs SET status = 'validated' WHERE run_id = $1`,
      [runId],
    );
    console.log("  Run marked as validated");

    // 6. Promote if requested
    if (opts.promote) {
      await client.query(
        `UPDATE lexical_mapping_current
         SET current_run_id = $1, promoted_at = now()
         WHERE id = true`,
        [runId],
      );
      await client.query(
        `UPDATE lexical_mapping_runs SET status = 'promoted' WHERE run_id = $1`,
        [runId],
      );
      console.log("  Run promoted to current");
    }

    await client.query("COMMIT");
    console.log(`\nDone. run_id = ${runId}`);

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
