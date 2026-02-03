import { ImageResponse } from "next/og";

export const alt = "Kyokon Category";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { categoryId } = await params;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 100px",
          background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)",
          fontFamily: "system-ui, sans-serif",
          color: "white",
        }}
      >
        <div style={{ fontSize: 20, color: "#6366f1", fontWeight: 600 }}>
          Kyokon · Food Category
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, marginTop: 12 }}>
          Category {categoryId}
        </div>
        <div style={{ fontSize: 24, color: "#a1a1aa", marginTop: 16 }}>
          USDA FoodData Central category
        </div>
      </div>
    ),
    { ...size }
  );
}
