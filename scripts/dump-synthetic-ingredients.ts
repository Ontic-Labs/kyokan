/**
 * Dump all synthetic/canonical ingredients to JSONL
 *
 * Exports canonical_ingredient with:
 * - FDC membership (member foods)
 * - Aggregated nutrient stats (median, P10, P90)
 * - Aliases
 *
 * Usage:
 *   npx tsx scripts/dump-synthetic-ingredients.ts
 *   npx tsx scripts/dump-synthetic-ingredients.ts --slug beef
 *   npx tsx scripts/dump-synthetic-ingredients.ts --min-members 5
 */

import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const OUTPUT_PATH = path.join(__dirname, "..", "data", "synthetic_ingredients.jsonl");

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 1 });
}

interface SyntheticIngredient {
  canonical_id: string;
  canonical_slug: string;
  canonical_name: string;
  canonical_rank: number;
  synthetic_fdc_id: number | null;
  member_count: number;
  members: Array<{
    fdc_id: number;
    description: string;
    data_type: string;
  }>;
  nutrients: Array<{
    nutrient_id: number;
    name: string;
    unit: string;
    median: number;
    p10: number | null;
    p90: number | null;
    min: number;
    max: number;
    n_samples: number;
  }>;
  aliases: string[];
}

async function main(): Promise<void> {
  console.log("=== Dump Synthetic Ingredients to JSONL ===\n");

  const slugIdx = process.argv.indexOf("--slug");
  const slugFilter = slugIdx !== -1 ? process.argv[slugIdx + 1] : undefined;

  const minMembersIdx = process.argv.indexOf("--min-members");
  const minMembers = minMembersIdx !== -1 ? parseInt(process.argv[minMembersIdx + 1], 10) : 1;

  if (slugFilter) console.log(`Filter: slug = ${slugFilter}`);
  if (minMembers > 1) console.log(`Filter: min members = ${minMembers}`);
  console.log(`Output: ${OUTPUT_PATH}\n`);

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Get all canonical ingredients with member counts
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (slugFilter) {
      conditions.push(`ci.canonical_slug = $${paramIdx}`);
      values.push(slugFilter);
      paramIdx++;
    }

    // Build WHERE clause including min members filter
    if (minMembers > 1) {
      conditions.push(`COALESCE(m.member_count, 0) >= ${minMembers}`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const canonicalsResult = await client.query<{
      canonical_id: string;
      canonical_slug: string;
      canonical_name: string;
      canonical_rank: string;
      synthetic_fdc_id: string | null;
      member_count: string;
    }>(
      `SELECT
        ci.canonical_id,
        ci.canonical_slug,
        ci.canonical_name,
        ci.canonical_rank,
        ci.synthetic_fdc_id,
        COALESCE(m.member_count, 0) as member_count
      FROM canonical_ingredient ci
      LEFT JOIN (
        SELECT canonical_id, COUNT(*) as member_count
        FROM canonical_fdc_membership
        GROUP BY canonical_id
      ) m ON m.canonical_id = ci.canonical_id
      ${whereClause}
      ORDER BY ci.canonical_rank NULLS LAST`,
      values
    );

    console.log(`Canonical ingredients to export: ${canonicalsResult.rows.length}`);

    // Prepare output file
    const outputStream = fs.createWriteStream(OUTPUT_PATH);
    let exported = 0;

    for (const row of canonicalsResult.rows) {
      const ingredient: SyntheticIngredient = {
        canonical_id: row.canonical_id,
        canonical_slug: row.canonical_slug,
        canonical_name: row.canonical_name,
        canonical_rank: Number(row.canonical_rank),
        synthetic_fdc_id: row.synthetic_fdc_id ? Number(row.synthetic_fdc_id) : null,
        member_count: Number(row.member_count),
        members: [],
        nutrients: [],
        aliases: [],
      };

      // Get member foods
      const membersResult = await client.query<{
        fdc_id: string;
        description: string;
        data_type: string;
      }>(
        `SELECT f.fdc_id, f.description, f.data_type
         FROM canonical_fdc_membership cfm
         JOIN foods f ON f.fdc_id = cfm.fdc_id
         WHERE cfm.canonical_id = $1
         ORDER BY f.data_type, f.description`,
        [row.canonical_id]
      );
      ingredient.members = membersResult.rows.map((m) => ({
        fdc_id: Number(m.fdc_id),
        description: m.description,
        data_type: m.data_type,
      }));

      // Get aggregated nutrients
      const nutrientsResult = await client.query<{
        nutrient_id: string;
        name: string;
        unit_name: string;
        median: string;
        p10: string | null;
        p90: string | null;
        min_amount: string;
        max_amount: string;
        n_samples: string;
      }>(
        `SELECT
          cin.nutrient_id,
          n.name,
          cin.unit_name,
          cin.median,
          cin.p10,
          cin.p90,
          cin.min_amount,
          cin.max_amount,
          cin.n_samples
         FROM canonical_ingredient_nutrients cin
         JOIN nutrients n ON n.nutrient_id = cin.nutrient_id
         WHERE cin.canonical_id = $1
         ORDER BY n.nutrient_rank NULLS LAST`,
        [row.canonical_id]
      );
      ingredient.nutrients = nutrientsResult.rows.map((n) => ({
        nutrient_id: Number(n.nutrient_id),
        name: n.name,
        unit: n.unit_name,
        median: Number(n.median),
        p10: n.p10 ? Number(n.p10) : null,
        p90: n.p90 ? Number(n.p90) : null,
        min: Number(n.min_amount),
        max: Number(n.max_amount),
        n_samples: Number(n.n_samples),
      }));

      // Get aliases
      const aliasesResult = await client.query<{ alias_norm: string }>(
        `SELECT alias_norm FROM canonical_ingredient_alias
         WHERE canonical_id = $1
         ORDER BY alias_count DESC
         LIMIT 50`,
        [row.canonical_id]
      );
      ingredient.aliases = aliasesResult.rows.map((a) => a.alias_norm);

      outputStream.write(JSON.stringify(ingredient) + "\n");
      exported++;

      if (exported % 100 === 0 || exported === canonicalsResult.rows.length) {
        process.stdout.write(`\r  ${exported}/${canonicalsResult.rows.length} exported...`);
      }
    }

    await new Promise<void>((resolve, reject) => {
      outputStream.end(() => resolve());
      outputStream.on("error", reject);
    });

    console.log(`\r  ${exported} ingredients exported.   \n`);

    // Show sample
    if (exported > 0) {
      const sample = canonicalsResult.rows[0];
      console.log(`Sample: "${sample.canonical_name}"`);
      console.log(`  Members: ${sample.member_count}`);

      const sampleNutrients = await client.query<{
        name: string;
        median: string;
        p10: string | null;
        p90: string | null;
        n_samples: string;
      }>(
        `SELECT n.name, cin.median, cin.p10, cin.p90, cin.n_samples
         FROM canonical_ingredient_nutrients cin
         JOIN nutrients n ON n.nutrient_id = cin.nutrient_id
         WHERE cin.canonical_id = $1
         ORDER BY n.nutrient_rank NULLS LAST
         LIMIT 5`,
        [sample.canonical_id]
      );

      console.log(`  Top nutrients:`);
      for (const n of sampleNutrients.rows) {
        const p10 = n.p10 ? Number(n.p10).toFixed(1) : "—";
        const p90 = n.p90 ? Number(n.p90).toFixed(1) : "—";
        console.log(
          `    ${n.name}: ${Number(n.median).toFixed(1)} [${p10}–${p90}] (n=${n.n_samples})`
        );
      }
    }

    // Stats
    const stats = await client.query<{
      total_canonicals: string;
      with_members: string;
      with_nutrients: string;
      total_nutrient_rows: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM canonical_ingredient) as total_canonicals,
        (SELECT COUNT(DISTINCT canonical_id) FROM canonical_fdc_membership) as with_members,
        (SELECT COUNT(DISTINCT canonical_id) FROM canonical_ingredient_nutrients) as with_nutrients,
        (SELECT COUNT(*) FROM canonical_ingredient_nutrients) as total_nutrient_rows
    `);
    const s = stats.rows[0];
    console.log(`\nDatabase stats:`);
    console.log(`  Total canonical ingredients: ${s.total_canonicals}`);
    console.log(`  With FDC members: ${s.with_members}`);
    console.log(`  With nutrient data: ${s.with_nutrients}`);
    console.log(`  Total nutrient rows: ${s.total_nutrient_rows}`);

    console.log(`\nOutput: ${OUTPUT_PATH}`);
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
