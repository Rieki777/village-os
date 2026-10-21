/**
 * What the organisational memory service would receive from the journal, on
 * the module's own setup card. Read only, and nothing on it sends anything.
 *
 * ── WHAT AN ADMIN SEES, AND WHAT THEY NEVER DO ───────────────────────────
 *
 * The kind, the date, the code-name, the length and the status of each item,
 * and the counts. NEVER THE WORDS. The founder's rule is that inside the
 * village an entry is its author's alone and no admin reads it, and showing
 * the swapped text here would break that as surely as showing the original:
 * the swap removes names, and it leaves every sentence the member wrote. So
 * the server never sends the words to this screen
 * (`GET /api/saberra/outbox`, built in server/lib/saberraOutbox.ts from a
 * SELECT that does not name the payload), and this panel has nothing it could
 * show by mistake.
 *
 * ── NOTHING IS SENT YET ──────────────────────────────────────────────────
 *
 * The service has not named where journal entries land, so the outbox is a
 * record of what would cross. The panel says that first, before any number,
 * so a founder never reads "12 waiting" as "12 about to go".
 *
 * Light-only, by the founder's ruling on the admin workspace: fixed light
 * inks, the same zone as every panel in this directory
 * (scripts/check-tailwind-gray.mjs LIGHT_SURFACES).
 */
import { useCallback, useEffect, useState } from "react";
import type { OutboxKind, OutboxStatus, OutboxView } from "@shared/saberraBridge";
import { API_BASE, authHeaders, refusal } from "./adminApi";

const KIND_WORDS: Record<OutboxKind, string> = {
  journal_entry: "Journal entry",
  team_signal: "Team signal",
};

const STATUS_WORDS: Record<OutboxStatus, string> = {
  queued: "Waiting",
  sent: "Sent",
  failed: "Will try again",
  held: "Withdrawn",
};

const STATUS_INK: Record<OutboxStatus, string> = {
  queued: "bg-gray-100 text-gray-700",
  sent: "bg-emerald-50 text-emerald-800",
  failed: "bg-amber-50 text-amber-800",
  held: "bg-gray-50 text-gray-500",
};

/** "1 entry", "3 entries". */
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A read believed only in its own shape: counts, kinds and a list. */
function readable(d: unknown): d is OutboxView {
  const v = d as OutboxView | null;
  return (
    !!v &&
    typeof v === "object" &&
    !!v.counts &&
    typeof v.counts.queued === "number" &&
    !!v.byKind &&
    typeof v.pendingVendorDelete === "number" &&
    Array.isArray(v.items)
  );
}

export default function SaberraOutboxPanel({ password }: { password: string }) {
  const [view, setView] = useState<OutboxView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/saberra/outbox`, { headers: authHeaders(password) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setView(null);
        setProblem(refusal(d, "What would be sent could not be read."));
        return;
      }
      if (!readable(d)) {
        setView(null);
        setProblem("What would be sent came back in a shape this screen cannot read.");
        return;
      }
      setView(d);
      setProblem(null);
    } catch {
      setView(null);
      setProblem("What would be sent could not be read, because the request did not reach the server.");
    }
  }, [password]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="border-t border-gray-100 pt-4" aria-labelledby="saberra-outbox-heading">
      <h3 id="saberra-outbox-heading" className="font-semibold text-gray-900 mb-1">
        What Saberra would receive
      </h3>
      <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 mb-3">
        Nothing is sent until Saberra names where journal entries land. Until then this is a record of
        what would cross.
      </p>
      <p className="text-xs text-gray-500 mb-3">
        Journal entries cross under code-names, with every member name swapped for that member's
        code-name. Private entries and feedback never cross. A team signal crosses only when at least
        two members answered. You see the kind, the date, the code-name, the length and the status of
        each item, and never the words: an entry stays its author's alone.
      </p>

      {problem && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{problem}</p>}
      {!view && !problem && <p className="text-sm text-gray-500">Reading what would be sent…</p>}

      {view && (
        <>
          {!view.journalOn && (
            <p className="text-sm text-amber-800 mb-3">The journal module is off, so nothing is being queued.</p>
          )}
          <ul className="text-sm text-gray-700 space-y-1 mb-3" aria-label="Counts">
            <li>
              <span className="font-medium text-gray-900">Waiting: </span>
              {count(view.counts.queued, "item")}
              {view.counts.failed > 0 ? `, and ${count(view.counts.failed, "item")} to try again` : ""}.
            </li>
            <li>
              <span className="font-medium text-gray-900">Sent: </span>
              {count(view.counts.sent, "item")}.
            </li>
            <li>
              <span className="font-medium text-gray-900">Withdrawn: </span>
              {count(view.counts.held, "item")}, made private, deleted, or written by a member who left.
            </li>
            <li>
              <span className="font-medium text-gray-900">By kind: </span>
              {count(view.byKind.journal_entry, "journal entry", "journal entries")} and{" "}
              {count(view.byKind.team_signal, "team signal")}.
            </li>
            <li>
              <span className="font-medium text-gray-900">Members who left: </span>
              {view.pendingVendorDelete === 0
                ? "none waiting."
                : `${count(view.pendingVendorDelete, "code-name")} kept, marked pending.`}{" "}
              When a member leaves, their items here are cleared and their code-name waits for Saberra
              to confirm a delete. Saberra has no delete endpoint yet, so it stays pending.
            </li>
          </ul>

          {view.items.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing would cross yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <caption className="sr-only">The newest items, without their words</caption>
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th scope="col" className="py-2 pr-3 font-medium">Kind</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Code-name</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Length</th>
                    <th scope="col" className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {view.items.map((item) => (
                    <tr key={item.id} className="border-b border-gray-50 text-gray-700">
                      <td className="py-2 pr-3">{KIND_WORDS[item.kind] ?? item.kind}</td>
                      <td className="py-2 pr-3 tabular-nums">{item.period}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{item.codeName ?? "the team"}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {item.kind === "team_signal" ? "numbers only" : count(item.chars, "character")}
                      </td>
                      <td className="py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_INK[item.status] ?? STATUS_INK.queued}`}>
                          {STATUS_WORDS[item.status] ?? item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
