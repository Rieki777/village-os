/**
 * "Carry people across": step four of a structure change, once it is live.
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────────
 *
 * Every person still seated on the old chart, one row each: their first name,
 * the old seat and circle, a suggested seat on the new chart when there is
 * one, and a picker of the new chart's seats with "Keep this seat for now".
 * The list comes from shared/carryAcross.ts through the structure read.
 *
 * A suggestion is only ever a suggestion. It is marked "Suggested" with its
 * reason, and nothing moves until somebody presses the row's button. "Confirm
 * all suggested" moves only the rows on screen whose picker still holds the
 * suggestion, and only after an in-page confirm that lists each one.
 *
 * Each move is one request and one transaction on the server: the person is
 * seated in the new seat with the season's term, and the old seating ends.
 *
 * ── RETIRING THE OLD CHART ───────────────────────────────────────────────
 *
 * Once an old seat has nobody in it, "Retire the empty old chart" previews
 * one draft that rests every empty old seat and every old circle left with
 * nothing in it, bottom up. Seats somebody still holds are listed as still
 * held and are never in it. The draft publishes through the same publish
 * route and the same confirm as the structure draft.
 *
 * ── WHO MAY ACT ──────────────────────────────────────────────────────────
 *
 * Moving people follows `org.seat`, the seating door's power. A member without
 * it reads the list and is told who holds it.
 */
import { useMemo, useState } from "react";
import type { CarryPlan, CarryRow } from "@shared/carryAcross";

export interface CarryAnswer extends CarryPlan {
  draftId: string;
  retireDraft: {
    id: string;
    status: "open" | "published";
    reads: string[];
    blocked: number;
    blockedLines: Array<{ reads: string; blocked: string }>;
  } | null;
  mayCarry: boolean;
  whoCarries: string[];
  mayRetire: boolean;
  mayPublishRetire: boolean;
}

const card = "rounded-2xl border border-border bg-card text-card-foreground";
const pillBase = "text-[11px] font-bold tracking-wide uppercase rounded-full px-2.5 py-0.5 border whitespace-nowrap";
const primary =
  "rounded-full border border-notice bg-notice text-background px-4 py-2.5 min-h-[44px] font-semibold text-sm disabled:opacity-45 disabled:cursor-not-allowed";
const secondary =
  "rounded-full border border-border bg-muted px-4 py-2.5 min-h-[44px] font-semibold text-sm disabled:opacity-45 disabled:cursor-not-allowed";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const KEEP = "keep";
const WHY = { "same-name": "Same name", "similar-name": "Similar name" } as const;

/** "Ana and Rye", "Ana, Bo and Rye". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Where the carry step stands, in one sentence. */
export function carrySummary(carry: CarryAnswer): string {
  const n = carry.rows.length;
  if (n > 0) return `${plural(n, "person still sits", "people still sit")} on the old chart.`;
  if (carry.retireDraft?.status === "published") return "Everyone is on the new chart, and the old chart is retired.";
  if (carry.retireDraft?.status === "open") return "Everyone is on the new chart. The retire draft is waiting to publish.";
  if (carry.retire.seats.length + carry.retire.circles.length > 0) return "Everyone is on the new chart. The empty old chart is ready to retire.";
  return "Everyone is on the new chart, and nothing on the old chart is left to retire.";
}

/** The carry step is finished: nobody left to move and nothing left to retire. */
export function carryDone(carry: CarryAnswer): boolean {
  if (carry.rows.length > 0) return false;
  if (carry.retireDraft?.status === "open") return false;
  return carry.retireDraft?.status === "published" || carry.retire.seats.length + carry.retire.circles.length === 0;
}

export default function CarryAcross({
  carry,
  batchId,
  headers,
  onChanged,
}: {
  carry: CarryAnswer;
  batchId: string;
  headers: () => Record<string, string>;
  /** Read the batch again after an action, with a sentence to show. */
  onChanged: (notice: string) => void;
}) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [retirePreview, setRetirePreview] = useState<{ reads: string[]; blocked: number } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const base = `/api/review/batches/${encodeURIComponent(batchId)}/structure/carry`;
  const pickOf = (r: CarryRow): string => picks[r.seatingId] ?? r.suggestion?.seatId ?? "";
  const seatName = new Map(carry.newSeats.map((s) => [s.id, s.name]));
  const suggestedRows = carry.rows.filter((r) => r.suggestion && pickOf(r) === r.suggestion.seatId);
  const toRetire = carry.retire.seats.length + carry.retire.circles.length;

  const groups = useMemo(() => {
    const m = new Map<string, typeof carry.newSeats>();
    for (const s of carry.newSeats) {
      const k = s.circleName ?? "Not in a circle";
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return Array.from(m.entries());
  }, [carry.newSeats]);

  const post = async (url: string, body: unknown): Promise<{ ok: boolean; body: any }> => {
    const r = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    return { ok: r.ok, body: await r.json().catch(() => ({})) };
  };

  /** One person, one request. Returns the server's refusal, or null. */
  const moveOne = async (r: CarryRow, toSeatId: string): Promise<string | null> => {
    const res = await post(`${base}/move`, { seatingId: r.seatingId, toSeatId });
    return res.ok ? null : String(res.body?.error ?? `${r.person} was not moved.`);
  };

  const confirmRow = async (r: CarryRow) => {
    const to = pickOf(r);
    if (!to || to === KEEP) return;
    setBusy(r.seatingId);
    setFailure(null);
    try {
      const refused = await moveOne(r, to);
      if (refused) return setFailure(refused);
      onChanged(`${r.person} now sits in ${seatName.get(to) ?? "the new seat"}. Their old seat is ended, and its history is kept.`);
    } catch {
      setFailure("The server could not be reached. Nobody was moved.");
    } finally {
      setBusy(null);
    }
  };

  const confirmSuggested = async () => {
    const rows = suggestedRows;
    setBusy("all");
    setFailure(null);
    let moved = 0;
    const refused: string[] = [];
    try {
      for (const r of rows) {
        const why = await moveOne(r, r.suggestion!.seatId);
        if (why) refused.push(`${r.person}: ${why}`);
        else moved += 1;
      }
    } catch {
      refused.push("The server could not be reached.");
    } finally {
      setBusy(null);
      setConfirmAll(false);
    }
    if (refused.length) setFailure(refused.join(" "));
    onChanged(`${plural(moved, "person moved", "people moved")} to their new seat.${refused.length ? ` ${plural(refused.length, "move", "moves")} did not go through.` : ""}`);
  };

  const previewRetire = async () => {
    setBusy("retire");
    setFailure(null);
    try {
      const r = await post(`${base}/retire`, { dryRun: true });
      if (!r.ok) return setFailure(String(r.body?.error ?? "The preview did not load."));
      setRetirePreview({ reads: r.body?.reads ?? [], blocked: Number(r.body?.blocked ?? 0) });
    } catch {
      setFailure("The server could not be reached.");
    } finally {
      setBusy(null);
    }
  };

  const writeRetire = async () => {
    setBusy("retire");
    setFailure(null);
    try {
      const r = await post(`${base}/retire`, {});
      if (!r.ok) return setFailure(String(r.body?.error ?? "The retire draft was not made."));
      setRetirePreview(null);
      onChanged("The retire draft is ready. Nothing is retired until it is published.");
    } catch {
      setFailure("The server could not be reached. No draft was made.");
    } finally {
      setBusy(null);
    }
  };

  const publishRetire = async () => {
    if (!carry.retireDraft) return;
    setBusy("publish");
    setFailure(null);
    try {
      const r = await post(`/api/admin/org/drafts/${encodeURIComponent(carry.retireDraft.id)}/publish`, {});
      if (!r.ok) return setFailure(String(r.body?.error ?? "The draft did not publish. Nothing changed."));
      setConfirmPublish(false);
      onChanged("Published. The empty old chart is retired, and its history is kept.");
    } catch {
      setFailure("The server could not be reached. Nothing was published.");
    } finally {
      setBusy(null);
    }
  };

  const withdrawRetire = async () => {
    if (!carry.retireDraft) return;
    setBusy("withdraw");
    setFailure(null);
    try {
      const r = await post(`/api/review/drafts/${encodeURIComponent(carry.retireDraft.id)}/withdraw`, {});
      if (!r.ok) return setFailure(String(r.body?.error ?? "The draft was not withdrawn."));
      onChanged("Withdrawn. Nothing on the old chart was retired.");
    } catch {
      setFailure("The server could not be reached. The draft is still open.");
    } finally {
      setBusy(null);
    }
  };

  const who = carry.whoCarries.length
    ? `Moving people is for ${nameList(carry.whoCarries)}, who ${carry.whoCarries.length === 1 ? "holds" : "hold"} the power to seat people.`
    : "Moving people is for whoever holds the power to seat people. Ask an admin of this village who that is.";

  return (
    <section id="carry" className="grid gap-3 scroll-mt-4" aria-labelledby="h-carry" data-testid="carry-across">
      <h2 id="h-carry" className="font-display text-[22px]">Carry people across</h2>
      <p className="text-base font-semibold" role="status" data-testid="carry-state">{carrySummary(carry)}</p>
      {carry.rows.length > 0 && (
        <p className="text-sm text-muted-foreground max-w-[68ch]">
          Pick each person&apos;s seat on the new chart and confirm it. They get the new seat until the season ends, and their old
          seat ends with its history kept.
        </p>
      )}
      {carry.kept.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="carry-kept">
          {plural(carry.kept.length, "person kept their seat", "people kept their seat")} when it moved into the new chart, so they need nothing.
        </p>
      )}
      {!carry.mayCarry && carry.rows.length > 0 && (
        <p className={`${card} px-4 py-3 text-sm`} data-testid="carry-read-only">
          You can read this list. {who}
        </p>
      )}

      {carry.mayCarry && suggestedRows.length > 0 && !confirmAll && (
        <button type="button" className={`${secondary} justify-self-start`} disabled={busy !== null} onClick={() => setConfirmAll(true)}>
          Confirm all suggested ({suggestedRows.length})
        </button>
      )}
      {confirmAll && (
        <div className={`${card} p-3.5 grid gap-2.5 border-notice/60`} role="group" aria-labelledby="h-carry-all" data-testid="carry-confirm-all">
          <p id="h-carry-all" className="font-semibold">
            Move {plural(suggestedRows.length, "person", "people")} to their suggested seat?
          </p>
          <ul className="text-sm grid gap-1">
            {suggestedRows.map((r) => (
              <li key={r.seatingId}>
                <b>{r.person}</b>: {r.oldSeatName} to {r.suggestion!.seatName}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" className={primary} disabled={busy !== null} onClick={() => void confirmSuggested()}>
              {busy === "all" ? "Moving" : `Yes, move ${plural(suggestedRows.length, "person", "people")}`}
            </button>
            <button type="button" className={secondary} disabled={busy !== null} onClick={() => setConfirmAll(false)}>
              Not yet
            </button>
          </div>
        </div>
      )}
      {failure && <p className="text-sm text-destructive" role="alert">{failure}</p>}

      {carry.rows.length > 0 && (
        <ul className={card} aria-label="People on the old chart">
          {carry.rows.map((r) => {
            const pick = pickOf(r);
            const suggested = !!r.suggestion && pick === r.suggestion.seatId;
            return (
              <li
                key={r.seatingId}
                data-testid={`carry-row-${r.seatingId}`}
                className="px-4 py-3.5 border-b border-border last:border-b-0 grid gap-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-center"
              >
                <div className="min-w-0 grid gap-0.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <b className="font-semibold">{r.person}</b>
                    {suggested && (
                      <span className={`${pillBase} text-notice border-current`} data-testid="suggested">
                        Suggested · {WHY[r.suggestion!.why]}
                      </span>
                    )}
                    {!suggested && pick && pick !== KEEP && <span className={`${pillBase} text-open border-current`}>Your pick</span>}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Old seat: {r.oldSeatName}
                    {r.oldCircleName ? ` · ${r.oldCircleName}` : ""}
                  </p>
                  {!r.suggestion && <p className="text-[13px] text-muted-foreground">No seat on the new chart has a name like it. Pick one.</p>}
                </div>
                {carry.mayCarry ? (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] items-center min-w-0">
                    <select
                      aria-label={`New seat for ${r.person}`}
                      value={pick}
                      disabled={busy !== null}
                      onChange={(e) => setPicks((p) => ({ ...p, [r.seatingId]: e.target.value }))}
                      className="min-h-[44px] w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm"
                    >
                      <option value="">Choose a seat</option>
                      {groups.map(([circle, seats]) => (
                        <optgroup key={circle} label={circle}>
                          {seats.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      <option value={KEEP}>Keep this seat for now</option>
                    </select>
                    <button
                      type="button"
                      className={primary}
                      disabled={busy !== null || !pick || pick === KEEP}
                      onClick={() => void confirmRow(r)}
                    >
                      {busy === r.seatingId ? "Moving" : `Move ${r.person}`}
                    </button>
                    {pick === KEEP && (
                      <p className="text-[13px] text-muted-foreground sm:col-span-2">
                        {r.person} stays in {r.oldSeatName} for now. A seat somebody holds is never retired.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    {r.suggestion ? `Suggested: ${r.suggestion.seatName}` : "No suggestion yet"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {carry.retire.stillHeld.length > 0 && toRetire > 0 && (
        <div className="grid gap-1.5" data-testid="carry-still-held">
          <h3 className="font-display text-[17px]">Still held</h3>
          <p className="text-[13px] text-muted-foreground">These old seats stay until their people have a seat on the new chart.</p>
          <ul className="text-sm grid gap-0.5">
            {carry.retire.stillHeld.map((s) => (
              <li key={s.id}>
                {s.name} <span className="text-muted-foreground">· {plural(s.holders, "person", "people")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toRetire > 0 && !carry.retireDraft && (
        <div className={`${card} p-4 grid gap-2.5`} data-testid="carry-retire">
          <h3 className="font-display text-[17px]">Retire the empty old chart</h3>
          <p className="text-sm text-muted-foreground">
            {plural(carry.retire.seats.length, "old seat has", "old seats have")} nobody in it
            {carry.retire.circles.length ? `, and ${plural(carry.retire.circles.length, "old circle is", "old circles are")} left empty` : ""}.
            Retiring rests them, keeps their history, and never unseats anybody.
          </p>
          {retirePreview ? (
            <>
              <ol className="text-sm grid gap-1 list-decimal pl-5" data-testid="carry-retire-preview">
                {retirePreview.reads.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2.5">
                <button type="button" className={primary} disabled={busy !== null || retirePreview.blocked > 0} onClick={() => void writeRetire()}>
                  {busy === "retire" ? "Saving" : "Put it in a draft"}
                </button>
                <button type="button" className={secondary} disabled={busy !== null} onClick={() => setRetirePreview(null)}>
                  Not yet
                </button>
              </div>
            </>
          ) : carry.mayRetire ? (
            <button type="button" className={`${secondary} justify-self-start`} disabled={busy !== null} onClick={() => void previewRetire()}>
              {busy === "retire" ? "Reading" : "Retire the empty old chart"}
            </button>
          ) : (
            <p className="text-[13px] text-muted-foreground">A steward who works the review queue can put this in a draft.</p>
          )}
        </div>
      )}

      {carry.retireDraft?.status === "open" && (
        <div className={`${card} p-4 grid gap-2.5`} data-testid="carry-retire-draft">
          <h3 className="font-display text-[17px]">The retire draft</h3>
          <p className="text-sm font-semibold">
            Nothing is retired yet. {plural(carry.retireDraft.reads.length, "change", "changes")},{" "}
            {carry.retireDraft.blocked ? `${carry.retireDraft.blocked} blocked` : "none blocked"}.
          </p>
          <ol className="text-sm grid gap-1 list-decimal pl-5">
            {carry.retireDraft.reads.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
          {carry.retireDraft.blockedLines.length > 0 && (
            <ul className="text-sm grid gap-1">
              {carry.retireDraft.blockedLines.map((l, i) => (
                <li key={i}>
                  {l.reads}
                  <span className="block text-destructive">{l.blocked}</span>
                </li>
              ))}
            </ul>
          )}
          {confirmPublish ? (
            <div className={`${card} p-3.5 grid gap-2.5 border-notice/60`} role="group" aria-labelledby="h-retire-confirm" data-testid="carry-publish-confirm">
              <p id="h-retire-confirm" className="font-semibold">Publish the retire draft?</p>
              <p className="text-sm text-muted-foreground">
                This rests {plural(carry.retireDraft.reads.length, "seat or circle", "seats and circles")} at once, as one change. Nobody is unseated.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <button type="button" className={primary} disabled={busy !== null} onClick={() => void publishRetire()}>
                  {busy === "publish" ? "Publishing" : "Yes, publish it now"}
                </button>
                <button type="button" className={secondary} disabled={busy !== null} onClick={() => setConfirmPublish(false)}>
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              {carry.mayPublishRetire && (
                <button type="button" className={primary} disabled={busy !== null || carry.retireDraft.blocked > 0} onClick={() => setConfirmPublish(true)}>
                  Publish to the live chart
                </button>
              )}
              {carry.mayRetire && (
                <button type="button" className={secondary} disabled={busy !== null} onClick={() => void withdrawRetire()}>
                  {busy === "withdraw" ? "Withdrawing" : "Withdraw the draft"}
                </button>
              )}
            </div>
          )}
          {!carry.mayPublishRetire && (
            <p className="text-[13px] text-muted-foreground">Publishing changes the live chart, so an admin of this village does it.</p>
          )}
        </div>
      )}
    </section>
  );
}
