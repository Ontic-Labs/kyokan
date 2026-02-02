/**
 * Validation report: compare our canonical specific names against
 * how humans actually name ingredients in recipes.
 *
 * Reads USDA food descriptions from local JSON files (no DB needed),
 * runs canonicalizeDescription() on each, then checks how many of our
 * canonical names appear in the recipe ingredient vocabulary.
 *
 * Usage: npx tsx scripts/validate-canonical-vs-recipes.ts
 */

import * as fs from "fs";
import * as readline from "readline";
import { canonicalizeDescription } from "../src/lib/canonicalize";

// ---------------------------------------------------------------------------
// Step 1: Load recipe ingredients from RAW_recipes.csv
// ---------------------------------------------------------------------------

async function loadRecipeIngredients(csvPath: string): Promise<Map<string, number>> {
  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath),
    crlfDelay: Infinity,
  });

  const ingredients = new Map<string, number>();
  let recipes = 0;
  let buffer = "";
  const ingredientPattern = /"\[([^\]]*)\]",(\d+)$/;

  for await (const line of rl) {
    buffer += (buffer ? "\n" : "") + line;
    const match = buffer.match(ingredientPattern);
    if (match === null) continue;

    recipes++;
    const raw = match[1];
    const items = raw.match(/'([^']+)'/g);
    if (items !== null) {
      for (const item of items) {
        const name = item.replace(/^'|'$/g, "").trim().toLowerCase();
        ingredients.set(name, (ingredients.get(name) || 0) + 1);
      }
    }
    buffer = "";
  }

  console.log(`Loaded ${ingredients.size} unique ingredients from ${recipes} recipes\n`);
  return ingredients;
}

// ---------------------------------------------------------------------------
// Step 2: Load USDA food descriptions from JSON files
// ---------------------------------------------------------------------------

interface FoodDesc {
  description: string;
  source: string;
}

function loadFoodsFromJSON(): FoodDesc[] {
  const foods: FoodDesc[] = [];

  // SR Legacy
  const srPath = "fdc/FoodData_Central_sr_legacy_food_json_2018-04.json";
  if (fs.existsSync(srPath)) {
    const sr = JSON.parse(fs.readFileSync(srPath, "utf-8"));
    for (const f of sr.SRLegacyFoods) {
      foods.push({ description: f.description, source: "SR Legacy" });
    }
  }

  // Foundation
  const fnPath = "fdc/FoodData_Central_foundation_food_json_2025-12-18.json";
  if (fs.existsSync(fnPath)) {
    const fn = JSON.parse(fs.readFileSync(fnPath, "utf-8"));
    for (const f of fn.FoundationFoods) {
      foods.push({ description: f.description, source: "Foundation" });
    }
  }

  console.log(`Loaded ${foods.length} USDA food descriptions\n`);
  return foods;
}

// ---------------------------------------------------------------------------
// Step 3: Canonicalize all foods and collect unique specific names
// ---------------------------------------------------------------------------

interface CanonicalEntry {
  specificName: string;
  specificSlug: string;
  baseName: string;
  descriptions: string[]; // original USDA descriptions that map here
}

function canonicalizeAllFoods(foods: FoodDesc[]): Map<string, CanonicalEntry> {
  const map = new Map<string, CanonicalEntry>();

  for (const food of foods) {
    const result = canonicalizeDescription(food.description);
    const slug = result.specificSlug;

    const existing = map.get(slug);
    if (existing) {
      existing.descriptions.push(food.description);
    } else {
      map.set(slug, {
        specificName: result.specificName,
        specificSlug: slug,
        baseName: result.baseName,
        descriptions: [food.description],
      });
    }
  }

  console.log(`Produced ${map.size} unique specific canonical names\n`);
  return map;
}

// ---------------------------------------------------------------------------
// Step 4: Match against recipe ingredients
// ---------------------------------------------------------------------------

interface MatchResult {
  slug: string;
  specificName: string;
  baseName: string;
  foodCount: number;
  exactMatch: boolean;        // specificName appears exactly in recipes
  containsMatch: boolean;     // some recipe ingredient contains our name
  containedInMatch: boolean;  // our name contains some recipe ingredient
  bestRecipeMatch: string;
  bestRecipeCount: number;
}

function matchAgainstRecipes(
  canonicals: Map<string, CanonicalEntry>,
  recipeIngredients: Map<string, number>,
): MatchResult[] {
  const results: MatchResult[] = [];

  // Pre-build sorted recipe ingredients for substring searching
  const recipeEntries = [...recipeIngredients.entries()]
    .sort((a, b) => b[1] - a[1]);

  for (const [slug, entry] of canonicals) {
    const name = entry.specificName;
    const exactCount = recipeIngredients.get(name) || 0;

    let bestContains = "";
    let bestContainsCount = 0;
    let bestContainedIn = "";
    let bestContainedInCount = 0;

    // Check recipe ingredients that contain our name or vice versa
    // Only check top 2000 recipe ingredients for performance
    for (const [recipeName, count] of recipeEntries.slice(0, 3000)) {
      if (recipeName === name) continue; // skip exact
      if (recipeName.includes(name) && count > bestContainsCount) {
        bestContains = recipeName;
        bestContainsCount = count;
      }
      if (name.includes(recipeName) && recipeName.length >= 3 && count > bestContainedInCount) {
        bestContainedIn = recipeName;
        bestContainedInCount = count;
      }
    }

    const hasContains = bestContainsCount > 0;
    const hasContainedIn = bestContainedInCount > 0;

    // Pick the best match to display
    let bestMatch = "";
    let bestCount = 0;
    if (exactCount > 0) {
      bestMatch = name;
      bestCount = exactCount;
    } else if (bestContainsCount >= bestContainedInCount) {
      bestMatch = bestContains;
      bestCount = bestContainsCount;
    } else {
      bestMatch = bestContainedIn;
      bestCount = bestContainedInCount;
    }

    results.push({
      slug,
      specificName: name,
      baseName: entry.baseName,
      foodCount: entry.descriptions.length,
      exactMatch: exactCount > 0,
      containsMatch: hasContains,
      containedInMatch: hasContainedIn,
      bestRecipeMatch: bestMatch,
      bestRecipeCount: bestCount,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Step 5: Print report
// ---------------------------------------------------------------------------

function printReport(results: MatchResult[]): void {
  const total = results.length;
  const exact = results.filter((r) => r.exactMatch);
  const containsOnly = results.filter((r) => !r.exactMatch && r.containsMatch);
  const containedOnly = results.filter((r) => !r.exactMatch && !r.containsMatch && r.containedInMatch);
  const noMatch = results.filter((r) => !r.exactMatch && !r.containsMatch && !r.containedInMatch);

  console.log("=".repeat(80));
  console.log("CANONICAL NAME VALIDATION REPORT");
  console.log("=".repeat(80));
  console.log();
  console.log(`Total unique specific canonical names: ${total}`);
  console.log(`  Exact match in recipes:          ${exact.length} (${pct(exact.length, total)})`);
  console.log(`  Substring match (recipe ⊃ ours): ${containsOnly.length} (${pct(containsOnly.length, total)})`);
  console.log(`  Substring match (ours ⊃ recipe): ${containedOnly.length} (${pct(containedOnly.length, total)})`);
  console.log(`  No match:                        ${noMatch.length} (${pct(noMatch.length, total)})`);

  // Sort by food count descending for relevance
  const byFoodCount = [...results].sort((a, b) => b.foodCount - a.foodCount);

  console.log("\n" + "-".repeat(80));
  console.log("EXACT MATCHES (our canonical name = recipe ingredient) — top 40");
  console.log("-".repeat(80));
  const topExact = exact
    .sort((a, b) => b.bestRecipeCount - a.bestRecipeCount)
    .slice(0, 40);
  for (const r of topExact) {
    console.log(`  ✓ ${r.specificName.padEnd(30)} recipe_count=${String(r.bestRecipeCount).padStart(6)}  foods=${r.foodCount}`);
  }

  console.log("\n" + "-".repeat(80));
  console.log("NEAR MATCHES (recipe ingredient contains our name) — top 30");
  console.log("-".repeat(80));
  const topContains = containsOnly
    .sort((a, b) => b.bestRecipeCount - a.bestRecipeCount)
    .slice(0, 30);
  for (const r of topContains) {
    console.log(`  ~ ${r.specificName.padEnd(30)} → recipe: "${r.bestRecipeMatch}" (${r.bestRecipeCount})`);
  }

  console.log("\n" + "-".repeat(80));
  console.log("NO MATCH — high-food-count canonicals (most impactful to fix)");
  console.log("-".repeat(80));
  const topNoMatch = noMatch
    .sort((a, b) => b.foodCount - a.foodCount)
    .slice(0, 50);
  for (const r of topNoMatch) {
    console.log(`  ✗ ${r.specificName.padEnd(35)} base=${r.baseName.padEnd(15)} foods=${r.foodCount}`);
  }

  console.log("\n" + "-".repeat(80));
  console.log("PROTEIN CANONICALS — all");
  console.log("-".repeat(80));
  const proteins = results.filter((r) =>
    ["beef", "pork", "lamb", "chicken", "turkey", "fish", "veal"].includes(r.baseName)
  ).sort((a, b) => b.foodCount - a.foodCount);
  for (const r of proteins) {
    const matchIcon = r.exactMatch ? "✓" : r.containsMatch ? "~" : "✗";
    const matchInfo = r.bestRecipeMatch
      ? `→ "${r.bestRecipeMatch}" (${r.bestRecipeCount})`
      : "";
    console.log(`  ${matchIcon} ${r.specificName.padEnd(30)} foods=${String(r.foodCount).padStart(3)}  ${matchInfo}`);
  }

  console.log("\n" + "-".repeat(80));
  console.log("SPICE CANONICALS — all");
  console.log("-".repeat(80));
  const spices = results.filter((r) =>
    r.baseName === "pepper" ||
    byFoodCount.some((b) => b.slug === r.slug && r.baseName.includes("spice")) ||
    ["cinnamon", "cumin", "oregano", "thyme", "basil", "paprika", "turmeric",
     "nutmeg", "ginger", "cloves", "cardamom", "coriander", "fennel",
     "mustard", "saffron", "allspice", "anise", "caraway", "celery seed",
     "chili powder", "curry", "dill", "garlic", "onion", "parsley",
     "rosemary", "sage", "tarragon"].some(s => r.specificName.includes(s))
  ).sort((a, b) => b.foodCount - a.foodCount);
  for (const r of spices) {
    const matchIcon = r.exactMatch ? "✓" : r.containsMatch ? "~" : "✗";
    const matchInfo = r.bestRecipeMatch
      ? `→ "${r.bestRecipeMatch}" (${r.bestRecipeCount})`
      : "";
    console.log(`  ${matchIcon} ${r.specificName.padEnd(30)} foods=${String(r.foodCount).padStart(3)}  ${matchInfo}`);
  }
}

function pct(n: number, total: number): string {
  return `${((n / total) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Loading recipe ingredients...");
  const recipeIngredients = await loadRecipeIngredients("recipes/RAW_recipes.csv");

  console.log("Loading USDA food descriptions...");
  const foods = loadFoodsFromJSON();

  console.log("Canonicalizing all foods...");
  const canonicals = canonicalizeAllFoods(foods);

  console.log("Matching against recipe ingredients...\n");
  const results = matchAgainstRecipes(canonicals, recipeIngredients);

  printReport(results);
}

main().catch(console.error);
