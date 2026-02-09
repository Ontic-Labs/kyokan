import { db } from "@/lib/db";
import { getOffset, paginate, PaginatedResponse } from "@/lib/paging";
import { validateItems } from "@/lib/validate-response";
import {
  IngredientDetail,
  IngredientNutrient,
  IngredientNutrientSchema,
  IngredientAlias,
  IngredientAliasSchema,
  IngredientMemberFood,
  IngredientMemberFoodSchema,
  IngredientListItem,
  IngredientListItemSchema,
  MatchMethod,
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

// Minimum trigram similarity for fuzzy matching (pg_trgm)
const FUZZY_THRESHOLD = 0.4;

interface ResolvedCanonical {
  canonical_id: string;
  canonical_name: string;
  canonical_slug: string;
  canonical_rank: string;
  synthetic_fdc_id: number | null;
  total_count: string;
  fdc_count: string;
  method: MatchMethod;
  confidence: number;
}

/**
 * Resolve a canonical ingredient by slug.
 * Resolution order:
 *   1. Direct slug match on canonical_ingredient.canonical_slug
 *   2. Alias match: alias_norm ILIKE the reconstructed name
 *   3. Trigram fuzzy match on canonical_name (similarity >= FUZZY_THRESHOLD)
 */
async function resolveCanonicalId(slug: string): Promise<ResolvedCanonical | null> {
  // 1. Direct slug match
  const direct = await db.query<{
    canonical_id: string;
    canonical_name: string;
    canonical_slug: string;
    canonical_rank: string;
    synthetic_fdc_id: number | null;
    total_count: string;
    fdc_count: string;
  }>(
    `SELECT
      ci.canonical_id,
      ci.canonical_name,
      ci.canonical_slug,
      ci.canonical_rank::text,
      ci.synthetic_fdc_id,
      ci.total_count,
      COUNT(cfm.fdc_id)::text AS fdc_count
    FROM canonical_ingredient ci
    LEFT JOIN canonical_fdc_membership cfm ON cfm.canonical_id = ci.canonical_id
    WHERE ci.canonical_slug = $1
    GROUP BY ci.canonical_id`,
    [slug]
  );
  if (direct.rows.length > 0) {
    return { ...direct.rows[0], method: "direct", confidence: 1.0 };
  }

  // 2. Alias match — check if any alias normalizes to this slug
  const nameFromSlug = slug.replace(/-/g, " ");
  const alias = await db.query<{
    canonical_id: string;
    canonical_name: string;
    canonical_slug: string;
    canonical_rank: string;
    synthetic_fdc_id: number | null;
    total_count: string;
    fdc_count: string;
  }>(
    `SELECT
      ci.canonical_id,
      ci.canonical_name,
      ci.canonical_slug,
      ci.canonical_rank::text,
      ci.synthetic_fdc_id,
      ci.total_count,
      COUNT(cfm.fdc_id)::text AS fdc_count
    FROM canonical_ingredient_alias cia
    JOIN canonical_ingredient ci ON ci.canonical_id = cia.canonical_id
    LEFT JOIN canonical_fdc_membership cfm ON cfm.canonical_id = ci.canonical_id
    WHERE cia.alias_norm ILIKE $1
    GROUP BY ci.canonical_id, cia.alias_count
    ORDER BY cia.alias_count DESC
    LIMIT 1`,
    [nameFromSlug]
  );
  if (alias.rows.length > 0) {
    return { ...alias.rows[0], method: "alias", confidence: 1.0 };
  }

  // 3. Trigram fuzzy match on canonical_name
  const fuzzy = await db.query<{
    canonical_id: string;
    canonical_name: string;
    canonical_slug: string;
    canonical_rank: string;
    synthetic_fdc_id: number | null;
    total_count: string;
    fdc_count: string;
    sim: number;
  }>(
    `SELECT
      ci.canonical_id,
      ci.canonical_name,
      ci.canonical_slug,
      ci.canonical_rank::text,
      ci.synthetic_fdc_id,
      ci.total_count,
      COUNT(cfm.fdc_id)::text AS fdc_count,
      similarity(ci.canonical_name, $1) AS sim
    FROM canonical_ingredient ci
    LEFT JOIN canonical_fdc_membership cfm ON cfm.canonical_id = ci.canonical_id
    WHERE similarity(ci.canonical_name, $1) >= $2
    GROUP BY ci.canonical_id
    ORDER BY sim DESC, ci.canonical_rank ASC
    LIMIT 1`,
    [nameFromSlug, FUZZY_THRESHOLD]
  );
  if (fuzzy.rows.length > 0) {
    return { ...fuzzy.rows[0], method: "fuzzy", confidence: fuzzy.rows[0].sim };
  }

  return null;
}

export async function getIngredientBySlug(
  slug: string
): Promise<IngredientDetail | null> {
  const row = await resolveCanonicalId(slug);
  if (!row) return null;

  const [nutrientResult, aliasResult, memberResult] = await Promise.all([
    // Nutrients
    db.query<{
      nutrient_id: number;
      name: string;
      unit_name: string;
      median: number;
      p10: number | null;
      p90: number | null;
      p25: number | null;
      p75: number | null;
      min_amount: number;
      max_amount: number;
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
    ),
    // Aliases
    db.query<{
      alias_norm: string;
      alias_count: string;
      alias_source: string;
    }>(
      `SELECT alias_norm, alias_count::text, alias_source
       FROM canonical_ingredient_alias
       WHERE canonical_id = $1
       ORDER BY alias_count DESC`,
      [row.canonical_id]
    ),
    // Member foods
    db.query<{
      fdc_id: number;
      description: string;
      data_type: string | null;
      membership_reason: string;
    }>(
      `SELECT
        f.fdc_id,
        f.description,
        f.data_type,
        cfm.membership_reason
       FROM canonical_fdc_membership cfm
       JOIN foods f ON f.fdc_id = cfm.fdc_id
       WHERE cfm.canonical_id = $1
       ORDER BY f.description ASC`,
      [row.canonical_id]
    ),
  ]);

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

  const aliases: IngredientAlias[] = validateItems(
    IngredientAliasSchema,
    aliasResult.rows.map((r) => ({
      aliasNorm: r.alias_norm,
      aliasCount: Number(r.alias_count),
      aliasSource: r.alias_source,
    }))
  );

  const memberFoods: IngredientMemberFood[] = validateItems(
    IngredientMemberFoodSchema,
    memberResult.rows.map((r) => ({
      fdcId: r.fdc_id,
      description: r.description,
      dataType: r.data_type,
      membershipReason: r.membership_reason,
    }))
  );

  return {
    canonicalId: row.canonical_id,
    ingredientName: row.canonical_name,
    ingredientSlug: row.canonical_slug,
    syntheticFdcId: row.synthetic_fdc_id,
    frequency: Number(row.total_count),
    fdcCount: Number(row.fdc_count),
    canonicalRank: Number(row.canonical_rank),
    nutrients,
    aliases,
    memberFoods,
  };
}

// ============================================================================
// Ingredient List (paginated, searchable)
// ============================================================================

export interface IngredientSearchParams {
  q?: string;
  hasNutrients?: boolean;
  sortBy?: "name" | "frequency" | "foods" | "nutrients";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export async function searchIngredients(
  params: IngredientSearchParams
): Promise<PaginatedResponse<IngredientListItem>> {
  const {
    q,
    hasNutrients,
    sortBy,
    sortDir = "asc",
    page = 1,
    pageSize = 25,
  } = params;
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

  const orderBy = (() => {
    const dir = sortDir === "desc" ? "DESC" : "ASC";
    // Unranked ingredients (canonical_rank = 0) sort to the end
    const rankOrder = "CASE WHEN ci.canonical_rank = 0 THEN 1 ELSE 0 END, ci.canonical_rank ASC";
    switch (sortBy) {
      case "name":
        return `ci.canonical_name ${dir}, ${rankOrder}`;
      case "frequency":
        return `ci.total_count ${dir}, ${rankOrder}`;
      case "foods":
        return `COALESCE(cfm.fdc_count, 0) ${dir}, ${rankOrder}`;
      case "nutrients":
        return `CASE WHEN cin.canonical_id IS NULL THEN 0 ELSE 1 END ${dir}, ${rankOrder}`;
      default:
        return rankOrder;
    }
  })();

  const dataSql = `
    SELECT
      ci.canonical_id,
      ci.canonical_name,
      ci.canonical_slug,
      ci.synthetic_fdc_id,
      ci.total_count,
      COALESCE(cfm.fdc_count, 0) AS fdc_count,
      cin.canonical_id IS NOT NULL AS has_nutrients
    FROM canonical_ingredient ci
    LEFT JOIN (
      SELECT canonical_id, COUNT(*) AS fdc_count
      FROM canonical_fdc_membership
      GROUP BY canonical_id
    ) cfm ON cfm.canonical_id = ci.canonical_id
    LEFT JOIN (
      SELECT DISTINCT canonical_id
      FROM canonical_ingredient_nutrients
    ) cin ON cin.canonical_id = ci.canonical_id
    ${whereClause}
    ORDER BY ${orderBy}
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
// Full Export (all ingredients with nutrients, for JSON download)
// ============================================================================

export interface ExportedIngredient {
  canonicalId: string;
  ingredientName: string;
  ingredientSlug: string;
  syntheticFdcId: number | null;
  frequency: number;
  fdcCount: number;
  canonicalRank: number;
  nutrients: IngredientNutrient[];
}

export async function exportAllIngredients(): Promise<ExportedIngredient[]> {
  // All ingredients ordered by rank
  const ingredientResult = await db.query<{
    canonical_id: string;
    canonical_name: string;
    canonical_slug: string;
    canonical_rank: string;
    synthetic_fdc_id: number | null;
    total_count: string;
    fdc_count: string;
  }>(
    `SELECT
      ci.canonical_id,
      ci.canonical_name,
      ci.canonical_slug,
      ci.canonical_rank::text,
      ci.synthetic_fdc_id,
      ci.total_count,
      COALESCE(cfm.fdc_count, 0)::text AS fdc_count
    FROM canonical_ingredient ci
    LEFT JOIN (
      SELECT canonical_id, COUNT(*) AS fdc_count
      FROM canonical_fdc_membership
      GROUP BY canonical_id
    ) cfm ON cfm.canonical_id = ci.canonical_id
    ORDER BY ci.canonical_rank ASC`
  );

  // All nutrients in one query, grouped in JS
  const nutrientResult = await db.query<{
    canonical_id: string;
    nutrient_id: number;
    name: string;
    unit_name: string;
    median: number;
    p10: number | null;
    p90: number | null;
    p25: number | null;
    p75: number | null;
    min_amount: number;
    max_amount: number;
    n_samples: number;
  }>(
    `SELECT
      cin.canonical_id,
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
    ORDER BY cin.canonical_id, n.nutrient_rank ASC NULLS LAST, n.name ASC`
  );

  // Group nutrients by canonical_id
  const nutrientMap = new Map<string, IngredientNutrient[]>();
  for (const nr of nutrientResult.rows) {
    let list = nutrientMap.get(nr.canonical_id);
    if (!list) {
      list = [];
      nutrientMap.set(nr.canonical_id, list);
    }
    list.push({
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
    });
  }

  return ingredientResult.rows.map((r) => ({
    canonicalId: r.canonical_id,
    ingredientName: r.canonical_name,
    ingredientSlug: r.canonical_slug,
    syntheticFdcId: r.synthetic_fdc_id,
    frequency: Number(r.total_count),
    fdcCount: Number(r.fdc_count),
    canonicalRank: Number(r.canonical_rank),
    nutrients: nutrientMap.get(r.canonical_id) ?? [],
  }));
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
    method: MatchMethod;
    confidence: number;
    nutrients: IngredientNutrient[];
  } | null;
}

// Row shape returned by batch canonical queries
interface CanonicalRow {
  canonical_id: string;
  canonical_name: string;
  canonical_slug: string;
  canonical_rank: string;
  synthetic_fdc_id: number | null;
  total_count: string;
  fdc_count: string;
}

// Row shape for alias batch query (adds alias_norm for mapping back)
interface AliasRow extends CanonicalRow {
  alias_norm: string;
}

// Nutrient row shape for batch nutrient query
interface NutrientRow {
  canonical_id: string;
  nutrient_id: number;
  name: string;
  unit_name: string;
  median: number;
  p10: number | null;
  p90: number | null;
  p25: number | null;
  p75: number | null;
  min_amount: number;
  max_amount: number;
  n_samples: number;
}

/**
 * Batch-fetch nutrients for multiple canonical IDs in a single query.
 * Returns a map of canonical_id → IngredientNutrient[].
 */
async function batchFetchNutrients(
  canonicalIds: string[]
): Promise<Map<string, IngredientNutrient[]>> {
  const result = new Map<string, IngredientNutrient[]>();
  if (canonicalIds.length === 0) return result;

  const rows = await db.query<NutrientRow>(
    `SELECT
      cin.canonical_id,
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
    WHERE cin.canonical_id = ANY($1::uuid[])
    ORDER BY cin.canonical_id, n.nutrient_rank ASC NULLS LAST, n.name ASC`,
    [canonicalIds]
  );

  // Group by canonical_id
  for (const nr of rows.rows) {
    let list = result.get(nr.canonical_id);
    if (!list) {
      list = [];
      result.set(nr.canonical_id, list);
    }
    list.push({
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
    });
  }

  // Validate through Zod
  for (const [id, nutrients] of result) {
    result.set(id, validateItems(IngredientNutrientSchema, nutrients));
  }

  return result;
}

/**
 * Resolve an array of free-text ingredient names to canonical ingredients.
 *
 * Uses batched queries to minimize DB round-trips:
 *   Phase 1: Batch direct slug lookup (1 query)
 *   Phase 2: Batch alias lookup for unresolved (1 query)
 *   Phase 3: Individual fuzzy for remaining (N queries)
 *   Phase 4: Batch nutrient fetch for all resolved (1 query)
 *
 * Each ingredient is isolated — one failure doesn't break the batch.
 */
export async function resolveIngredients(
  inputs: string[]
): Promise<ResolvedIngredient[]> {
  // Prepare: slugify all inputs, track index mapping
  const entries = inputs.map((input, idx) => ({
    idx,
    input,
    slug: slugify(input.trim()),
    nameFromSlug: slugify(input.trim()).replace(/-/g, " "),
    resolved: null as (ResolvedCanonical | null),
  }));

  // Skip empty slugs
  const pending = entries.filter((e) => e.slug.length > 0);

  // ── Phase 1: Batch direct slug lookup ──
  const slugs = [...new Set(pending.map((e) => e.slug))];
  if (slugs.length > 0) {
    try {
      const directResult = await db.query<CanonicalRow>(
        `SELECT
          ci.canonical_id,
          ci.canonical_name,
          ci.canonical_slug,
          ci.canonical_rank::text,
          ci.synthetic_fdc_id,
          ci.total_count,
          COUNT(cfm.fdc_id)::text AS fdc_count
        FROM canonical_ingredient ci
        LEFT JOIN canonical_fdc_membership cfm ON cfm.canonical_id = ci.canonical_id
        WHERE ci.canonical_slug = ANY($1::text[])
        GROUP BY ci.canonical_id`,
        [slugs]
      );

      const bySlug = new Map<string, CanonicalRow>();
      for (const row of directResult.rows) {
        bySlug.set(row.canonical_slug, row);
      }

      for (const entry of pending) {
        const match = bySlug.get(entry.slug);
        if (match) {
          entry.resolved = { ...match, method: "direct", confidence: 1.0 };
        }
      }
    } catch {
      // Phase 1 failed — fall through, try individually later
    }
  }

  // ── Phase 2: Batch alias lookup for unresolved ──
  const unresolvedAfterDirect = pending.filter((e) => !e.resolved);
  if (unresolvedAfterDirect.length > 0) {
    const names = [...new Set(unresolvedAfterDirect.map((e) => e.nameFromSlug))];
    try {
      const aliasResult = await db.query<AliasRow>(
        `SELECT DISTINCT ON (cia.alias_norm)
          cia.alias_norm,
          ci.canonical_id,
          ci.canonical_name,
          ci.canonical_slug,
          ci.canonical_rank::text,
          ci.synthetic_fdc_id,
          ci.total_count,
          COUNT(cfm.fdc_id)::text AS fdc_count
        FROM canonical_ingredient_alias cia
        JOIN canonical_ingredient ci ON ci.canonical_id = cia.canonical_id
        LEFT JOIN canonical_fdc_membership cfm ON cfm.canonical_id = ci.canonical_id
        WHERE cia.alias_norm ILIKE ANY($1::text[])
        GROUP BY ci.canonical_id, cia.alias_norm, cia.alias_count
        ORDER BY cia.alias_norm, cia.alias_count DESC`,
        [names]
      );

      const byAlias = new Map<string, AliasRow>();
      for (const row of aliasResult.rows) {
        byAlias.set(row.alias_norm.toLowerCase(), row);
      }

      for (const entry of unresolvedAfterDirect) {
        const match = byAlias.get(entry.nameFromSlug.toLowerCase());
        if (match) {
          entry.resolved = {
            canonical_id: match.canonical_id,
            canonical_name: match.canonical_name,
            canonical_slug: match.canonical_slug,
            canonical_rank: match.canonical_rank,
            synthetic_fdc_id: match.synthetic_fdc_id,
            total_count: match.total_count,
            fdc_count: match.fdc_count,
            method: "alias",
            confidence: 1.0,
          };
        }
      }
    } catch {
      // Phase 2 failed — fall through to fuzzy
    }
  }

  // ── Phase 3: Individual fuzzy for still-unresolved ──
  const unresolvedAfterAlias = pending.filter((e) => !e.resolved);
  for (const entry of unresolvedAfterAlias) {
    try {
      const fuzzy = await db.query<CanonicalRow & { sim: number }>(
        `SELECT
          ci.canonical_id,
          ci.canonical_name,
          ci.canonical_slug,
          ci.canonical_rank::text,
          ci.synthetic_fdc_id,
          ci.total_count,
          COUNT(cfm.fdc_id)::text AS fdc_count,
          similarity(ci.canonical_name, $1) AS sim
        FROM canonical_ingredient ci
        LEFT JOIN canonical_fdc_membership cfm ON cfm.canonical_id = ci.canonical_id
        WHERE similarity(ci.canonical_name, $1) >= $2
        GROUP BY ci.canonical_id
        ORDER BY sim DESC, ci.canonical_rank ASC
        LIMIT 1`,
        [entry.nameFromSlug, FUZZY_THRESHOLD]
      );

      if (fuzzy.rows.length > 0) {
        entry.resolved = {
          ...fuzzy.rows[0],
          method: "fuzzy",
          confidence: fuzzy.rows[0].sim,
        };
      }
    } catch {
      // Individual fuzzy failed — this ingredient stays unresolved
    }
  }

  // ── Phase 4: Batch nutrient fetch for all resolved ──
  const resolvedEntries = entries.filter((e) => e.resolved);
  const canonicalIds = [
    ...new Set(resolvedEntries.map((e) => e.resolved!.canonical_id)),
  ];

  let nutrientMap = new Map<string, IngredientNutrient[]>();
  if (canonicalIds.length > 0) {
    try {
      nutrientMap = await batchFetchNutrients(canonicalIds);
    } catch {
      // Nutrient fetch failed — return matches without nutrients
    }
  }

  // ── Build response ──
  return entries.map((entry) => {
    const row = entry.resolved;
    if (!row) {
      return { input: entry.input, match: null };
    }

    const nutrients = nutrientMap.get(row.canonical_id) ?? [];

    return {
      input: entry.input,
      match: {
        ingredientName: row.canonical_name,
        ingredientSlug: row.canonical_slug,
        canonicalId: row.canonical_id,
        syntheticFdcId: row.synthetic_fdc_id,
        frequency: Number(row.total_count),
        fdcCount: Number(row.fdc_count),
        method: row.method,
        confidence: row.confidence,
        nutrients,
      },
    };
  });
}
