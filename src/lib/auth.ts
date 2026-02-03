/**
 * Simple API Key Authentication
 *
 * Environment-variable-based API keys (like USDA FDC).
 * Keys are defined in API_KEYS env var as comma-separated list.
 *
 * Usage:
 *   export const GET = withApiKey(async (request, context) => {
 *     return NextResponse.json({ data: "..." });
 *   });
 *
 * Configuration:
 *   API_KEYS=demo,prod_key_123,partner_abc
 */

import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteContext = { params: Promise<any> };

type RouteHandler = (
  request: NextRequest,
  context: RouteContext
) => Promise<NextResponse>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Get valid API keys from environment variable.
 * Supports comma-separated list: API_KEYS=key1,key2,key3
 */
function getValidKeys(): Set<string> {
  const keys = process.env.API_KEYS ?? "";
  return new Set(
    keys
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
  );
}

/**
 * Check if authentication is required.
 * Disabled when no API_KEYS are configured.
 */
function isAuthRequired(): boolean {
  return getValidKeys().size > 0;
}

// ---------------------------------------------------------------------------
// Key Extraction
// ---------------------------------------------------------------------------

/**
 * Extract API key from request.
 * Supports (in order of precedence):
 *   - Authorization: Bearer <key>
 *   - X-API-Key header
 *   - api_key query parameter (USDA-style)
 *   - apiKey query parameter (legacy)
 */
function extractApiKey(request: NextRequest): string | null {
  // Bearer token
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }

  // X-API-Key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey;

  // Query parameters (api_key or apiKey)
  const params = request.nextUrl.searchParams;
  return params.get("api_key") ?? params.get("apiKey") ?? null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do the comparison to maintain constant time
    let result = a.length ^ b.length;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return result === 0;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Check if provided key is valid.
 */
function isValidKey(provided: string): boolean {
  const validKeys = getValidKeys();
  for (const key of validKeys) {
    if (timingSafeEqual(provided, key)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Error Response
// ---------------------------------------------------------------------------

function unauthorizedResponse(message: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "UNAUTHORIZED",
        message,
      },
    },
    { status: 401 }
  );
}

// ---------------------------------------------------------------------------
// Route Wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a route handler with API key authentication.
 *
 * If no API_KEYS are configured, all requests are allowed.
 * Otherwise, requests must provide a valid key.
 */
export function withApiKey(handler: RouteHandler): RouteHandler {
  return async (request: NextRequest, context: RouteContext) => {
    // If no keys configured, allow all requests
    if (!isAuthRequired()) {
      return handler(request, context);
    }

    const provided = extractApiKey(request);

    if (!provided) {
      return unauthorizedResponse(
        "Missing API key. Provide via api_key query parameter or X-API-Key header."
      );
    }

    if (!isValidKey(provided)) {
      return unauthorizedResponse("Invalid API key");
    }

    return handler(request, context);
  };
}

/**
 * Wrap an admin route with ADMIN_SECRET authentication.
 */
export function withAdminAuth(handler: RouteHandler): RouteHandler {
  return async (request: NextRequest, context: RouteContext) => {
    const adminSecret = process.env.ADMIN_SECRET;

    if (!adminSecret) {
      return NextResponse.json(
        {
          error: {
            code: "CONFIGURATION_ERROR",
            message: "ADMIN_SECRET environment variable is not set",
          },
        },
        { status: 500 }
      );
    }

    const provided =
      request.headers.get("x-admin-secret") ??
      request.nextUrl.searchParams.get("adminSecret");

    if (!provided) {
      return unauthorizedResponse(
        "Missing admin secret. Provide via X-Admin-Secret header."
      );
    }

    if (!timingSafeEqual(provided, adminSecret)) {
      return unauthorizedResponse("Invalid admin secret");
    }

    return handler(request, context);
  };
}
