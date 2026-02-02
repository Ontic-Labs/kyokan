export const UI_STRINGS = {
  home: {
    title: "Kyokon",
    subtitle:
      "Search, browse, and explore USDA FoodData Central. SR Legacy and Foundation Foods with nutrients, portions, and cookability data.",
    stats: {
      foods: "Foods",
      nutrients: "Nutrients",
      categories: "Categories",
    },
    cards: [
      {
        title: "Food Search",
        description:
          "Search 8,000+ foods with filters for category, nutrients, cooking state, and cookability.",
        href: "/foods",
      },
      {
        title: "Categories",
        description:
          "Browse all food categories with counts. Explore dairy, meats, vegetables, and more.",
        href: "/categories",
      },
      {
        title: "Nutrients",
        description:
          "Explore 228 nutrients. Find top foods for any nutrient like protein, iron, or vitamin C.",
        href: "/nutrients",
      },
      {
        title: "API Documentation",
        description:
          "Interactive Swagger UI for the REST API. Try endpoints directly in your browser.",
        href: "/docs",
      },
    ],
  },
  docs: {
    title: "API Documentation",
    description:
      "Interactive REST API documentation. Use the “Try it out” button on any endpoint to make live requests.",
    metadataTitle: "API Documentation | Kyokon",
  },
  swagger: {
    loading: "Loading API documentation...",
  },
  error: {
    title: "Something went wrong",
    fallbackMessage: "An unexpected error occurred.",
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
      warning: "Copy this key now — it will not be shown again!",
      copied: "✓ Copied!",
      copy: "Copy",
      saved: "I’ve saved the key",
      nameLabel: "Name:",
      expiresLabel: "Expires:",
    },
    create: {
      title: "Create New Key",
      nameLabel: "Name",
      namePlaceholder: "e.g., Mobile App Production",
      expiresLabel: "Expires in (days)",
      expiresPlaceholder: "Leave empty for no expiration",
      submit: "Create Key",
      submitting: "Creating...",
    },
    list: {
      title: "API Keys",
      loading: "Loading...",
      empty: "No API keys yet. Create one above.",
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
      invalidAdminSecret: "Invalid admin secret",
      failedFetch: "Failed to fetch keys",
      failedCreate: "Failed to create key",
      failedRevoke: "Failed to revoke key",
      unknown: "Unknown error",
    },
    confirmRevoke: (name: string) =>
      `Are you sure you want to revoke key "${name}"? This cannot be undone.`,
    noDate: "—",
  },
} as const;
