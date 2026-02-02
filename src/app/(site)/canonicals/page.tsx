import Link from "next/link";
import { searchCanonicals } from "@/lib/data/canonicals";
import CanonicalSearchForm from "@/components/canonical-search-form";
import Pagination from "@/components/pagination";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Canonical Names | Kyokon",
};

export default async function CanonicalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;

  const results = await searchCanonicals({
    q: params.q || undefined,
    page: params.page ? Number(params.page) : 1,
    pageSize: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          Canonical Names
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {results.total.toLocaleString()} unique base identities extracted from
          food descriptions
        </p>
      </div>

      <CanonicalSearchForm />

      <div className="bg-surface-raised border border-border-default rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default bg-surface-inset">
              <th className="text-left px-4 py-2 font-medium text-text-secondary w-28">
                ID
              </th>
              <th className="text-left px-4 py-2 font-medium text-text-secondary">
                Canonical Name
              </th>
              <th className="text-right px-4 py-2 font-medium text-text-secondary w-24">
                Foods
              </th>
            </tr>
          </thead>
          <tbody>
            {results.items.map((item) => (
              <tr
                key={item.canonicalId}
                className="border-b border-border-default last:border-b-0 hover:bg-surface-inset transition-colors"
              >
                <td className="px-4 py-2 text-text-muted tabular-nums font-mono text-xs">
                  {item.canonicalId.toLocaleString()}
                </td>
                <td className="px-4 py-2">
                  <Link
                    href={`/foods?canonicalSlug=${item.canonicalSlug}`}
                    className="text-text-primary hover:text-accent-primary"
                  >
                    {item.canonicalName}
                  </Link>
                </td>
                <td className="text-right px-4 py-2 text-text-muted tabular-nums">
                  {item.foodCount.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {results.items.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          No canonical names found matching your search.
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
