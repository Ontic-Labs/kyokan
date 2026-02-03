import { ImageResponse } from "next/og";

export const alt = "Kyokon — Nutrition data that doesn't hallucinate";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
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
        }}
      >
        {/* Logo + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <svg
            width="64"
            height="64"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <ellipse cx="24" cy="28" rx="12" ry="16" fill="#7C3AED" />
            <ellipse
              cx="20"
              cy="24"
              rx="3"
              ry="6"
              fill="#A78BFA"
              opacity="0.5"
            />
            <path
              d="M24 12 C24 8, 28 6, 30 8 C32 10, 30 12, 28 12 L24 12"
              fill="#22C55E"
            />
            <path
              d="M24 12 C24 8, 20 6, 18 8 C16 10, 18 12, 20 12 L24 12"
              fill="#16A34A"
            />
            <ellipse cx="24" cy="13" rx="5" ry="2" fill="#15803D" />
          </svg>
          <span
            style={{
              fontSize: 72,
              fontWeight: 700,
              color: "white",
            }}
          >
            Kyokon
          </span>
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 28,
            color: "#a1a1aa",
            marginTop: 32,
          }}
        >
          Nutrition data that doesn&apos;t hallucinate.
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 20,
            color: "#71717a",
            marginTop: 16,
          }}
        >
          231K recipes taught us what &quot;ground beef&quot; means — no
          embeddings, no vibes.
        </div>

        {/* Stats bar */}
        <div
          style={{
            display: "flex",
            gap: "48px",
            marginTop: 60,
            padding: "20px 32px",
            background: "#18181b",
            borderRadius: 8,
          }}
        >
          {["8,000+ Foods", "247 Nutrients", "2,334 Ingredients", "REST API"].map(
            (stat) => (
              <span
                key={stat}
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: "#6366f1",
                }}
              >
                {stat}
              </span>
            )
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
