import Link from "next/link";
import { searchNutrients } from "@/lib/data/nutrients";
import SearchInput from "@/components/search-input";
import Pagination from "@/components/pagination";

export const metadata = {
  title: "Nutrients | Kyokon",
};

export default async function NutrientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const results = await searchNutrients({
    search: params.search || undefined,
    page: params.page ? Number(params.page) : 1,
    pageSize: 50,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Nutrients</h1>

      <SearchInput
        paramName="search"
        placeholder="Search nutrients (e.g., vitamin, protein)..."
        basePath="/nutrients"
      />

      <div className="border border-border-default rounded-md overflow-x-auto">
        <table className="w-full min-w-112.5">
          <thead>
            <tr className="bg-table-header-bg text-table-header-text text-sm">
              <th className="text-left px-4 py-2 font-medium">ID</th>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Unit</th>
              <th className="text-right px-4 py-2 font-medium">Rank</th>
            </tr>
          </thead>
          <tbody>
            {results.items.map((n, i) => (
              <tr
                key={n.nutrientId}
                className={`border-t border-table-border hover:bg-table-row-hover ${
                  i % 2 === 0 ? "bg-table-row-bg" : "bg-table-row-alt-bg"
                }`}
              >
                <td className="px-4 py-1.5 text-sm text-text-muted font-mono">
                  {n.nutrientId}
                </td>
                <td className="px-4 py-1.5 text-sm">
                  <Link
                    href={`/nutrients/${n.nutrientId}`}
                    className="text-text-link hover:text-text-link-hover"
                  >
                    {n.name}
                  </Link>
                </td>
                <td className="px-4 py-1.5 text-sm text-text-secondary">
                  {n.unit}
                </td>
                <td className="px-4 py-1.5 text-sm text-text-muted text-right font-mono">
                  {n.rank ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {results.items.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          No nutrients found.
        </div>
      )}

      <Pagination
        total={results.total}
        page={results.page}
        pageSize={results.pageSize}
      />
    </div>
  );
}
