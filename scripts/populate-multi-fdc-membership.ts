/**
 * Populate canonical_fdc_membership with MULTIPLE FDC foods per canonical
 *
 * Uses food_canonical_names grouping to link all matching FDC foods
 * to each canonical_ingredient, enabling nutrition range computation.
 *
 * Usage:
 *   npx tsx scripts/populate-multi-fdc-membership.ts          # dry run
 *   npx tsx scripts/populate-multi-fdc-membership.ts --write  # write to DB
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
  console.log("=== Populate Multi-FDC Membership ===\n");
  console.log(`Mode: ${write ? "WRITE" : "DRY RUN"}\n`);

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Check current state
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

    // Find all matching FDC foods via food_canonical_names
    // Using 'base' level for broader matching
    const matchQuery = `
      SELECT
        ci.canonical_id,
        ci.canonical_slug,
        fcn.fdc_id,
        f.description,
        f.data_type
      FROM canonical_ingredient ci
      JOIN food_canonical_names fcn ON fcn.canonical_slug = ci.canonical_slug
      JOIN foods f ON f.fdc_id = fcn.fdc_id
      WHERE fcn.level = 'base'
        AND NOT EXISTS (
          SELECT 1 FROM canonical_fdc_membership cfm
          WHERE cfm.canonical_id = ci.canonical_id AND cfm.fdc_id = fcn.fdc_id
        )
      ORDER BY ci.canonical_slug, f.data_type, f.description
    `;

    const matches = await client.query<{
      canonical_id: string;
      canonical_slug: string;
      fdc_id: string;
      description: string;
      data_type: string;
    }>(matchQuery);

    console.log(`New FDC memberships to add: ${matches.rows.length}`);

    if (matches.rows.length === 0) {
      console.log("\nNo new memberships to add.");
      return;
    }

    // Group by canonical for summary
    const byCanonical = new Map<string, { slug: string; foods: string[] }>();
    for (const row of matches.rows) {
      let group = byCanonical.get(row.canonical_id);
      if (!group) {
        group = { slug: row.canonical_slug, foods: [] };
        byCanonical.set(row.canonical_id, group);
      }
      group.foods.push(`${row.description} (${row.data_type})`);
    }

    console.log(`\nCanonicals with new members: ${byCanonical.size}`);
    console.log("\nSample (top 10 by new member count):");
    const sorted = [...byCanonical.entries()]
      .sort((a, b) => b[1].foods.length - a[1].foods.length)
      .slice(0, 10);
    for (const [, group] of sorted) {
      console.log(`  ${group.slug}: +${group.foods.length} foods`);
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

      for (let i = 0; i < matches.rows.length; i += BATCH) {
        const batch = matches.rows.slice(i, i + BATCH);
        const vals: unknown[] = [];
        const placeholders: string[] = [];
        let idx = 1;

        for (const row of batch) {
          placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
          vals.push(row.canonical_id, row.fdc_id, "canonical_slug_match", 1.0);
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

        if ((i + BATCH) % 1000 < BATCH || i + BATCH >= matches.rows.length) {
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
        GROUP BY ci.canonical_id
        ORDER BY member_count DESC
        LIMIT 15
      `);

      console.log("\nTop canonicals by FDC member count:");
      for (const row of topCanonicals.rows) {
        console.log(`  ${row.canonical_name}: ${row.member_count} foods`);
      }
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
