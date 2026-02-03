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
 *
 * CHANGELOG:
 * 2026-02-03 — Red team fixes:
 *   - P0: scoreIngredient now stores ALL scores in first pass, avoids double-scoring for near-ties
 *   - P1: Added tripwire validation gate before promotion (--promote requires passing tripwires)
 *   - P1: IDF hash now includes full DF histogram, not just first 10 foods
 *   - P2: Added null checks for database rows in loadFdcFoods
 *   - P2: Removed silent catch in batch insert, now logs errors
 *   - P2: Added run_id duplication check before inserting
 * 2026-02-03 — Red team follow-ups:
 *   - P1: Tripwire validation now fails if required ingredients are missing (unless partial run)
 *   - P1: IDF hash now based on full DF map (deterministic, collision-resistant)
 *   - P2: Store reason_codes as arrays in breakdown JSON (not text[] string)
 *   - P0: Write winners to canonical_fdc_membership_staging (run-scoped) instead of breakdowns
 *   - P2: Enforce staging table presence before writing
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
  splitCompounds,
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
  weights: { overlap: 0.50, jw: 0.00, segment: 0.25, affinity: 0.10, synonym: 0.15 },
  thresholds: { mapped: 0.75, review: 0.40, nearTie: 0.05 },
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
  // Join against fdc_cookability_assessment to exclude non-cooking foods
  // (restaurant meals, baby foods, supplements, etc.) assessed in migration 002.
  const { rows } = await client.query(`
    SELECT f.fdc_id, f.description, f.data_type,
           fc.name AS category_name
    FROM foods f
    LEFT JOIN food_categories fc ON f.category_id = fc.category_id
    JOIN fdc_cookability_assessment ca ON ca.fdc_id = f.fdc_id AND ca.is_cookable = TRUE
    WHERE f.is_synthetic = FALSE
    ORDER BY f.fdc_id
  `);

  const foods: ProcessedFdcFood[] = [];
  let skipped = 0;

  for (const r of rows) {
    // P2 fix: validate database rows before processing
    if (!r.fdc_id || !r.description) {
      skipped++;
      continue;
    }
    foods.push(
      processFdcFood(
        r.fdc_id,
        r.description,
        r.data_type === "foundation" ? "foundation" : "sr_legacy",
        r.category_name ?? null,
      )
    );
  }

  if (skipped > 0) {
    console.warn(`  Warning: skipped ${skipped} rows with missing fdc_id or description`);
  }

  return foods;
}

// ---------------------------------------------------------------------------
// Schema checks
// ---------------------------------------------------------------------------

async function ensureStagingTable(client: PoolClient): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'canonical_fdc_membership_staging'
     LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new Error(
      "Missing table canonical_fdc_membership_staging. Run migration 014_lexical_mapping_staging.sql before --write."
    );
  }
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

function scoreOnePart(
  partName: string,
  foods: ProcessedFdcFood[],
  idf: IdfWeights,
): { processed: ProcessedIngredient; allScores: Array<{ food: ProcessedFdcFood; match: ScoredMatch }> } {
  const processed = processIngredient(partName, idf);
  const allScores: Array<{ food: ProcessedFdcFood; match: ScoredMatch }> = [];

  if (processed.coreTokens.length === 0) {
    return { processed, allScores };
  }

  for (const food of foods) {
    const match = scoreCandidate(processed, food, idf);
    allScores.push({ food, match });
  }

  allScores.sort((a, b) => b.match.score - a.match.score);
  return { processed, allScores };
}

function scoreIngredient(
  ingredient: RecipeIngredient,
  foods: ProcessedFdcFood[],
  idf: IdfWeights,
): ScoringResult {
  const parts = splitCompounds(ingredient.name);

  // Score each compound part independently, take the best
  let bestResult: { processed: ProcessedIngredient; allScores: Array<{ food: ProcessedFdcFood; match: ScoredMatch }> } | null = null;
  let bestTopScore = -1;

  for (const part of parts) {
    const result = scoreOnePart(part, foods, idf);
    const topScore = result.allScores.length > 0 ? result.allScores[0].match.score : 0;
    if (topScore > bestTopScore) {
      bestTopScore = topScore;
      bestResult = result;
    }
  }

  if (!bestResult || bestResult.allScores.length === 0 || bestTopScore === 0) {
    const processed = processIngredient(ingredient.name, idf);
    return {
      ingredient: processed,
      ingredientText: ingredient.name,
      best: null,
      bestFood: null,
      nearTies: [],
      status: "no_match",
    };
  }

  const { processed, allScores } = bestResult;
  const best = allScores[0].match;
  const bestFood = allScores[0].food;
  const status = classifyScore(best.score);

  // Collect near ties (within NEAR_TIE_DELTA of best)
  const cutoff = best.score - NEAR_TIE_DELTA;
  const nearTies = allScores.filter((s) => s.match.score >= cutoff);

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
// P1 fix: Tripwire validation (must pass before promotion)
// ---------------------------------------------------------------------------

interface TripwireCase {
  ingredient: string;
  mustMatchCategory?: string;
  mustNotMatchCategory?: string;
  mustMatchDescriptionContains?: string;
  mustNotMatchDescriptionContains?: string;
  minScore?: number;
}

const TRIPWIRE_CASES: TripwireCase[] = [
  // Oil must map to Fats and Oils, not foods containing "boiled" or "broiled"
  { ingredient: "oil", mustMatchCategory: "Fats and Oils", mustNotMatchDescriptionContains: "boiled" },
  { ingredient: "oil", mustNotMatchDescriptionContains: "broiled" },

  // Salt must map to Spices and Herbs, not asphalt/basalt/cobalt
  { ingredient: "salt", mustMatchCategory: "Spices and Herbs", mustNotMatchDescriptionContains: "asphalt" },
  { ingredient: "salt", mustNotMatchDescriptionContains: "basalt" },
  { ingredient: "salt", mustNotMatchDescriptionContains: "cobalt" },

  // Butter must prefer Dairy over Baked Products
  { ingredient: "butter", mustMatchCategory: "Dairy and Egg Products" },

  // Olive oil must map to oil, not olives
  { ingredient: "olive oil", mustMatchDescriptionContains: "oil", minScore: 0.75 },

  // Olive (fruit) must map to olives, not oil
  { ingredient: "olive", mustMatchCategory: "Fruits and Fruit Juices" },

  // Sugar must map to Sweets, not cookies
  { ingredient: "sugar", mustMatchCategory: "Sweets" },

  // Flour must map to grains
  { ingredient: "flour", mustMatchCategory: "Cereal Grains and Pasta" },

  // Corn must not match corner
  { ingredient: "corn", mustNotMatchDescriptionContains: "corner" },
];

function runTripwireValidation(
  results: ScoringResult[],
  opts: { allowMissing: boolean },
): string[] {
  const failures: string[] = [];
  const resultsBySlug = new Map(results.map((r) => [r.ingredient.slug, r]));

  for (const tripwire of TRIPWIRE_CASES) {
    const slug = slugify(tripwire.ingredient);
    const result = resultsBySlug.get(slug);

    if (!result) {
      // If this is a partial run, skip missing tripwires. Otherwise, fail.
      if (!opts.allowMissing) {
        failures.push(`"${tripwire.ingredient}": missing from run (required for tripwire validation)`);
      }
      continue;
    }

    if (!result.best || !result.bestFood) {
      if (tripwire.minScore && tripwire.minScore > 0) {
        failures.push(`"${tripwire.ingredient}": expected score >= ${tripwire.minScore}, got no match`);
      }
      continue;
    }

    const bestDesc = result.bestFood.description.toLowerCase();
    const bestCat = result.bestFood.categoryName;

    if (tripwire.mustMatchCategory && bestCat !== tripwire.mustMatchCategory) {
      failures.push(
        `"${tripwire.ingredient}": expected category "${tripwire.mustMatchCategory}", got "${bestCat}" ` +
        `(matched: "${result.bestFood.description}")`
      );
    }

    if (tripwire.mustNotMatchCategory && bestCat === tripwire.mustNotMatchCategory) {
      failures.push(
        `"${tripwire.ingredient}": must NOT match category "${tripwire.mustNotMatchCategory}" ` +
        `(matched: "${result.bestFood.description}")`
      );
    }

    if (tripwire.mustMatchDescriptionContains &&
        !bestDesc.includes(tripwire.mustMatchDescriptionContains.toLowerCase())) {
      failures.push(
        `"${tripwire.ingredient}": expected description containing "${tripwire.mustMatchDescriptionContains}", ` +
        `got "${result.bestFood.description}"`
      );
    }

    if (tripwire.mustNotMatchDescriptionContains &&
        bestDesc.includes(tripwire.mustNotMatchDescriptionContains.toLowerCase())) {
      failures.push(
        `"${tripwire.ingredient}": must NOT match description containing "${tripwire.mustNotMatchDescriptionContains}", ` +
        `but matched "${result.bestFood.description}"`
      );
    }

    if (tripwire.minScore && result.best.score < tripwire.minScore) {
      failures.push(
        `"${tripwire.ingredient}": expected score >= ${tripwire.minScore}, got ${result.best.score.toFixed(3)}`
      );
    }
  }

  return failures;
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

    // P1 fix: IDF hash now includes full corpus fingerprint, not just first 10 foods
    // This ensures reproducibility tracking is accurate across different corpus versions
    const allTokens = new Set<string>();
    for (const food of foods) {
      for (const token of food.coreTokens) {
        allTokens.add(token);
      }
    }
    const df = new Map<string, number>();
    for (const food of foods) {
      for (const token of food.coreTokenSet) {
        df.set(token, (df.get(token) || 0) + 1);
      }
    }
    const dfEntries = [...df.entries()].sort(([a], [b]) => a.localeCompare(b));
    const idfHash = stableHash({
      type: "idf",
      count: foods.length,
      uniqueTokens: allTokens.size,
      df: dfEntries,
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
        console.log(`      jwGated:  ${r.best.breakdown.jwGated.toFixed(4)} (weight=0)`);
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

    // P2 fix: Check if run_id already exists (prevents duplicate key errors or partial overwrites)
    const existingRun = await client.query(
      `SELECT run_id, status FROM lexical_mapping_runs WHERE run_id = $1`,
      [runId],
    );
    if (existingRun.rows.length > 0) {
      throw new Error(
        `Run ID ${runId} already exists with status '${existingRun.rows[0].status}'. ` +
        `Use a new run_id or delete the existing run first.`
      );
    }

    // P2: Ensure staging table exists before writing
    await ensureStagingTable(client);

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

      // Write run-scoped winners into a staging table (run_id + ingredient_key).
      winnerRows.push([
        runId,
        r.ingredient.slug,  // ingredient_key
        r.ingredientText,
        fdcId,
        r.best?.score ?? 0,
        r.status,
        reasonCodes,
        r.bestFood?.description ?? null,
        r.bestFood?.categoryName ?? null,
        r.status === "needs_review" ? "⚠️" : null,
      ]);
    }

    // Write to canonical_fdc_membership_staging (run-scoped winners)
    console.log("  Writing winner mappings...");

    // Batch insert 500 rows at a time to avoid connection timeouts
    const BATCH_SIZE = 500;
    let insertErrors = 0;
    for (let i = 0; i < winnerRows.length; i += BATCH_SIZE) {
      const batch = winnerRows.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const offset = j * 10;
        placeholders.push(`($${offset+1}, $${offset+2}, $${offset+3}, $${offset+4}, $${offset+5}, $${offset+6}, $${offset+7}::text[], $${offset+8}, $${offset+9}, $${offset+10})`);
        values.push(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]);
      }
      try {
        await client.query(
          `INSERT INTO canonical_fdc_membership_staging
            (run_id, ingredient_key, ingredient_text, fdc_id, score, status, reason_codes, candidate_description, candidate_category, review_flag)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (run_id, ingredient_key) DO NOTHING`,
          values,
        );
      } catch (err) {
        insertErrors += batch.length;
        console.error(`  Error inserting batch ${Math.floor(i/BATCH_SIZE)+1}: ${err instanceof Error ? err.message : err}`);
      }
      console.log(`  ${Math.min(i + BATCH_SIZE, winnerRows.length)}/${winnerRows.length} rows written`);
    }
    console.log(`  ${winnerRows.length - insertErrors} winner mappings written${insertErrors > 0 ? ` (${insertErrors} errors)` : ""}`);

    // Also record minimal breakdowns (audit)
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
      // P1 fix: Run tripwire validation before promotion
      console.log("\n=== Running tripwire validation ===");
      const allowMissing = Boolean(opts.ingredientKey || opts.topN || opts.minFreq !== 25);
      const tripwireFailures = runTripwireValidation(results, { allowMissing });

      if (tripwireFailures.length > 0) {
        console.error("\n❌ TRIPWIRE FAILURES — promotion blocked:");
        for (const failure of tripwireFailures) {
          console.error(`  ${failure}`);
        }
        await client.query(
          `UPDATE lexical_mapping_runs SET status = 'failed', notes = $2 WHERE run_id = $1`,
          [runId, `Tripwire failures: ${tripwireFailures.join("; ")}`],
        );
        throw new Error(`Tripwire validation failed with ${tripwireFailures.length} errors. Run not promoted.`);
      }
      console.log("  ✓ All tripwires passed");

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
