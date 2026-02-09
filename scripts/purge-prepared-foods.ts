#!/usr/bin/env npx tsx
/**
 * purge-prepared-foods.ts
 *
 * Removes all FDC membership rows whose foods belong to prepared / fast-food
 * categories.  Only whole-food ingredient categories are kept.
 *
 * Usage:
 *   npx tsx scripts/purge-prepared-foods.ts          # dry-run (preview)
 *   npx tsx scripts/purge-prepared-foods.ts --write   # actually delete
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from 'pg';

const BANNED_CATEGORIES = [
  'Fast Foods',
  'Restaurant Foods',
  'Meals, Entrees, and Side Dishes',
  'Baby Foods',
  'Sausages and Luncheon Meats',
  'Soups, Sauces, and Gravies',
  'Baked Products',
  'Snacks',
  'Breakfast Cereals',
  'American Indian/Alaska Native Foods',
  'Sweets',
];

async function main() {
  const write = process.argv.includes('--write');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Preview
    const preview = await pool.query(`
      SELECT fc.name AS category, COUNT(*) AS cnt
      FROM canonical_fdc_membership m
      JOIN foods f ON f.fdc_id = m.fdc_id
      JOIN food_categories fc ON fc.category_id = f.category_id
      WHERE fc.name = ANY($1)
      GROUP BY fc.name ORDER BY cnt DESC
    `, [BANNED_CATEGORIES]);

    let total = 0;
    console.log('=== Categories to purge ===');
    for (const row of preview.rows) {
      console.log(`  ${String(row.cnt).padStart(5)}  ${row.category}`);
      total += parseInt(row.cnt);
    }
    console.log(`  -----`);
    console.log(`  ${String(total).padStart(5)}  TOTAL`);

    const before = await pool.query('SELECT COUNT(*) AS cnt FROM canonical_fdc_membership');
    console.log(`\nBefore: ${before.rows[0].cnt} memberships`);

    if (!write) {
      console.log('\nDry run — pass --write to delete.');
      return;
    }

    // Delete
    const del = await pool.query(`
      DELETE FROM canonical_fdc_membership m
      USING foods f, food_categories fc
      WHERE f.fdc_id = m.fdc_id
        AND fc.category_id = f.category_id
        AND fc.name = ANY($1)
    `, [BANNED_CATEGORIES]);
    console.log(`Deleted: ${del.rowCount} rows`);

    const after = await pool.query('SELECT COUNT(*) AS cnt FROM canonical_fdc_membership');
    console.log(`After: ${after.rows[0].cnt} memberships`);

    // Also purge meatless / imitation items that survive in kept categories
    const meatless = await pool.query(`
      DELETE FROM canonical_fdc_membership m
      USING foods f
      WHERE f.fdc_id = m.fdc_id
        AND (f.description ILIKE '%meatless%'
          OR f.description ILIKE '%imitation%')
    `);
    console.log(`Purged meatless/imitation: ${meatless.rowCount} rows`);

    const final = await pool.query('SELECT COUNT(*) AS cnt FROM canonical_fdc_membership');
    console.log(`Final: ${final.rows[0].cnt} memberships`);

    // Show remaining
    const remaining = await pool.query(`
      SELECT fc.name AS category, COUNT(*) AS cnt
      FROM canonical_fdc_membership m
      JOIN foods f ON f.fdc_id = m.fdc_id
      JOIN food_categories fc ON fc.category_id = f.category_id
      GROUP BY fc.name ORDER BY cnt DESC
    `);
    console.log('\n=== Remaining categories ===');
    for (const row of remaining.rows) {
      console.log(`  ${String(row.cnt).padStart(5)}  ${row.category}`);
    }

    // Canonical stats
    const stats = await pool.query(`
      SELECT COUNT(DISTINCT canonical_id) AS with_members
      FROM canonical_fdc_membership
    `);
    console.log(`\nCanonicals with members: ${stats.rows[0].with_members}`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
