import { notFound } from "next/navigation";
import Link from "next/link";
import { getCategoryById } from "@/lib/data/categories";
import { searchFoods } from "@/lib/data/foods";
import FoodResultsList from "@/components/food-results-list";
import Pagination from "@/components/pagination";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ categoryId: string }>;
  searchParams: Promise<Record<string, string>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { categoryId } = await params;
  const category = await getCategoryById(Number(categoryId));
  return {
    title: category
      ? `${category.name} | Kyokan`
      : "Category Not Found | Kyokan",
  };
}

export default async function CategoryDetailPage({
  params,
  searchParams,
}: Props) {
  const { categoryId } = await params;
  const sp = await searchParams;
  const category = await getCategoryById(Number(categoryId));

  if (!category) notFound();

  const page = sp.page ? Number(sp.page) : 1;
  const results = await searchFoods({
    categoryId: category.categoryId,
    page,
    pageSize: 25,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/categories"
          className="text-sm text-text-link hover:text-text-link-hover"
        >
          &larr; All categories
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-text-primary">
        {category.name}
      </h1>
      <p className="text-sm text-text-secondary">
        {results.total.toLocaleString()} foods in this category
      </p>

      <FoodResultsList items={results.items} />

      <Pagination
        total={results.total}
        page={results.page}
        pageSize={results.pageSize}
      />
    </div>
  );
}
