import { db } from "@/lib/db";

export interface Recipe {
  recipe_id: number;
  name: string;
  minutes: number | null;
  n_steps: number | null;
  n_ingredients: number | null;
  avg_rating: number;
  review_count: number;
  description: string | null;
  tags: string[];
  ingredients: string[];
  steps: string[];
}

export interface RecipeListItem {
  recipe_id: number;
  name: string;
  minutes: number | null;
  n_ingredients: number | null;
  avg_rating: number;
  review_count: number;
  match_rate: number;
}

export interface RecipeIngredientAnalysis {
  ingredient_raw: string;
  canonical_slug: string | null;
  fdc_id: number | null;
  match_score: number;
  match_status: "mapped" | "needs_review" | "no_match";
  cooking_methods: string[] | null;
}

interface SearchRecipesParams {
  q?: string;
  minRating?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const VALID_SORT_COLUMNS = new Set([
  "name",
  "minutes",
  "n_ingredients",
  "avg_rating",
  "review_count",
  "match_rate",
]);

export async function searchRecipes(params: SearchRecipesParams) {
  const {
    q,
    minRating,
    sortBy = "review_count",
    sortDir = "desc",
    page = 1,
    pageSize = 25,
  } = params;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (q && q.trim()) {
    conditions.push(`r.name ILIKE $${paramIdx++}`);
    values.push(`%${q.trim()}%`);
  }

  if (minRating !== undefined) {
    conditions.push(`r.avg_rating >= $${paramIdx++}`);
    values.push(minRating);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Validate sort column
  const safeSort = VALID_SORT_COLUMNS.has(sortBy) ? sortBy : "review_count";
  const safeDir = sortDir === "asc" ? "ASC" : "DESC";

  // Count total
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count 
     FROM canary_top_rated_recipes r 
     ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Get items with match rate
  const offset = (page - 1) * pageSize;
  const itemsResult = await db.query<RecipeListItem>(
    `SELECT 
       r.recipe_id,
       r.name,
       r.minutes,
       r.n_ingredients,
       r.avg_rating,
       r.review_count,
       COALESCE(
         (SELECT COUNT(*) FILTER (WHERE match_status = 'mapped')::float / NULLIF(COUNT(*), 0)
          FROM recipe_ingredient_analysis a 
          WHERE a.recipe_id = r.recipe_id), 0
       ) as match_rate
     FROM canary_top_rated_recipes r
     ${whereClause}
     ORDER BY ${safeSort} ${safeDir}, r.recipe_id
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...values, pageSize, offset]
  );

  return {
    items: itemsResult.rows,
    total,
    page,
    pageSize,
  };
}

export async function getRecipeById(recipeId: number): Promise<Recipe | null> {
  const result = await db.query<Recipe>(
    `SELECT 
       recipe_id,
       name,
       minutes,
       n_steps,
       n_ingredients,
       avg_rating,
       review_count,
       description,
       tags,
       ingredients,
       steps
     FROM canary_top_rated_recipes
     WHERE recipe_id = $1`,
    [recipeId]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0];
}

export async function getRecipeIngredients(
  recipeId: number
): Promise<RecipeIngredientAnalysis[]> {
  const result = await db.query<RecipeIngredientAnalysis>(
    `SELECT 
       ria.ingredient_raw,
       ria.canonical_slug,
       COALESCE(ria.fdc_id, ca.representative_fdc_id, cas.fdc_id) AS fdc_id,
       ria.match_score,
       ria.match_status,
       ria.cooking_methods
     FROM recipe_ingredient_analysis ria
     LEFT JOIN canonical_aggregates ca ON ca.canonical_slug = ria.canonical_slug AND ca.level = 'base'
     LEFT JOIN LATERAL (
       SELECT fdc_id FROM canonical_aggregate_sources 
       WHERE canonical_id = ca.canonical_id 
       LIMIT 1
     ) cas ON true
     WHERE ria.recipe_id = $1
     ORDER BY ria.match_status, ria.ingredient_raw`,
    [recipeId]
  );
  return result.rows;
}
