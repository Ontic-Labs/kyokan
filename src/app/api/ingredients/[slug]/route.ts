import { NextRequest } from "next/server";
import { handleError } from "@/lib/errors";
import { errorResponse } from "@/lib/errors";
import { validatedResponse } from "@/lib/validate-response";
import { IngredientDetailSchema } from "@/types/fdc";
import { getIngredientBySlug } from "@/lib/data/ingredients";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const ingredient = await getIngredientBySlug(slug);

    if (!ingredient) {
      return errorResponse(
        "NOT_FOUND",
        `Ingredient with slug "${slug}" not found`
      );
    }

    return validatedResponse(IngredientDetailSchema, ingredient);
  } catch (error) {
    return handleError(error);
  }
}
