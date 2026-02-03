import { ImageResponse } from "next/og";

export const alt = "Kyokon Blog";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const posts: Record<string, { title: string; date: string; tags: string[] }> = {
  "empirical-ontology-pattern": {
    title: "Empirical Ontology for High-Stakes Domains: A Pattern Language",
    date: "February 2026",
    tags: ["architecture", "safety", "ontology"],
  },
  "recipe-first-architecture": {
    title:
      "Recipe-First Canonical Naming: A Non-LLM Approach to Ingredient Identity",
    date: "February 2026",
    tags: ["implementation", "recipes", "canonicalization"],
  },
};

export default async function OgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = posts[slug];

  if (!post) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a0a0a",
            color: "white",
            fontSize: 48,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Post not found
        </div>
      ),
      { ...size }
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "80px",
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
            marginBottom: 48,
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
            Kyokon Blog
          </span>
        </div>

        {/* Post title */}
        <div
          style={{
            fontSize: 48,
            fontWeight: 700,
            color: "white",
            lineHeight: 1.2,
            marginBottom: 32,
            maxWidth: 1000,
          }}
        >
          {post.title}
        </div>

        {/* Date + tags */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: 18, color: "#71717a" }}>{post.date}</span>
          <span style={{ fontSize: 18, color: "#3f3f46" }}>·</span>
          <div style={{ display: "flex", gap: "10px" }}>
            {post.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 15,
                  color: "#a1a1aa",
                  padding: "4px 12px",
                  background: "#18181b",
                  borderRadius: 4,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
