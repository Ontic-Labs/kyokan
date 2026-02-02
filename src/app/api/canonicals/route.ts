import { NextRequest } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/errors";
import { PagingSchema, createPaginatedResponseSchema } from "@/lib/paging";
import { validatedResponse } from "@/lib/validate-response";
import { searchCanonicals } from "@/lib/data/canonicals";

const dbInt = z.coerce.number().int();

const CanonicalListItemSchema = z.object({
  canonicalId: dbInt,
  canonicalSlug: z.string(),
  canonicalName: z.string(),
  foodCount: dbInt,
});

const CanonicalsResponseSchema =
  createPaginatedResponseSchema(CanonicalListItemSchema);

const CanonicalsQuerySchema = z
  .object({
    q: z.string().optional(),
  })
  .merge(PagingSchema);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const params = CanonicalsQuerySchema.parse({
      q: searchParams.get("q") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });

    const result = await searchCanonicals(params);
    return validatedResponse(CanonicalsResponseSchema, result);
  } catch (error) {
    return handleError(error);
  }
}
