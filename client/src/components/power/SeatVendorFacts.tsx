/**
 * WHAT AN OUTSIDE SERVICE HOLDS ABOUT THIS SEAT, for the person deciding
 * whether to put their hand up for it.
 *
 * ── WHOSE WORDS THESE ARE ────────────────────────────────────────────────
 *
 * Every field below is the service's own, under its own name, and this village
 * interprets none of them. That is why the heading says whose they are instead
 * of saying "more". Our chart does not have more; it has different, and a
 * member reading "Energization Level: Partial" needs to know that is their
 * vocabulary and not ours.
 *
 * ── WHY IT IS OPEN TO EVERY MEMBER ───────────────────────────────────────
 *
 * Rye's reason, 2026-09-24: someone should be able to read what a role
 * actually involves before deciding whether to apply for it. So this sits
 * behind the module's own lifecycle and no capability. The detail carries no
 * person by construction, which is what makes that safe rather than generous.
 *
 * ── A REFUSAL IS NOT AN EMPTY SERVICE ────────────────────────────────────
 *
 * The same rule `SeatNeeds` states beside it. `null` is "no answer yet or none
 * to be had" and renders nothing. An empty list is a seat the service holds
 * nothing about, and also renders nothing. Printing "the service knows nothing
 * about this seat" for a reader who was refused the answer would be the page
 * stating a fact it does not have.
 *
 * ── THE DATE IS NOT DECORATION ───────────────────────────────────────────
 *
 * Vendor data goes stale silently, and the two systems will disagree. A panel
 * showing six fields and no date is the kind of surface people trust for a
 * month and then get burned by once, so when we last read it is shown beside
 * the fields rather than under a tooltip.
 */
import { useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";
import { useModuleOn } from "@/modules/ModuleProvider";

interface VendorFact {
  vendorRecordId: string;
  fields: Record<string, unknown>;
  sourceUrl: string | null;
  updatedAt: number;
}

/**
 * The fields worth reading before applying, in the order they help somebody
 * decide, and the ones that do not earn their place here.
 *
 * A seat's purpose and what it is accountable for come first because they
 * answer the question being asked. An audit date belongs to a steward doing an
 * audit; it is left out on purpose rather than forgotten, and anything the
 * service adds later shows after these in its own order.
 */
const FIRST = ["Role Name", "Body", "Circle", "Role Type", "Term Length", "Energization Level", "Assignment Method"];
const SKIP = new Set(["Last Audit Date", "Next Audit Date"]);

function ordered(fields: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  const add = (k: string) => {
    if (seen.has(k) || SKIP.has(k)) return;
    const v = fields[k];
    if (v === undefined || v === null) return;
    const text = Array.isArray(v) ? v.map(String).join(", ") : String(v);
    if (text.trim() === "") return;
    seen.add(k);
    out.push([k, text]);
  };
  for (const k of FIRST) add(k);
  for (const k of Object.keys(fields)) add(k);
  return out;
}

function whenRead(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
  if (days <= 0) return "Read today.";
  if (days === 1) return "Read yesterday.";
  return `Read ${days} days ago.`;
}

export default function SeatVendorFacts({
  entityKind,
  entityId,
  serviceName,
}: {
  entityKind: "org_role" | "circle";
  entityId: string;
  /** Whose words these are. The listing's name, never a guess. */
  serviceName: string;
}) {
  const on = useModuleOn("saberra");
  const [facts, setFacts] = useState<VendorFact[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!on || !open) return;
    let live = true;
    gameFetch(
      `/api/saberra/facts?kind=${encodeURIComponent(entityKind)}&id=${encodeURIComponent(entityId)}`,
    )
      .then(async (r) => {
        if (!r.ok) return null;
        const data = await r.json();
        return Array.isArray(data?.facts) ? (data.facts as VendorFact[]) : [];
      })
      .catch(() => null)
      .then((rows) => {
        if (live) setFacts(rows);
      });
    return () => {
      live = false;
    };
  }, [on, open, entityKind, entityId]);

  if (!on) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm underline underline-offset-2 min-h-[44px]"
      >
        See what {serviceName} holds
      </button>
    );
  }

  const rows = facts ?? [];
  if (facts === null || rows.length === 0) return null;

  return (
    <div className="space-y-3">
      {rows.map((fact) => {
        const pairs = ordered(fact.fields);
        if (pairs.length === 0) return null;
        return (
          <div key={fact.vendorRecordId} className="space-y-2">
            <p className="text-sm">
              These are {serviceName}'s own words about this seat. {whenRead(fact.updatedAt)}
            </p>
            <dl className="space-y-1">
              {pairs.map(([k, v]) => (
                <div key={k} className="flex flex-wrap gap-x-2">
                  <dt className="text-sm font-medium">{k}</dt>
                  <dd className="text-sm">{v}</dd>
                </div>
              ))}
            </dl>
            {fact.sourceUrl && (
              <a
                href={fact.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm underline underline-offset-2 inline-block min-h-[44px]"
              >
                Open this record in {serviceName}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
