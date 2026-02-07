/**
 * Parse Branded Foods → Canonical Synonyms
 *
 * Stream-parses branded_cookable.jsonl and extracts synonym mappings:
 *   - Strips brand prefixes (all-caps segments)
 *   - Strips size/UPC tokens
 *   - Canonicalizes remaining description → slug
 *   - Groups by canonical slug, collects surface forms as aliases
 *
 * Usage:
 *   npx tsx scripts/parse-branded-synonyms.ts                    # dry run, show stats
 *   npx tsx scripts/parse-branded-synonyms.ts --output           # write JSON output
 *   npx tsx scripts/parse-branded-synonyms.ts --write            # write to database
 *   npx tsx scripts/parse-branded-synonyms.ts --category Rice    # filter by category
 *   npx tsx scripts/parse-branded-synonyms.ts --sample 100       # process N foods
 */

import * as fs from "fs";
import * as readline from "readline";
import * as path from "path";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { canonicalizeDescription, slugify } from "../src/lib/canonicalize";

dotenv.config({ path: ".env.local" });

const INPUT_PATH = path.join(__dirname, "..", "fdc", "branded_cookable.jsonl");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "branded-synonyms.json");

// ============================================================================
// Types
// ============================================================================

interface BrandedFood {
  fdcId: number;
  description: string;
  brandOwner?: string;
  brandedFoodCategory?: string;
  ingredients?: string;
}

interface SynonymEntry {
  aliasNorm: string;          // normalized alias (lowercase, trimmed)
  canonicalSlug: string;      // target canonical slug
  canonicalName: string;      // human-readable canonical name
  sourceCount: number;        // how many branded foods produced this alias
  sampleBrands: string[];     // sample brand owners
  sampleDescriptions: string[]; // sample original descriptions
  category: string;           // branded food category
}

interface CanonicalGroup {
  slug: string;
  name: string;
  aliases: Map<string, {
    count: number;
    brands: Set<string>;
    descriptions: string[];
    category: string;
  }>;
  totalFoods: number;
}

// ============================================================================
// Category → Canonical Mapping (for staples)
// ============================================================================

const CATEGORY_TO_CANONICAL: Record<string, { slug: string; name: string }> = {
  // Dairy
  "Eggs & Egg Substitutes": { slug: "eggs", name: "Eggs" },
  "Cheese": { slug: "cheese", name: "Cheese" },
  "Milk": { slug: "milk", name: "Milk" },
  "Butter & Spread": { slug: "butter", name: "Butter" },
  "Cream": { slug: "cream", name: "Cream" },
  "Yogurt": { slug: "yogurt", name: "Yogurt" },

  // Proteins
  "Fresh Meat": { slug: "meat", name: "Meat" },
  "Other Meats": { slug: "meat", name: "Meat" },
  "Poultry, Chicken & Turkey": { slug: "chicken", name: "Chicken" },
  "Fish & Seafood": { slug: "fish", name: "Fish" },
  "Frozen Fish & Seafood": { slug: "fish", name: "Fish" },

  // Grains
  "Rice": { slug: "rice", name: "Rice" },
  "Pasta by Shape & Type": { slug: "pasta", name: "Pasta" },
  "Fresh Pasta": { slug: "pasta", name: "Pasta" },
  "All Noodles": { slug: "noodles", name: "Noodles" },
  "Noodles": { slug: "noodles", name: "Noodles" },
  "Flours & Corn Meal": { slug: "flour", name: "Flour" },

  // Produce
  "Tomatoes": { slug: "tomatoes", name: "Tomatoes" },
  "Canned Vegetables": { slug: "vegetables", name: "Vegetables" },
  "Frozen Vegetables": { slug: "vegetables", name: "Vegetables" },

  // Fats & Oils
  "Vegetable & Cooking Oils": { slug: "oil", name: "Oil" },
  "Cooking Oils and Fats": { slug: "oil", name: "Oil" },

  // Sweeteners
  "Honey": { slug: "honey", name: "Honey" },
  "Granulated, Brown & Powdered Sugar": { slug: "sugar", name: "Sugar" },
  "Syrups & Molasses": { slug: "syrup", name: "Syrup" },

  // Legumes
  "Canned & Bottled Beans": { slug: "beans", name: "Beans" },

  // Condiments
  "Vinegar": { slug: "vinegar", name: "Vinegar" },
  "Vinegars/Cooking Wines": { slug: "vinegar", name: "Vinegar" },
  "Herbs & Spices": { slug: "spices", name: "Spices" },
  "Nut & Seed Butters": { slug: "nut-butter", name: "Nut Butter" },
};

// ============================================================================
// Brand/noise stripping (supplements canonicalize.ts)
// ============================================================================

// Size/weight patterns to strip
const SIZE_PATTERNS = [
  /\b\d+(\.\d+)?\s*(oz|ounce|lb|lbs|pound|g|gram|kg|ml|l|liter|fl\.?\s*oz|gal|gallon|ct|count|pk|pack|pc|piece)s?\b/gi,
  /\b\d+\s*%\b/gi,                    // percentages
  /\b\d+\s*x\s*\d+/gi,                // dimensions like "6 x 8"
  /\bfamily\s*size\b/gi,
  /\bvalue\s*pack\b/gi,
  /\bbonus\s*pack\b/gi,
  /\bmulti[\s-]*pack\b/gi,
  /\bsingle\s*serve\b/gi,
];

// Promotional/marketing terms to strip
const PROMO_PATTERNS = [
  /\bnew\b/gi,
  /\bimproved\b/gi,
  /\boriginal\b/gi,
  /\bclassic\b/gi,
  /\bpremium\b/gi,
  /\bselect\b/gi,
  /\bsignature\b/gi,
  /\bgourmet\b/gi,
  /\bartisan\b/gi,
  /\bhomestyle\b/gi,
  /\bold\s*fashioned\b/gi,
  /\bfarm\s*fresh\b/gi,
  /\ball\s*natural\b/gi,
  /\b100%\s*natural\b/gi,
];

/**
 * Strip brand prefix from description.
 * Branded foods often start with "BRAND NAME, actual food"
 */
function stripBrandPrefix(description: string, brandOwner?: string): string {
  let text = description.trim();

  // If brandOwner provided, try to strip it directly
  if (brandOwner) {
    const brandLower = brandOwner.toLowerCase();
    const textLower = text.toLowerCase();
    if (textLower.startsWith(brandLower)) {
      text = text.slice(brandOwner.length).replace(/^[,\s]+/, "").trim();
    }
  }

  // Strip all-caps prefix before first comma (common brand pattern)
  const commaIdx = text.indexOf(",");
  if (commaIdx > 0 && commaIdx < 50) {
    const prefix = text.slice(0, commaIdx);
    const words = prefix.split(/\s+/);
    const allCaps = words.every((w) => {
      const letters = w.replace(/[^a-zA-Z]/g, "");
      return letters.length >= 2 && letters === letters.toUpperCase();
    });
    if (allCaps) {
      text = text.slice(commaIdx + 1).trim();
    }
  }

  return text;
}

/**
 * Strip size, UPC, and promotional noise from description
 */
function stripNoise(text: string): string {
  let result = text;

  // Strip size patterns
  for (const pattern of SIZE_PATTERNS) {
    result = result.replace(pattern, " ");
  }

  // Strip promo patterns
  for (const pattern of PROMO_PATTERNS) {
    result = result.replace(pattern, " ");
  }

  // Collapse whitespace and commas
  result = result
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+/, "")
    .replace(/[,\s]+$/, "")
    .trim();

  return result;
}

/**
 * Extract canonical info from a branded food description
 */
function extractCanonical(food: BrandedFood): {
  aliasNorm: string;
  canonicalSlug: string;
  canonicalName: string;
} | null {
  // Step 1: Strip brand prefix
  let text = stripBrandPrefix(food.description, food.brandOwner);

  // Step 2: Strip noise (sizes, promo terms)
  text = stripNoise(text);

  // Skip if too short after stripping
  if (text.length < 3) return null;

  // Step 3: Check category-based mapping for common staples
  const categoryCanonical = food.brandedFoodCategory
    ? CATEGORY_TO_CANONICAL[food.brandedFoodCategory]
    : undefined;

  let canonicalSlug: string;
  let canonicalName: string;

  if (categoryCanonical) {
    // Use category-based canonical for staples
    canonicalSlug = categoryCanonical.slug;
    canonicalName = categoryCanonical.name;
  } else {
    // Fall back to description-based canonicalization
    const result = canonicalizeDescription(text);

    // Skip if canonical is too generic
    if (result.baseSlug === "unknown" || result.baseSlug.length < 2) return null;

    canonicalSlug = result.baseSlug;
    canonicalName = result.baseName;
  }

  // The alias is the cleaned description (what someone might type)
  const aliasNorm = text.toLowerCase().trim();

  // Skip if alias is same as canonical (no new info)
  if (slugify(aliasNorm) === canonicalSlug) return null;

  // Skip very long aliases (likely product names, not ingredient terms)
  if (aliasNorm.length > 80) return null;

  return {
    aliasNorm,
    canonicalSlug,
    canonicalName,
  };
}

// ============================================================================
// Database
// ============================================================================

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({ connectionString, max: 1 });
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("=== Parse Branded Foods → Canonical Synonyms ===\n");

  const writeOutput = process.argv.includes("--output");
  const writeDb = process.argv.includes("--write");
  const categoryIdx = process.argv.indexOf("--category");
  const categoryFilter = categoryIdx !== -1 ? process.argv[categoryIdx + 1] : undefined;
  const sampleIdx = process.argv.indexOf("--sample");
  const sampleLimit = sampleIdx !== -1 ? parseInt(process.argv[sampleIdx + 1], 10) : undefined;

  console.log(`Input:    ${INPUT_PATH}`);
  console.log(`Mode:     ${writeDb ? "WRITE TO DB" : writeOutput ? "WRITE JSON" : "DRY RUN"}`);
  if (categoryFilter) console.log(`Category: ${categoryFilter}`);
  if (sampleLimit) console.log(`Sample:   ${sampleLimit} foods`);
  console.log();

  // Check input exists
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`Input file not found: ${INPUT_PATH}\nRun filter-branded-cookable.ts first.`);
  }

  // Stream parse JSONL
  const fileStream = fs.createReadStream(INPUT_PATH);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const canonicals = new Map<string, CanonicalGroup>();
  let totalFoods = 0;
  let skipped = 0;
  let extracted = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    totalFoods++;
    if (sampleLimit && totalFoods > sampleLimit) break;

    let food: BrandedFood;
    try {
      food = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }

    // Category filter
    if (categoryFilter && food.brandedFoodCategory !== categoryFilter) {
      continue;
    }

    const result = extractCanonical(food);
    if (!result) {
      skipped++;
      continue;
    }

    extracted++;

    // Group by canonical slug
    let group = canonicals.get(result.canonicalSlug);
    if (!group) {
      group = {
        slug: result.canonicalSlug,
        name: result.canonicalName,
        aliases: new Map(),
        totalFoods: 0,
      };
      canonicals.set(result.canonicalSlug, group);
    }
    group.totalFoods++;

    // Track alias
    let aliasEntry = group.aliases.get(result.aliasNorm);
    if (!aliasEntry) {
      aliasEntry = {
        count: 0,
        brands: new Set(),
        descriptions: [],
        category: food.brandedFoodCategory || "(none)",
      };
      group.aliases.set(result.aliasNorm, aliasEntry);
    }
    aliasEntry.count++;
    if (food.brandOwner) aliasEntry.brands.add(food.brandOwner);
    if (aliasEntry.descriptions.length < 3) {
      aliasEntry.descriptions.push(food.description);
    }

    if (totalFoods % 10000 === 0) {
      process.stdout.write(`\r  ${totalFoods.toLocaleString()} foods processed...`);
    }
  }

  console.log(`\r  ${totalFoods.toLocaleString()} foods processed.   \n`);

  // Build synonym list
  const synonyms: SynonymEntry[] = [];
  for (const group of canonicals.values()) {
    for (const [aliasNorm, entry] of group.aliases) {
      synonyms.push({
        aliasNorm,
        canonicalSlug: group.slug,
        canonicalName: group.name,
        sourceCount: entry.count,
        sampleBrands: [...entry.brands].slice(0, 5),
        sampleDescriptions: entry.descriptions,
        category: entry.category,
      });
    }
  }

  // Sort by source count descending
  synonyms.sort((a, b) => b.sourceCount - a.sourceCount);

  // Stats
  console.log("=== Summary ===");
  console.log(`Total foods processed: ${totalFoods.toLocaleString()}`);
  console.log(`Extracted:             ${extracted.toLocaleString()}`);
  console.log(`Skipped:               ${skipped.toLocaleString()}`);
  console.log(`Unique canonicals:     ${canonicals.size.toLocaleString()}`);
  console.log(`Unique aliases:        ${synonyms.length.toLocaleString()}`);

  // Top canonicals by food count
  const sortedCanonicals = [...canonicals.values()].sort((a, b) => b.totalFoods - a.totalFoods);
  console.log("\n=== Top 20 Canonicals by Food Count ===");
  for (const c of sortedCanonicals.slice(0, 20)) {
    console.log(`  ${c.totalFoods.toString().padStart(6)} ${c.slug} (${c.aliases.size} aliases)`);
  }

  // Top aliases by source count
  console.log("\n=== Top 20 Aliases by Source Count ===");
  for (const s of synonyms.slice(0, 20)) {
    console.log(`  ${s.sourceCount.toString().padStart(6)} "${s.aliasNorm}" → ${s.canonicalSlug}`);
  }

  // Sample extractions
  console.log("\n=== Sample Extractions ===");
  for (const s of synonyms.slice(0, 10)) {
    console.log(`  "${s.sampleDescriptions[0]}"`);
    console.log(`    → alias: "${s.aliasNorm}"`);
    console.log(`    → canonical: ${s.canonicalSlug}`);
    console.log();
  }

  // Output
  if (writeOutput) {
    const output = {
      generatedAt: new Date().toISOString(),
      totalFoods,
      uniqueCanonicals: canonicals.size,
      uniqueAliases: synonyms.length,
      synonyms: synonyms.slice(0, 10000), // Cap at 10K for file size
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`\nWrote ${OUTPUT_PATH}`);
  }

  if (writeDb) {
    console.log("\n=== Writing to Database ===");
    const pool = getPool();
    const client = await pool.connect();

    try {
      // Filter to aliases with count >= 2 (reduce noise)
      const validSynonyms = synonyms.filter((s) => s.sourceCount >= 2);
      console.log(`Synonyms with count >= 2: ${validSynonyms.length}`);

      // Batch lookup all canonical_ids at once (much faster than individual queries)
      const uniqueSlugs = [...new Set(validSynonyms.map((s) => s.canonicalSlug))];
      console.log(`Unique canonical slugs: ${uniqueSlugs.length}`);

      const lookupResult = await client.query<{ canonical_id: string; canonical_slug: string }>(
        `SELECT canonical_id, canonical_slug FROM canonical_ingredient WHERE canonical_slug = ANY($1)`,
        [uniqueSlugs]
      );
      const slugToId = new Map<string, string>();
      for (const row of lookupResult.rows) {
        slugToId.set(row.canonical_slug, row.canonical_id);
      }
      console.log(`Found ${slugToId.size} canonical IDs in database`);

      await client.query("BEGIN");

      const BATCH = 500;
      let inserted = 0;
      let skippedNoCanonical = 0;

      for (let i = 0; i < validSynonyms.length; i += BATCH) {
        const batch = validSynonyms.slice(i, i + BATCH);
        const vals: unknown[] = [];
        const placeholders: string[] = [];
        let idx = 1;

        for (const syn of batch) {
          const canonicalId = slugToId.get(syn.canonicalSlug);
          if (!canonicalId) {
            skippedNoCanonical++;
            continue;
          }

          placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
          vals.push(canonicalId, syn.aliasNorm, syn.sourceCount, "branded");
          idx += 4;
        }

        if (placeholders.length > 0) {
          await client.query(
            `INSERT INTO canonical_ingredient_alias
              (canonical_id, alias_norm, alias_count, alias_source)
             VALUES ${placeholders.join(", ")}
             ON CONFLICT (canonical_id, alias_norm) DO UPDATE SET
               alias_count = canonical_ingredient_alias.alias_count + EXCLUDED.alias_count`,
            vals
          );
          inserted += placeholders.length;
        }

        if ((i + BATCH) % 1000 < BATCH || i + BATCH >= validSynonyms.length) {
          process.stdout.write(`\r  ${inserted} inserted, ${skippedNoCanonical} skipped (no canonical)...`);
        }
      }

      await client.query("COMMIT");
      console.log(`\r  ${inserted} aliases inserted, ${skippedNoCanonical} skipped (no canonical).   `);
    } finally {
      client.release();
      await pool.end();
    }
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
