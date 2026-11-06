/**
 * SUGGEST A CHANGE TO THIS MODULE'S DIALS, beside the dials.
 *
 * Rye, 2026-09-25: "the community can always from day one be able to suggest
 * upgrades and changes to all the dials". A member reads each dial this module
 * owns that the village may move (the open ring; `dialKeys` on the catalog)
 * with its value now, and can suggest a new value with a reason. The
 * suggestion is the ordinary mechanics proposal (`POST
 * /api/game/mechanics/proposals` with one `{key, to}` change), the same door
 * Game Mechanics has always used; the server checks the value, the ring and the
 * cooldown, and its words come back here on a refusal.
 *
 * A steward sees the dials themselves in the steward panel and changes them
 * there; this section is for everybody else who is signed in.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { SlidersHorizontal } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { proposalHref } from "./switchModules";

interface PublicDial {
  key: string;
  label: string;
  description: string;
  type: string;
  unit: string | null;
  choices: { value: string; label: string }[] | null;
  value: string;
  withheld?: boolean;
}

const shown = (d: PublicDial, raw: string) => {
  if (d.type === "boolean") return raw === "true" || raw === "1" ? "On" : "Off";
  const choice = d.choices?.find((c) => c.value === raw)?.label;
  if (choice) return choice;
  return d.unit ? `${raw} ${d.unit}` : raw;
};

function SuggestOne({ d }: { d: PublicDial }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(d.value);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/game/mechanics/proposals", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken() ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Change ${d.label}`, rationale: reason.trim(), changes: [{ key: d.key, to: to.trim() }] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const problems = Array.isArray(body?.problems) ? body.problems.map((p: any) => String(p?.problem ?? "")).filter(Boolean) : [];
        setError(problems.length ? problems.join(". ") : String(body?.message || body?.error || "The suggestion was refused."));
      } else setSent(String(body.id));
    } catch {
      setError("That did not go through. Try again in a moment.");
    }
    setBusy(false);
  };

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{d.label}</p>
        <p className="text-sm text-muted-foreground">{d.withheld ? "Set by the village" : shown(d, d.value)}</p>
      </div>
      {sent ? (
        <p className="mt-1 text-sm">
          Suggested.{" "}
          <Link href={proposalHref(sent)} className="text-teal-deep underline">See your proposal</Link>
        </p>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-1 min-h-[44px] text-sm font-medium text-teal-deep underline">
          Suggest a change
        </button>
      ) : (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <p className="text-sm text-muted-foreground">{d.description}</p>
          <label className="block text-sm font-medium text-foreground">
            New value
            {d.type === "boolean" || d.choices?.length ? (
              <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-background px-2 text-base">
                {(d.type === "boolean" ? [{ value: "true", label: "On" }, { value: "false", label: "Off" }] : d.choices ?? []).map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            ) : (
              <input value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-background px-2 text-base" />
            )}
          </label>
          <label className="block text-sm font-medium text-foreground">
            Why
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={2000} className="mt-1 block w-full rounded-lg border border-border bg-background p-2 text-base" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || reason.trim().length < 10 || to.trim() === d.value} className="min-h-[44px] px-4 rounded-lg bg-teal-deep text-white text-sm font-semibold disabled:opacity-40">
              {busy ? "Sending…" : "Suggest it"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] px-4 rounded-lg border border-border text-sm font-medium">
              Not now
            </button>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </form>
      )}
    </li>
  );
}

export default function SuggestDial({ dialKeys }: { dialKeys: string[] }) {
  const [dials, setDials] = useState<PublicDial[] | null>(null);
  const wanted = dialKeys.join(",");
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    fetch("/api/game/mechanics")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const keys = new Set(wanted.split(","));
        setDials((Array.isArray(d.variables) ? d.variables : []).filter((v: PublicDial) => keys.has(v.key)));
      })
      .catch(() => {
        /* no section on a failed read */
      });
    return () => {
      alive = false;
    };
  }, [wanted]);

  if (!dials || dials.length === 0) return null;
  return (
    <section aria-labelledby="suggest-dials" className="mt-8">
      <h2 id="suggest-dials" className="flex items-center gap-2 font-semibold text-foreground">
        <SlidersHorizontal className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        Its settings
      </h2>
      <p className="text-sm text-muted-foreground mt-1 mb-3">Anyone here can suggest a change. The village decides.</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {dials.map((d) => (
          <SuggestOne key={d.key} d={d} />
        ))}
      </ul>
    </section>
  );
}
