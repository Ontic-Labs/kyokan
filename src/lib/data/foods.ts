import { db } from "@/lib/db";
import { getOffset, paginate, PaginatedResponse } from "@/lib/paging";
import { validateItems } from "@/lib/validate-response";
import {
  FoodListItem,
  FoodListItemSchema,
  FoodDetail,
  NutrientInfo,
  NutrientInfoSchema,
  PortionInfo,
  PortionInfoSchema,
  CategoryInfo,
  CategoryInfoSchema,
} from "@/types/fdc";

export interface FoodSearchParams {
  q?: string;
  categoryId?: number;
  nutrientId?: number;
  min?: number;
  max?: number;
  cookable?: boolean;
  state?: string;
  preservation?: string;
  processing?: string;
  canonicalSlug?: string;
  page?: number;
  pageSize?: number;
}

export async function searchFoods(
  params: FoodSearchParams
): Promise<PaginatedResponse<FoodListItem>> {
  const {
    q,
    categoryId,
    nutrientId,
    min,
    max,
    cookable,
    state,
    preservation,
    processing,
    canonicalSlug,
    page = 1,
    pageSize = 25,
  } = params;
  const offset = getOffset(page, pageSize);

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  // Full-text search
  let orderBy = "f.description ASC";
  let selectRank = "";
  if (q) {
    conditions.push(
      `f.description_tsv @@ plainto_tsquery('simple', $${paramIndex})`
    );
    selectRank = `, ts_rank(f.description_tsv, plainto_tsquery('simple', $${paramIndex})) AS rank`;
    orderBy = "rank DESC, f.description ASC";
    values.push(q);
    paramIndex++;
  }

  // Category filter
  if (categoryId) {
    conditions.push(`f.category_id = $${paramIndex}`);
    values.push(categoryId);
    paramIndex++;
  }

  // Nutrient filter
  let nutrientJoin = "";
  if (nutrientId) {
    nutrientJoin = `INNER JOIN food_nutrients fn ON f.fdc_id = fn.fdc_id AND fn.nutrient_id = $${paramIndex}`;
    values.push(nutrientId);
    paramIndex++;

    if (min !== undefined) {
      conditions.push(`fn.amount >= $${paramIndex}`);
      values.push(min);
      paramIndex++;
    }
    if (max !== undefined) {
      conditions.push(`fn.amount <= $${paramIndex}`);
      values.push(max);
      paramIndex++;
    }
  }

  // Cookability filter
  let cookabilityJoin = "";
  if (cookable !== undefined) {
    cookabilityJoin = `INNER JOIN fdc_cookability_assessment ca ON f.fdc_id = ca.fdc_id`;
    conditions.push(`ca.is_cookable = $${paramIndex}`);
    values.push(cookable);
    paramIndex++;
  }

  // Canonical slug filter
  let canonicalJoinRequired = false;
  if (canonicalSlug) {
    canonicalJoinRequired = true;
    conditions.push(`cn_base.canonical_slug = $${paramIndex}`);
    values.push(canonicalSlug);
    paramIndex++;
  }

  // Food state filters
  let stateJoin = "";
  if (
    state !== undefined ||
    preservation !== undefined ||
    processing !== undefined
  ) {
    stateJoin = `INNER JOIN food_state fs ON f.fdc_id = fs.fdc_id`;
    if (state !== undefined) {
      conditions.push(`fs.cooking_state = $${paramIndex}`);
      values.push(state);
      paramIndex++;
    }
    if (preservation !== undefined) {
      conditions.push(`fs.preservation = $${paramIndex}`);
      values.push(preservation);
      paramIndex++;
    }
    if (processing !== undefined) {
      conditions.push(`fs.processing = $${paramIndex}`);
      values.push(processing);
      paramIndex++;
    }
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const stateSelect = stateJoin
    ? `, fs.cooking_state, fs.cooking_methods, fs.preservation, fs.processing`
    : "";

  const canonicalJoin = `
    LEFT JOIN food_canonical_names cn_base ON f.fdc_id = cn_base.fdc_id AND cn_base.level = 'base'
    LEFT JOIN food_canonical_names cn_spec ON f.fdc_id = cn_spec.fdc_id AND cn_spec.level = 'specific'`;

  const countSql = `
    SELECT COUNT(DISTINCT f.fdc_id) as total
    FROM foods f
    ${canonicalJoinRequired ? canonicalJoin : ""}
    ${nutrientJoin}
    ${cookabilityJoin}
    ${stateJoin}
    ${whereClause}
  `;

  const dataSql = `
    SELECT DISTINCT
      f.fdc_id,
      f.description,
      f.category_id,
      f.data_type,
      c.name as category_name,
      cn_base.canonical_name as canonical_base_name,
      cn_base.canonical_slug as canonical_base_slug,
      cn_spec.canonical_name as canonical_specific_name,
      cn_spec.canonical_slug as canonical_specific_slug
      ${stateSelect}
      ${selectRank}
    FROM foods f
    LEFT JOIN food_categories c ON f.category_id = c.category_id
    ${canonicalJoin}
    ${nutrientJoin}
    ${cookabilityJoin}
    ${stateJoin}
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const dataValues = [...values, pageSize, offset];

  const [countResult, dataResult] = await Promise.all([
    db.query<{ total: string }>(countSql, values),
    db.query<{
      fdc_id: number;
      description: string;
      category_id: number | null;
      data_type: string;
      category_name: string | null;
      canonical_base_name: string | null;
      canonical_base_slug: string | null;
      canonical_specific_name: string | null;
      canonical_specific_slug: string | null;
      cooking_state?: string;
      cooking_methods?: string[];
      preservation?: string;
      processing?: string;
    }>(dataSql, dataValues),
  ]);

  const total = parseInt(countResult.rows[0]?.total ?? "0", 10);
  const rawItems = dataResult.rows.map((row) => ({
    fdcId: row.fdc_id,
    description: row.description,
    categoryId: row.category_id,
    categoryName: row.category_name ?? undefined,
    dataType: row.data_type,
    ...(row.canonical_base_name && {
      canonicalBaseName: row.canonical_base_name,
      canonicalBaseSlug: row.canonical_base_slug,
    }),
    ...(row.canonical_specific_name && {
      canonicalSpecificName: row.canonical_specific_name,
      canonicalSpecificSlug: row.canonical_specific_slug,
    }),
    ...(row.cooking_state !== undefined && {
      cookingState: row.cooking_state,
      cookingMethods: row.cooking_methods,
      preservation: row.preservation,
      processing: row.processing,
    }),
  }));

  const items: FoodListItem[] = validateItems(FoodListItemSchema, rawItems);
  return paginate(items, total, page, pageSize);
}

export async function getFoodDetail(
  fdcId: number
): Promise<FoodDetail | null> {
  const foodResult = await db.query<{
    fdc_id: number;
    description: string;
    data_type: string;
    published_date: Date | null;
    category_id: number | null;
    category_name: string | null;
    canonical_base_name: string | null;
    canonical_base_slug: string | null;
    canonical_specific_name: string | null;
    canonical_specific_slug: string | null;
  }>(
    `SELECT
      f.fdc_id,
      f.description,
      f.data_type,
      f.published_date,
      f.category_id,
      c.name as category_name,
      cn_base.canonical_name as canonical_base_name,
      cn_base.canonical_slug as canonical_base_slug,
      cn_spec.canonical_name as canonical_specific_name,
      cn_spec.canonical_slug as canonical_specific_slug
    FROM foods f
    LEFT JOIN food_categories c ON f.category_id = c.category_id
    LEFT JOIN food_canonical_names cn_base ON f.fdc_id = cn_base.fdc_id AND cn_base.level = 'base'
    LEFT JOIN food_canonical_names cn_spec ON f.fdc_id = cn_spec.fdc_id AND cn_spec.level = 'specific'
    WHERE f.fdc_id = $1`,
    [fdcId]
  );

  if (foodResult.rows.length === 0) return null;

  const food = foodResult.rows[0];

  const [nutrientsResult, portionsResult] = await Promise.all([
    db.query<{
      nutrient_id: number;
      name: string;
      unit_name: string;
      amount: number;
    }>(
      `SELECT
        n.nutrient_id,
        n.name,
        n.unit_name,
        fn.amount
      FROM food_nutrients fn
      INNER JOIN nutrients n ON fn.nutrient_id = n.nutrient_id
      WHERE fn.fdc_id = $1
      ORDER BY n.nutrient_rank ASC NULLS LAST, n.name ASC`,
      [fdcId]
    ),
    db.query<{
      gram_weight: number;
      amount: number | null;
      unit_name: string | null;
      modifier: string | null;
    }>(
      `SELECT
        fp.gram_weight,
        fp.amount,
        mu.name as unit_name,
        fp.modifier
      FROM food_portions fp
      LEFT JOIN measure_units mu ON fp.measure_unit_id = mu.measure_unit_id
      WHERE fp.fdc_id = $1
      ORDER BY fp.sequence_number ASC NULLS LAST`,
      [fdcId]
    ),
  ]);

  const categoryRaw =
    food.category_id && food.category_name
      ? { categoryId: food.category_id, name: food.category_name }
      : null;
  const category: CategoryInfo | null = categoryRaw
    ? CategoryInfoSchema.parse(categoryRaw)
    : null;

  const nutrients: NutrientInfo[] = validateItems(
    NutrientInfoSchema,
    nutrientsResult.rows.map((row) => ({
      nutrientId: row.nutrient_id,
      name: row.name,
      unit: row.unit_name,
      amount: row.amount,
    }))
  );

  const portions: PortionInfo[] = validateItems(
    PortionInfoSchema,
    portionsResult.rows.map((row) => ({
      gramWeight: row.gram_weight,
      amount: row.amount,
      unit: row.unit_name,
      modifier: row.modifier,
    }))
  );

  return {
    fdcId: food.fdc_id,
    description: food.description,
    dataType: food.data_type,
    publishedDate: food.published_date?.toISOString().split("T")[0] ?? null,
    category,
    nutrients,
    portions,
    ...(food.canonical_base_name && {
      canonicalBaseName: food.canonical_base_name,
      canonicalBaseSlug: food.canonical_base_slug ?? undefined,
    }),
    ...(food.canonical_specific_name && {
      canonicalSpecificName: food.canonical_specific_name,
      canonicalSpecificSlug: food.canonical_specific_slug ?? undefined,
    }),
  };
}
