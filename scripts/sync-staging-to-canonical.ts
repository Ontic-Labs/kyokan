/**
 * Sync promoted staging run → canonical_ingredient + canonical_fdc_membership
 *
 * Takes the current promoted run from canonical_fdc_membership_staging and:
 * 1. Creates missing canonical_ingredient entries for unmapped slugs
 * 2. Populates canonical_fdc_membership with (canonical_id, fdc_id) pairs
 *
 * Usage:
 *   npx tsx scripts/sync-staging-to-canonical.ts              # dry run
 *   npx tsx scripts/sync-staging-to-canonical.ts --write      # write to DB
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 1 });
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  console.log(`=== Sync Staging → Canonical ===`);
  console.log(`Mode: ${write ? "WRITE" : "DRY RUN"}\n`);

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Get current promoted run
    const runResult = await client.query<{ current_run_id: string }>(
      `SELECT current_run_id FROM lexical_mapping_current LIMIT 1`
    );
    if (runResult.rows.length === 0) {
      throw new Error("No promoted run found in lexical_mapping_current");
    }
    const runId = runResult.rows[0].current_run_id;
    console.log(`Promoted run: ${runId}\n`);

    // Load all mapped staging rows with fdc_id
    const stagingResult = await client.query<{
      ingredient_key: string;
      ingredient_text: string;
      fdc_id: string;
      score: string;
      reason_codes: string[];
    }>(
      `SELECT ingredient_key, ingredient_text, fdc_id, score, reason_codes
       FROM canonical_fdc_membership_staging
       WHERE run_id = $1 AND status = 'mapped' AND fdc_id IS NOT NULL
       ORDER BY ingredient_key`,
      [runId]
    );
    console.log(`Mapped staging rows: ${stagingResult.rows.length}`);

    // Load existing canonical_ingredient slugs
    const existingResult = await client.query<{
      canonical_id: string;
      canonical_slug: string;
    }>(`SELECT canonical_id, canonical_slug FROM canonical_ingredient`);
    const slugToCanonicalId = new Map<string, string>();
    for (const r of existingResult.rows) {
      slugToCanonicalId.set(r.canonical_slug, r.canonical_id);
    }
    console.log(`Existing canonical_ingredient entries: ${slugToCanonicalId.size}`);

    // Find staging rows that need new canonical entries
    const needNew: { slug: string; name: string }[] = [];
    const seenSlugs = new Set<string>();
    for (const row of stagingResult.rows) {
      if (!slugToCanonicalId.has(row.ingredient_key) && !seenSlugs.has(row.ingredient_key)) {
        needNew.push({ slug: row.ingredient_key, name: row.ingredient_text });
        seenSlugs.add(row.ingredient_key);
      }
    }
    console.log(`New canonical entries needed: ${needNew.length}`);

    // Load ingredient frequencies for ranking
    const freqResult = await client.query<{
      ingredient_key: string;
      frequency: string;
    }>(
      `SELECT DISTINCT ON (ingredient_key) ingredient_key,
              (reason_codes[array_length(reason_codes, 1)])::text as frequency
       FROM canonical_fdc_membership_staging
       WHERE run_id = $1
       ORDER BY ingredient_key`,
      [runId]
    );
    // Actually, frequency isn't in staging. Use recipe_ingredient_vocab if available.
    // For now, assign rank 0 to new entries (will be updated later).

    if (write) {
      await client.query("BEGIN");

      // 1. Create missing canonical_ingredient entries
      if (needNew.length > 0) {
        console.log(`\nCreating ${needNew.length} new canonical_ingredient entries...`);
        const BATCH = 100;
        for (let i = 0; i < needNew.length; i += BATCH) {
          const batch = needNew.slice(i, i + BATCH);
          const vals: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const entry of batch) {
            placeholders.push(`($${idx}, $${idx + 1}, 0, 0)`);
            vals.push(entry.slug, entry.name);
            idx += 2;
          }
          const result = await client.query<{ canonical_id: string; canonical_slug: string }>(
            `INSERT INTO canonical_ingredient (canonical_slug, canonical_name, canonical_rank, total_count)
             VALUES ${placeholders.join(", ")}
             ON CONFLICT (canonical_slug) DO NOTHING
             RETURNING canonical_id, canonical_slug`,
            vals
          );
          for (const r of result.rows) {
            slugToCanonicalId.set(r.canonical_slug, r.canonical_id);
          }
        }
        // Re-fetch any that were already present (ON CONFLICT DO NOTHING)
        const refetch = await client.query<{ canonical_id: string; canonical_slug: string }>(
          `SELECT canonical_id, canonical_slug FROM canonical_ingredient
           WHERE canonical_slug = ANY($1)`,
          [needNew.map((n) => n.slug)]
        );
        for (const r of refetch.rows) {
          slugToCanonicalId.set(r.canonical_slug, r.canonical_id);
        }
        console.log(`  Done. Total canonical entries: ${slugToCanonicalId.size}`);
      }

      // 2. Clear existing canonical_fdc_membership and repopulate
      await client.query(`DELETE FROM canonical_fdc_membership`);
      console.log(`\nPopulating canonical_fdc_membership...`);

      const BATCH = 500;
      let written = 0;
      let skipped = 0;
      for (let i = 0; i < stagingResult.rows.length; i += BATCH) {
        const batch = stagingResult.rows.slice(i, i + BATCH);
        const vals: unknown[] = [];
        const placeholders: string[] = [];
        let idx = 1;
        for (const row of batch) {
          const canonicalId = slugToCanonicalId.get(row.ingredient_key);
          if (!canonicalId) {
            skipped++;
            continue;
          }
          // Determine membership_reason from reason_codes
          const reason = row.reason_codes?.[0] ?? "lexical";
          placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, 1.0)`);
          vals.push(canonicalId, row.fdc_id, reason);
          idx += 3;
        }
        if (placeholders.length > 0) {
          await client.query(
            `INSERT INTO canonical_fdc_membership (canonical_id, fdc_id, membership_reason, weight)
             VALUES ${placeholders.join(", ")}
             ON CONFLICT (canonical_id, fdc_id) DO UPDATE SET
               membership_reason = EXCLUDED.membership_reason,
               weight = EXCLUDED.weight`,
            vals
          );
        }
        written += placeholders.length;
        if ((i + BATCH) % 1000 < BATCH || i + BATCH >= stagingResult.rows.length) {
          process.stdout.write(`\r  ${written} rows written, ${skipped} skipped`);
        }
      }

      await client.query("COMMIT");
      console.log(`\n\nDone. ${written} membership rows written.`);
    } else {
      // Dry run summary
      console.log(`\nDry run summary:`);
      console.log(`  Would create ${needNew.length} new canonical_ingredient entries`);
      console.log(`  Would write ${stagingResult.rows.length} canonical_fdc_membership rows`);
      if (needNew.length > 0) {
        console.log(`\n  Sample new entries:`);
        for (const n of needNew.slice(0, 20)) {
          console.log(`    + ${n.slug} ("${n.name}")`);
        }
        if (needNew.length > 20) console.log(`    ... and ${needNew.length - 20} more`);
      }
    }

    // Verification
    const verify = await client.query<{
      canonical_count: string;
      membership_count: string;
      distinct_canonicals: string;
      distinct_fdcs: string;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM canonical_ingredient) as canonical_count,
        (SELECT COUNT(*) FROM canonical_fdc_membership) as membership_count,
        (SELECT COUNT(DISTINCT canonical_id) FROM canonical_fdc_membership) as distinct_canonicals,
        (SELECT COUNT(DISTINCT fdc_id) FROM canonical_fdc_membership) as distinct_fdcs`
    );
    const v = verify.rows[0];
    console.log(`\nVerification:`);
    console.log(`  canonical_ingredient: ${v.canonical_count}`);
    console.log(`  canonical_fdc_membership: ${v.membership_count}`);
    console.log(`  Distinct canonicals with membership: ${v.distinct_canonicals}`);
    console.log(`  Distinct FDC foods in membership: ${v.distinct_fdcs}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
