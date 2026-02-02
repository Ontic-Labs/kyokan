import { db } from "@/lib/db";
import { getOffset, paginate, PaginatedResponse } from "@/lib/paging";
import { validateItems } from "@/lib/validate-response";
import { NutrientListItem, NutrientListItemSchema } from "@/types/fdc";

export interface NutrientSearchParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function searchNutrients(
  params: NutrientSearchParams
): Promise<PaginatedResponse<NutrientListItem>> {
  const { search, page = 1, pageSize = 25 } = params;
  const offset = getOffset(page, pageSize);

  let whereClause = "";
  const values: unknown[] = [];

  if (search) {
    whereClause = "WHERE name ILIKE $1";
    values.push(`%${search}%`);
  }

  const [countResult, dataResult] = await Promise.all([
    db.query<{ total: string }>(
      `SELECT COUNT(*) as total FROM nutrients ${whereClause}`,
      values
    ),
    db.query<{
      nutrient_id: number;
      name: string;
      unit_name: string;
      nutrient_rank: number | null;
      is_energy: boolean;
    }>(
      `SELECT
        nutrient_id,
        name,
        unit_name,
        nutrient_rank,
        is_energy
      FROM nutrients
      ${whereClause}
      ORDER BY nutrient_rank ASC NULLS LAST, name ASC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset]
    ),
  ]);

  const total = parseInt(countResult.rows[0]?.total ?? "0", 10);
  const items: NutrientListItem[] = validateItems(
    NutrientListItemSchema,
    dataResult.rows.map((row) => ({
      nutrientId: row.nutrient_id,
      name: row.name,
      unit: row.unit_name,
      rank: row.nutrient_rank,
      isEnergy: row.is_energy,
    }))
  );

  return paginate(items, total, page, pageSize);
}

export interface NutrientDetail {
  nutrientId: number;
  name: string;
  unit: string;
  rank: number | null;
  isEnergy: boolean;
}

export async function getNutrientById(
  nutrientId: number
): Promise<NutrientDetail | null> {
  const result = await db.query<{
    nutrient_id: number;
    name: string;
    unit_name: string;
    nutrient_rank: number | null;
    is_energy: boolean;
  }>(
    `SELECT nutrient_id, name, unit_name, nutrient_rank, is_energy
    FROM nutrients
    WHERE nutrient_id = $1`,
    [nutrientId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    nutrientId: row.nutrient_id,
    name: row.name,
    unit: row.unit_name,
    rank: row.nutrient_rank,
    isEnergy: row.is_energy,
  };
}

export interface TopFoodForNutrient {
  fdcId: number;
  description: string;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
}

export async function getTopFoodsForNutrient(
  nutrientId: number,
  page: number = 1,
  pageSize: number = 25
): Promise<PaginatedResponse<TopFoodForNutrient>> {
  const offset = getOffset(page, pageSize);

  const [countResult, dataResult] = await Promise.all([
    db.query<{ total: string }>(
      `SELECT COUNT(*) as total
      FROM food_nutrients
      WHERE nutrient_id = $1`,
      [nutrientId]
    ),
    db.query<{
      fdc_id: number;
      description: string;
      amount: number;
      category_id: number | null;
      category_name: string | null;
    }>(
      `SELECT
        f.fdc_id,
        f.description,
        fn.amount,
        f.category_id,
        c.name as category_name
      FROM food_nutrients fn
      JOIN foods f ON fn.fdc_id = f.fdc_id
      LEFT JOIN food_categories c ON f.category_id = c.category_id
      WHERE fn.nutrient_id = $1
      ORDER BY fn.amount DESC
      LIMIT $2 OFFSET $3`,
      [nutrientId, pageSize, offset]
    ),
  ]);

  const total = parseInt(countResult.rows[0]?.total ?? "0", 10);
  const items: TopFoodForNutrient[] = dataResult.rows.map((row) => ({
    fdcId: row.fdc_id,
    description: row.description,
    amount: row.amount,
    categoryId: row.category_id,
    categoryName: row.category_name,
  }));

  return paginate(items, total, page, pageSize);
}
