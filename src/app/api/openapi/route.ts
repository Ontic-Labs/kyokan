import { NextResponse } from "next/server";

export async function GET() {
  const spec = await import("@/../public/openapi.json");
  return NextResponse.json(spec.default ?? spec, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
