/**
 * Build Canonical Aggregates
 *
 * For each distinct base canonical slug, creates a canonical_aggregates row
 * and links all cookable source foods via canonical_aggregate_sources.
 * Also inserts a synthetic food row into the foods table.
 *
 * Targets the 008_canonical_aggregates.sql schema.
 *
 * Usage:
 *   npx tsx scripts/build-canonical-aggregates.ts
 *   npx tsx scripts/build-canonical-aggregates.ts --slug black-pepper   # single identity
 *   npx tsx scripts/build-canonical-aggregates.ts --force               # rebuild all
 */

import { Pool, PoolClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const CANONICAL_VERSION = "1.0.0";
const BATCH_SIZE = 200; // aggregates per batch

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

interface CanonicalGroup {
  canonicalSlug: string;
  canonicalName: string;
  members: Array<{
    fdcId: number;
    dataType: string;
    description: string;
  }>;
}

/**
 * Load all specific-level canonical slugs and their cookable member foods.
 *
 * We aggregate at the 'specific' level because base-level slugs can be
 * ambiguous (e.g. "pepper" = both the spice and the vegetable).
 * Specific-level slugs like "black-pepper", "bell-peppers" match how a
 * human thinks about distinct cooking ingredients.
 */
async function loadCanonicalGroups(
  client: PoolClient,
  slugFilter?: string
): Promise<CanonicalGroup[]> {
  const conditions = [
    "cn.level = 'specific'",
    "ca.is_cookable = true",
  ];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (slugFilter) {
    conditions.push(`cn.canonical_slug = $${paramIndex}`);
    values.push(slugFilter);
    paramIndex++;
  }

  const sql = `
    SELECT
      cn.canonical_slug,
      cn.canonical_name,
      f.fdc_id,
      f.data_type,
      f.description
    FROM food_canonical_names cn
    JOIN foods f ON f.fdc_id = cn.fdc_id
    JOIN fdc_cookability_assessment ca ON ca.fdc_id = cn.fdc_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY cn.canonical_slug, f.fdc_id
  `;

  const result = await client.query<{
    canonical_slug: string;
    canonical_name: string;
    fdc_id: string;
    data_type: string;
    description: string;
  }>(sql, values);

  // Group by slug
  const groups = new Map<string, CanonicalGroup>();
  for (const row of result.rows) {
    const slug = row.canonical_slug;
    if (!groups.has(slug)) {
      groups.set(slug, {
        canonicalSlug: slug,
        canonicalName: row.canonical_name,
        members: [],
      });
    }
    groups.get(slug)!.members.push({
      fdcId: Number(row.fdc_id),
      dataType: row.data_type,
      description: row.description,
    });
  }

  return [...groups.values()];
}

/**
 * Pick a representative food: prefer SR Legacy, then Foundation, then most data points.
 */
function pickRepresentative(
  members: CanonicalGroup["members"]
): number {
  const priority: Record<string, number> = {
    sr_legacy: 0,
    foundation_food: 1,
  };
  const sorted = [...members].sort((a, b) => {
    const pa = priority[a.dataType] ?? 99;
    const pb = priority[b.dataType] ?? 99;
    return pa - pb;
  });
  return sorted[0].fdcId;
}

/**
 * Get distinct data types for members.
 */
function getDataTypes(members: CanonicalGroup["members"]): string[] {
  return [...new Set(members.map((m) => m.dataType))].sort();
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  console.log("=== Build Canonical Aggregates ===\n");
  console.log(`Version: ${CANONICAL_VERSION}`);

  const forceMode = process.argv.includes("--force");
  const slugIdx = process.argv.indexOf("--slug");
  const slugFilter = slugIdx !== -1 ? process.argv[slugIdx + 1] : undefined;

  if (forceMode) console.log("Force mode: rebuilding all aggregates");
  if (slugFilter) console.log(`Slug filter: ${slugFilter}`);
  console.log();

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Load canonical groups
    console.log("Loading canonical groups (specific level, cookable only)...");
    const groups = await loadCanonicalGroups(client, slugFilter);
    console.log(`  Found ${groups.length} canonical groups`);

    const totalMembers = groups.reduce((s, g) => s + g.members.length, 0);
    console.log(`  Total member foods: ${totalMembers}\n`);

    if (groups.length === 0) {
      console.log("No groups to process.");
      return;
    }

    // In non-force mode, check existing aggregates
    let existingSlugs = new Set<string>();
    if (!forceMode) {
      const existing = await client.query<{ canonical_slug: string }>(
        `SELECT canonical_slug FROM canonical_aggregates WHERE canonical_version = $1`,
        [CANONICAL_VERSION]
      );
      existingSlugs = new Set(existing.rows.map((r) => r.canonical_slug));
      const skipping = groups.filter((g) =>
        existingSlugs.has(g.canonicalSlug)
      ).length;
      console.log(
        `  Existing aggregates at version ${CANONICAL_VERSION}: ${existingSlugs.size} (skipping ${skipping})\n`
      );
    }

    let created = 0;
    let skipped = 0;
    let membersInserted = 0;

    // Process in batches
    for (let i = 0; i < groups.length; i += BATCH_SIZE) {
      const batch = groups.slice(i, i + BATCH_SIZE);

      await client.query("BEGIN");

      for (const group of batch) {
        if (!forceMode && existingSlugs.has(group.canonicalSlug)) {
          skipped++;
          continue;
        }

        const representativeFdcId = pickRepresentative(group.members);
        const dataTypes = getDataTypes(group.members);

        // Upsert canonical_aggregates
        const upsertResult = await client.query<{ canonical_id: string }>(
          `INSERT INTO canonical_aggregates
            (canonical_name, canonical_slug, level, food_count, data_types,
             representative_fdc_id, canonical_version)
           VALUES ($1, $2, 'specific', $3, $4, $5, $6)
           ON CONFLICT (canonical_slug) DO UPDATE SET
             canonical_name = EXCLUDED.canonical_name,
             food_count = EXCLUDED.food_count,
             data_types = EXCLUDED.data_types,
             representative_fdc_id = EXCLUDED.representative_fdc_id,
             canonical_version = EXCLUDED.canonical_version,
             computed_at = NOW()
           RETURNING canonical_id`,
          [
            group.canonicalName,
            group.canonicalSlug,
            group.members.length,
            dataTypes,
            representativeFdcId,
            CANONICAL_VERSION,
          ]
        );

        const canonicalId = Number(upsertResult.rows[0].canonical_id);

        // Clear existing sources for this aggregate (idempotent rebuild)
        await client.query(
          `DELETE FROM canonical_aggregate_sources WHERE canonical_id = $1`,
          [canonicalId]
        );

        // Insert sources in sub-batches (8 params per row, stay under 65535)
        const MEMBER_BATCH = 500;
        for (let j = 0; j < group.members.length; j += MEMBER_BATCH) {
          const memberBatch = group.members.slice(j, j + MEMBER_BATCH);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;

          for (const member of memberBatch) {
            placeholders.push(
              `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`
            );
            values.push(
              canonicalId,
              member.fdcId,
              member.dataType,
              member.description
            );
            idx += 4;
          }

          await client.query(
            `INSERT INTO canonical_aggregate_sources
              (canonical_id, fdc_id, data_type, description)
             VALUES ${placeholders.join(", ")}`,
            values
          );
          membersInserted += memberBatch.length;
        }

        // Upsert synthetic food in foods table
        await client.query(
          `INSERT INTO foods (fdc_id, description, data_type, is_synthetic, canonical_aggregate_id)
           VALUES ($1, $2, 'canonical_aggregate', TRUE, $3)
           ON CONFLICT (fdc_id) DO UPDATE SET
             description = EXCLUDED.description,
             data_type = EXCLUDED.data_type,
             is_synthetic = TRUE,
             canonical_aggregate_id = EXCLUDED.canonical_aggregate_id`,
          [canonicalId, group.canonicalName, canonicalId]
        );

        created++;
      }

      await client.query("COMMIT");

      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(groups.length / BATCH_SIZE);
      process.stdout.write(
        `\r  Batch ${batchNum}/${totalBatches} — ${created} created, ${skipped} skipped`
      );
    }

    console.log(
      `\n\n=== Summary ===`
    );
    console.log(`Canonical aggregates created/updated: ${created}`);
    console.log(`Skipped (already at version): ${skipped}`);
    console.log(`Source memberships inserted: ${membersInserted}`);

    // Show top 20 by member count
    console.log("\nTop 20 by food count:");
    const top = [...groups]
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 20);
    for (const g of top) {
      console.log(
        `  ${g.members.length.toString().padStart(4)} ${g.canonicalName} (${g.canonicalSlug})`
      );
    }

    // Verify
    const verifyResult = await client.query<{
      agg_count: string;
      src_count: string;
      syn_count: string;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM canonical_aggregates) as agg_count,
        (SELECT COUNT(*) FROM canonical_aggregate_sources) as src_count,
        (SELECT COUNT(*) FROM foods WHERE is_synthetic = TRUE) as syn_count`
    );
    const v = verifyResult.rows[0];
    console.log(`\nVerification:`);
    console.log(`  canonical_aggregates rows: ${v.agg_count}`);
    console.log(`  canonical_aggregate_sources rows: ${v.src_count}`);
    console.log(`  synthetic foods rows: ${v.syn_count}`);
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
