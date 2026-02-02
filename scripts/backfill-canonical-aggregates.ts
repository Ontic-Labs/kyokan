/**
 * Backfill Canonical Aggregates
 *
 * Populates the canonical_aggregates table with synthetic FDC IDs (9,200,000+)
 * by aggregating data from food_canonical_names.
 *
 * Usage:
 *   npx tsx scripts/backfill-canonical-aggregates.ts
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const BATCH_SIZE = 1000;

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 5 });
}

async function main() {
  const pool = getPool();

  try {
    console.log("Backfilling canonical aggregates...\n");

    // Get distinct canonical slugs with counts (use MIN for canonical_name when slugs collide)
    const aggregatesResult = await pool.query<{
      canonical_name: string;
      canonical_slug: string;
      level: string;
      food_count: string;
      data_types: string[];
      representative_fdc_id: string;
    }>(`
      SELECT
        MIN(cn.canonical_name) as canonical_name,
        cn.canonical_slug,
        cn.level,
        COUNT(*) as food_count,
        ARRAY_AGG(DISTINCT f.data_type) as data_types,
        (
          SELECT cn2.fdc_id
          FROM food_canonical_names cn2
          JOIN foods f2 ON cn2.fdc_id = f2.fdc_id
          WHERE cn2.canonical_slug = cn.canonical_slug AND cn2.level = cn.level
          ORDER BY
            CASE f2.data_type
              WHEN 'Foundation' THEN 1
              WHEN 'SR Legacy' THEN 2
              ELSE 3
            END,
            f2.fdc_id
          LIMIT 1
        ) as representative_fdc_id
      FROM food_canonical_names cn
      JOIN foods f ON cn.fdc_id = f.fdc_id
      GROUP BY cn.canonical_slug, cn.level
      ORDER BY COUNT(*) DESC
    `);

    const aggregates = aggregatesResult.rows;
    console.log(`Found ${aggregates.length.toLocaleString()} unique canonical names\n`);

    if (aggregates.length === 0) {
      console.log("No canonical names found. Run backfill-canonical-names.ts first.");
      return;
    }

    // Clear existing aggregates
    await pool.query("DELETE FROM canonical_aggregate_sources");
    await pool.query("DELETE FROM canonical_aggregate_nutrients");
    await pool.query("DELETE FROM canonical_aggregates");
    await pool.query("ALTER SEQUENCE canonical_aggregate_id_seq RESTART WITH 9200000");
    console.log("Cleared existing aggregates\n");

    // Insert in batches
    let inserted = 0;
    for (let i = 0; i < aggregates.length; i += BATCH_SIZE) {
      const batch = aggregates.slice(i, i + BATCH_SIZE);

      const values: unknown[] = [];
      const placeholders: string[] = [];

      batch.forEach((agg, idx) => {
        const base = idx * 5;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
        );
        values.push(
          agg.canonical_name,
          agg.canonical_slug,
          agg.level,
          parseInt(agg.food_count, 10),
          agg.data_types
        );
      });

      await pool.query(
        `
        INSERT INTO canonical_aggregates
          (canonical_name, canonical_slug, level, food_count, data_types)
        VALUES ${placeholders.join(", ")}
        `,
        values
      );

      inserted += batch.length;
      console.log(`Inserted ${inserted.toLocaleString()}/${aggregates.length.toLocaleString()} aggregates`);
    }

    // Now populate the sources junction table
    console.log("\nPopulating source links...");

    await pool.query(`
      INSERT INTO canonical_aggregate_sources (canonical_id, fdc_id, data_type, description)
      SELECT
        ca.canonical_id,
        cn.fdc_id,
        f.data_type,
        f.description
      FROM canonical_aggregates ca
      JOIN food_canonical_names cn ON cn.canonical_slug = ca.canonical_slug AND cn.level = ca.level
      JOIN foods f ON cn.fdc_id = f.fdc_id
    `);

    const sourcesCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM canonical_aggregate_sources"
    );
    console.log(`Linked ${parseInt(sourcesCount.rows[0].count, 10).toLocaleString()} source foods\n`);

    // Update representative_fdc_id
    console.log("Setting representative foods...");
    await pool.query(`
      UPDATE canonical_aggregates ca
      SET representative_fdc_id = (
        SELECT cas.fdc_id
        FROM canonical_aggregate_sources cas
        JOIN foods f ON cas.fdc_id = f.fdc_id
        WHERE cas.canonical_id = ca.canonical_id
        ORDER BY
          CASE f.data_type
            WHEN 'Foundation' THEN 1
            WHEN 'SR Legacy' THEN 2
            ELSE 3
          END,
          f.fdc_id
        LIMIT 1
      )
    `);

    // Summary
    const finalCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM canonical_aggregates"
    );
    const idRange = await pool.query<{ min_id: string; max_id: string }>(
      "SELECT MIN(canonical_id) as min_id, MAX(canonical_id) as max_id FROM canonical_aggregates"
    );

    console.log("\n=== Summary ===");
    console.log(`Total aggregates: ${parseInt(finalCount.rows[0].count, 10).toLocaleString()}`);
    console.log(`ID range: ${idRange.rows[0].min_id} - ${idRange.rows[0].max_id}`);

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
