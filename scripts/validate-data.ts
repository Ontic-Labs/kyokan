#!/usr/bin/env npx tsx
/**
 * validate-data.ts — CI-friendly data invariant checker
 *
 * Runs a suite of integrity checks on the canonical ingredient pipeline.
 * Exits 0 on pass, 1 on any failure.
 *
 * Usage:
 *   npx tsx scripts/validate-data.ts
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { ALLOWED_CATEGORIES } from "./lib/constants";

dotenv.config({ path: ".env.local" });

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 1 });
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const pool = getPool();
  const results: CheckResult[] = [];

  function check(name: string, passed: boolean, detail: string) {
    results.push({ name, passed, detail });
    const icon = passed ? "✅" : "❌";
    console.log(`${icon} ${name}: ${detail}`);
  }

  try {
    console.log("=== Data Validation ===\n");

    // ── 1. No banned categories in memberships ──────────────────────
    const bannedInMemberships = await pool.query<{ category: string; cnt: string }>(`
      SELECT fc.name AS category, COUNT(*) AS cnt
      FROM canonical_fdc_membership m
      JOIN foods f ON f.fdc_id = m.fdc_id
      JOIN food_categories fc ON fc.category_id = f.category_id
      WHERE fc.name NOT IN (${ALLOWED_CATEGORIES.map((_, i) => `$${i + 1}`).join(", ")})
      GROUP BY fc.name
      ORDER BY cnt DESC
    `, [...ALLOWED_CATEGORIES]);

    if (bannedInMemberships.rows.length === 0) {
      check("No banned categories", true, "all memberships in allowed categories");
    } else {
      const cats = bannedInMemberships.rows
        .map((r) => `${r.category} (${r.cnt})`)
        .join(", ");
      check("No banned categories", false, `found: ${cats}`);
    }

    // ── 2. No meatless/imitation items ──────────────────────────────
    const meatless = await pool.query<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM canonical_fdc_membership m
      JOIN foods f ON f.fdc_id = m.fdc_id
      WHERE f.description ILIKE '%meatless%'
         OR f.description ILIKE '%imitation%'
    `);
    const meatlessCnt = parseInt(meatless.rows[0].cnt);
    check(
      "No meatless/imitation",
      meatlessCnt === 0,
      meatlessCnt === 0 ? "none found" : `${meatlessCnt} items found`
    );

    // ── 3. No orphan memberships ────────────────────────────────────
    const orphanMemberships = await pool.query<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM canonical_fdc_membership m
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_ingredient ci WHERE ci.canonical_id = m.canonical_id
      )
    `);
    const orphanMemCnt = parseInt(orphanMemberships.rows[0].cnt);
    check(
      "No orphan memberships",
      orphanMemCnt === 0,
      orphanMemCnt === 0 ? "none" : `${orphanMemCnt} orphan rows`
    );

    // ── 4. No orphan nutrients ──────────────────────────────────────
    const orphanNutrients = await pool.query<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt
      FROM canonical_ingredient_nutrients n
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_ingredient ci WHERE ci.canonical_id = n.canonical_id
      )
    `);
    const orphanNutCnt = parseInt(orphanNutrients.rows[0].cnt);
    check(
      "No orphan nutrients",
      orphanNutCnt === 0,
      orphanNutCnt === 0 ? "none" : `${orphanNutCnt} orphan rows`
    );

    // ── 5. No stale multi-member nutrient data ─────────────────────
    // Canonicals with n_samples > 1 got nutrients from the multi-membership
    // aggregation pipeline. If they no longer have members, the data is stale.
    // (n_samples = 1 nutrients come from the synthetic_fdc_id 1:1 mapping and
    //  are expected even without membership rows.)
    const stale = await pool.query<{ cnt: string }>(`
      SELECT COUNT(DISTINCT n.canonical_id) AS cnt
      FROM canonical_ingredient_nutrients n
      WHERE n.n_samples > 1
        AND NOT EXISTS (
          SELECT 1 FROM canonical_fdc_membership m WHERE m.canonical_id = n.canonical_id
        )
    `);
    const staleCnt = parseInt(stale.rows[0].cnt);
    check(
      "No stale nutrient data",
      staleCnt === 0,
      staleCnt === 0 ? "none" : `${staleCnt} canonicals have nutrients but no members`
    );

    // ── 6. Every canonical with members has nutrient data ───────────
    const missingNutrients = await pool.query<{ cnt: string }>(`
      SELECT COUNT(DISTINCT m.canonical_id) AS cnt
      FROM canonical_fdc_membership m
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_ingredient_nutrients n WHERE n.canonical_id = m.canonical_id
      )
    `);
    const missingNutCnt = parseInt(missingNutrients.rows[0].cnt);
    check(
      "All members have nutrients",
      missingNutCnt === 0,
      missingNutCnt === 0
        ? "every canonical with members has aggregated nutrients"
        : `${missingNutCnt} canonicals with members but no nutrients`
    );

    // ── 7. No rank=0 sentinel values ────────────────────────────────
    const rank0 = await pool.query<{ cnt: string }>(`
      SELECT COUNT(*) AS cnt FROM canonical_ingredient WHERE canonical_rank = 0
    `);
    const rank0Cnt = parseInt(rank0.rows[0].cnt);
    check(
      "No rank=0 sentinel",
      rank0Cnt === 0,
      rank0Cnt === 0 ? "all unranked use NULL" : `${rank0Cnt} rows still have rank=0`
    );

    // ── 8. Category distribution sanity check ───────────────────────
    const catDist = await pool.query<{ name: string; cnt: string }>(`
      SELECT fc.name, COUNT(*) AS cnt
      FROM canonical_fdc_membership m
      JOIN foods f ON f.fdc_id = m.fdc_id
      JOIN food_categories fc ON fc.category_id = f.category_id
      GROUP BY fc.name
      ORDER BY cnt DESC
    `);
    const totalCats = catDist.rows.length;
    check(
      "Category count reasonable",
      totalCats > 0 && totalCats <= ALLOWED_CATEGORIES.length,
      `${totalCats} categories (max ${ALLOWED_CATEGORIES.length} allowed)`
    );

    // ── Summary ─────────────────────────────────────────────────────
    console.log("\n=== Summary ===");
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    console.log(`${passed} passed, ${failed} failed out of ${results.length} checks`);

    if (failed > 0) {
      console.log("\nFAILED checks:");
      for (const r of results.filter((r) => !r.passed)) {
        console.log(`  ❌ ${r.name}: ${r.detail}`);
      }
      process.exit(1);
    }

    console.log("\n✅ All checks passed.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
