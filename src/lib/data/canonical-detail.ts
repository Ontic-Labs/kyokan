import { db } from "@/lib/db";

export interface CanonicalNutrient {
  nutrientId: number;
  name: string;
  unit: string;
  median: number;
  p5: number | null;
  p95: number | null;
  min: number;
  max: number;
  sampleCount: number;
}

export interface CanonicalSource {
  fdcId: number;
  description: string;
  dataType: string;
}

export interface CanonicalDetail {
  canonicalId: number;
  canonicalSlug: string;
  canonicalName: string;
  level: string;
  foodCount: number;
  dataTypes: string[];
  representativeFdcId: number | null;
  nutrients: CanonicalNutrient[];
  sources: CanonicalSource[];
}

export async function getCanonicalBySlug(
  slug: string
): Promise<CanonicalDetail | null> {
  const aggResult = await db.query<{
    canonical_id: string;
    canonical_slug: string;
    canonical_name: string;
    level: string;
    food_count: string;
    data_types: string[];
    representative_fdc_id: string | null;
  }>(
    `SELECT canonical_id, canonical_slug, canonical_name, level,
            food_count, data_types, representative_fdc_id
     FROM canonical_aggregates
     WHERE canonical_slug = $1`,
    [slug]
  );

  if (aggResult.rows.length === 0) return null;

  const agg = aggResult.rows[0];
  const canonicalId = parseInt(agg.canonical_id, 10);

  // Fetch nutrients and sources in parallel
  const [nutrientsResult, sourcesResult] = await Promise.all([
    db.query<{
      nutrient_id: string;
      name: string;
      unit_name: string;
      median_amount: string;
      p5_amount: string | null;
      p95_amount: string | null;
      min_amount: string;
      max_amount: string;
      sample_count: string;
    }>(
      `SELECT can.nutrient_id, n.name, n.unit_name,
              can.median_amount, can.p5_amount, can.p95_amount,
              can.min_amount, can.max_amount, can.sample_count
       FROM canonical_aggregate_nutrients can
       JOIN nutrients n ON n.nutrient_id = can.nutrient_id
       WHERE can.canonical_id = $1
       ORDER BY n.nutrient_rank NULLS LAST, n.name`,
      [canonicalId]
    ),
    db.query<{
      fdc_id: string;
      description: string;
      data_type: string;
    }>(
      `SELECT cas.fdc_id, cas.description, cas.data_type
       FROM canonical_aggregate_sources cas
       WHERE cas.canonical_id = $1
       ORDER BY cas.data_type, cas.description`,
      [canonicalId]
    ),
  ]);

  return {
    canonicalId,
    canonicalSlug: agg.canonical_slug,
    canonicalName: agg.canonical_name,
    level: agg.level,
    foodCount: parseInt(agg.food_count, 10),
    dataTypes: agg.data_types,
    representativeFdcId: agg.representative_fdc_id
      ? parseInt(agg.representative_fdc_id, 10)
      : null,
    nutrients: nutrientsResult.rows.map((r) => ({
      nutrientId: parseInt(r.nutrient_id, 10),
      name: r.name,
      unit: r.unit_name,
      median: parseFloat(r.median_amount),
      p5: r.p5_amount ? parseFloat(r.p5_amount) : null,
      p95: r.p95_amount ? parseFloat(r.p95_amount) : null,
      min: parseFloat(r.min_amount),
      max: parseFloat(r.max_amount),
      sampleCount: parseInt(r.sample_count, 10),
    })),
    sources: sourcesResult.rows.map((r) => ({
      fdcId: parseInt(r.fdc_id, 10),
      description: r.description,
      dataType: r.data_type,
    })),
  };
}
