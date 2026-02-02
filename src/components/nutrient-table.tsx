import { NutrientInfo } from "@/types/fdc";

interface NutrientTableProps {
  nutrients: NutrientInfo[];
}

export default function NutrientTable({ nutrients }: NutrientTableProps) {
  if (nutrients.length === 0) {
    return (
      <p className="text-text-muted text-sm">No nutrient data available.</p>
    );
  }

  return (
    <div className="border border-border-default rounded-md overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-table-header-bg text-table-header-text text-sm">
            <th className="text-left px-4 py-2 font-medium">Nutrient</th>
            <th className="text-right px-4 py-2 font-medium">Amount</th>
            <th className="text-left px-4 py-2 font-medium">Unit</th>
          </tr>
        </thead>
        <tbody>
          {nutrients.map((n, i) => (
            <tr
              key={n.nutrientId}
              className={`border-t border-table-border ${
                i % 2 === 0 ? "bg-table-row-bg" : "bg-table-row-alt-bg"
              }`}
            >
              <td className="px-4 py-1.5 text-sm text-text-primary">
                {n.name}
              </td>
              <td className="px-4 py-1.5 text-sm text-text-primary text-right font-mono">
                {n.amount.toLocaleString(undefined, {
                  maximumFractionDigits: 3,
                })}
              </td>
              <td className="px-4 py-1.5 text-sm text-text-muted">{n.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
