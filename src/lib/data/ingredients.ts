import { db } from "@/lib/db";
import { getOffset, paginate, PaginatedResponse } from "@/lib/paging";
import { validateItems } from "@/lib/validate-response";
import {
  IngredientDetail,
  IngredientNutrient,
  IngredientNutrientSchema,
  IngredientListItem,
  IngredientListItemSchema,
} from "@/types/fdc";

// ============================================================================
// Slug normalization (matches canonicalize.ts slugify)
// ============================================================================

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ============================================================================
// Ingredient Detail (by slug, with alias fallback)
// ============================================================================

/**
 * Resolve a canonical ingredient by slug.
 * Resolution order:
 *   1. Direct slug match on canonical_ingredient.canonical_slug
 *   2. Alias match: slugify(alias_norm) matches the input slug
 *   3. Trigram fuzzy match on canonical_name (similarity >= 0.3)
 */
async function resolveCanonicalId(slug: string): Promise<{
  canonical_id: string;
  canonical_name: string;
  canonical_slug: string;
  synthetic_fdc_id: number | null;
  total_count: string;
  fdc_count: string;
} | null> {
  // 1. Direct slug match
  const direct = await db.query<{
    canonical_id: string;
    canonical_name: string;
    canonical_slug: string;
    synthetic_fdc_id: number | null;
    total_count: string;
    fdc_count: string;
  }>(
    `SELECT
      ci.canonical_id,
      ci.canonical_name,
      ci.canonical_slug,
      ci.synthetic_fdc_id,
      ci.total_count,
      (SELECT COUNT(*) FROM canonical_fdc_membership cfm
       WHERE cfm.canonical_id = ci.canonical_id) AS fdc_count
    FROM canonical_ingredient ci
    WHERE ci.canonical_slug = $1`,
    [slug]
  );
  if (direct.rows.length > 0) return direct.rows[0];

  // 2. Alias match — check if any alias normalizes to this slug
  // Reconstruct the name from slug (hyphens → spaces) for ILIKE matching
  const nameFromSlug = slug.replace(/-/g, " ");
  const alias = await db.query<{
    canonical_id: string;
    canonical_name: string;
    canonical_slug: string;
    synthetic_fdc_id: number | null;
    total_count: string;
    fdc_count: string;
  }>(
    `SELECT
      ci.canonical_id,
      ci.canonical_name,
      ci.canonical_slug,
      ci.synthetic_fdc_id,
      ci.total_count,
      (SELECT COUNT(*) FROM canonical_fdc_membership cfm
       WHERE cfm.canonical_id = ci.canonical_id) AS fdc_count
    FROM canonical_ingredient_alias cia
    JOIN canonical_ingredient ci ON ci.canonical_id = cia.canonical_id
    WHERE cia.alias_norm ILIKE $1
    ORDER BY cia.alias_count DESC
    LIMIT 1`,
    [nameFromSlug]
  );
  if (alias.rows.length > 0) return alias.rows[0];

  // 3. Trigram fuzzy match on canonical_name
  const fuzzy = await db.query<{
    canonical_id: string;
    canonical_name: string;
    canonical_slug: string;
    synthetic_fdc_id: number | null;
    total_count: string;
    fdc_count: string;
    sim: number;
  }>(
    `SELECT
      ci.canonical_id,
      ci.canonical_name,
      ci.canonical_slug,
      ci.synthetic_fdc_id,
      ci.total_count,
      (SELECT COUNT(*) FROM canonical_fdc_membership cfm
       WHERE cfm.canonical_id = ci.canonical_id) AS fdc_count,
      similarity(ci.canonical_name, $1) AS sim
    FROM canonical_ingredient ci
    WHERE similarity(ci.canonical_name, $1) >= 0.3
    ORDER BY sim DESC, ci.canonical_rank ASC
    LIMIT 1`,
    [nameFromSlug]
  );
  if (fuzzy.rows.length > 0) return fuzzy.rows[0];

  return null;
}

export async function getIngredientBySlug(
  slug: string
): Promise<IngredientDetail | null> {
  const row = await resolveCanonicalId(slug);
  if (!row) return null;

  const nutrientResult = await db.query<{
    nutrient_id: number;
    name: string;
    unit_name: string;
    median: number;
    p10: number | null;
    p90: number | null;
    p25: number | null;
    p75: number | null;
    min_amount: number | null;
    max_amount: number | null;
    n_samples: number;
  }>(
    `SELECT
      n.nutrient_id,
      n.name,
      cin.unit_name,
      cin.median,
      cin.p10,
      cin.p90,
      cin.p25,
      cin.p75,
      cin.min_amount,
      cin.max_amount,
      cin.n_samples
    FROM canonical_ingredient_nutrients cin
    JOIN nutrients n ON n.nutrient_id = cin.nutrient_id
    WHERE cin.canonical_id = $1
    ORDER BY n.nutrient_rank ASC NULLS LAST, n.name ASC`,
    [row.canonical_id]
  );

  const nutrients: IngredientNutrient[] = validateItems(
    IngredientNutrientSchema,
    nutrientResult.rows.map((nr) => ({
      nutrientId: nr.nutrient_id,
      name: nr.name,
      unit: nr.unit_name,
      median: nr.median,
      p10: nr.p10,
      p90: nr.p90,
      p25: nr.p25,
      p75: nr.p75,
      min: nr.min_amount,
      max: nr.max_amount,
      nSamples: nr.n_samples,
    }))
  );

  return {
    canonicalId: row.canonical_id,
    ingredientName: row.canonical_name,
    ingredientSlug: row.canonical_slug,
    syntheticFdcId: row.synthetic_fdc_id,
    frequency: Number(row.total_count),
    fdcCount: Number(row.fdc_count),
    nutrients,
  };
}

// ============================================================================
// Ingredient List (paginated, searchable)
// ============================================================================

export interface IngredientSearchParams {
  q?: string;
  hasNutrients?: boolean;
  page?: number;
  pageSize?: number;
}

export async function searchIngredients(
  params: IngredientSearchParams
): Promise<PaginatedResponse<IngredientListItem>> {
  const { q, hasNutrients, page = 1, pageSize = 25 } = params;
  const offset = getOffset(page, pageSize);

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (q) {
    conditions.push(
      `ci.canonical_name ILIKE '%' || $${paramIndex} || '%'`
    );
    values.push(q);
    paramIndex++;
  }

  if (hasNutrients !== undefined) {
    if (hasNutrients) {
      conditions.push(
        `EXISTS (SELECT 1 FROM canonical_ingredient_nutrients cin WHERE cin.canonical_id = ci.canonical_id)`
      );
    } else {
      conditions.push(
        `NOT EXISTS (SELECT 1 FROM canonical_ingredient_nutrients cin WHERE cin.canonical_id = ci.canonical_id)`
      );
    }
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countSql = `
    SELECT COUNT(*) as total
    FROM canonical_ingredient ci
    ${whereClause}
  `;

  const dataSql = `
    SELECT
      ci.canonical_id,
      ci.canonical_name,
      ci.canonical_slug,
      ci.synthetic_fdc_id,
      ci.total_count,
      (SELECT COUNT(*) FROM canonical_fdc_membership cfm
       WHERE cfm.canonical_id = ci.canonical_id) AS fdc_count,
      EXISTS (
        SELECT 1 FROM canonical_ingredient_nutrients cin
        WHERE cin.canonical_id = ci.canonical_id
      ) AS has_nutrients
    FROM canonical_ingredient ci
    ${whereClause}
    ORDER BY ci.canonical_rank ASC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const dataValues = [...values, pageSize, offset];

  const [countResult, dataResult] = await Promise.all([
    db.query<{ total: string }>(countSql, values),
    db.query<{
      canonical_id: string;
      canonical_name: string;
      canonical_slug: string;
      synthetic_fdc_id: number | null;
      total_count: string;
      fdc_count: string;
      has_nutrients: boolean;
    }>(dataSql, dataValues),
  ]);

  const total = parseInt(countResult.rows[0]?.total ?? "0", 10);
  const rawItems = dataResult.rows.map((r) => ({
    canonicalId: r.canonical_id,
    ingredientName: r.canonical_name,
    ingredientSlug: r.canonical_slug,
    syntheticFdcId: r.synthetic_fdc_id,
    frequency: Number(r.total_count),
    fdcCount: Number(r.fdc_count),
    hasNutrients: r.has_nutrients,
  }));

  const items: IngredientListItem[] = validateItems(
    IngredientListItemSchema,
    rawItems
  );
  return paginate(items, total, page, pageSize);
}

// ============================================================================
// Batch Resolve (free-text ingredient names → canonical ingredients)
// ============================================================================

export interface ResolvedIngredient {
  input: string;
  match: {
    ingredientName: string;
    ingredientSlug: string;
    canonicalId: string;
    syntheticFdcId: number | null;
    frequency: number;
    fdcCount: number;
    nutrients: IngredientNutrient[];
  } | null;
}

/**
 * Resolve an array of free-text ingredient names to canonical ingredients.
 * Each input is slugified and resolved via the same chain as getIngredientBySlug
 * (direct slug → alias → trigram fuzzy).
 */
export async function resolveIngredients(
  inputs: string[]
): Promise<ResolvedIngredient[]> {
  const results: ResolvedIngredient[] = [];

  for (const input of inputs) {
    const slug = slugify(input.trim());
    if (!slug) {
      results.push({ input, match: null });
      continue;
    }

    const row = await resolveCanonicalId(slug);
    if (!row) {
      results.push({ input, match: null });
      continue;
    }

    // Fetch nutrients for matched ingredient
    const nutrientResult = await db.query<{
      nutrient_id: number;
      name: string;
      unit_name: string;
      median: number;
      p10: number | null;
      p90: number | null;
      p25: number | null;
      p75: number | null;
      min_amount: number | null;
      max_amount: number | null;
      n_samples: number;
    }>(
      `SELECT
        n.nutrient_id,
        n.name,
        cin.unit_name,
        cin.median,
        cin.p10,
        cin.p90,
        cin.p25,
        cin.p75,
        cin.min_amount,
        cin.max_amount,
        cin.n_samples
      FROM canonical_ingredient_nutrients cin
      JOIN nutrients n ON n.nutrient_id = cin.nutrient_id
      WHERE cin.canonical_id = $1
      ORDER BY n.nutrient_rank ASC NULLS LAST, n.name ASC`,
      [row.canonical_id]
    );

    const nutrients: IngredientNutrient[] = validateItems(
      IngredientNutrientSchema,
      nutrientResult.rows.map((nr) => ({
        nutrientId: nr.nutrient_id,
        name: nr.name,
        unit: nr.unit_name,
        median: nr.median,
        p10: nr.p10,
        p90: nr.p90,
        p25: nr.p25,
        p75: nr.p75,
        min: nr.min_amount,
        max: nr.max_amount,
        nSamples: nr.n_samples,
      }))
    );

    results.push({
      input,
      match: {
        ingredientName: row.canonical_name,
        ingredientSlug: row.canonical_slug,
        canonicalId: row.canonical_id,
        syntheticFdcId: row.synthetic_fdc_id,
        frequency: Number(row.total_count),
        fdcCount: Number(row.fdc_count),
        nutrients,
      },
    });
  }

  return results;
}
