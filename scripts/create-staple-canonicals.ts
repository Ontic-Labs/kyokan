/**
 * Create canonical_ingredient entries for staple ingredients
 *
 * Creates entries for the category-based staples (cheese, milk, yogurt, etc.)
 * so branded synonyms can be linked to them.
 *
 * Usage:
 *   npx tsx scripts/create-staple-canonicals.ts          # dry run
 *   npx tsx scripts/create-staple-canonicals.ts --write  # write to DB
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// Same mapping as parse-branded-synonyms.ts
const STAPLE_CANONICALS: Array<{ slug: string; name: string }> = [
  // Dairy
  { slug: "eggs", name: "Eggs" },
  { slug: "cheese", name: "Cheese" },
  { slug: "milk", name: "Milk" },
  { slug: "butter", name: "Butter" },
  { slug: "cream", name: "Cream" },
  { slug: "yogurt", name: "Yogurt" },

  // Proteins
  { slug: "meat", name: "Meat" },
  { slug: "chicken", name: "Chicken" },
  { slug: "fish", name: "Fish" },

  // Grains
  { slug: "rice", name: "Rice" },
  { slug: "pasta", name: "Pasta" },
  { slug: "noodles", name: "Noodles" },
  { slug: "flour", name: "Flour" },

  // Produce
  { slug: "tomatoes", name: "Tomatoes" },
  { slug: "vegetables", name: "Vegetables" },

  // Fats & Oils
  { slug: "oil", name: "Oil" },

  // Sweeteners
  { slug: "honey", name: "Honey" },
  { slug: "sugar", name: "Sugar" },
  { slug: "syrup", name: "Syrup" },

  // Legumes
  { slug: "beans", name: "Beans" },

  // Condiments
  { slug: "vinegar", name: "Vinegar" },
  { slug: "spices", name: "Spices" },
  { slug: "nut-butter", name: "Nut Butter" },
];

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 1 });
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  console.log("=== Create Staple Canonical Ingredients ===\n");
  console.log(`Mode: ${write ? "WRITE" : "DRY RUN"}\n`);

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Check which slugs already exist
    const existingResult = await client.query<{ canonical_slug: string }>(
      `SELECT canonical_slug FROM canonical_ingredient WHERE canonical_slug = ANY($1)`,
      [STAPLE_CANONICALS.map((s) => s.slug)]
    );
    const existingSlugs = new Set(existingResult.rows.map((r) => r.canonical_slug));

    const toCreate = STAPLE_CANONICALS.filter((s) => !existingSlugs.has(s.slug));

    console.log(`Existing staple entries: ${existingSlugs.size}`);
    console.log(`New entries to create:   ${toCreate.length}`);

    if (toCreate.length === 0) {
      console.log("\nAll staple canonicals already exist!");
      return;
    }

    console.log("\nWill create:");
    for (const s of toCreate) {
      console.log(`  + ${s.slug} ("${s.name}")`);
    }

    if (write) {
      console.log("\nCreating entries...");

      const vals: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const s of toCreate) {
        placeholders.push(`($${idx}, $${idx + 1}, 0, 0)`);
        vals.push(s.slug, s.name);
        idx += 2;
      }

      const result = await client.query(
        `INSERT INTO canonical_ingredient (canonical_slug, canonical_name, canonical_rank, total_count)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (canonical_slug) DO NOTHING
         RETURNING canonical_slug`,
        vals
      );

      console.log(`Created ${result.rowCount} canonical entries.`);

      // Verify
      const verify = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM canonical_ingredient WHERE canonical_slug = ANY($1)`,
        [STAPLE_CANONICALS.map((s) => s.slug)]
      );
      console.log(`\nTotal staple canonicals in DB: ${verify.rows[0].count}`);
    } else {
      console.log("\nDry run - no changes made. Use --write to create entries.");
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
