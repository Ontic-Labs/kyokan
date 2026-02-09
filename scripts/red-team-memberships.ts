/**
 * Red-team membership audit: find FDC foods that match by slug
 * but are semantically wrong contributors to a canonical ingredient.
 *
 * Checks:
 * 1. Category mismatch: food is in a wildly different FDC category
 *    than the majority of members for that canonical
 * 2. Composite/mixed products: foods that are multi-ingredient products
 *    (e.g. "Chicken, meatless" matched to "chicken")
 * 3. Baby foods: babyfood items contaminating adult ingredient profiles
 * 4. Brand-specific items that skew generic profiles
 * 5. Prepared/recipe items vs raw ingredients
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  console.log("=== Red-Team Membership Audit ===\n");

  // ---------------------------------------------------------------
  // 1. Category outliers: for each canonical, find members whose
  //    category differs from the majority category
  // ---------------------------------------------------------------
  console.log("--- CHECK 1: Category Outliers ---\n");

  const categoryOutliers = await pool.query<{
    canonical_slug: string;
    fdc_id: string;
    description: string;
    food_category: string;
    majority_category: string;
    majority_count: string;
    total_members: string;
  }>(`
    WITH canonical_category_counts AS (
      SELECT cfm.canonical_id, fc.name as category, COUNT(*) as cnt
      FROM canonical_fdc_membership cfm
      JOIN foods f ON f.fdc_id = cfm.fdc_id
      LEFT JOIN food_categories fc ON fc.category_id = f.category_id
      GROUP BY cfm.canonical_id, fc.name
    ),
    majority AS (
      SELECT DISTINCT ON (canonical_id) canonical_id, category as majority_category, cnt as majority_count
      FROM canonical_category_counts
      ORDER BY canonical_id, cnt DESC
    ),
    totals AS (
      SELECT canonical_id, SUM(cnt) as total_members
      FROM canonical_category_counts
      GROUP BY canonical_id
    )
    SELECT ci.canonical_slug, cfm.fdc_id, f.description,
           fc.name as food_category, m.majority_category, m.majority_count::text, t.total_members::text
    FROM canonical_fdc_membership cfm
    JOIN foods f ON f.fdc_id = cfm.fdc_id
    JOIN canonical_ingredient ci ON ci.canonical_id = cfm.canonical_id
    LEFT JOIN food_categories fc ON fc.category_id = f.category_id
    JOIN majority m ON m.canonical_id = cfm.canonical_id
    JOIN totals t ON t.canonical_id = cfm.canonical_id
    WHERE fc.name != m.majority_category
    AND t.total_members >= 3
    ORDER BY ci.canonical_slug, f.description
  `);

  console.log(`Category outliers: ${categoryOutliers.rows.length}\n`);
  const byCanonical1 = new Map<string, typeof categoryOutliers.rows>();
  for (const r of categoryOutliers.rows) {
    let g = byCanonical1.get(r.canonical_slug);
    if (!g) { g = []; byCanonical1.set(r.canonical_slug, g); }
    g.push(r);
  }
  for (const [slug, rows] of byCanonical1) {
    const maj = rows[0].majority_category;
    console.log(`  ${slug} (majority: ${maj}, ${rows[0].majority_count}/${rows[0].total_members}):`);
    for (const r of rows) {
      console.log(`    ⚠ "${r.description}" [${r.food_category}]`);
    }
  }

  // ---------------------------------------------------------------
  // 2. Meatless/imitation items matched to real ingredients
  // ---------------------------------------------------------------
  console.log("\n--- CHECK 2: Meatless/Imitation Items ---\n");

  const imitation = await pool.query<{
    canonical_slug: string;
    fdc_id: string;
    description: string;
  }>(`
    SELECT ci.canonical_slug, cfm.fdc_id, f.description
    FROM canonical_fdc_membership cfm
    JOIN foods f ON f.fdc_id = cfm.fdc_id
    JOIN canonical_ingredient ci ON ci.canonical_id = cfm.canonical_id
    WHERE f.description ILIKE '%meatless%'
       OR f.description ILIKE '%imitation%'
       OR f.description ILIKE '%meat substitute%'
       OR f.description ILIKE '%analog%'
    ORDER BY ci.canonical_slug, f.description
  `);

  console.log(`Meatless/imitation items: ${imitation.rows.length}`);
  for (const r of imitation.rows) {
    console.log(`  ⚠ ${r.canonical_slug}: "${r.description}"`);
  }

  // ---------------------------------------------------------------
  // 3. Baby foods contaminating adult profiles
  // ---------------------------------------------------------------
  console.log("\n--- CHECK 3: Baby Foods ---\n");

  const babyFoods = await pool.query<{
    canonical_slug: string;
    fdc_id: string;
    description: string;
  }>(`
    SELECT ci.canonical_slug, cfm.fdc_id, f.description
    FROM canonical_fdc_membership cfm
    JOIN foods f ON f.fdc_id = cfm.fdc_id
    JOIN canonical_ingredient ci ON ci.canonical_id = cfm.canonical_id
    WHERE f.description ILIKE 'babyfood%'
       OR f.description ILIKE 'baby food%'
    ORDER BY ci.canonical_slug, f.description
  `);

  console.log(`Baby food items: ${babyFoods.rows.length}`);
  for (const r of babyFoods.rows) {
    console.log(`  ⚠ ${r.canonical_slug}: "${r.description}"`);
  }

  // ---------------------------------------------------------------
  // 4. Alaska Native / ethnic specialty foods
  // ---------------------------------------------------------------
  console.log("\n--- CHECK 4: Regional Specialty Items ---\n");

  const specialty = await pool.query<{
    canonical_slug: string;
    fdc_id: string;
    description: string;
  }>(`
    SELECT ci.canonical_slug, cfm.fdc_id, f.description
    FROM canonical_fdc_membership cfm
    JOIN foods f ON f.fdc_id = cfm.fdc_id
    JOIN canonical_ingredient ci ON ci.canonical_id = cfm.canonical_id
    WHERE f.description ILIKE '%Alaska Native%'
       OR f.description ILIKE '%Hawaiian%'
       OR f.description ILIKE '%salvadoran%'
    ORDER BY ci.canonical_slug, f.description
  `);

  console.log(`Regional specialty items: ${specialty.rows.length}`);
  for (const r of specialty.rows) {
    console.log(`  ⚠ ${r.canonical_slug}: "${r.description}"`);
  }

  // ---------------------------------------------------------------
  // 5. High-member canonicals with suspicious diversity
  //    (ingredient name is too generic → pulls in unrelated foods)
  // ---------------------------------------------------------------
  console.log("\n--- CHECK 5: Generic Slugs with High Member Counts ---\n");

  const highCount = await pool.query<{
    canonical_slug: string;
    member_count: string;
    distinct_categories: string;
    categories: string;
  }>(`
    SELECT ci.canonical_slug,
           COUNT(*)::text as member_count,
           COUNT(DISTINCT fc.name)::text as distinct_categories,
           STRING_AGG(DISTINCT fc.name, ', ' ORDER BY fc.name) as categories
    FROM canonical_fdc_membership cfm
    JOIN foods f ON f.fdc_id = cfm.fdc_id
    JOIN canonical_ingredient ci ON ci.canonical_id = cfm.canonical_id
    LEFT JOIN food_categories fc ON fc.category_id = f.category_id
    GROUP BY ci.canonical_slug
    HAVING COUNT(DISTINCT fc.name) >= 4
    ORDER BY COUNT(DISTINCT fc.name) DESC, COUNT(*) DESC
  `);

  console.log(`Canonicals spanning 4+ categories: ${highCount.rows.length}\n`);
  for (const r of highCount.rows) {
    console.log(`  ⚠ ${r.canonical_slug}: ${r.member_count} members across ${r.distinct_categories} categories`);
    console.log(`    Categories: ${r.categories}`);
  }

  // ---------------------------------------------------------------
  // 6. Spot-check specific high-value ingredients
  // ---------------------------------------------------------------
  console.log("\n--- CHECK 6: Spot-Check Key Ingredients ---\n");

  const spotChecks = ["butter", "sugar", "salt", "garlic", "olive-oil", "milk", "eggs", "flour", "chicken", "beef"];

  for (const slug of spotChecks) {
    const members = await pool.query<{
      fdc_id: string;
      description: string;
      category: string;
    }>(`
      SELECT cfm.fdc_id, f.description, fc.name as category
      FROM canonical_fdc_membership cfm
      JOIN foods f ON f.fdc_id = cfm.fdc_id
      JOIN canonical_ingredient ci ON ci.canonical_id = cfm.canonical_id
      LEFT JOIN food_categories fc ON fc.category_id = f.category_id
      WHERE ci.canonical_slug = $1
      ORDER BY f.description
    `, [slug]);

    if (members.rows.length === 0) {
      console.log(`  ${slug}: no members`);
    } else {
      console.log(`  ${slug} (${members.rows.length} members):`);
      for (const r of members.rows) {
        console.log(`    - "${r.description}" [${r.category}]`);
      }
    }
    console.log();
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
