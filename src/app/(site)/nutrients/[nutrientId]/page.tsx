import { notFound } from "next/navigation";
import Link from "next/link";
import { getNutrientById, getTopFoodsForNutrient } from "@/lib/data/nutrients";
import Pagination from "@/components/pagination";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ nutrientId: string }>;
  searchParams: Promise<Record<string, string>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { nutrientId } = await params;
  const nutrient = await getNutrientById(Number(nutrientId));
  return {
    title: nutrient
      ? `${nutrient.name} | Kyokan`
      : "Nutrient Not Found | Kyokan",
  };
}

export default async function NutrientDetailPage({
  params,
  searchParams,
}: Props) {
  const { nutrientId } = await params;
  const sp = await searchParams;
  const nutrient = await getNutrientById(Number(nutrientId));

  if (!nutrient) notFound();

  const page = sp.page ? Number(sp.page) : 1;
  const topFoods = await getTopFoodsForNutrient(
    nutrient.nutrientId,
    page,
    25
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/nutrients"
          className="text-sm text-text-link hover:text-text-link-hover"
        >
          &larr; All nutrients
        </Link>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-text-primary">
          {nutrient.name}
        </h1>
        <div className="flex gap-4 text-sm text-text-secondary">
          <span>
            ID:{" "}
            <span className="font-mono text-text-muted">
              {nutrient.nutrientId}
            </span>
          </span>
          <span>Unit: {nutrient.unit}</span>
          {nutrient.rank && <span>Rank: {nutrient.rank}</span>}
          {nutrient.isEnergy && (
            <span className="px-2 py-0.5 bg-status-info-bg text-status-info rounded-full text-xs">
              Energy
            </span>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">
          Top foods by {nutrient.name.toLowerCase()} content
        </h2>

        <div className="border border-border-default rounded-md overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-table-header-bg text-table-header-text text-sm">
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-4 py-2 font-medium">Food</th>
                <th className="text-right px-4 py-2 font-medium">
                  Amount ({nutrient.unit})
                </th>
                <th className="text-left px-4 py-2 font-medium">Category</th>
              </tr>
            </thead>
            <tbody>
              {topFoods.items.map((food, i) => (
                <tr
                  key={food.fdcId}
                  className={`border-t border-table-border hover:bg-table-row-hover ${
                    i % 2 === 0 ? "bg-table-row-bg" : "bg-table-row-alt-bg"
                  }`}
                >
                  <td className="px-4 py-1.5 text-sm text-text-muted">
                    {(page - 1) * 25 + i + 1}
                  </td>
                  <td className="px-4 py-1.5 text-sm">
                    <Link
                      href={`/foods/${food.fdcId}`}
                      className="text-text-link hover:text-text-link-hover"
                    >
                      {food.description}
                    </Link>
                  </td>
                  <td className="px-4 py-1.5 text-sm text-text-primary text-right font-mono">
                    {food.amount.toLocaleString(undefined, {
                      maximumFractionDigits: 3,
                    })}
                  </td>
                  <td className="px-4 py-1.5 text-sm text-text-secondary">
                    {food.categoryName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination
          total={topFoods.total}
          page={topFoods.page}
          pageSize={topFoods.pageSize}
        />
      </section>
    </div>
  );
}
