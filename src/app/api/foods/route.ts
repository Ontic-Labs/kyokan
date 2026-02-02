import { NextRequest } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/errors";
import { PagingSchema, createPaginatedResponseSchema } from "@/lib/paging";
import { validatedResponse } from "@/lib/validate-response";
import { FoodListItemSchema } from "@/types/fdc";
import { searchFoods } from "@/lib/data/foods";

const FoodsResponseSchema = createPaginatedResponseSchema(FoodListItemSchema);

const FoodsQuerySchema = z
  .object({
    q: z.string().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    nutrientId: z.coerce.number().int().positive().optional(),
    min: z.coerce.number().optional(),
    max: z.coerce.number().optional(),
    cookable: z
      .enum(["true", "false", "1", "0"])
      .optional()
      .transform((v) =>
        v === "true" || v === "1"
          ? true
          : v === "false" || v === "0"
            ? false
            : undefined
      ),
    state: z.enum(["unknown", "raw", "cooked"]).optional(),
    preservation: z
      .enum([
        "unknown", "fresh", "frozen", "canned", "dried", "cured",
        "pickled", "fermented", "smoked",
      ])
      .optional(),
    processing: z
      .enum([
        "unknown", "whole", "ground", "sliced", "diced", "shredded",
        "pureed", "paste", "powder", "flour", "juice", "oil",
        "broth", "stock",
      ])
      .optional(),
  })
  .merge(PagingSchema);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const params = FoodsQuerySchema.parse({
      q: searchParams.get("q") ?? undefined,
      categoryId: searchParams.get("categoryId") ?? undefined,
      nutrientId: searchParams.get("nutrientId") ?? undefined,
      min: searchParams.get("min") ?? undefined,
      max: searchParams.get("max") ?? undefined,
      cookable: searchParams.get("cookable") ?? undefined,
      state: searchParams.get("state") ?? undefined,
      preservation: searchParams.get("preservation") ?? undefined,
      processing: searchParams.get("processing") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    const result = await searchFoods(params);
    return validatedResponse(FoodsResponseSchema, result);
  } catch (error) {
    return handleError(error);
  }
}
