import Link from "next/link";
import { db } from "@/lib/db";

async function getStats() {
  const [foods, nutrients, categories] = await Promise.all([
    db.query<{ count: string }>("SELECT COUNT(*) as count FROM foods"),
    db.query<{ count: string }>("SELECT COUNT(*) as count FROM nutrients"),
    db.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM food_categories"
    ),
  ]);

  return {
    foods: parseInt(foods.rows[0].count, 10),
    nutrients: parseInt(nutrients.rows[0].count, 10),
    categories: parseInt(categories.rows[0].count, 10),
  };
}

const cards = [
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
];

export default async function HomePage() {
  const stats = await getStats();

  return (
    <div className="space-y-12">
      <div className="text-center space-y-4 py-8">
        <h1 className="text-3xl font-bold text-text-primary">
          Kyokan
        </h1>
        <p className="text-lg text-text-secondary max-w-2xl mx-auto">
          Search, browse, and explore USDA FoodData Central. SR Legacy and
          Foundation Foods with nutrients, portions, and cookability data.
        </p>

        <div className="flex justify-center gap-8 pt-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-text-primary">
              {stats.foods.toLocaleString()}
            </div>
            <div className="text-sm text-text-muted">Foods</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-text-primary">
              {stats.nutrients.toLocaleString()}
            </div>
            <div className="text-sm text-text-muted">Nutrients</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-text-primary">
              {stats.categories.toLocaleString()}
            </div>
            <div className="text-sm text-text-muted">Categories</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="block p-6 bg-surface-raised border border-border-default rounded-md hover:border-border-strong transition-colors"
          >
            <h2 className="text-lg font-semibold text-text-primary mb-2">
              {card.title}
            </h2>
            <p className="text-sm text-text-secondary">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
