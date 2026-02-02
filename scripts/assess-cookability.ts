/**
 * Cookability Assessment Script
 *
 * Applies layered deterministic filters to identify which foods
 * are suitable for recipe/cooking use.
 *
 * Usage:
 *   npx tsx scripts/assess-cookability.ts
 *
 * Layers:
 *   1. Category exclusion (infant, supplement, medical)
 *   2. Lexical pattern matching (capsule, tablet, formula, etc.)
 *   3. Portion unit analysis (no mass-based units = suspect)
 *   4. Nutrient profile sanity (extreme values = supplements)
 *
 * Scoring:
 *   veto_score = count of DISTINCT LAYERS that fired (not individual flags)
 *   This prevents double-counting when the same concept triggers multiple flags.
 */

import { Pool, PoolClient } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// Veto threshold: foods with >= this many independent LAYERS are excluded
const COOKABILITY_THRESHOLD = 2;

// Assessment version (semantic version, bump when rules change)
const ASSESSMENT_VERSION = "1.4.0";

// ============================================
// Veto group mapping (for scoring)
// ============================================

function vetoGroup(flag: string): string {
  if (flag.startsWith("CATEGORY_")) return "CATEGORY";
  if (flag.startsWith("LEXICAL_")) return "LEXICAL";
  if (flag.startsWith("PORTION_")) return "PORTION";
  if (flag.startsWith("NUTRIENT_")) return "NUTRIENT";
  return "OTHER";
}

function computeVetoScore(flags: string[]): number {
  return new Set(flags.map(vetoGroup)).size;
}

// ============================================
// Layer 1: Category veto rules (explicit mapping)
// ============================================

const CATEGORY_VETO_RULES: Array<{ pattern: RegExp; flag: string }> = [
  // Non-ingredient prepared foods
  { pattern: /fast\s*foods/i, flag: "CATEGORY_PREPARED" },
  { pattern: /restaurant/i, flag: "CATEGORY_PREPARED" },
  { pattern: /meals,?\s*entrees/i, flag: "CATEGORY_PREPARED" },
  // Infant / medical / supplement
  { pattern: /infant|baby\s*food/i, flag: "CATEGORY_INFANT" },
  { pattern: /infant\s*formula/i, flag: "CATEGORY_INFANT" },
  { pattern: /dietary\s*supplement|supplement/i, flag: "CATEGORY_SUPPLEMENT" },
  { pattern: /medical|enteral|clinical|tube\s*feeding/i, flag: "CATEGORY_MEDICAL" },
  { pattern: /meal\s*replacement|weight\s*(loss|management)|sports\s*nutrition|nutrition\s*bar/i, flag: "CATEGORY_NON_COOKING" },
];

// ============================================
// Layer 2: Lexical pattern denylists
// ============================================

// Hard excludes - these words are identity-destroying for cooking
const LEXICAL_SUPPLEMENT_PATTERNS = [
  /\bcapsule[s]?\b/i,
  /\btablet[s]?\b/i,
  /\bpill[s]?\b/i,
  /\bsupplement[s]?\b/i,
  /\bnutraceutical[s]?\b/i, // Fixed typo from "nuutraceutical"
  /\bextract,?\s*supplement/i,
  /\bpowder,?\s*supplement/i,
  /\bprotein\s*(isolate|concentrate)\b/i,
  /\bwhey\s*protein\b/i,
  /\bcasein\s*protein\b/i,
];

const LEXICAL_MEDICAL_PATTERNS = [
  /\binfant\b/i,
  /\bbaby\s*food\b/i,
  /\binfant\s+formula\b/i,
  /\bready[- ]to[- ]feed\b/i,
  /\bmedical\b/i,
  /\btube\s*feeding\b/i,
  /\benteral\b/i,
  /\bclinical\b/i,
  /\bmeal\s*replacement\b/i,
  /\bprotein\s*shake\b/i,
  /\bnutrition\s*shake\b/i,
  /\bpediatric\b/i,
  /\bgeriatric\b/i,
  /\belemental\s*diet\b/i,
];

// ============================================
// Layer 3: Portion unit patterns
// ============================================

// Units that indicate non-cooking use
const NON_COOKING_PORTION_PATTERNS = [
  /\bcapsule[s]?\b/i,
  /\btablet[s]?\b/i,
  /\bserving\s*\(shake\)/i,
];

// Units that indicate cooking use
const COOKING_PORTION_PATTERNS = [
  /\bg\b/, // case-sensitive: lowercase "g" only for grams
  /\bgram[s]?\b/i,
  /\boz\b/i,
  /\bounce[s]?\b/i,
  /\btbsp\b/i,
  /\btablespoon[s]?\b/i,
  /\btsp\b/i,
  /\bteaspoon[s]?\b/i,
  /\bcup[s]?\b/i,
  /\blb\b/i,
  /\bpound[s]?\b/i,
  /\bslice[s]?\b/i,
  /\bpiece[s]?\b/i,
  /\bwhole\b/i,
  /\beach\b/i,
];

// ============================================
// Layer 4: Nutrient thresholds
// ============================================

// Implausible nutrient profiles for cooking ingredients
const NUTRIENT_THRESHOLDS = {
  // Protein isolates: protein > 80g/100g with minimal carbs/fat
  proteinIsolate: {
    proteinMin: 80,
    carbsMax: 10,
    fatMax: 10,
  },
  // Supplements: extreme micronutrient values (with expected units)
  vitaminExtreme: {
    // If any vitamin exceeds 1000% DV per 100g, likely a supplement
    vitaminCMax: 9000, // mg per 100g (1000% DV = 900mg)
    vitaminCUnit: "mg",
    vitaminB12Max: 240, // mcg per 100g (1000% DV = 24mcg)
    vitaminB12Unit: "UG", // SR Legacy uses "UG" for micrograms
    vitaminDMax: 200, // mcg per 100g (1000% DV = 20mcg)
    vitaminDUnit: "UG",
  },
};

// ============================================
// Database connection
// ============================================

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 5 });
}

// ============================================
// Assessment logic
// ============================================

interface FoodAssessment {
  fdcId: number;
  description: string;
  categoryName: string | null;
  vetoFlags: string[];
}

interface PortionData {
  fdcId: number;
  modifier: string | null;
  unitName: string | null;
}

interface NutrientData {
  fdcId: number;
  nutrientName: string;
  unitName: string;
  amount: number;
}

async function loadFoods(client: PoolClient): Promise<FoodAssessment[]> {
  const result = await client.query<{
    fdc_id: number;
    description: string;
    category_name: string | null;
  }>(`
    SELECT f.fdc_id, f.description, c.name as category_name
    FROM foods f
    LEFT JOIN food_categories c ON f.category_id = c.category_id
    ORDER BY f.fdc_id
  `);

  return result.rows.map((row) => ({
    fdcId: row.fdc_id,
    description: row.description,
    categoryName: row.category_name,
    vetoFlags: [],
  }));
}

async function loadPortions(client: PoolClient): Promise<Map<number, PortionData[]>> {
  const result = await client.query<{
    fdc_id: number;
    modifier: string | null;
    unit_name: string | null;
  }>(`
    SELECT fp.fdc_id, fp.modifier, mu.name as unit_name
    FROM food_portions fp
    LEFT JOIN measure_units mu ON fp.measure_unit_id = mu.measure_unit_id
  `);

  const map = new Map<number, PortionData[]>();
  for (const row of result.rows) {
    const list = map.get(row.fdc_id) || [];
    list.push({
      fdcId: row.fdc_id,
      modifier: row.modifier,
      unitName: row.unit_name,
    });
    map.set(row.fdc_id, list);
  }
  return map;
}

async function loadNutrientsChunked(
  client: PoolClient,
  foods: FoodAssessment[]
): Promise<Map<number, NutrientData[]>> {
  // Load key nutrients in chunks to limit memory usage.
  // Instead of loading all nutrient rows at once (millions of rows),
  // we query by fdc_id ranges derived from the sorted foods list.
  const CHUNK_SIZE = 50000;
  const map = new Map<number, NutrientData[]>();

  for (let i = 0; i < foods.length; i += CHUNK_SIZE) {
    const chunk = foods.slice(i, i + CHUNK_SIZE);
    const minId = chunk[0].fdcId;
    const maxId = chunk[chunk.length - 1].fdcId;

    const result = await client.query<{
      fdc_id: number;
      nutrient_name: string;
      unit_name: string;
      amount: number;
    }>(
      `SELECT fn.fdc_id, n.name as nutrient_name, n.unit_name, fn.amount
       FROM food_nutrients fn
       JOIN nutrients n ON fn.nutrient_id = n.nutrient_id
       WHERE fn.fdc_id BETWEEN $1 AND $2
         AND n.name IN (
           'Protein',
           'Carbohydrate, by difference',
           'Total lipid (fat)',
           'Vitamin C, total ascorbic acid',
           'Vitamin B-12',
           'Vitamin D (D2 + D3)'
         )`,
      [minId, maxId]
    );

    for (const row of result.rows) {
      const list = map.get(row.fdc_id) || [];
      list.push({
        fdcId: row.fdc_id,
        nutrientName: row.nutrient_name,
        unitName: row.unit_name,
        amount: row.amount,
      });
      map.set(row.fdc_id, list);
    }
  }

  return map;
}

// Layer 1: Category assessment (using explicit rules)
function assessCategory(food: FoodAssessment): void {
  if (!food.categoryName) return;

  for (const rule of CATEGORY_VETO_RULES) {
    if (rule.pattern.test(food.categoryName)) {
      food.vetoFlags.push(rule.flag);
      return; // One category veto is enough
    }
  }
}

// Layer 2: Lexical assessment
function assessLexical(food: FoodAssessment): void {
  const desc = food.description;

  // Check supplement patterns
  for (const pattern of LEXICAL_SUPPLEMENT_PATTERNS) {
    if (pattern.test(desc)) {
      food.vetoFlags.push("LEXICAL_SUPPLEMENT");
      break;
    }
  }

  // Check medical patterns (separate veto)
  for (const pattern of LEXICAL_MEDICAL_PATTERNS) {
    if (pattern.test(desc)) {
      food.vetoFlags.push("LEXICAL_MEDICAL");
      break;
    }
  }
}

// Layer 3: Portion assessment
// NOTE: Foods with no portion data are intentionally skipped (no penalty).
// Absence of portion rows doesn't imply non-cookability — many valid cooking
// ingredients simply lack portion data in the FDC dataset.
function assessPortions(
  food: FoodAssessment,
  portions: PortionData[] | undefined
): void {
  if (!portions || portions.length === 0) return;

  let hasNonCookingUnit = false;
  let hasCookingUnit = false;

  for (const portion of portions) {
    const text = [portion.modifier, portion.unitName].filter(Boolean).join(" ");

    for (const pattern of NON_COOKING_PORTION_PATTERNS) {
      if (pattern.test(text)) {
        hasNonCookingUnit = true;
        break;
      }
    }

    for (const pattern of COOKING_PORTION_PATTERNS) {
      if (pattern.test(text)) {
        hasCookingUnit = true;
        break;
      }
    }
  }

  // Veto only if ALL portions are non-cooking and NONE are cooking
  if (hasNonCookingUnit && !hasCookingUnit) {
    food.vetoFlags.push("PORTION_NON_COOKING");
  }
}

// Layer 4: Nutrient profile assessment (with unit verification)
function assessNutrients(
  food: FoodAssessment,
  nutrients: NutrientData[] | undefined
): void {
  if (!nutrients || nutrients.length === 0) return;

  const byName: Record<string, { amount: number; unit: string }> = {};
  for (const n of nutrients) {
    byName[n.nutrientName] = { amount: n.amount, unit: n.unitName };
  }

  // Check protein isolate pattern (protein/carbs/fat should be in grams)
  const protein = byName["Protein"];
  const carbs = byName["Carbohydrate, by difference"];
  const fat = byName["Total lipid (fat)"];

  if (protein && carbs && fat) {
    // Only check if all are in grams
    if (
      protein.unit.toLowerCase() === "g" &&
      carbs.unit.toLowerCase() === "g" &&
      fat.unit.toLowerCase() === "g"
    ) {
      const t = NUTRIENT_THRESHOLDS.proteinIsolate;
      if (
        protein.amount >= t.proteinMin &&
        carbs.amount <= t.carbsMax &&
        fat.amount <= t.fatMax
      ) {
        food.vetoFlags.push("NUTRIENT_PROTEIN_ISOLATE");
      }
    }
  }

  // Check extreme vitamin levels (with unit verification)
  const vt = NUTRIENT_THRESHOLDS.vitaminExtreme;
  
  const vitC = byName["Vitamin C, total ascorbic acid"];
  const vitB12 = byName["Vitamin B-12"];
  const vitD = byName["Vitamin D (D2 + D3)"];

  const hasExtremeVitamins =
    (vitC && vitC.unit.toLowerCase() === vt.vitaminCUnit.toLowerCase() && vitC.amount >= vt.vitaminCMax) ||
    (vitB12 && vitB12.unit.toUpperCase() === vt.vitaminB12Unit && vitB12.amount >= vt.vitaminB12Max) ||
    (vitD && vitD.unit.toUpperCase() === vt.vitaminDUnit && vitD.amount >= vt.vitaminDMax);

  if (hasExtremeVitamins) {
    food.vetoFlags.push("NUTRIENT_VITAMIN_EXTREME");
  }
}

// ============================================
// Hard veto flags (always excluded regardless of threshold)
// ============================================

// These flags indicate items that are never suitable for cooking,
// even if they only trigger a single veto layer.
const HARD_VETO_FLAGS = new Set([
  "CATEGORY_NON_COOKING",
  "CATEGORY_PREPARED",
  "CATEGORY_INFANT",
  "LEXICAL_SUPPLEMENT",
  "NUTRIENT_PROTEIN_ISOLATE",
]);

function isCookable(food: FoodAssessment): boolean {
  // Hard veto: any flag in this set forces exclusion
  if (food.vetoFlags.some((f) => HARD_VETO_FLAGS.has(f))) return false;
  // Threshold-based: exclude if >= COOKABILITY_THRESHOLD distinct layers fired
  return computeVetoScore(food.vetoFlags) < COOKABILITY_THRESHOLD;
}

// ============================================
// Main execution
// ============================================

async function main(): Promise<void> {
  console.log("=== Cookability Assessment ===\n");
  console.log(`Version: ${ASSESSMENT_VERSION}`);
  console.log(`Threshold: ${COOKABILITY_THRESHOLD} distinct layers\n`);

  // Parameter limit guard: PostgreSQL supports max 65535 parameters per query
  const PARAMS_PER_ROW = 6;
  const BATCH_SIZE = 500;
  if (BATCH_SIZE * PARAMS_PER_ROW > 65535) {
    throw new Error(
      `Batch size ${BATCH_SIZE} x ${PARAMS_PER_ROW} params = ${BATCH_SIZE * PARAMS_PER_ROW} exceeds PostgreSQL limit of 65535`
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    // Use REPEATABLE READ so all three SELECT queries share the same snapshot,
    // preventing inconsistencies if data changes between reads.
    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");

    // Load data (all through the same client/transaction for consistency)
    console.log("Loading foods...");
    const foods = await loadFoods(client);
    console.log(`  Loaded ${foods.length} foods`);

    console.log("Loading portions...");
    const portions = await loadPortions(client);
    console.log(`  Loaded portions for ${portions.size} foods`);

    // Load nutrients in chunks to limit memory usage
    console.log("Loading nutrients...");
    const nutrients = await loadNutrientsChunked(client, foods);
    console.log(`  Loaded nutrients for ${nutrients.size} foods\n`);

    // End the read transaction — writes use a separate transaction below
    await client.query("COMMIT");

    // Assess each food
    console.log("Assessing cookability...");
    for (const food of foods) {
      assessCategory(food);
      assessLexical(food);
      assessPortions(food, portions.get(food.fdcId));
      assessNutrients(food, nutrients.get(food.fdcId));
    }

    // Calculate stats using group-based scoring
    const vetoCounts: Record<string, number> = {};
    const groupCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    let excludedCount = 0;
    let hardVetoCount = 0;

    for (const food of foods) {
      for (const flag of food.vetoFlags) {
        vetoCounts[flag] = (vetoCounts[flag] || 0) + 1;
      }
      const score = computeVetoScore(food.vetoFlags);
      groupCounts[Math.min(score, 4)] = (groupCounts[Math.min(score, 4)] || 0) + 1;
      if (!isCookable(food)) {
        excludedCount++;
        if (food.vetoFlags.some((f) => HARD_VETO_FLAGS.has(f))) {
          hardVetoCount++;
        }
      }
    }

    console.log("\nVeto flag counts:");
    for (const [flag, count] of Object.entries(vetoCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${flag}: ${count}`);
    }

    console.log("\nFoods by veto group count:");
    console.log(`  0 groups (clean): ${groupCounts[0]}`);
    console.log(`  1 group (kept unless hard-vetoed): ${groupCounts[1]}`);
    console.log(`  2 groups (excluded): ${groupCounts[2]}`);
    console.log(`  3 groups (excluded): ${groupCounts[3]}`);
    console.log(`  4 groups (excluded): ${groupCounts[4]}`);

    console.log(`\nTotal foods: ${foods.length}`);
    console.log(`Excluded (>= ${COOKABILITY_THRESHOLD} layers or hard-vetoed): ${excludedCount}`);
    console.log(`  Of which hard-vetoed: ${hardVetoCount}`);
    console.log(`Cookable: ${foods.length - excludedCount}`);

    // Save to database with transaction
    console.log("\nSaving assessments to database...");

    await client.query("BEGIN");

    // DELETE instead of TRUNCATE: avoids ACCESS EXCLUSIVE lock and is
    // safely rollback-able within the transaction.
    await client.query("DELETE FROM fdc_cookability_assessment");

    // Batch insert with UPSERT for safety
    for (let i = 0; i < foods.length; i += BATCH_SIZE) {
      const batch = foods.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const food of batch) {
        const vetoScore = computeVetoScore(food.vetoFlags);
        const cookable = isCookable(food);

        placeholders.push(
          `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, NOW(), $${idx + 5})`
        );
        values.push(
          food.fdcId,
          food.vetoFlags,
          COOKABILITY_THRESHOLD,
          vetoScore,
          cookable,
          ASSESSMENT_VERSION
        );
        idx += PARAMS_PER_ROW;
      }

      await client.query(
        `INSERT INTO fdc_cookability_assessment
         (fdc_id, veto_flags, cookability_threshold, veto_score, is_cookable, assessed_at, assessment_version)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (fdc_id)
         DO UPDATE SET
           veto_flags = EXCLUDED.veto_flags,
           cookability_threshold = EXCLUDED.cookability_threshold,
           veto_score = EXCLUDED.veto_score,
           is_cookable = EXCLUDED.is_cookable,
           assessed_at = EXCLUDED.assessed_at,
           assessment_version = EXCLUDED.assessment_version`,
        values
      );
    }

    await client.query("COMMIT");
    console.log("Done!");

    // Show some examples
    console.log("\n--- Examples of EXCLUDED items ---");
    const excluded = foods
      .filter((f) => !isCookable(f))
      .slice(0, 10);
    for (const f of excluded) {
      const groups = [...new Set(f.vetoFlags.map(vetoGroup))].join("+");
      const hardVeto = f.vetoFlags.some((fl) => HARD_VETO_FLAGS.has(fl)) ? " [HARD VETO]" : "";
      console.log(`  [${groups}]${hardVeto} ${f.description.substring(0, 50)}`);
      console.log(`    Flags: ${f.vetoFlags.join(", ")}`);
    }

    console.log("\n--- Examples of items with 1 layer (kept) ---");
    const oneLayer = foods
      .filter((f) => computeVetoScore(f.vetoFlags) === 1 && isCookable(f))
      .slice(0, 10);
    for (const f of oneLayer) {
      console.log(`  [${f.vetoFlags.join(", ")}] ${f.description.substring(0, 60)}`);
    }

  } catch (error) {
    await client.query("ROLLBACK");
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
