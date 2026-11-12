/**
 * The door from Admin to the review page (/admin/proposals), with how many
 * proposed changes wait there. Drawn on every tab while something waits, and
 * on Home always, so the page is findable before the first proposal arrives.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Trans } from "@lingui/react/macro";
import { API_BASE, authHeaders } from "./adminApi";

export default function ProposedChangesLink({ password, always }: { password: string; always: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/admin/proposals/count`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { open?: number } | null) => {
        if (live) setOpen(typeof d?.open === "number" ? d.open : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [password]);
  if (open === null || (!always && open === 0)) return null;
  return (
    <Link
      href="/admin/proposals"
      className="mb-4 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2 font-medium text-foreground shadow-sm hover:border-notice"
      data-testid="proposed-changes-link"
    >
      <span>
        <Trans context="proposed changes">Proposed changes</Trans>
      </span>
      <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm font-semibold text-muted-foreground">
        {open === 0 ? <Trans context="proposed changes">None waiting</Trans> : <Trans context="proposed changes">{open} waiting</Trans>}
      </span>
    </Link>
  );
}
