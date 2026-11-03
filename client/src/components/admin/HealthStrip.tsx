/**
 * A word and a shape for each connection, on every admin page.
 *
 * Colour is never the only signal. Each row says Working, Needs you, or
 * Broken right now, and the shape matches the word.
 */
import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/components/admin/adminApi";
import { revealCard } from "./revealCard";
import { connectionRows, type ConnectionRow, type ConnState } from "./todayGlance";

const SHAPE: Record<ConnState, string> = {
  working: "rounded-sm",
  needs: "rounded-full",
  broken: "rounded-sm rotate-45",
};

function openService(onOpen: (tab: string) => void, id: string) {
  onOpen(id === "calendar" ? "events-admin" : "integrations");
  revealCard(id);
}

export default function HealthStrip({ password, onOpen, full = true }: { password: string; onOpen: (tab: string) => void; full?: boolean }) {
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
  if (!full) {
    const needs = rows.filter((row) => row.state !== "working").length;
    const line = needs === 0 ? "Connections are fine." : needs === 1 ? "1 connection needs you." : `${needs} connections need you.`;
    return (
      <button type="button" onClick={() => onOpen("integrations")} className="mb-4 inline-flex min-h-[44px] items-center rounded-full border border-border bg-card px-3 text-sm text-card-foreground">
        {line}
      </button>
    );
  }
  return (
    <ul className="admin-chip-row mb-4 flex flex-nowrap gap-2 overflow-x-auto" aria-label="Connections">
      {rows.map((row) => (
        <li key={row.id} className="shrink-0">
          <button
            type="button"
            onClick={() => openService(onOpen, row.id)}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3 text-sm text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span aria-hidden="true" className={`inline-block h-3 w-3 border-2 border-current ${SHAPE[row.state]}`} />
            <span className="font-medium">{row.name}</span>
            <span>{row.word}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
