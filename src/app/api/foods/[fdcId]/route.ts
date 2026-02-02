import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, handleError } from "@/lib/errors";
import { validatedResponse } from "@/lib/validate-response";
import { FoodDetailSchema } from "@/types/fdc";
import { getFoodDetail } from "@/lib/data/foods";

const ParamsSchema = z.object({
  fdcId: z.coerce.number().int().positive(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fdcId: string }> }
) {
  try {
    const { fdcId } = ParamsSchema.parse(await params);
    const food = await getFoodDetail(fdcId);

    if (!food) {
      return errorResponse("NOT_FOUND", `Food with fdcId ${fdcId} not found`);
    }

    return validatedResponse(FoodDetailSchema, food);
  } catch (error) {
    return handleError(error);
  }
}
