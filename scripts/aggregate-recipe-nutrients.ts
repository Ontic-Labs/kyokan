/**
 * Aggregate Recipe-First Canonical Ingredient Nutrients
 *
 * For each canonical_ingredient (from migration 009), computes statistical
 * nutrient values (median, p10, p90, p25, p75, min, max) across all member
 * foods via canonical_fdc_membership → food_nutrients.
 *
 * Writes to canonical_ingredient_nutrients (migration 011).
 *
 * Usage:
 *   npx tsx scripts/aggregate-recipe-nutrients.ts
 *   npx tsx scripts/aggregate-recipe-nutrients.ts --slug ground-beef
 *   npx tsx scripts/aggregate-recipe-nutrients.ts --force
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// ============================================
// Database
// ============================================

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 1 });
}

interface CanonicalInfo {
  canonicalId: string;
  canonicalSlug: string;
  canonicalName: string;
  memberCount: number;
}

interface NutrientStat {
  nutrientId: number;
  unitName: string;
  median: number;
  p10: number | null;
  p90: number | null;
  p25: number | null;
  p75: number | null;
  min: number;
  max: number;
  nSamples: number;
  nTotal: number;
}

// ============================================
// Percentile computation (JS to avoid
// PostgreSQL percentile_cont over pooler issues)
// ============================================

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;

  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function computeStats(
  amounts: number[],
  nTotal: number
): Omit<NutrientStat, "nutrientId" | "unitName"> {
  if (amounts.length === 0) {
    throw new Error("computeStats called with empty amounts");
  }
  const sorted = [...amounts].sort((a, b) => a - b);
  const n = sorted.length;

  return {
    median: percentile(sorted, 0.5),
    p10: n >= 3 ? percentile(sorted, 0.1) : null,
    p90: n >= 3 ? percentile(sorted, 0.9) : null,
    p25: n >= 3 ? percentile(sorted, 0.25) : null,
    p75: n >= 3 ? percentile(sorted, 0.75) : null,
    min: sorted[0],
    max: sorted[n - 1],
    nSamples: n,
    nTotal,
  };
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  console.log("=== Aggregate Recipe-First Canonical Nutrients ===\n");

  const forceMode = process.argv.includes("--force");
  const slugIdx = process.argv.indexOf("--slug");
  let slugFilter: string | undefined;

  if (slugIdx !== -1) {
    const nextArg = process.argv[slugIdx + 1];
    if (!nextArg || nextArg.startsWith("--")) {
      console.error("Error: --slug requires a value");
      process.exit(1);
    }
    if (!/^[a-z0-9-]+$/.test(nextArg)) {
      console.error("Error: slug must be lowercase kebab-case");
      process.exit(1);
    }
    slugFilter = nextArg;
  }

  if (forceMode) console.log("Force mode: recomputing all");
  if (slugFilter) console.log(`Slug filter: ${slugFilter}`);
  console.log();

  const pool = getPool();
  const client = await pool.connect();

  // Clean shutdown on SIGINT/SIGTERM
  const cleanup = async () => {
    console.log("\nShutting down...");
    client.release();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    // Load canonical ingredients with member counts
    const conditions = ["m.member_count > 0"];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (slugFilter) {
      conditions.push(`ci.canonical_slug = $${paramIndex}`);
      values.push(slugFilter);
      paramIndex++;
    }

    if (!forceMode) {
      conditions.push(
        `ci.canonical_id NOT IN (SELECT DISTINCT canonical_id FROM canonical_ingredient_nutrients)`
      );
    }

    const result = await client.query<{
      canonical_id: string;
      canonical_slug: string;
      canonical_name: string;
      member_count: string;
    }>(
      `SELECT ci.canonical_id, ci.canonical_slug, ci.canonical_name,
              m.member_count
       FROM canonical_ingredient ci
       JOIN (
         SELECT canonical_id, COUNT(*) as member_count
         FROM canonical_fdc_membership
         GROUP BY canonical_id
       ) m ON ci.canonical_id = m.canonical_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ci.canonical_rank`,
      values
    );

    const canonicals: CanonicalInfo[] = result.rows.map((r) => ({
      canonicalId: r.canonical_id,
      canonicalSlug: r.canonical_slug,
      canonicalName: r.canonical_name,
      memberCount: Number(r.member_count),
    }));

    console.log(`Canonical ingredients to process: ${canonicals.length}\n`);

    if (canonicals.length === 0) {
      console.log("Nothing to process.");
      return;
    }

    let totalNutrientRows = 0;
    let processed = 0;

    let failed = 0;

    for (const ci of canonicals) {
      try {
        // Pull all nutrient amounts for member foods
        const nutrientData = await client.query<{
          nutrient_id: string;
          unit_name: string;
          amount: string;
        }>(
          `SELECT fn.nutrient_id, n.unit_name, fn.amount
           FROM food_nutrients fn
           JOIN canonical_fdc_membership cfm ON cfm.fdc_id = fn.fdc_id
           JOIN nutrients n ON n.nutrient_id = fn.nutrient_id
           WHERE cfm.canonical_id = $1
           ORDER BY fn.nutrient_id, fn.amount`,
          [ci.canonicalId]
        );

        // Group amounts by nutrient (with NaN guard)
        const nutrientAmounts = new Map<
          number,
          { unitName: string; amounts: number[] }
        >();
        for (const row of nutrientData.rows) {
          const nid = Number(row.nutrient_id);
          const amt = Number(row.amount);
          if (Number.isNaN(nid) || Number.isNaN(amt)) {
            console.warn(
              `  Skipping invalid row for "${ci.canonicalSlug}": nutrient_id=${row.nutrient_id}, amount=${row.amount}`
            );
            continue;
          }
          let entry = nutrientAmounts.get(nid);
          if (!entry) {
            entry = { unitName: row.unit_name, amounts: [] };
            nutrientAmounts.set(nid, entry);
          }
          entry.amounts.push(amt);
        }

        // Compute stats per nutrient
        const stats: NutrientStat[] = [];
        for (const [nutrientId, { unitName, amounts }] of nutrientAmounts) {
          if (amounts.length === 0) continue;
          const s = computeStats(amounts, ci.memberCount);
          stats.push({ nutrientId, unitName, ...s });
        }

        if (stats.length === 0) {
          processed++;
          continue;
        }

        // Write to DB in batches (UPSERT first, then cleanup stale rows)
        await client.query("BEGIN");

        const now = new Date();
        const NUTRIENT_BATCH = 500;
        for (let j = 0; j < stats.length; j += NUTRIENT_BATCH) {
          const batch = stats.slice(j, j + NUTRIENT_BATCH);
          const vals: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;

          for (const s of batch) {
            placeholders.push(
              `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10}, $${idx + 11}, $${idx + 12})`
            );
            vals.push(
              ci.canonicalId,
              s.nutrientId,
              s.unitName,
              s.median,
              s.p10,
              s.p90,
              s.p25,
              s.p75,
              s.min,
              s.max,
              s.nSamples,
              s.nTotal,
              now
            );
            idx += 13;
          }

          await client.query(
            `INSERT INTO canonical_ingredient_nutrients
              (canonical_id, nutrient_id, unit_name, median, p10, p90, p25, p75,
               min_amount, max_amount, n_samples, n_total, computed_at)
             VALUES ${placeholders.join(", ")}
             ON CONFLICT (canonical_id, nutrient_id) DO UPDATE SET
               unit_name = EXCLUDED.unit_name,
               median = EXCLUDED.median,
               p10 = EXCLUDED.p10,
               p90 = EXCLUDED.p90,
               p25 = EXCLUDED.p25,
               p75 = EXCLUDED.p75,
               min_amount = EXCLUDED.min_amount,
               max_amount = EXCLUDED.max_amount,
               n_samples = EXCLUDED.n_samples,
               n_total = EXCLUDED.n_total,
               computed_at = EXCLUDED.computed_at`,
            vals
          );

          totalNutrientRows += batch.length;
        }

        // In force mode, remove stale nutrient rows (nutrients no longer
        // present in member foods). Done AFTER inserts so a crash leaves
        // stale-but-present data rather than missing data.
        if (forceMode) {
          const currentNutrientIds = stats.map((s) => s.nutrientId);
          await client.query(
            `DELETE FROM canonical_ingredient_nutrients
             WHERE canonical_id = $1
             AND nutrient_id != ALL($2::int[])`,
            [ci.canonicalId, currentNutrientIds]
          );
        }

        await client.query("COMMIT");
        processed++;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        failed++;
        console.error(`\nFailed for "${ci.canonicalSlug}": ${err}`);
      }

      if (processed % 50 === 0 || processed === canonicals.length) {
        process.stdout.write(
          `\r\x1b[K  ${processed}/${canonicals.length} ingredients processed, ${totalNutrientRows} nutrient rows${failed > 0 ? `, ${failed} failed` : ""}`
        );
      }
    }

    console.log(`\n\n=== Summary ===`);
    console.log(`Canonical ingredients processed: ${processed}`);
    if (failed > 0) console.log(`Failed: ${failed}`);
    console.log(`Nutrient rows upserted: ${totalNutrientRows}`);

    // Show sample output
    if (canonicals.length > 0) {
      const sample = canonicals[0];
      console.log(
        `\nSample: "${sample.canonicalName}" (${sample.memberCount} member foods)`
      );

      const sampleNutrients = await client.query<{
        name: string;
        unit_name: string;
        median: string;
        p10: string | null;
        p90: string | null;
        n_samples: string;
      }>(
        `SELECT n.name, cin.unit_name, cin.median, cin.p10, cin.p90, cin.n_samples
         FROM canonical_ingredient_nutrients cin
         JOIN nutrients n ON n.nutrient_id = cin.nutrient_id
         WHERE cin.canonical_id = $1
         ORDER BY n.nutrient_rank NULLS LAST
         LIMIT 15`,
        [sample.canonicalId]
      );

      for (const row of sampleNutrients.rows) {
        const p10 = row.p10 ? Number(row.p10).toFixed(1) : "—";
        const p90 = row.p90 ? Number(row.p90).toFixed(1) : "—";
        console.log(
          `  ${row.name}: ${Number(row.median).toFixed(1)} ${row.unit_name} [${p10}–${p90}] (n=${row.n_samples})`
        );
      }
    }

    // Verification
    const verify = await client.query<{
      ingredients_with_nutrients: string;
      total_nutrient_rows: string;
    }>(
      `SELECT
        (SELECT COUNT(DISTINCT canonical_id) FROM canonical_ingredient_nutrients) as ingredients_with_nutrients,
        (SELECT COUNT(*) FROM canonical_ingredient_nutrients) as total_nutrient_rows`
    );
    const v = verify.rows[0];
    console.log(`\nVerification:`);
    console.log(
      `  Canonical ingredients with nutrients: ${v.ingredients_with_nutrients}`
    );
    console.log(`  Total nutrient rows: ${v.total_nutrient_rows}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
