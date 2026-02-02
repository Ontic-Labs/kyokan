import { NextRequest } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/errors";
import { PagingSchema, createPaginatedResponseSchema } from "@/lib/paging";
import { validatedResponse } from "@/lib/validate-response";
import { IngredientListItemSchema } from "@/types/fdc";
import { searchIngredients } from "@/lib/data/ingredients";

const IngredientsResponseSchema = createPaginatedResponseSchema(
  IngredientListItemSchema
);

const IngredientsQuerySchema = z
  .object({
    q: z.string().optional(),
    hasNutrients: z
      .enum(["true", "false", "1", "0"])
      .optional()
      .transform((v) =>
        v === "true" || v === "1"
          ? true
          : v === "false" || v === "0"
            ? false
            : undefined
      ),
  })
  .merge(PagingSchema);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const params = IngredientsQuerySchema.parse({
      q: searchParams.get("q") ?? undefined,
      hasNutrients: searchParams.get("hasNutrients") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    const result = await searchIngredients(params);
    return validatedResponse(IngredientsResponseSchema, result);
  } catch (error) {
    return handleError(error);
  }
}
