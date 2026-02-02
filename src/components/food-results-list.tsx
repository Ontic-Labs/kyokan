import Link from "next/link";
import { FoodListItem } from "@/types/fdc";

interface FoodResultsListProps {
  items: FoodListItem[];
}

export default function FoodResultsList({ items }: FoodResultsListProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        No foods found matching your criteria.
      </div>
    );
  }

  return (
    <div className="border border-border-default rounded-md overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-table-header-bg text-table-header-text text-sm">
            <th className="text-left px-4 py-2 font-medium">FDC ID</th>
            <th className="text-left px-4 py-2 font-medium">Description</th>
            <th className="text-left px-4 py-2 font-medium">Category</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr
              key={item.fdcId}
              className={`border-t border-table-border hover:bg-table-row-hover ${
                i % 2 === 0 ? "bg-table-row-bg" : "bg-table-row-alt-bg"
              }`}
            >
              <td className="px-4 py-2 text-sm text-text-muted font-mono">
                {item.fdcId}
              </td>
              <td className="px-4 py-2 text-sm">
                <Link
                  href={`/foods/${item.fdcId}`}
                  className="text-text-link hover:text-text-link-hover"
                >
                  {item.description}
                </Link>
              </td>
              <td className="px-4 py-2 text-sm text-text-secondary">
                {item.categoryName ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
