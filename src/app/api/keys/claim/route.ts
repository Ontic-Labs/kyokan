import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createHash } from "crypto";
import { z } from "zod";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function getAvailableKeys(): string[] {
  const keys = process.env.API_KEYS ?? "";
  return keys
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

// GET - Check how many keys are available (not claimed)
export async function GET() {
  try {
    const allKeys = getAvailableKeys();
    
    if (allKeys.length === 0) {
      return NextResponse.json({
        available: 0,
        total: 0,
        message: "No API keys configured",
      });
    }

    // Get all claimed key hashes
    const result = await query<{ key_hash: string }>(
      "SELECT key_hash FROM api_key_claims"
    );
    const claimedHashes = new Set(result.rows.map((r) => r.key_hash));

    // Count unclaimed
    const unclaimed = allKeys.filter((k) => !claimedHashes.has(hashKey(k)));

    return NextResponse.json({
      available: unclaimed.length,
      total: allKeys.length,
    });
  } catch (error) {
    // Table might not exist yet
    console.error("Error checking keys:", error);
    return NextResponse.json({
      available: getAvailableKeys().length,
      total: getAvailableKeys().length,
      message: "Claims table not initialized",
    });
  }
}

const ClaimSchema = z.object({
  email: z.string().email("Valid email required"),
});

// POST - Claim a key
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = ClaimSchema.parse(body);

    const allKeys = getAvailableKeys();
    
    if (allKeys.length === 0) {
      return NextResponse.json(
        { error: { code: "NO_KEYS", message: "No API keys available" } },
        { status: 503 }
      );
    }

    // Check if this email already has a key
    const existingResult = await query<{ key_hash: string }>(
      "SELECT key_hash FROM api_key_claims WHERE claimed_by = $1",
      [email]
    );

    if (existingResult.rows.length > 0) {
      // Find the key they already have
      const theirHash = existingResult.rows[0].key_hash;
      const theirKey = allKeys.find((k) => hashKey(k) === theirHash);
      
      if (theirKey) {
        return NextResponse.json({
          key: theirKey,
          message: "You already have an API key",
          existing: true,
        });
      }
    }

    // Get all claimed hashes
    const claimedResult = await query<{ key_hash: string }>(
      "SELECT key_hash FROM api_key_claims"
    );
    const claimedHashes = new Set(claimedResult.rows.map((r) => r.key_hash));

    // Find an unclaimed key
    const unclaimedKey = allKeys.find((k) => !claimedHashes.has(hashKey(k)));

    if (!unclaimedKey) {
      return NextResponse.json(
        { error: { code: "NO_KEYS_LEFT", message: "All API keys have been claimed" } },
        { status: 503 }
      );
    }

    // Claim it
    await query(
      "INSERT INTO api_key_claims (key_hash, claimed_by) VALUES ($1, $2)",
      [hashKey(unclaimedKey), email]
    );

    return NextResponse.json({
      key: unclaimedKey,
      message: "API key claimed successfully",
      existing: false,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: error.issues[0].message } },
        { status: 400 }
      );
    }
    console.error("Error claiming key:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to claim key" } },
      { status: 500 }
    );
  }
}
