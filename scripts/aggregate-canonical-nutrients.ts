/**
 * Aggregate Canonical Nutrients
 *
 * For each canonical aggregate, computes statistical nutrient values
 * (median, p5, p95, min, max) across all member foods and writes to
 * canonical_aggregate_nutrients.
 *
 * Targets the 008_canonical_aggregates.sql schema.
 *
 * Usage:
 *   npx tsx scripts/aggregate-canonical-nutrients.ts
 *   npx tsx scripts/aggregate-canonical-nutrients.ts --slug black-pepper
 *   npx tsx scripts/aggregate-canonical-nutrients.ts --force
 */

import { Pool, PoolClient } from "pg";
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
  return new Pool({ connectionString, max: 5 });
}

interface AggregateInfo {
  canonicalId: number;
  canonicalSlug: string;
  canonicalName: string;
  foodCount: number;
}

interface NutrientStat {
  nutrientId: number;
  median: number;
  p5: number | null;
  p95: number | null;
  min: number;
  max: number;
  sampleCount: number;
}

// ============================================
// Percentile computation (in JS to avoid
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

function computeStats(amounts: number[]): {
  median: number;
  p5: number | null;
  p95: number | null;
  min: number;
  max: number;
} {
  const sorted = [...amounts].sort((a, b) => a - b);
  const n = sorted.length;

  return {
    median: percentile(sorted, 0.5),
    p5: n >= 3 ? percentile(sorted, 0.05) : null,
    p95: n >= 3 ? percentile(sorted, 0.95) : null,
    min: sorted[0],
    max: sorted[n - 1],
  };
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  console.log("=== Aggregate Canonical Nutrients ===\n");

  const forceMode = process.argv.includes("--force");
  const slugIdx = process.argv.indexOf("--slug");
  const slugFilter = slugIdx !== -1 ? process.argv[slugIdx + 1] : undefined;

  if (forceMode) console.log("Force mode: recomputing all");
  if (slugFilter) console.log(`Slug filter: ${slugFilter}`);
  console.log();

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Load aggregates to process
    const conditions = ["1=1"];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (slugFilter) {
      conditions.push(`canonical_slug = $${paramIndex}`);
      values.push(slugFilter);
      paramIndex++;
    }

    if (!forceMode) {
      // Skip aggregates that already have nutrients computed
      conditions.push(
        `canonical_id NOT IN (SELECT DISTINCT canonical_id FROM canonical_aggregate_nutrients)`
      );
    }

    const aggregates = await client.query<{
      canonical_id: string;
      canonical_slug: string;
      canonical_name: string;
      food_count: string;
    }>(
      `SELECT canonical_id, canonical_slug, canonical_name, food_count
       FROM canonical_aggregates
       WHERE ${conditions.join(" AND ")}
       ORDER BY food_count DESC`,
      values
    );

    const aggs: AggregateInfo[] = aggregates.rows.map((r) => ({
      canonicalId: Number(r.canonical_id),
      canonicalSlug: r.canonical_slug,
      canonicalName: r.canonical_name,
      foodCount: Number(r.food_count),
    }));

    console.log(`Aggregates to process: ${aggs.length}\n`);

    if (aggs.length === 0) {
      console.log("Nothing to process.");
      return;
    }

    let totalNutrientRows = 0;
    let processed = 0;

    for (const agg of aggs) {
      // Pull all nutrient amounts for member foods
      const nutrientData = await client.query<{
        nutrient_id: string;
        amount: string;
      }>(
        `SELECT fn.nutrient_id, fn.amount
         FROM food_nutrients fn
         JOIN canonical_aggregate_sources cas ON cas.fdc_id = fn.fdc_id
         WHERE cas.canonical_id = $1
         ORDER BY fn.nutrient_id, fn.amount`,
        [agg.canonicalId]
      );

      // Group amounts by nutrient
      const nutrientAmounts = new Map<number, number[]>();
      for (const row of nutrientData.rows) {
        const nid = Number(row.nutrient_id);
        const amt = Number(row.amount);
        if (!nutrientAmounts.has(nid)) {
          nutrientAmounts.set(nid, []);
        }
        nutrientAmounts.get(nid)!.push(amt);
      }

      // Compute stats per nutrient
      const stats: NutrientStat[] = [];
      for (const [nutrientId, amounts] of nutrientAmounts) {
        if (amounts.length === 0) continue;
        const s = computeStats(amounts);
        stats.push({
          nutrientId,
          median: s.median,
          p5: s.p5,
          p95: s.p95,
          min: s.min,
          max: s.max,
          sampleCount: amounts.length,
        });
      }

      if (stats.length === 0) {
        processed++;
        continue;
      }

      // Write to DB in batches
      await client.query("BEGIN");

      // Clear existing nutrients for this aggregate (idempotent)
      if (forceMode) {
        await client.query(
          `DELETE FROM canonical_aggregate_nutrients WHERE canonical_id = $1`,
          [agg.canonicalId]
        );
      }

      // Insert nutrients (8 params per row, batch to stay under 65535)
      const NUTRIENT_BATCH = 500;
      for (let j = 0; j < stats.length; j += NUTRIENT_BATCH) {
        const batch = stats.slice(j, j + NUTRIENT_BATCH);
        const vals: unknown[] = [];
        const placeholders: string[] = [];
        let idx = 1;

        for (const s of batch) {
          placeholders.push(
            `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`
          );
          vals.push(
            agg.canonicalId,
            s.nutrientId,
            s.median,
            s.p5,
            s.p95,
            s.min,
            s.max,
            s.sampleCount
          );
          idx += 8;
        }

        await client.query(
          `INSERT INTO canonical_aggregate_nutrients
            (canonical_id, nutrient_id, median_amount, p5_amount, p95_amount,
             min_amount, max_amount, sample_count)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (canonical_id, nutrient_id) DO UPDATE SET
             median_amount = EXCLUDED.median_amount,
             p5_amount = EXCLUDED.p5_amount,
             p95_amount = EXCLUDED.p95_amount,
             min_amount = EXCLUDED.min_amount,
             max_amount = EXCLUDED.max_amount,
             sample_count = EXCLUDED.sample_count`,
          vals
        );

        totalNutrientRows += batch.length;
      }

      await client.query("COMMIT");
      processed++;

      if (processed % 100 === 0 || processed === aggs.length) {
        process.stdout.write(
          `\r  ${processed}/${aggs.length} aggregates processed, ${totalNutrientRows} nutrient rows`
        );
      }
    }

    console.log(
      `\n\n=== Summary ===`
    );
    console.log(`Aggregates processed: ${processed}`);
    console.log(`Nutrient rows inserted: ${totalNutrientRows}`);

    // Show sample output for first aggregate
    if (aggs.length > 0) {
      const sample = aggs[0];
      console.log(
        `\nSample: "${sample.canonicalName}" (${sample.foodCount} foods)`
      );

      const sampleNutrients = await client.query<{
        name: string;
        unit_name: string;
        median_amount: string;
        p5_amount: string | null;
        p95_amount: string | null;
        sample_count: string;
      }>(
        `SELECT n.name, n.unit_name, can.median_amount, can.p5_amount, can.p95_amount, can.sample_count
         FROM canonical_aggregate_nutrients can
         JOIN nutrients n ON n.nutrient_id = can.nutrient_id
         WHERE can.canonical_id = $1
         ORDER BY n.nutrient_rank NULLS LAST
         LIMIT 15`,
        [sample.canonicalId]
      );

      for (const row of sampleNutrients.rows) {
        const p5 = row.p5_amount ? Number(row.p5_amount).toFixed(1) : "—";
        const p95 = row.p95_amount ? Number(row.p95_amount).toFixed(1) : "—";
        console.log(
          `  ${row.name}: ${Number(row.median_amount).toFixed(1)} ${row.unit_name} [${p5}–${p95}] (n=${row.sample_count})`
        );
      }
    }

    // Verify
    const verifyResult = await client.query<{
      agg_with_nutrients: string;
      total_nutrient_rows: string;
    }>(
      `SELECT
        (SELECT COUNT(DISTINCT canonical_id) FROM canonical_aggregate_nutrients) as agg_with_nutrients,
        (SELECT COUNT(*) FROM canonical_aggregate_nutrients) as total_nutrient_rows`
    );
    const v = verifyResult.rows[0];
    console.log(`\nVerification:`);
    console.log(`  Aggregates with nutrients: ${v.agg_with_nutrients}`);
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
