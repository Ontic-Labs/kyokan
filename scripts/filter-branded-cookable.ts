/**
 * Filter Branded Foods to Cookable Ingredients Only
 *
 * Stream-parses the 3.1GB branded JSON file and outputs only foods in
 * cookable categories as JSONL. No chunks needed.
 *
 * Usage:
 *   npx tsx scripts/filter-branded-cookable.ts
 *   npx tsx scripts/filter-branded-cookable.ts --discover   # dump all categories with counts
 */

import * as fs from "fs";
import * as path from "path";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/Pick";
import { streamArray } from "stream-json/streamers/StreamArray";
import { chain } from "stream-chain";

const INPUT_PATH = path.join(
  __dirname,
  "..",
  "fdc",
  "FoodData_Central_branded_food_json_2025-12-18.json"
);
const OUTPUT_PATH = path.join(__dirname, "..", "fdc", "branded_cookable.jsonl");

// ============================================================================
// Categories that represent actual cooking ingredients
// ============================================================================

const COOKABLE_CATEGORIES = new Set([
  // Dairy
  "Cheese",
  "Milk",
  "Cream",
  "Butter & Spread",
  "Yogurt",
  "Eggs & Egg Substitutes",
  "Eggs",
  "Margarine/Butter",

  // Produce
  "Pre-Packaged Fruit & Vegetables",
  "Canned Vegetables",
  "Frozen Vegetables",
  "Canned Fruit",
  "Frozen Fruit & Fruit Juice Concentrates",
  "Tomatoes",
  "Fresh Fruit and Vegetables",
  "Fruits, Vegetables & Produce",
  "Vegetables",
  "Fruit",
  "Berries/Small Fruit",
  "Peppers",
  "Fruits - Unprepared/Unprocessed (Frozen)",
  "Fruits - Unprepared/Unprocessed (Shelf Stable)",
  "Vegetables - Unprepared/Unprocessed (Frozen)",
  "Vegetables - Unprepared/Unprocessed (Shelf Stable)",

  // Proteins
  "Other Meats",
  "Fresh Meat",
  "Fresh Meat, Poultry and Seafood",
  "Pepperoni, Salami & Cold Cuts",
  "Sausages, Hotdogs & Brats",
  "Bacon, Sausages & Ribs",
  "Fish & Seafood",
  "Frozen Fish & Seafood",
  "Canned Seafood",
  "Canned Tuna",
  "Poultry, Chicken & Turkey",
  "Fresh Chicken - Processed",
  "Fresh Chicken - Whole",
  "Fresh Chicken - Portions",
  "Frozen Chicken - Portions",
  "Ham/Cold Meats",
  "Pork - Unprepared/Unprocessed",
  "Pork - Prepared/Processed",
  "Beef - Prepared/Processed",
  "Turkey - Unprepared/Unprocessed",
  "Shellfish Prepared/Processed",
  "Aquatic Invertebrates/Fish/Shellfish/Seafood Combination",
  "Mussels",
  "Tofu",

  // Grains & Pasta
  "Pasta by Shape & Type",
  "Rice",
  "All Noodles",
  "Noodles",
  "Fresh Pasta",
  "Pasta",
  "Other Grains & Seeds",
  "Rice & Grains",
  "Flours & Corn Meal",
  "Flour - Cereal/Pulse (Shelf Stable)",

  // Legumes
  "Canned & Bottled Beans",
  "Vegetable and Lentil Mixes",
  "Chickpeas",

  // Condiments & Seasonings
  "Herbs & Spices",
  "Seasoning Mixes, Salts, Marinades & Tenderizers",
  "Pickles, Olives, Peppers & Relishes",
  "Vegetable & Cooking Oils",
  "Cooking Oils and Fats",
  "Vinegar",
  "Vinegars/Cooking Wines",
  "Honey",
  "Syrups & Molasses",
  "Nut & Seed Butters",
  "Oriental, Mexican & Ethnic Sauces",
  "Other Cooking Sauces",
  "Prepared Pasta & Pizza Sauces",
  "Ketchup, Mustard, BBQ & Cheese Sauce",
  "Salad Dressing & Mayonnaise",
  "Jam, Jelly & Fruit Spreads",
  "Dips & Salsa",
  "Antipasto",
  "Sauces - Cooking (Shelf Stable)",
  "Sauces/Spreads/Dips/Condiments",
  "Dressings/Dips (Shelf Stable)",

  // Baking
  "Granulated, Brown & Powdered Sugar",
  "Baking Decorations & Dessert Toppings",
  "Baking/Cooking Mixes (Shelf Stable)",
  "Baking/Cooking Mixes (Perishable)",
  "Baking",

  // Bread & Dough (for cooking)
  "Crusts & Dough",
  "Frozen Bread & Dough",
  "Pastry",

  // Nuts & Seeds
  "Popcorn, Peanuts, Seeds & Related Snacks",
  "Nuts/Seeds - Unprepared/Unprocessed (In Shell)",

  // Plant-based
  "Plant Based Milk",
]);

// ============================================================================
// Streaming pipeline
// ============================================================================

interface BrandedFood {
  fdcId: number;
  description: string;
  brandOwner?: string;
  brandedFoodCategory?: string;
  gtinUpc?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: unknown[];
  labelNutrients?: Record<string, { value: number }>;
}

async function discoverCategories(): Promise<void> {
  console.log("=== Category Discovery Mode ===\n");
  console.log(`Reading: ${INPUT_PATH}\n`);

  const categories = new Map<string, number>();
  let total = 0;

  const pipeline = chain([
    fs.createReadStream(INPUT_PATH),
    parser(),
    pick({ filter: "BrandedFoods" }),
    streamArray(),
  ]);

  for await (const { value } of pipeline as AsyncIterable<{ value: BrandedFood }>) {
    total++;
    const cat = value.brandedFoodCategory || "(none)";
    categories.set(cat, (categories.get(cat) || 0) + 1);

    if (total % 50000 === 0) {
      process.stdout.write(`\r  ${total.toLocaleString()} foods scanned...`);
    }
  }

  console.log(`\r  ${total.toLocaleString()} foods scanned.\n`);

  const sorted = [...categories.entries()].sort((a, b) => b[1] - a[1]);
  const inSet = sorted.filter(([cat]) => COOKABLE_CATEGORIES.has(cat));
  const notInSet = sorted.filter(([cat]) => !COOKABLE_CATEGORIES.has(cat));

  console.log(`Total categories: ${sorted.length}`);
  console.log(`In cookable set: ${inSet.length}`);
  console.log(`Not in cookable set: ${notInSet.length}\n`);

  console.log("=== INCLUDED ===");
  for (const [cat, count] of inSet) {
    console.log(`  ${count.toLocaleString().padStart(8)} ${cat}`);
  }

  console.log("\n=== NOT INCLUDED ===");
  for (const [cat, count] of notInSet) {
    console.log(`  ${count.toLocaleString().padStart(8)} ${cat}`);
  }
}

async function filterCookable(): Promise<void> {
  console.log("=== Filter Branded Foods to Cookable ===\n");
  console.log(`Input:  ${INPUT_PATH}`);
  console.log(`Output: ${OUTPUT_PATH}\n`);

  const outputStream = fs.createWriteStream(OUTPUT_PATH);
  const categories = new Map<string, number>();
  let total = 0;
  let kept = 0;

  const pipeline = chain([
    fs.createReadStream(INPUT_PATH),
    parser({ jsonStreaming: true }),
    streamArray(),
  ]);

  for await (const { value } of pipeline as AsyncIterable<{ value: BrandedFood }>) {
    total++;
    const cat = value.brandedFoodCategory || "";

    if (COOKABLE_CATEGORIES.has(cat)) {
      kept++;
      outputStream.write(JSON.stringify(value) + "\n");
      categories.set(cat, (categories.get(cat) || 0) + 1);
    }

    if (total % 50000 === 0) {
      process.stdout.write(
        `\r  ${total.toLocaleString()} scanned, ${kept.toLocaleString()} kept...`
      );
    }
  }

  await new Promise<void>((resolve, reject) => {
    outputStream.end(() => resolve());
    outputStream.on("error", reject);
  });

  console.log(
    `\r  ${total.toLocaleString()} scanned, ${kept.toLocaleString()} kept.   \n`
  );

  console.log("=== Summary ===");
  console.log(`Total foods processed: ${total.toLocaleString()}`);
  console.log(`Cookable foods kept:   ${kept.toLocaleString()}`);
  console.log(`Reduction:             ${((1 - kept / total) * 100).toFixed(1)}%`);
  console.log(`Output:                ${OUTPUT_PATH}`);

  console.log("\n=== Categories Kept ===");
  const sorted = [...categories.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sorted) {
    console.log(`  ${count.toLocaleString().padStart(8)} ${cat}`);
  }
}

// ============================================================================
// Main
// ============================================================================

const isDiscover = process.argv.includes("--discover");

(isDiscover ? discoverCategories() : filterCookable()).catch((err) => {
  console.error(err);
  process.exit(1);
});
