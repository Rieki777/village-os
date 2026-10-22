/**
 * "Your draft": what /review/structure/:batchId shows once the batch has been
 * accepted. Read from the draft itself (`draft` on the structure read), never
 * from the waiting proposals, which after an accept are only the leftovers.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────
 *
 * On 2026-10-20 the founder accepted a batch into a draft and the page went on
 * to show an empty batch: no word about the draft, where it was, or what to do
 * with it, and no screen anywhere that published a draft the queue made. This
 * view says what the draft holds, runs its preview ("Nothing is live yet. 36
 * changes, none blocked."), and puts the next step on the page as buttons:
 *
 *   Publish to the live chart   only for a viewer a publish route admits
 *                               (`mayPublish`), through the door the read
 *                               names (`publishDoor`: a holder of
 *                               `org.decide` publishes by power, an admin
 *                               before launch through the admin panel's),
 *                               behind a confirm that names what goes live;
 *   Withdraw the draft          the review queue's withdraw, which sends the
 *                               proposals back to the queue, for whoever
 *                               keeps the queue (`mayModerate`).
 *
 * A viewer who may not publish is told who can. Once published it says so,
 * with the way to the living map and the seats, and moves on to step four:
 * carrying the people on the old chart across (CarryAcross.tsx).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import StructureMap, { StructureMapList } from "@/components/review/StructureMap";
import StructureSteps from "@/components/review/StructureSteps";
import CarryAcross, { carryDone, carrySummary, type CarryAnswer } from "@/components/review/CarryAcross";
import { RoleFieldChanges } from "@/components/review/RoleFieldChanges";
import { structureMapModel, type MapView } from "@/lib/structureMapModel";
import { decideStructure, type PlanSeat, type StructureDecisions, type StructurePlan } from "@shared/structurePlan";
import { stayedBehind, type DraftCounts } from "@shared/structureDraft";

export interface DraftAnswer {
  id: string;
  title: string;
  status: "open" | "published" | "reverted" | "withdrawn";
  publishedAt: string | null;
  counts: DraftCounts;
  plan: StructurePlan;
  decisions: StructureDecisions;
  preview: { lines: number; blocked: number; blockedLines: Array<{ reads: string; blocked: string }> } | null;
}

const card = "rounded-2xl border border-border bg-card text-card-foreground";
const pillBase = "text-[11px] font-bold tracking-wide uppercase rounded-full px-2.5 py-0.5 border whitespace-nowrap";
const primary =
  "rounded-full border border-notice bg-notice text-background px-4 py-2.5 min-h-[44px] font-semibold text-sm disabled:opacity-45 disabled:cursor-not-allowed";
const secondary =
  "rounded-full border border-border bg-muted px-4 py-2.5 min-h-[44px] font-semibold text-sm disabled:opacity-45 disabled:cursor-not-allowed";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** What a draft makes, in one phrase: "7 new circles, 26 new seats and 3 moved seats". */
export function draftPhrase(c: DraftCounts): string {
  const parts = [
    c.circles ? plural(c.circles, "new circle", "new circles") : null,
    c.seats ? plural(c.seats, "new role", "new roles") : null,
    c.moves ? plural(c.moves, "moved role", "moved roles") : null,
    c.retiring ? plural(c.retiring, "retirement", "retirements") : null,
  ].filter((p): p is string => !!p);
  if (!parts.length) return plural(c.changes, "change", "changes");
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const VIEWS: Array<{ id: MapView; label: string }> = [
  { id: "after", label: "After" },
  { id: "changes", label: "What changes" },
  { id: "before", label: "Before" },
];

export default function StructureDraft({
  draft,
  plan,
  waiting,
  source,
  mayPublish,
  publishDoor = "admin",
  mayModerate = true,
  headers,
  onChanged,
  onReviewRest,
  carry = null,
  batchId = "",
}: {
  draft: DraftAnswer;
  /** Who still sits on the old chart, once the draft is live. Null from an older server. */
  carry?: CarryAnswer | null;
  batchId?: string;
  /** What still waits in the batch, read as a plan, or null when nothing does. */
  plan: StructurePlan | null;
  /** How many proposals still wait in the batch. */
  waiting: number;
  source: string;
  mayPublish: boolean;
  /** Which publish route admits this viewer. An older server sends none, and its only door was the admin panel's. */
  publishDoor?: "power" | "admin";
  /** Whether this viewer keeps the review queue, which is what withdrawing asks. An older server sends none. */
  mayModerate?: boolean;
  headers: () => Record<string, string>;
  /** Read the batch again after a publish or a withdraw, with a sentence to show. */
  onChanged: (notice: string) => void;
  /** Offered when proposals in the batch still wait for a decision. */
  onReviewRest?: () => void;
}) {
  const [view, setView] = useState<MapView>("after");
  const [asList, setAsList] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"publish" | "withdraw" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const decided = useMemo(() => decideStructure(draft.plan, draft.decisions), [draft]);
  const model = useMemo(() => structureMapModel(draft.plan, decided, draft.decisions, view), [draft, decided, view]);

  const live = draft.status === "published";
  const counts = draft.counts;
  const what = draftPhrase(counts);
  const blocked = draft.preview?.blocked ?? 0;
  const behind = stayedBehind(plan, waiting, source);

  const liveCircleName = new Map(draft.plan.live.circles.map((c) => [c.id, c.name]));
  const newCircleName = new Map(draft.plan.circles.map((c) => [c.id, c.name]));
  const circleName = (id: string | null) => (id ? newCircleName.get(id) ?? liveCircleName.get(id) ?? id : "the village");

  const send = async (url: string): Promise<{ ok: boolean; body: any }> => {
    const r = await fetch(url, { method: "POST", headers: headers(), body: "{}" });
    return { ok: r.ok, body: await r.json().catch(() => ({})) };
  };

  const publish = async () => {
    setBusy("publish");
    setFailure(null);
    try {
      const id = encodeURIComponent(draft.id);
      const r = await send(publishDoor === "power" ? `/api/org/drafts/${id}/publish-by-power` : `/api/admin/org/drafts/${id}/publish`);
      if (!r.ok) {
        setFailure(String(r.body?.message ?? r.body?.error ?? "The draft did not publish. Nothing changed."));
        return;
      }
      setConfirming(false);
      onChanged(
        r.body?.reloaded === false
          ? "Published. The map is still catching up, so reload in a moment to see the new shape."
          : "Published. The new structure is the live chart now.",
      );
    } catch {
      setFailure("The server could not be reached. Nothing was published.");
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async () => {
    setBusy("withdraw");
    setFailure(null);
    try {
      const r = await send(`/api/review/drafts/${encodeURIComponent(draft.id)}/withdraw`);
      if (!r.ok) {
        setFailure(String(r.body?.error ?? "The draft was not withdrawn."));
        return;
      }
      const n = Number(r.body?.reopened ?? 0);
      onChanged(`Withdrawn. ${n === 1 ? "Its proposal is" : `${n} proposals are`} back in the queue, ready to review again.`);
    } catch {
      setFailure("The server could not be reached. The draft is still open.");
    } finally {
      setBusy(null);
    }
  };

  const action = live ? (
    <>
      {carry && (
        <p className="text-sm" data-testid="carry-step-summary">
          {carrySummary(carry)}{" "}
          {!carryDone(carry) && (
            <a href="#carry" className="underline">
              Go to the list
            </a>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
        <Link href="/map" className={primary + " inline-flex items-center"}>See the living map</Link>
        <Link href="/roles" className={secondary + " inline-flex items-center"}>See every role</Link>
      </div>
    </>
  ) : confirming ? (
    <div className={`${card} p-3.5 grid gap-2.5 border-notice/60`} role="group" aria-labelledby="h-confirm" data-testid="publish-confirm">
      <p id="h-confirm" className="font-semibold">Publish this draft to the live chart?</p>
      <p className="text-sm text-muted-foreground">
        This puts {what} on the live chart at once, as one change. People keep their roles, and nobody is unseated.
      </p>
      <div className="flex flex-wrap gap-2.5">
        <button type="button" className={primary} disabled={busy !== null} onClick={() => void publish()}>
          {busy === "publish" ? "Publishing" : "Yes, publish it now"}
        </button>
        <button type="button" className={secondary} disabled={busy !== null} onClick={() => setConfirming(false)}>
          Not yet
        </button>
      </div>
    </div>
  ) : (
    <>
      <div className="flex flex-wrap gap-2.5">
        {mayPublish && (
          <button type="button" className={primary} disabled={busy !== null || blocked > 0} onClick={() => setConfirming(true)}>
            Publish to the live chart
          </button>
        )}
        {mayModerate && (
          <button type="button" className={secondary} disabled={busy !== null} onClick={() => void withdraw()}>
            {busy === "withdraw" ? "Withdrawing" : "Withdraw the draft"}
          </button>
        )}
      </div>
      {mayPublish && blocked > 0 && (
        <p className="text-[13px] text-muted-foreground">Publishing waits until no line is blocked. Withdraw it to change what it holds.</p>
      )}
      {!mayPublish && (
        <p className="text-[13px] text-muted-foreground" data-testid="who-publishes">
          Publishing changes the live chart, so whoever holds the power to change the village's structure does it. Ask one of them to open this page and publish it.
        </p>
      )}
    </>
  );

  // The draft's seats under the circle they would sit in, read only.
  const groups: Array<{ key: string; name: string; meta: string; seats: PlanSeat[] }> = [];
  for (const c of draft.plan.circles) {
    groups.push({
      key: `c-${c.key}`,
      name: c.name,
      meta: [c.parentId ? `Inside ${circleName(c.parentId)}` : null, "New circle"].filter(Boolean).join(" · "),
      seats: draft.plan.seats.filter((s) => s.circleId === c.id),
    });
  }
  const placed = new Set(groups.flatMap((g) => g.seats.map((s) => s.key)));
  const byLive = new Map<string, PlanSeat[]>();
  const loose: PlanSeat[] = [];
  for (const s of draft.plan.seats) {
    if (placed.has(s.key)) continue;
    if (s.circleId) byLive.set(s.circleId, [...(byLive.get(s.circleId) ?? []), s]);
    else loose.push(s);
  }
  for (const [id, seats] of Array.from(byLive.entries())) {
    groups.push({ key: `l-${id}`, name: circleName(id), meta: "A circle this village already has", seats });
  }
  if (loose.length) groups.push({ key: "loose", name: "Not placed in a circle", meta: "", seats: loose });

  const jump = (rowKey: string) => {
    setHighlight(rowKey);
    document.getElementById(`draft-row-${rowKey}`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  return (
    <div className="grid gap-6" data-testid="your-draft">
      <header className="grid gap-2.5">
        <h1 className="font-display text-[clamp(28px,4vw,40px)] leading-tight">{live ? "Your draft is live" : "Your draft"}</h1>
        <p className="text-muted-foreground max-w-[68ch]">{draft.title}</p>
        <p className="text-base font-semibold" role="status" data-testid="draft-state">
          {live
            ? `Published. The live chart now holds ${what}.`
            : blocked
              ? `Nothing is live yet. ${plural(counts.changes, "change", "changes")}, ${blocked} blocked. Each one says why below.`
              : `Nothing is live yet. ${plural(counts.changes, "change", "changes")}, none blocked.`}
        </p>
        {behind && (
          <p className="text-sm text-muted-foreground" data-testid="stayed-behind">
            {behind}{" "}
            {(plan?.archived ?? []).length > 0 && (
              <a href="#draft-archived" className="underline" onClick={() => {
                const d = document.getElementById("draft-archived") as HTMLDetailsElement | null;
                if (d) d.open = true;
              }}>
                See the list
              </a>
            )}
          </p>
        )}
        {onReviewRest && (
          <button type="button" className={`${secondary} justify-self-start`} onClick={onReviewRest}>
            Review what is still waiting
          </button>
        )}
      </header>

      <div className={`${card} flex flex-wrap`} role="list" aria-label="What this draft holds">
        {[
          { n: counts.circles, label: "New circles", tone: "text-open" },
          { n: counts.seats, label: "New roles", tone: "text-open" },
          { n: counts.moves, label: "Moved roles", tone: "text-notice" },
          ...(counts.retiring ? [{ n: counts.retiring, label: "Retiring", tone: "text-muted-foreground" }] : []),
        ].map((s, i) => (
          <div key={s.label} role="listitem" className={`flex-[1_1_130px] px-4 py-3.5 grid gap-0.5 ${i ? "border-l border-border" : ""}`}>
            <b className={`font-display font-normal text-[32px] leading-none tabular-nums ${s.tone}`} data-testid={`draft-count-${s.label}`}>
              {s.n}
            </b>
            <span className="text-[11px] tracking-[0.12em] uppercase text-muted-foreground font-semibold">{s.label}</span>
          </div>
        ))}
      </div>

      <StructureSteps
        stage={live ? (carry ? "carry" : "live") : "draft"}
        complete={!!carry && carryDone(carry)}
        source={source}
        action={action}
      />
      {failure && <p className="text-sm text-destructive" role="alert">{failure}</p>}

      {live && carry && <CarryAcross carry={carry} batchId={batchId} headers={headers} onChanged={onChanged} />}

      {!live && draft.preview && draft.preview.blockedLines.length > 0 && (
        <section className={`${card} p-4 grid gap-2`} aria-labelledby="h-blocked">
          <h2 id="h-blocked" className="font-display text-[22px]">What blocks it</h2>
          <ul className="text-sm grid gap-1">
            {draft.preview.blockedLines.map((l, i) => (
              <li key={i}>
                {l.reads}
                <span className="block text-destructive">{l.blocked}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!live && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
          <section className={`${card} p-4 grid gap-3 lg:sticky lg:top-3`} aria-labelledby="h-draft-map">
            <h2 id="h-draft-map" className="sr-only">The draft on the circle map</h2>
            <div className="inline-flex flex-wrap gap-0.5 rounded-full border border-border p-[3px] justify-self-start" role="group" aria-label="Map view">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === v.id}
                  onClick={() => setView(v.id)}
                  className={`rounded-full px-3.5 py-2 min-h-[40px] text-[13px] font-semibold ${
                    view === v.id ? "bg-muted text-foreground ring-1 ring-inset ring-ring" : "text-muted-foreground"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {asList ? (
              <StructureMapList model={model} onSeat={jump} />
            ) : (
              <StructureMap
                model={model}
                caption={
                  view === "after"
                    ? "The chart once this draft publishes."
                    : view === "before"
                      ? "The chart today."
                      : "Green is new, gold is a live role that moves, dashed is where it leaves or what retires."
                }
                highlight={highlight}
                onSeat={jump}
              />
            )}
            <button type="button" onClick={() => setAsList((v) => !v)} className="justify-self-end text-xs text-muted-foreground underline underline-offset-2 min-h-[32px]">
              {asList ? "Show the map" : "Show the map as a list"}
            </button>
          </section>

          <section className="grid gap-2.5" aria-labelledby="h-draft-list">
            <h2 id="h-draft-list" className="font-display text-[22px]">Everything in this draft</h2>
            <div className={card}>
              {groups.map((g) => (
                <div key={g.key} className="pt-1.5">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="font-display text-[17px]">{g.name}</h3>
                    <p className="text-xs text-muted-foreground">{[g.meta, plural(g.seats.length, "role", "roles")].filter(Boolean).join(" · ")}</p>
                  </div>
                  {g.seats.map((s) => (
                    <div
                      key={s.key}
                      id={`draft-row-${s.key}`}
                      onMouseEnter={() => setHighlight(s.key)}
                      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-start px-4 py-3 border-b border-border last:border-b-0 ${
                        highlight === s.key ? "bg-muted" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">{s.name || "A role with no name"}</p>
                        {s.aim && <p className="text-[13px] text-muted-foreground">{s.aim}</p>}
                        {s.match && (
                          <p className="text-[13px] text-muted-foreground">
                            Our existing role moves here from {circleName(s.match.circleId)}.{" "}
                            {s.match.holders ? `${plural(s.match.holders, "person keeps it", "people keep it")}.` : "Nobody holds it yet."}
                          </p>
                        )}
                        <RoleFieldChanges payload={s.payload} match={s.match} liveSeats={draft.plan.live.seats} />
                      </div>
                      {s.match ? (
                        <span className={`${pillBase} text-notice border-current`}>Moves here</span>
                      ) : (
                        <span className={`${pillBase} text-open border-current`}>New role</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {(plan?.archived ?? []).length > 0 && (
        <details id="draft-archived" className={`${card} px-4 py-3`} data-testid="draft-archived">
          <summary className="cursor-pointer min-h-[24px] text-sm text-muted-foreground">
            Archived in {source}, still in the queue · {plural(plan!.archived.length, "item", "items")}. None of it is in the draft.
          </summary>
          <ul className="grid gap-2 mt-2">
            {plan!.archived.map((a) => (
              <li key={a.key} className="text-[13px]">
                <span className="font-semibold">{a.name || (a.kind === "circle" ? "A circle with no name" : "A role with no name")}</span>
                <span className="text-muted-foreground">
                  {" "}· {a.kind === "circle" ? "Circle" : "Role"}
                  {a.liveMatch ? ` · This village still has ${a.kind === "circle" ? "a circle" : "a role"} called ${a.liveMatch}, and it stays as it is.` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Link href="/review" className="underline justify-self-start">Back to the review queue</Link>
    </div>
  );
}
