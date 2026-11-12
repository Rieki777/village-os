/**
 * Print the view under it (0088, L5b): one button, the browser's own print
 * path, and a sheet in print.css that strips the chrome. The header line the
 * paper needs (zone, month, moon) is rendered by the view itself inside a
 * print-header block, invisible on screen.
 */
import { Printer } from "lucide-react";
// Its stylesheet rides the main one (index.css), saving a 4 KB block of the dist budget.

export default function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print-hide inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted text-foreground"
    >
      <Printer className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
