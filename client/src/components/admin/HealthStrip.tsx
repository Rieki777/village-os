/**
 * A word and a shape for each connection, on every admin page.
 *
 * Colour is never the only signal. Each row says Working, Needs you, or
 * Broken right now, and the shape matches the word.
 */
import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";
import { connectionRows, type ConnectionRow, type ConnState } from "./todayGlance";

const SHAPE: Record<ConnState, string> = {
  working: "rounded-sm",
  needs: "rounded-full",
  broken: "rounded-sm rotate-45",
};

export default function HealthStrip({ password, onOpen }: { password: string; onOpen: (tab: string) => void }) {
  const [rows, setRows] = useState<ConnectionRow[] | null>(null);
  useEffect(() => {
    let gone = false;
    fetch(`${API_BASE}/admin/integrations`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!gone && data) setRows(connectionRows(data)); })
      .catch(() => { if (!gone) setRows([]); });
    return () => { gone = true; };
  }, [password]);
  if (!rows || rows.length === 0) return null;
  return (
    <ul className="mb-4 flex flex-wrap gap-2" aria-label="Connections">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onOpen("integrations")}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-gray-300 bg-white px-3 text-sm text-gray-900"
          >
            <span aria-hidden="true" className={`inline-block h-3 w-3 border-2 border-gray-900 ${SHAPE[row.state]}`} />
            <span className="font-medium">{row.name}</span>
            <span>{row.word}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
