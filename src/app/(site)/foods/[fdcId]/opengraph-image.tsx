import { ImageResponse } from "next/og";
import { getFoodDetail } from "@/lib/data/foods";

export const alt = "Kyokon Food";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({
  params,
}: {
  params: Promise<{ fdcId: string }>;
}) {
  const { fdcId } = await params;
  const food = await getFoodDetail(Number(fdcId));

  if (!food) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a0a0a",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <ellipse cx="24" cy="28" rx="12" ry="16" fill="#7C3AED" />
            <ellipse cx="20" cy="24" rx="3" ry="6" fill="#A78BFA" opacity="0.5" />
            <path d="M24 12 C24 8, 28 6, 30 8 C32 10, 30 12, 28 12 L24 12" fill="#22C55E" />
            <path d="M24 12 C24 8, 20 6, 18 8 C16 10, 18 12, 20 12 L24 12" fill="#16A34A" />
            <ellipse cx="24" cy="13" rx="5" ry="2" fill="#15803D" />
          </svg>
          <div style={{ fontSize: 56, fontWeight: 700, color: "white", marginTop: 12 }}>
            Food {fdcId}
          </div>
          <div style={{ fontSize: 24, color: "#a1a1aa", marginTop: 16 }}>
            USDA FoodData Central
          </div>
        </div>
      ),
      { ...size }
    );
  }

  const topNutrients = food.nutrients.slice(0, 6);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "60px 80px",
          background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: 12,
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <ellipse cx="24" cy="28" rx="12" ry="16" fill="#7C3AED" />
            <ellipse cx="20" cy="24" rx="3" ry="6" fill="#A78BFA" opacity="0.5" />
            <path d="M24 12 C24 8, 28 6, 30 8 C32 10, 30 12, 28 12 L24 12" fill="#22C55E" />
            <path d="M24 12 C24 8, 20 6, 18 8 C16 10, 18 12, 20 12 L24 12" fill="#16A34A" />
            <ellipse cx="24" cy="13" rx="5" ry="2" fill="#15803D" />
          </svg>
          <span style={{ fontSize: 20, color: "#6366f1", fontWeight: 600 }}>
            Kyokon · USDA Food
          </span>
        </div>

        {/* Food name */}
        <div
          style={{
            fontSize: 48,
            fontWeight: 700,
            color: "white",
            lineHeight: 1.15,
            marginBottom: 20,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {food.description}
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: "40px", marginBottom: 40 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 14, color: "#71717a" }}>FDC ID</span>
            <span style={{ fontSize: 22, fontWeight: 600, color: "white" }}>
              {food.fdcId}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 14, color: "#71717a" }}>Data type</span>
            <span style={{ fontSize: 22, fontWeight: 600, color: "white" }}>
              {food.dataType}
            </span>
          </div>
          {food.category && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 14, color: "#71717a" }}>Category</span>
              <span style={{ fontSize: 22, fontWeight: 600, color: "white" }}>
                {food.category.name}
              </span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 14, color: "#71717a" }}>Nutrients</span>
            <span style={{ fontSize: 22, fontWeight: 600, color: "white" }}>
              {food.nutrients.length}
            </span>
          </div>
        </div>

        {/* Top nutrients */}
        {topNutrients.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              padding: "20px 28px",
              background: "#18181b",
              borderRadius: 8,
            }}
          >
            <span style={{ fontSize: 13, color: "#71717a", marginBottom: 4 }}>
              Per 100g
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }}>
              {topNutrients.map((n) => (
                <div key={n.nutrientId} style={{ display: "flex", gap: "6px" }}>
                  <span style={{ fontSize: 16, color: "#a1a1aa" }}>
                    {n.name}:
                  </span>
                  <span style={{ fontSize: 16, color: "white", fontWeight: 600 }}>
                    {n.amount.toFixed(1)} {n.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    ),
    { ...size }
  );
}
