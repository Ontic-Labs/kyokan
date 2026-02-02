import { db } from "@/lib/db";
import { validateItems } from "@/lib/validate-response";
import {
  CategoryInfo,
  CategoryInfoSchema,
  CategoryWithCount,
  CategoryWithCountSchema,
} from "@/types/fdc";

export async function getCategories(
  includeCounts: boolean
): Promise<CategoryInfo[] | CategoryWithCount[]> {
  if (includeCounts) {
    const result = await db.query<{
      category_id: number;
      name: string;
      food_count: string;
    }>(
      `SELECT
        c.category_id,
        c.name,
        COUNT(f.fdc_id) as food_count
      FROM food_categories c
      LEFT JOIN foods f ON c.category_id = f.category_id
      GROUP BY c.category_id, c.name
      ORDER BY c.name ASC`
    );

    return validateItems(
      CategoryWithCountSchema,
      result.rows.map((row) => ({
        categoryId: row.category_id,
        name: row.name,
        foodCount: parseInt(row.food_count, 10),
      }))
    );
  }

  const result = await db.query<{
    category_id: number;
    name: string;
  }>(
    `SELECT category_id, name
    FROM food_categories
    ORDER BY name ASC`
  );

  return validateItems(
    CategoryInfoSchema,
    result.rows.map((row) => ({
      categoryId: row.category_id,
      name: row.name,
    }))
  );
}

export async function getCategoryById(
  categoryId: number
): Promise<CategoryInfo | null> {
  const result = await db.query<{
    category_id: number;
    name: string;
  }>(
    `SELECT category_id, name
    FROM food_categories
    WHERE category_id = $1`,
    [categoryId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return CategoryInfoSchema.parse({
    categoryId: row.category_id,
    name: row.name,
  });
}
