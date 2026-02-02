import { NextRequest } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/errors";
import { PagingSchema, createPaginatedResponseSchema } from "@/lib/paging";
import { validatedResponse } from "@/lib/validate-response";
import { NutrientListItemSchema } from "@/types/fdc";
import { searchNutrients } from "@/lib/data/nutrients";

const NutrientsQuerySchema = z
  .object({
    search: z.string().optional(),
  })
  .merge(PagingSchema);

const NutrientsResponseSchema = createPaginatedResponseSchema(NutrientListItemSchema);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const params = NutrientsQuerySchema.parse({
      search: searchParams.get("search") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    const result = await searchNutrients(params);
    return validatedResponse(NutrientsResponseSchema, result);
  } catch (error) {
    return handleError(error);
  }
}
