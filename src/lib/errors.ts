import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ErrorCode = "BAD_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "INTERNAL";

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Create a standardized error response
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  status?: number
): NextResponse<ApiError> {
  const statusCode =
    status ??
    (code === "BAD_REQUEST" ? 400 : code === "UNAUTHORIZED" ? 401 : code === "NOT_FOUND" ? 404 : 500);
  const body = JSON.stringify(
    {
      error: {
        code,
        message,
        ...(details && { details }),
      },
    },
    null,
    2
  );

  return new NextResponse(body, {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle Zod validation errors
 */
export function handleZodError(error: ZodError): NextResponse<ApiError> {
  return errorResponse("BAD_REQUEST", "Validation error", {
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

/**
 * Handle unknown errors
 */
export function handleError(error: unknown): NextResponse<ApiError> {
  console.error("API Error:", error);

  if (error instanceof ZodError) {
    return handleZodError(error);
  }

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";

  return errorResponse("INTERNAL", message);
}
