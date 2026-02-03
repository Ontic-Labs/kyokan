import { NextResponse } from "next/server";
import { handleError } from "@/lib/errors";
import { exportAllIngredients } from "@/lib/data/ingredients";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ingredients = await exportAllIngredients();

    const body = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        count: ingredients.length,
        ingredients,
      },
      null,
      2
    );

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition":
          'attachment; filename="kyokon-synthetic-ingredients.json"',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
