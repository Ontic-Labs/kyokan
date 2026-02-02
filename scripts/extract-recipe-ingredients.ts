/**
 * Extract unique ingredient names from RAW_recipes.csv
 * to understand how humans actually refer to cooking ingredients.
 *
 * The CSV has multi-line records (description field spans lines),
 * so we accumulate lines and look for the ingredients pattern.
 *
 * Outputs:
 *   data/recipe-ingredients.json — sorted array of {name, frequency}
 *   Console summary with top ingredients and category breakdowns
 *
 * Usage: npx tsx scripts/extract-recipe-ingredients.ts
 */

import * as fs from "fs";
import * as readline from "readline";

const CSV_PATH = "recipes/RAW_recipes.csv";
const OUTPUT_PATH = "data/recipe-ingredients.json";

async function main() {
  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH),
    crlfDelay: Infinity,
  });

  const ingredients = new Map<string, number>();
  let recipes = 0;
  let buffer = "";

  // The ingredients column contains: "['item1', 'item2', ...]",N
  // at the end of each complete record
  const ingredientPattern = /"\[([^\]]*)\]",(\d+)$/;

  for await (const line of rl) {
    buffer += (buffer ? "\n" : "") + line;

    const match = buffer.match(ingredientPattern);
    if (match === null) continue;

    // Found a complete record
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

    if (recipes % 50000 === 0) {
      process.stdout.write(`\r  ${recipes.toLocaleString()} recipes...`);
    }
  }

  console.log(`\rTotal unique ingredients: ${ingredients.size}`);
  console.log(`Total recipes processed: ${recipes}`);

  const sorted = [...ingredients.entries()].sort((a, b) => b[1] - a[1]);

  // Write structured JSON for downstream scripts
  const output = sorted.map(([name, frequency]) => ({ name, frequency }));
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${output.length} ingredients to ${OUTPUT_PATH}`);

  // Coverage analysis
  const totalUsages = sorted.reduce((sum, [, count]) => sum + count, 0);
  let cumulative = 0;
  let p90idx = 0;
  for (const [, count] of sorted) {
    cumulative += count;
    p90idx++;
    if (cumulative >= totalUsages * 0.9) break;
  }
  console.log(`Top ${p90idx} ingredients cover 90% of all recipe usages (${cumulative.toLocaleString()} / ${totalUsages.toLocaleString()})`);

  console.log("\nTop 50 recipe ingredients:");
  for (const [name, count] of sorted.slice(0, 50)) {
    console.log(`  ${String(count).padStart(7)}  ${name}`);
  }

  console.log("\nPepper-related:");
  for (const [name, count] of sorted) {
    if (name.includes("pepper") && count > 50) {
      console.log(`  ${String(count).padStart(7)}  ${name}`);
    }
  }

  console.log("\nChicken-related (>100):");
  for (const [name, count] of sorted) {
    if (name.includes("chicken") && count > 100) {
      console.log(`  ${String(count).padStart(7)}  ${name}`);
    }
  }

  console.log("\nBeef-related (>100):");
  for (const [name, count] of sorted) {
    if (name.includes("beef") && count > 100) {
      console.log(`  ${String(count).padStart(7)}  ${name}`);
    }
  }

  console.log("\nFish-related (>50):");
  for (const [name, count] of sorted) {
    if (
      (name.includes("fish") || name.includes("salmon") ||
        name.includes("tuna") || name.includes("cod")) &&
      count > 50
    ) {
      console.log(`  ${String(count).padStart(7)}  ${name}`);
    }
  }
}

main().catch(console.error);
