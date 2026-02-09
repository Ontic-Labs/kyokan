/**
 * Populate canonical_fdc_membership with MULTIPLE FDC foods per canonical
 *
 * Directly canonicalizes every food in the DB using canonicalizeDescription(),
 * then matches against canonical_ingredient slugs by baseSlug.
 * This gives each synthetic ingredient the full set of matching FDC foods,
 * enabling real nutrition range computation (P10–P90).
 *
 * IMPORTANT: Only foods from ALLOWED_CATEGORIES are considered.
 * Prepared foods, fast foods, baby foods, etc. are rejected at query time.
 *
 * Usage:
 *   npx tsx scripts/populate-multi-fdc-membership.ts          # dry run
 *   npx tsx scripts/populate-multi-fdc-membership.ts --write  # write to DB
 *   npx tsx scripts/populate-multi-fdc-membership.ts --write --slug garlic
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { canonicalizeDescription } from "../src/lib/canonicalize";
import { ALLOWED_CATEGORIES } from "./lib/constants";

dotenv.config({ path: ".env.local" });

// Re-export for backward compat (validate-data.ts etc.)
export { ALLOWED_CATEGORIES } from "./lib/constants";

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 1 });
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const slugIdx = process.argv.indexOf("--slug");
  const slugFilter = slugIdx !== -1 ? process.argv[slugIdx + 1] : undefined;

  console.log("=== Populate Multi-FDC Membership ===\n");
  console.log(`Mode: ${write ? "WRITE" : "DRY RUN"}`);
  if (slugFilter) console.log(`Filter: slug = ${slugFilter}`);
  console.log();

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Current state
    const currentState = await client.query<{
      canonical_count: string;
      membership_count: string;
      avg_members: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM canonical_ingredient) as canonical_count,
        (SELECT COUNT(*) FROM canonical_fdc_membership) as membership_count,
        COALESCE((
          SELECT AVG(cnt)::numeric(10,2) FROM (
            SELECT COUNT(*) as cnt FROM canonical_fdc_membership GROUP BY canonical_id
          ) sub
        ), 0) as avg_members
    `);
    const state = currentState.rows[0];
    console.log("Current state:");
    console.log(`  Canonical ingredients: ${state.canonical_count}`);
    console.log(`  Membership rows: ${state.membership_count}`);
    console.log(`  Avg FDC foods per canonical: ${state.avg_members}`);
    console.log();

    // ---------------------------------------------------------------
    // 1. Load FDC foods from ALLOWED categories only
    // ---------------------------------------------------------------
    console.log("Loading FDC foods from DB (allowed categories only)...");
    const foodsResult = await client.query<{
      fdc_id: string;
      description: string;
      data_type: string;
    }>(
      `SELECT f.fdc_id, f.description, f.data_type
       FROM foods f
       JOIN food_categories fc ON fc.category_id = f.category_id
       WHERE fc.name = ANY($1)
         AND f.description NOT ILIKE '%meatless%'
         AND f.description NOT ILIKE '%imitation%'
       ORDER BY f.fdc_id`,
      [ALLOWED_CATEGORIES as unknown as string[]]
    );

    console.log(`  ${foodsResult.rows.length} foods loaded`);

    // Build baseSlug → fdc_ids index
    const byBaseSlug = new Map<string, Array<{ fdcId: number; description: string; dataType: string }>>();
    let canonicalized = 0;

    for (const row of foodsResult.rows) {
      const result = canonicalizeDescription(row.description);
      const slug = result.baseSlug;
      if (!slug || slug === "unknown") continue;

      let group = byBaseSlug.get(slug);
      if (!group) {
        group = [];
        byBaseSlug.set(slug, group);
      }
      group.push({
        fdcId: Number(row.fdc_id),
        description: row.description,
        dataType: row.data_type,
      });
      canonicalized++;
    }

    console.log(`  ${canonicalized} foods canonicalized into ${byBaseSlug.size} base slugs`);

    // ---------------------------------------------------------------
    // 2. Load canonical_ingredient entries
    // ---------------------------------------------------------------
    const canonicalConditions: string[] = [];
    const canonicalValues: unknown[] = [];
    let paramIdx = 1;

    if (slugFilter) {
      canonicalConditions.push(`ci.canonical_slug = $${paramIdx}`);
      canonicalValues.push(slugFilter);
      paramIdx++;
    }

    const whereClause = canonicalConditions.length > 0
      ? `WHERE ${canonicalConditions.join(" AND ")}`
      : "";

    const canonicalsResult = await client.query<{
      canonical_id: string;
      canonical_slug: string;
      canonical_name: string;
    }>(
      `SELECT canonical_id, canonical_slug, canonical_name
       FROM canonical_ingredient ci
       ${whereClause}
       ORDER BY canonical_rank NULLS LAST`,
      canonicalValues
    );
    console.log(`  ${canonicalsResult.rows.length} canonical ingredients to process`);

    // ---------------------------------------------------------------
    // 3. Load existing memberships to skip duplicates
    // ---------------------------------------------------------------
    const existingResult = await client.query<{
      canonical_id: string;
      fdc_id: string;
    }>(`SELECT canonical_id, fdc_id FROM canonical_fdc_membership`);

    const existingPairs = new Set<string>();
    for (const row of existingResult.rows) {
      existingPairs.add(`${row.canonical_id}:${row.fdc_id}`);
    }
    console.log(`  ${existingPairs.size} existing memberships loaded`);
    console.log();

    // ---------------------------------------------------------------
    // 4. Match canonical ingredients to FDC foods by baseSlug
    // ---------------------------------------------------------------
    interface NewMembership {
      canonicalId: string;
      fdcId: number;
      description: string;
      dataType: string;
    }

    const newRows: NewMembership[] = [];
    const byCanonical = new Map<string, { slug: string; name: string; foods: string[] }>();

    for (const ci of canonicalsResult.rows) {
      const matched = byBaseSlug.get(ci.canonical_slug) ?? [];

      for (const food of matched) {
        const key = `${ci.canonical_id}:${food.fdcId}`;
        if (existingPairs.has(key)) continue;

        newRows.push({
          canonicalId: ci.canonical_id,
          fdcId: food.fdcId,
          description: food.description,
          dataType: food.dataType,
        });

        let group = byCanonical.get(ci.canonical_id);
        if (!group) {
          group = { slug: ci.canonical_slug, name: ci.canonical_name, foods: [] };
          byCanonical.set(ci.canonical_id, group);
        }
        group.foods.push(`${food.description} (${food.dataType})`);
      }
    }

    console.log(`New FDC memberships to add: ${newRows.length}`);
    console.log(`Canonicals gaining new members: ${byCanonical.size}`);

    if (newRows.length === 0) {
      console.log("\nNo new memberships to add.");

      // Still show current distribution
      const dist = await client.query<{
        bucket: string;
        cnt: string;
      }>(`
        SELECT
          CASE
            WHEN member_count = 0 THEN '0'
            WHEN member_count = 1 THEN '1'
            WHEN member_count BETWEEN 2 AND 5 THEN '2-5'
            WHEN member_count BETWEEN 6 AND 10 THEN '6-10'
            WHEN member_count BETWEEN 11 AND 20 THEN '11-20'
            ELSE '20+'
          END as bucket,
          COUNT(*) as cnt
        FROM (
          SELECT ci.canonical_id, COALESCE(m.mc, 0) as member_count
          FROM canonical_ingredient ci
          LEFT JOIN (
            SELECT canonical_id, COUNT(*) as mc
            FROM canonical_fdc_membership GROUP BY canonical_id
          ) m ON m.canonical_id = ci.canonical_id
        ) sub
        GROUP BY 1
        ORDER BY MIN(member_count)
      `);
      console.log("\nMembership distribution:");
      for (const row of dist.rows) {
        console.log(`  ${row.bucket.padStart(5)} members: ${row.cnt} canonicals`);
      }
      return;
    }

    // Show top 15 by new member count
    console.log("\nSample (top 15 by new member count):");
    const sorted = [...byCanonical.entries()]
      .sort((a, b) => b[1].foods.length - a[1].foods.length)
      .slice(0, 15);
    for (const [, group] of sorted) {
      console.log(`  ${group.name} (${group.slug}): +${group.foods.length} foods`);
      for (const food of group.foods.slice(0, 3)) {
        console.log(`    - ${food}`);
      }
      if (group.foods.length > 3) {
        console.log(`    ... and ${group.foods.length - 3} more`);
      }
    }

    if (write) {
      console.log("\n=== Writing to Database ===");

      await client.query("BEGIN");

      const BATCH = 500;
      let inserted = 0;

      for (let i = 0; i < newRows.length; i += BATCH) {
        const batch = newRows.slice(i, i + BATCH);
        const vals: unknown[] = [];
        const placeholders: string[] = [];
        let idx = 1;

        for (const row of batch) {
          placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
          vals.push(row.canonicalId, row.fdcId, "canonical_base_slug", 1.0);
          idx += 4;
        }

        await client.query(
          `INSERT INTO canonical_fdc_membership
            (canonical_id, fdc_id, membership_reason, weight)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (canonical_id, fdc_id) DO NOTHING`,
          vals
        );
        inserted += batch.length;

        if ((i + BATCH) % 2000 < BATCH || i + BATCH >= newRows.length) {
          process.stdout.write(`\r  ${inserted} rows inserted...`);
        }
      }

      await client.query("COMMIT");
      console.log(`\r  ${inserted} rows inserted.   \n`);

      // Verify new state
      const newState = await client.query<{
        membership_count: string;
        avg_members: string;
        max_members: string;
      }>(`
        SELECT
          (SELECT COUNT(*) FROM canonical_fdc_membership) as membership_count,
          (SELECT AVG(cnt)::numeric(10,2) FROM (
            SELECT COUNT(*) as cnt FROM canonical_fdc_membership GROUP BY canonical_id
          ) sub) as avg_members,
          (SELECT MAX(cnt) FROM (
            SELECT COUNT(*) as cnt FROM canonical_fdc_membership GROUP BY canonical_id
          ) sub) as max_members
      `);
      const ns = newState.rows[0];
      console.log("New state:");
      console.log(`  Membership rows: ${ns.membership_count}`);
      console.log(`  Avg FDC foods per canonical: ${ns.avg_members}`);
      console.log(`  Max FDC foods per canonical: ${ns.max_members}`);

      // Show top canonicals by member count
      const topCanonicals = await client.query<{
        canonical_name: string;
        member_count: string;
      }>(`
        SELECT ci.canonical_name, COUNT(cfm.fdc_id) as member_count
        FROM canonical_ingredient ci
        JOIN canonical_fdc_membership cfm ON cfm.canonical_id = ci.canonical_id
        GROUP BY ci.canonical_id, ci.canonical_name
        ORDER BY member_count DESC
        LIMIT 20
      `);

      console.log("\nTop canonicals by FDC member count:");
      for (const row of topCanonicals.rows) {
        console.log(`  ${row.canonical_name}: ${row.member_count} foods`);
      }

      // Distribution
      const dist = await client.query<{
        bucket: string;
        cnt: string;
      }>(`
        SELECT
          CASE
            WHEN member_count = 0 THEN '0'
            WHEN member_count = 1 THEN '1'
            WHEN member_count BETWEEN 2 AND 5 THEN '2-5'
            WHEN member_count BETWEEN 6 AND 10 THEN '6-10'
            WHEN member_count BETWEEN 11 AND 20 THEN '11-20'
            ELSE '20+'
          END as bucket,
          COUNT(*) as cnt
        FROM (
          SELECT ci.canonical_id, COALESCE(m.mc, 0) as member_count
          FROM canonical_ingredient ci
          LEFT JOIN (
            SELECT canonical_id, COUNT(*) as mc
            FROM canonical_fdc_membership GROUP BY canonical_id
          ) m ON m.canonical_id = ci.canonical_id
        ) sub
        GROUP BY 1
        ORDER BY MIN(member_count)
      `);
      console.log("\nMembership distribution:");
      for (const row of dist.rows) {
        console.log(`  ${row.bucket.padStart(5)} members: ${row.cnt} canonicals`);
      }

      console.log("\nNext step: npx tsx scripts/aggregate-recipe-nutrients.ts --force");
    } else {
      console.log("\nDry run - no changes made. Use --write to insert rows.");
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
