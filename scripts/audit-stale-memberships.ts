/**
 * Audit stale canonical_fdc_membership rows where the current
 * canonicalizeDescription() baseSlug no longer matches the canonical_slug.
 *
 * These are leftovers from older matching logic (e.g. "Cookies, butter"
 * matched to canonical_slug="butter" instead of "cookies").
 *
 * Usage:
 *   npx tsx scripts/audit-stale-memberships.ts            # dry run
 *   npx tsx scripts/audit-stale-memberships.ts --delete    # remove stale rows
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { canonicalizeDescription } from "../src/lib/canonicalize";

dotenv.config({ path: ".env.local" });

async function main(): Promise<void> {
  const doDelete = process.argv.includes("--delete");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  console.log("=== Audit Stale FDC Memberships ===\n");
  console.log(`Mode: ${doDelete ? "DELETE" : "DRY RUN"}\n`);

  // Pull all canonical_slug_match memberships
  const result = await pool.query<{
    canonical_id: string;
    fdc_id: string;
    description: string;
    canonical_slug: string;
    canonical_name: string;
    category_name: string | null;
    membership_reason: string;
  }>(`
    SELECT cfm.canonical_id, cfm.fdc_id, f.description,
           ci.canonical_slug, ci.canonical_name,
           fc.name as category_name,
           cfm.membership_reason
    FROM canonical_fdc_membership cfm
    JOIN foods f ON f.fdc_id = cfm.fdc_id
    JOIN canonical_ingredient ci ON ci.canonical_id = cfm.canonical_id
    LEFT JOIN food_categories fc ON fc.category_id = f.category_id
  `);

  console.log(`Total membership rows: ${result.rows.length}\n`);

  // Check each row against current canonicalize logic
  const staleRows: Array<{
    canonicalId: string;
    fdcId: string;
    food: string;
    category: string;
    canonicalSlug: string;
    actualBaseSlug: string;
    reason: string;
  }> = [];

  for (const row of result.rows) {
    const canonical = canonicalizeDescription(row.description);

    // A membership is stale if the food's current baseSlug doesn't match
    // the canonical_slug it's assigned to
    if (canonical.baseSlug !== row.canonical_slug) {
      staleRows.push({
        canonicalId: row.canonical_id,
        fdcId: row.fdc_id,
        food: row.description,
        category: row.category_name ?? "?",
        canonicalSlug: row.canonical_slug,
        actualBaseSlug: canonical.baseSlug,
        reason: row.membership_reason,
      });
    }
  }

  console.log(`Stale memberships found: ${staleRows.length}\n`);

  if (staleRows.length === 0) {
    console.log("No stale memberships. All clean!");
    await pool.end();
    return;
  }

  // Group by canonical_slug for display
  const byCanonical = new Map<string, typeof staleRows>();
  for (const row of staleRows) {
    let group = byCanonical.get(row.canonicalSlug);
    if (!group) {
      group = [];
      byCanonical.set(row.canonicalSlug, group);
    }
    group.push(row);
  }

  // Show examples (limit to 30 canonicals)
  let shown = 0;
  for (const [slug, rows] of byCanonical) {
    if (shown >= 30) {
      console.log(`... and ${byCanonical.size - shown} more canonicals\n`);
      break;
    }
    console.log(`  ${slug}:`);
    for (const r of rows) {
      console.log(`    ✗ "${r.food}" [${r.category}] → should be "${r.actualBaseSlug}" (via ${r.reason})`);
    }
    shown++;
  }

  // Delete if requested
  if (doDelete) {
    console.log(`\nDeleting ${staleRows.length} stale membership rows...`);

    const pairs = staleRows.map((r) => `('${r.canonicalId}', ${r.fdcId})`);
    const BATCH = 500;
    let deleted = 0;

    for (let i = 0; i < pairs.length; i += BATCH) {
      const batch = pairs.slice(i, i + BATCH);
      const res = await pool.query(
        `DELETE FROM canonical_fdc_membership
         WHERE (canonical_id, fdc_id::text) IN (${batch.join(", ")})`
      );
      deleted += res.rowCount ?? 0;
    }

    console.log(`Deleted: ${deleted} rows`);

    // Show updated totals
    const verify = await pool.query<{ cnt: string }>(`
      SELECT COUNT(*) as cnt FROM canonical_fdc_membership
    `);
    console.log(`Remaining memberships: ${verify.rows[0].cnt}`);
  } else {
    console.log(`\nRun with --delete to remove these stale rows.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
