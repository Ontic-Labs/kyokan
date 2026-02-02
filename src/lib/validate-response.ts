import { z } from "zod";
import { NextResponse } from "next/server";

/**
 * Validate data against a Zod schema and return a NextResponse.
 * Throws in development if validation fails, logs warning in production.
 * 
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @param options - Optional configuration
 * @returns NextResponse with validated data
 */
export function validatedResponse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  options?: { status?: number }
): NextResponse<z.infer<T>> {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errorDetails = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    // Log validation failures for debugging
    console.error("[Response Validation Failed]", {
      errors: errorDetails,
      data: JSON.stringify(data, null, 2).slice(0, 1000), // Truncate for logs
    });

    // In development, throw to catch bugs early
    if (process.env.NODE_ENV === "development") {
      throw new Error(
        `Response validation failed: ${JSON.stringify(errorDetails)}`
      );
    }

    // In production, log but still return the data (avoid breaking clients)
    // The type assertion is intentional - we're accepting the risk in prod
  }

  return NextResponse.json(
    (result.success ? result.data : data) as z.infer<T>,
    { status: options?.status ?? 200 }
  );
}

/**
 * Validate an array of items against a schema.
 * In development, throws if any item fails validation.
 * In production, logs errors but returns all items to avoid silent data loss.
 */
export function validateItems<T extends z.ZodTypeAny>(
  schema: T,
  items: unknown[]
): z.infer<T>[] {
  const validated: z.infer<T>[] = [];
  const errors: Array<{ index: number; issues: z.ZodIssue[] }> = [];

  for (let i = 0; i < items.length; i++) {
    const result = schema.safeParse(items[i]);
    if (result.success) {
      validated.push(result.data);
    } else {
      errors.push({ index: i, issues: result.error.issues });
    }
  }

  if (errors.length > 0) {
    console.error("[Item Validation Errors]", {
      failedCount: errors.length,
      totalCount: items.length,
      firstError: errors[0],
      sampleItem: JSON.stringify(items[errors[0].index]).slice(0, 500),
    });

    if (process.env.NODE_ENV === "development") {
      throw new Error(
        `${errors.length} items failed validation. First error at index ${errors[0].index}: ${JSON.stringify(errors[0].issues)}`
      );
    }

    // In production, return raw items rather than silently dropping them
    return items as z.infer<T>[];
  }

  return validated;
}
