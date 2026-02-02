import Link from "next/link";
import { getCategories } from "@/lib/data/categories";
import { CategoryWithCount } from "@/types/fdc";

export const metadata = {
  title: "Categories | Kyokan",
};

export default async function CategoriesPage() {
  const categories = (await getCategories(true)) as CategoryWithCount[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">
        Food Categories ({categories.length})
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((cat) => (
          <Link
            key={cat.categoryId}
            href={`/categories/${cat.categoryId}`}
            className="block p-4 bg-surface-raised border border-border-default rounded-md hover:border-border-strong transition-colors"
          >
            <div className="text-sm font-medium text-text-primary">
              {cat.name}
            </div>
            <div className="text-sm text-text-muted mt-1">
              {cat.foodCount.toLocaleString()} foods
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
