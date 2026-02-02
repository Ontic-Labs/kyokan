import { NextRequest } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/errors";
import { validatedResponse } from "@/lib/validate-response";
import {
  CategoriesResponseSchema,
  CategoriesWithCountResponseSchema,
} from "@/types/fdc";
import { getCategories } from "@/lib/data/categories";

const CategoriesQuerySchema = z.object({
  includeCounts: z.coerce.boolean().optional().default(false),
});

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const params = CategoriesQuerySchema.parse({
      includeCounts: searchParams.get("includeCounts") ?? undefined,
    });

    const categories = await getCategories(params.includeCounts);
    const schema = params.includeCounts
      ? CategoriesWithCountResponseSchema
      : CategoriesResponseSchema;

    return validatedResponse(schema, { categories });
  } catch (error) {
    return handleError(error);
  }
}
