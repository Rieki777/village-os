/**
 * WHAT A BADGE MULTIPLIES, TOKEN BY TOKEN (0278).
 *
 * Rye, 2026-10-23: "badges that have multipliers should multiply token pay (the
 * multiplier is attached to a token, so voice, credits, etc)". Each badge row in
 * the Badges tab gets this: a factor per token, applied to what a holder is paid
 * in that token for a quest, a role each cycle and an accepted proposal. Blank
 * is no multiplier. The server judges every value again
 * (`badgeProblem`, server/lib/badges.ts) and this screen only says it early.
 *
 * The tokens offered are the ones this village pays work in (the pay options),
 * plus any the badge already names. Self and hypha badges carry no powers, so
 * they get no control. Its own file because client/src/pages/Admin.tsx is on a
 * line ratchet, and the badge definition row it sits in moved here with it
 * (`BadgeDefinitionRow`), so the Badges tab grew by one line, not twenty.
 * Light-only, like the rest of this folder.
 */
import { useState } from "react";
import { usePayOptions } from "@/components/WorkValueEditor";
import { ExampleChip } from "@/components/ExamplesBanner";

/** The most one badge may multiply a token by: `MAX_BADGE_MULTIPLIER`, server/lib/badges.ts. */
const MAX_FACTOR = 3;

interface BadgeLike {
  id: string;
  kind: string;
  isExample?: boolean;
  multiplier?: number | null;
  multipliers?: Record<string, number> | null;
}

export function multipliersWords(multipliers: Record<string, number> | null | undefined, nameOf: (slug: string) => string): string {
  const entries = Object.entries(multipliers ?? {});
  return entries.length ? `multiplies ${entries.map(([t, f]) => `${nameOf(t)} ×${f}`).join(", ")}` : "";
}

export default function BadgeMultipliersEditor({
  badge,
  call,
  onSaved,
}: {
  badge: BadgeLike;
  call: (path: string, body?: unknown, method?: string) => Promise<any>;
  onSaved: () => void;
}) {
  const options = usePayOptions();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  if (badge.kind === "self" || badge.kind === "hypha" || badge.isExample) return null;

  const stored = badge.multipliers ?? {};
  const offered = new Map<string, string>();
  for (const o of [...(options?.quest ?? []), ...(options?.role ?? [])]) offered.set(o.token, o.name);
  for (const t of Object.keys(stored)) if (!offered.has(t)) offered.set(t, t);
  const nameOf = (slug: string) => offered.get(slug) ?? slug;
  const shown = draft ?? Object.fromEntries(Object.entries(stored).map(([t, f]) => [t, String(f)]));

  const save = async () => {
    const out: Record<string, number> = {};
    for (const [token, text] of Object.entries(shown)) {
      const raw = String(text ?? "").trim();
      if (raw === "") continue;
      const f = Number(raw);
      if (!Number.isFinite(f) || f < 1 || f > MAX_FACTOR) {
        setError(`The multiplier on ${nameOf(token)} is a number from 1 to ${MAX_FACTOR}.`);
        return;
      }
      if (f !== 1) out[token] = f;
    }
    setError("");
    const d = await call(`/admin/badges/${badge.id}`, { multipliers: Object.keys(out).length ? out : null }, "PUT");
    if (d) {
      setDraft(null);
      setOpen(false);
      onSaved();
    }
  };

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs text-gray-500 hover:text-gray-900 min-h-[32px]">
        {open ? "Hide pay multipliers" : multipliersWords(stored, nameOf) || "Pay multipliers"}
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 rounded-lg border border-gray-100 px-3 py-2">
          <p className="text-xs text-gray-500">
            A holder is paid this many times the usual amount of each token, for quests, roles and accepted
            proposals. Blank is no multiplier.
          </p>
          {badge.multiplier != null && Object.keys(stored).length === 0 && (
            <p className="text-xs text-amber-800">
              This badge carries an older multiplier of ×{badge.multiplier} that names no token, so it multiplies
              nothing. Set it on a token below.
            </p>
          )}
          {offered.size === 0 ? (
            <p className="text-xs text-gray-500">This village pays work in no tokens yet, so there is nothing to multiply.</p>
          ) : (
            Array.from(offered.entries()).map(([token, name]) => (
              <label key={token} className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  inputMode="decimal"
                  value={shown[token] ?? ""}
                  onChange={(e) => setDraft({ ...shown, [token]: e.target.value })}
                  placeholder="1"
                  aria-label={`Multiplier on ${name}`}
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm"
                />
                <span>× {name}</span>
              </label>
            ))
          )}
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <button type="button" onClick={save} disabled={!draft} className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-40">
            Save multipliers
          </button>
        </div>
      )}
    </div>
  );
}

/** One badge definition in the Badges tab: its name, what it grants or denies, its multipliers, and the switch. */
export function BadgeDefinitionRow({
  badge: b,
  call,
  onSaved,
}: {
  badge: any;
  call: (path: string, body?: unknown, method?: string) => Promise<any>;
  onSaved: () => void;
}) {
  return (
    <div className={`border rounded-lg px-4 py-3 ${b.active ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-medium text-gray-900">
            {b.name} <span className="text-xs text-gray-400">({b.kind})</span>
            {b.isExample && <ExampleChip className="ml-2 align-middle" />}
          </p>
          <p className="text-xs text-gray-500">
            {b.kind === "earned" && b.rule ? `at ${b.rule.threshold} ${String(b.rule.metric).replace(/_/g, " ")}${b.rule.stackable ? ` · stacks ×${b.rule.maxStack}` : ""} · ` : ""}
            {(b.capabilities ?? []).length ? `grants ${b.capabilities.join(", ")} · ` : ""}
            {(b.denies ?? []).length ? `denies ${b.denies.join(", ")} · ` : ""}
            {b.description || "no description"}
          </p>
          <BadgeMultipliersEditor badge={b} call={call} onSaved={onSaved} />
        </div>
        <button
          onClick={async () => { const d = await call(`/admin/badges/${b.id}`, { active: !b.active }, "PUT"); if (d) onSaved(); }}
          className="text-xs text-gray-500 hover:text-gray-900"
        >
          {b.active ? "Deactivate" : "Reactivate"}
        </button>
      </div>
    </div>
  );
}
