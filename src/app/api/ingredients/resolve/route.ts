import { NextRequest } from "next/server";
import { handleError } from "@/lib/errors";
import { validatedResponse } from "@/lib/validate-response";
import { ResolveRequestSchema, ResolveResponseSchema } from "@/types/fdc";
import { resolveIngredients } from "@/lib/data/ingredients";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ingredients } = ResolveRequestSchema.parse(body);

    const results = await resolveIngredients(ingredients);
    const resolved = results.filter((r) => r.match !== null).length;

    return validatedResponse(ResolveResponseSchema, {
      results,
      resolved,
      unresolved: results.length - resolved,
    });
  } catch (error) {
    return handleError(error);
  }
}
