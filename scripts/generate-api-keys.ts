#!/usr/bin/env npx tsx
/**
 * Generate API Keys
 * 
 * Usage:
 *   npx tsx scripts/generate-api-keys.ts           # Generate 1 key
 *   npx tsx scripts/generate-api-keys.ts 5         # Generate 5 keys
 *   npx tsx scripts/generate-api-keys.ts --simple  # Generate simple readable key
 */

import { randomBytes } from "crypto";

function generateSecureKey(): string {
  // 24 random bytes = 32 base64url chars (no padding)
  return randomBytes(24).toString("base64url");
}

function generateSimpleKey(): string {
  // 8 random bytes = 16 hex chars, more human-readable
  return randomBytes(8).toString("hex");
}

const args = process.argv.slice(2);
const isSimple = args.includes("--simple");
const countArg = args.find((a) => !a.startsWith("--"));
const count = countArg ? parseInt(countArg, 10) : 1;

console.log("\n🔑 Generated API Keys:\n");

const keys: string[] = [];
for (let i = 0; i < count; i++) {
  const key = isSimple ? generateSimpleKey() : generateSecureKey();
  keys.push(key);
  console.log(`   ${key}`);
}

console.log("\n📋 For Vercel environment variable (API_KEYS):\n");
console.log(`   ${keys.join(",")}`);
console.log("\n💡 Add existing keys by appending: existingKey,${keys.join(",")}\n");
