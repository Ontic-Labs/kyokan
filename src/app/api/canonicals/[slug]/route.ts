import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, handleError } from "@/lib/errors";
import { validatedResponse } from "@/lib/validate-response";
import { getCanonicalBySlug } from "@/lib/data/canonical-detail";

const dbInt = z.coerce.number().int();
const dbNum = z.coerce.number();

const CanonicalNutrientSchema = z.object({
  nutrientId: dbInt,
  name: z.string(),
  unit: z.string(),
  median: dbNum,
  p5: dbNum.nullable(),
  p95: dbNum.nullable(),
  min: dbNum,
  max: dbNum,
  sampleCount: dbInt,
});

const CanonicalSourceSchema = z.object({
  fdcId: dbInt,
  description: z.string(),
  dataType: z.string(),
});

const CanonicalDetailSchema = z.object({
  canonicalId: dbInt,
  canonicalSlug: z.string(),
  canonicalName: z.string(),
  level: z.string(),
  foodCount: dbInt,
  dataTypes: z.array(z.string()),
  representativeFdcId: dbInt.nullable(),
  nutrients: z.array(CanonicalNutrientSchema),
  sources: z.array(CanonicalSourceSchema),
});

const ParamsSchema = z.object({
  slug: z.string().min(1),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = ParamsSchema.parse(await params);
    const canonical = await getCanonicalBySlug(slug);

    if (!canonical) {
      return errorResponse(
        "NOT_FOUND",
        `Canonical aggregate with slug "${slug}" not found`
      );
    }

    return validatedResponse(CanonicalDetailSchema, canonical);
  } catch (error) {
    return handleError(error);
  }
}
