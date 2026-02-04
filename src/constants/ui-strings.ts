export const NAV_ITEMS = [
  { href: "/ingredients", label: "Synthetic" },
  { href: "/canonicals", label: "Canonicals" },
  { href: "/foods", label: "Foods" },
  { href: "/categories", label: "Categories" },
  { href: "/nutrients", label: "Nutrients" },
  { href: "/docs", label: "API Docs" },
  { href: "/blog", label: "Blog" },
] as const;

export const UI_STRINGS = {
  home: {
    title: "Kyokon",
    subtitle:
      "Nutrition data that doesn't hallucinate. 231K recipes taught us what 'ground beef' means — no embeddings, no vibes, no 'the model feels like 250 calories.'",
    stats: {
      foods: "Foods",
      nutrients: "Nutrients",
      categories: "Categories",
    },
    cards: [
      {
        title: "Synthetic Ingredients",
        description:
          "2,334 ingredients derived from 231K real recipes, each with statistical nutrient boundaries computed from USDA source foods. Aliases, member foods, and full provenance you can audit.",
        href: "/ingredients",
      },
      {
        title: "Food Search",
        description:
          "8,158 USDA foods from SR Legacy and Foundation Foods. Filter by state, preservation, processing, cookability — every filter is deterministic, not inferred.",
        href: "/foods",
      },
      {
        title: "Categories",
        description:
          "25 USDA food groups. Browse every food in each category with full nutrient breakdowns.",
        href: "/categories",
      },
      {
        title: "Nutrients",
        description:
          "247 nutrients with statistical bounds per ingredient. Median, p10, p90 — because 'salmon has 208 calories' is a single point from a distribution, and we show the distribution.",
        href: "/nutrients",
      },
      {
        title: "Canonicals",
        description:
          "1,054 canonical food names mapped from FDC descriptions to human-readable forms. Every mapping traces to source foods. No black boxes.",
        href: "/canonicals",
      },
      {
        title: "API Documentation",
        description:
          "Swagger UI where 'Try it out' returns deterministic results. Same input, same output. Revolutionary, apparently.",
        href: "/docs",
      },
      {
        title: "Blog",
        description:
          "Why we built this. Empirical ontology, recipe-first architecture, and how to avoid the semantic trap that kills nutrition APIs.",
        href: "/blog",
      },
    ],
  },
  docs: {
    title: "API Documentation",
    description:
      "A REST API where you can ask 'why did it return that?' and get a SQL query instead of a shrug. Use 'Try it out' on any endpoint.",
    metadataTitle: "API Documentation | Kyokon",
  },
  swagger: {
    loading: "Loading documentation... deterministically.",
  },
  error: {
    title: "Something went wrong",
    fallbackMessage: "An unexpected error occurred. But it's a real error, not a made-up one.",
    action: "Try again",
  },
  adminKeys: {
    title: "Admin: API Keys",
    login: {
      label: "Admin Secret",
      placeholder: "Enter ADMIN_SECRET",
      button: "Authenticate",
    },
    modal: {
      title: "🔑 Key Created",
      warning: "Copy this key now. We hash it immediately because we're not insane.",
      copied: "✓ Copied",
      copy: "Copy",
      saved: "I've saved the key",
      nameLabel: "Name:",
      expiresLabel: "Expires:",
    },
    create: {
      title: "Create New Key",
      nameLabel: "Name",
      namePlaceholder: "e.g., App That Actually Ships",
      expiresLabel: "Expires in (days)",
      expiresPlaceholder: "Leave empty for no expiration",
      submit: "Create Key",
      submitting: "Creating...",
    },
    list: {
      title: "API Keys",
      loading: "Loading...",
      empty: "No API keys yet. Create one above. It's deterministic, we promise.",
      headers: {
        name: "Name",
        prefix: "Prefix",
        status: "Status",
        created: "Created",
        expires: "Expires",
        lastUsed: "Last Used",
        requests: "Requests",
        actions: "Actions",
      },
      revoke: "Revoke",
    },
    status: {
      revoked: "Revoked",
      expired: "Expired",
      active: "Active",
    },
    errors: {
      invalidAdminSecret: "Invalid admin secret. This one's on you.",
      failedFetch: "Failed to fetch keys. The irony of a deterministic system failing is not lost on us.",
      failedCreate: "Failed to create key. Try again — same input might work this time. Just kidding, it won't. Fix the actual problem.",
      failedRevoke: "Failed to revoke key. It's still active. Sorry.",
      unknown: "Unknown error. But at least we're honest about not knowing.",
    },
    confirmRevoke: (name: string) =>
      `Revoke "${name}"? This is irreversible. No prompt engineering will bring it back.`,
    noDate: "—",
  },
} as const;