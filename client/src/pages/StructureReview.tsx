/**
 * /review/structure/:batchId: one arrival from an outside service, read as a
 * change to this village's chart, and accepted with the steward's decisions.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────
 *
 * /review shows each proposal as its raw payload in a textarea, which is the
 * redaction path and stays. It cannot show a reorganisation. The first real
 * sync arrived as nineteen proposals and seventy-four changes, and the queue
 * could not drop one seat out of the structure, turn a seat that already exists
 * into an update of the live one, retire the old chart, or show what any of it
 * changed. This page does all four, and accepts into ONE org draft.
 *
 * ── WHAT IT READS AND WHAT IT COUNTS ─────────────────────────────────────
 *
 * The plan comes from `GET /api/review/batches/:batchId/structure`. Every count,
 * every refusal and the map are worked out here by `decideStructure`
 * (shared/structurePlan.ts), the same function the accept route runs, so the
 * button is enabled exactly when the server would accept.
 *
 * Nothing is decided for the steward: each seat named the same as a live seat
 * waits for a choice, and the primary action stays disabled until each has
 * one. The vendor's raw fields sit behind "What <source> sent" and nowhere
 * else, its `Notes` is never shown as a purpose, and holder names never come
 * from it: the page shows how many people hold a live seat, from this village.
 *
 * ── HONEST ABOUT WHERE IT STOPS ──────────────────────────────────────────
 *
 * The primary action is "Accept into a draft", and it says so. Proposing the
 * change for adoption (by whoever holds the power to change the chart, or by a
 * village vote) is the next phase, and nothing on this page claims it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import Layout from "@/components/Layout";
import { authToken } from "@/lib/gameApi";
import StructureMap, { StructureMapList } from "@/components/review/StructureMap";
import { structureMapModel, type MapView } from "@/lib/structureMapModel";
import {
  decideStructure,
  type ConflictChoice,
  type PlanSeat,
  type StructureDecisions,
  type StructurePlan,
} from "@shared/structurePlan";
import { MODULES_BY_ID } from "@shared/modules";

interface PlanAnswer {
  batchId: string;
  moduleId: string | null;
  receivedAt: string | null;
  title: string | null;
  plan: StructurePlan;
}

interface DraftLine {
  reads: string;
  blocked: string | null;
}

type Load =
  | { state: "loading" }
  | { state: "refused" }
  | { state: "empty" }
  | { state: "failed"; why: string }
  | { state: "ready"; data: PlanAnswer };

const when = (iso: string | null): string => {
  if (!iso) return "at a time it did not say";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "at a time it did not say"
    : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
};

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

const VIEWS: Array<{ id: MapView; label: string }> = [
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "changes", label: "What changes" },
];

const card = "rounded-2xl border border-border bg-card text-card-foreground";
const pillBase = "text-[11px] font-bold tracking-wide uppercase rounded-full px-2.5 py-0.5 border whitespace-nowrap";

export default function StructureReview() {
  const params = useParams<{ batchId: string }>();
  const batchId = String(params?.batchId ?? "");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [exclude, setExclude] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<Record<string, ConflictChoice>>({});
  const [retire, setRetire] = useState(false);
  const [view, setView] = useState<MapView>("changes");
  const [asList, setAsList] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "accept" | null>(null);
  const [preview, setPreview] = useState<{ lines: DraftLine[]; blocked: number } | null>(null);
  const [done, setDone] = useState<{ draftId: string; blockedLines: DraftLine[]; leftInQueue: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const t = authToken();
    return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }, []);

  const read = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const r = await fetch(`/api/review/batches/${encodeURIComponent(batchId)}/structure`, { headers: headers() });
      if (r.status === 401 || r.status === 403) return setLoad({ state: "refused" });
      if (r.status === 404) return setLoad({ state: "empty" });
      if (!r.ok) return setLoad({ state: "failed", why: `The server answered ${r.status}` });
      setLoad({ state: "ready", data: (await r.json()) as PlanAnswer });
    } catch {
      setLoad({ state: "failed", why: "The server could not be reached" });
    }
  }, [batchId, headers]);

  useEffect(() => {
    void read();
  }, [read]);

  const data = load.state === "ready" ? load.data : null;
  const plan = data?.plan ?? null;
  const decisions: StructureDecisions = useMemo(
    () => ({ exclude: Array.from(exclude), conflicts, retireOldChart: retire }),
    [exclude, conflicts, retire],
  );
  const decided = useMemo(() => (plan ? decideStructure(plan, decisions) : null), [plan, decisions]);
  const model = useMemo(
    () => (plan && decided ? structureMapModel(plan, decided, decisions, view) : null),
    [plan, decided, decisions, view],
  );

  // Any change to the decisions makes an earlier preview stale.
  useEffect(() => setPreview(null), [decisions]);

  if (load.state !== "ready" || !plan || !decided || !model || !data) {
    return (
      <Layout>
        <div className="sheet-night min-h-screen bg-background text-foreground">
          <div className="max-w-3xl mx-auto px-4 py-10">
            <div className={`${card} p-6`}>
              {load.state === "loading" && <p className="text-muted-foreground">Reading the change.</p>}
              {load.state === "refused" && (
                <p>Reviewing structure changes is for whoever keeps the review queue. Ask a steward to open it for you.</p>
              )}
              {load.state === "empty" && (
                <p>
                  Nothing in this arrival is waiting for a decision. <Link href="/review" className="underline">Back to the review queue</Link>
                </p>
              )}
              {load.state === "failed" && (
                <>
                  <p>The change did not load. {load.why}. There may be proposals waiting; this is not an empty queue.</p>
                  <button type="button" onClick={() => void read()} className="mt-4 rounded-full border border-border px-4 py-2 min-h-[44px]">
                    Try again
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const source = (data.moduleId && MODULES_BY_ID[data.moduleId]?.name) || "The connected service";
  const liveCircleName = new Map(plan.live.circles.map((c) => [c.id, c.name]));
  const newCircleName = new Map(plan.circles.map((c) => [c.id, c.name]));
  const circleName = (id: string | null) => (id ? newCircleName.get(id) ?? liveCircleName.get(id) ?? id : "the village");
  const counts = decided.counts;
  const settledOrOut = (s: PlanSeat) => exclude.has(s.key) || !!conflicts[s.key];
  const matchedIn = plan.seats.filter((s) => s.match && !exclude.has(s.key));
  const allKeys = [...plan.circles.map((c) => c.key), ...plan.seats.map((s) => s.key)];
  const allOut = allKeys.every((k) => exclude.has(k));
  const canAccept = decided.problems.length === 0 && busy === null && !done;

  const toggle = (key: string, keep: boolean) => {
    setExclude((prev) => {
      const next = new Set(prev);
      const circle = plan.circles.find((c) => c.key === key);
      if (keep) {
        next.delete(key);
        // Keeping a seat keeps the new circle it sits in, and that circle's own parents.
        const seat = plan.seats.find((s) => s.key === key);
        let at = seat ? plan.circles.find((c) => c.id === seat.circleId && c.status === "new") : circle;
        while (at) {
          next.delete(at.key);
          const parentId = at.parentId;
          at = parentId ? plan.circles.find((c) => c.id === parentId && c.status === "new") : undefined;
        }
      } else {
        next.add(key);
        // Leaving a new circle out leaves out what sits in it.
        if (circle && circle.status === "new") {
          const stack = [circle.id];
          while (stack.length) {
            const id = stack.pop()!;
            for (const s of plan.seats) if (s.circleId === id) next.add(s.key);
            for (const c of plan.circles) {
              if (c.parentId === id && c.status === "new" && !next.has(c.key)) {
                next.add(c.key);
                stack.push(c.id);
              }
            }
          }
        }
      }
      return next;
    });
    if (keep) setConflicts((prev) => prev);
  };

  const choose = (s: PlanSeat, choice: ConflictChoice | "out") => {
    if (choice === "out") {
      toggle(s.key, false);
      setConflicts((prev) => {
        const next = { ...prev };
        delete next[s.key];
        return next;
      });
      return;
    }
    setConflicts((prev) => ({ ...prev, [s.key]: choice }));
  };

  const jump = (rowKey: string) => {
    setHighlight(rowKey);
    const row = document.getElementById(`row-${rowKey}`);
    row?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  const post = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "accept");
    setFailure(null);
    try {
      const r = await fetch(`/api/review/batches/${encodeURIComponent(batchId)}/structure/accept`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ ...decisions, dryRun }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFailure(String(body?.error ?? `The server answered ${r.status}`));
        return;
      }
      if (dryRun) setPreview({ lines: body.lines ?? [], blocked: Number(body.blocked ?? 0) });
      else setDone({ draftId: String(body.draftId), blockedLines: body.blockedLines ?? [], leftInQueue: (body.leftInQueue ?? []).length });
    } catch {
      setFailure("The server could not be reached. Nothing was accepted.");
    } finally {
      setBusy(null);
    }
  };

  const newSeatsCount = plan.seats.filter((s) => !s.match).length;
  const summary =
    `${source} suggests ${plural(plan.circles.filter((c) => c.status === "new").length, "new circle", "new circles")} ` +
    `and ${plural(plan.seats.length, "seat", "seats")}` +
    (plan.seats.some((s) => s.match) ? `, ${plural(plan.seats.filter((s) => s.match).length, "of them named", "of them named")} like a seat this village already has` : "") +
    `. Nothing here is live. Read what changes on the map, settle the seats that already exist, then accept it into a draft.`;

  const caption =
    view === "before"
      ? `Today: ${plural(model.circles.length, "circle", "circles")} and ${plural(model.seats.length, "seat", "seats")}.`
      : view === "after"
        ? `If this publishes: ${retire ? "the new structure, with the old chart retired where nobody sits" : "the new structure beside today's chart"}.`
        : `Green is new, gold takes over a live seat, dashed retires or moves out.${retire ? "" : " Today's chart stays live beside it."}`;

  // Seats grouped under the circle they would sit in.
  const groups: Array<{ key: string; circleKey: string | null; name: string; meta: string; purpose: string | null; seats: PlanSeat[]; problem: string | null }> = [];
  for (const c of plan.circles) {
    groups.push({
      key: `c-${c.key}`,
      circleKey: c.key,
      name: c.name || "A circle with no name",
      meta: [c.parentId ? `Inside ${circleName(c.parentId)}` : null, c.status === "new" ? "New circle" : "Already a circle here"].filter(Boolean).join(" · "),
      purpose: c.purpose,
      seats: plan.seats.filter((s) => s.circleId === c.id),
      problem: c.problem,
    });
  }
  const grouped = new Set(groups.flatMap((g) => g.seats.map((s) => s.key)));
  const byLive = new Map<string, PlanSeat[]>();
  const unplaced: PlanSeat[] = [];
  for (const s of plan.seats) {
    if (grouped.has(s.key)) continue;
    if (s.circleId) byLive.set(s.circleId, [...(byLive.get(s.circleId) ?? []), s]);
    else unplaced.push(s);
  }
  for (const [id, seats] of Array.from(byLive.entries())) {
    groups.push({ key: `l-${id}`, circleKey: null, name: circleName(id), meta: "A circle this village already has", purpose: null, seats, problem: null });
  }
  if (unplaced.length) groups.push({ key: "unplaced", circleKey: null, name: "Not placed in a circle", meta: "", purpose: null, seats: unplaced, problem: null });

  const pill = (s: PlanSeat) => {
    if (exclude.has(s.key)) return <span className={`${pillBase} text-muted-foreground border-border`}>Left out</span>;
    if (!s.match) return <span className={`${pillBase} text-open border-current`}>New seat</span>;
    const c = conflicts[s.key];
    if (c?.choice === "update") return <span className={`${pillBase} text-notice border-current`}>Updates live seat</span>;
    if (c?.choice === "rename") return <span className={`${pillBase} text-open border-current`}>Added as new</span>;
    return <span className={`${pillBase} text-destructive border-current`}>Needs your call</span>;
  };

  return (
    <Layout>
      <div className="sheet-night min-h-screen bg-background text-foreground">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-5 pt-7 pb-40 grid gap-6">
          <header className="grid gap-2.5">
            <p className="text-[11px] tracking-[0.16em] uppercase text-muted-foreground font-semibold">
              Review · From {source} · Arrived {when(data.receivedAt)}
            </p>
            <h1 className="font-display text-[clamp(28px,4vw,40px)] leading-tight">{data.title ?? "A new shape for the village"}</h1>
            <p className="text-muted-foreground max-w-[68ch]">{summary}</p>
            {plan.notes.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {plural(plan.notes.length, "note", "notes")} in this arrival change no structure and stay in the{" "}
                <Link href="/review" className="underline">review queue</Link>.
              </p>
            )}
          </header>

          <div className={`${card} flex flex-wrap`} role="list" aria-label="What this change does">
            {[
              { n: counts.newCircles, label: "New circles", tone: "text-open" },
              { n: counts.newSeats, label: "New seats", tone: "text-open" },
              { n: counts.matched, label: "Match live seats", tone: "text-notice" },
              { n: counts.retiringCircles, label: "Old circles retiring", tone: "text-muted-foreground" },
              { n: counts.unsettled, label: "Need your call", tone: "text-destructive" },
            ].map((s, i) => (
              <div key={s.label} role="listitem" className={`flex-[1_1_130px] px-4 py-3.5 grid gap-0.5 ${i ? "border-l border-border" : ""}`}>
                <b className={`font-display font-normal text-[32px] leading-none tabular-nums ${s.tone}`} data-testid={`count-${s.label}`}>
                  {s.n}
                </b>
                <span className="text-[11px] tracking-[0.12em] uppercase text-muted-foreground font-semibold">{s.label}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
            <section className={`${card} p-4 grid gap-3 order-2 lg:order-1 lg:sticky lg:top-3`} aria-labelledby="h-map">
              <h2 id="h-map" className="sr-only">The circle map</h2>
              <div className="flex flex-wrap justify-between gap-2.5 items-center">
                <div className="inline-flex flex-wrap gap-0.5 rounded-full border border-border p-[3px]" role="group" aria-label="Map view">
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
                <label className="flex gap-2 items-center text-[13px] text-muted-foreground min-h-[40px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={retire}
                    onChange={(e) => setRetire(e.target.checked)}
                    className="w-[18px] h-[18px] accent-[var(--color-notice)]"
                  />
                  Retire the old chart in the same change
                </label>
              </div>
              {asList ? (
                <StructureMapList model={model} onSeat={jump} />
              ) : (
                <StructureMap model={model} caption={caption} highlight={highlight} onSeat={jump} />
              )}
              <div className="flex flex-wrap gap-3.5 text-xs text-muted-foreground items-center">
                <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-full bg-open" aria-hidden="true" />New</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-full bg-notice" aria-hidden="true" />Takes over a live seat</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-full border border-dashed border-muted-foreground" aria-hidden="true" />Retiring</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-full bg-muted-foreground" aria-hidden="true" />Stays as it is</span>
                <button type="button" onClick={() => setAsList((v) => !v)} className="ml-auto underline underline-offset-2 min-h-[32px]">
                  {asList ? "Show the map" : "Show the map as a list"}
                </button>
              </div>
              {retire && decided.retire.carryFirst.length > 0 && (
                <div className="text-sm grid gap-1" data-testid="carry-first">
                  <p className="font-semibold">Carry people first</p>
                  <p className="text-muted-foreground">
                    These old seats have people in them, so they stay until each person has a seat in the new chart.
                  </p>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {decided.retire.carryFirst.map((s) => (
                      <li key={s.id}>
                        {s.name} in {circleName(s.circleId)}, {plural(s.holders, "person", "people")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <div className="grid gap-6 order-1 lg:order-2">
              <section className="grid gap-2.5" aria-labelledby="h-conf">
                <div className="flex flex-wrap justify-between items-baseline gap-2.5">
                  <h2 id="h-conf" className="font-display text-[22px]">
                    {matchedIn.length === 0
                      ? "No seats already exist"
                      : matchedIn.length === 1
                        ? "One seat already exists"
                        : `${matchedIn.length} seats already exist`}
                  </h2>
                  <span className="text-[11px] tracking-[0.16em] uppercase text-muted-foreground font-semibold" data-testid="to-settle">
                    {counts.unsettled ? `${counts.unsettled} to settle` : "All settled"}
                  </span>
                </div>
                {matchedIn.length > 0 && (
                  <p className="text-muted-foreground">
                    {source} names {plural(matchedIn.length, "seat", "seats")} this village already has. Choose what each one does before this can be accepted.
                  </p>
                )}
                <div className="grid gap-2.5">
                  {matchedIn.map((s) => {
                    const live = s.match!;
                    const choice = conflicts[s.key];
                    const otherTakes = plan.seats.some(
                      (o) => o.key !== s.key && o.match?.seatId === live.seatId && !exclude.has(o.key) && conflicts[o.key]?.choice === "update",
                    );
                    return (
                      <div key={s.key} className={`${card} px-4 py-3.5 grid gap-2.5 border-notice/50`} data-testid={`conflict-${s.key}`}>
                        <div className="grid grid-cols-[1fr_auto_1fr] gap-2.5 items-center text-sm">
                          <div>
                            <b>{s.name}</b>
                            <small className="block text-muted-foreground text-xs">{source} · {circleName(s.circleId)}</small>
                          </div>
                          <span className="text-notice font-display text-xl" aria-hidden="true">⟷</span>
                          <div>
                            <b>{live.name}</b>
                            <small className="block text-muted-foreground text-xs">
                              Live today · {circleName(live.circleId)} · {live.holders ? plural(live.holders, "person holds it", "people hold it") : "nobody holds it"}
                            </small>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2" role="group" aria-label={`What happens to ${s.name} in ${circleName(s.circleId)}`}>
                          <button
                            type="button"
                            aria-pressed={choice?.choice === "update"}
                            disabled={otherTakes && choice?.choice !== "update"}
                            title={otherTakes ? "The other seat with this name already moves the live seat" : undefined}
                            onClick={() => choose(s, { choice: "update" })}
                            className={choiceClass(choice?.choice === "update")}
                          >
                            Move the live seat here
                          </button>
                          <button
                            type="button"
                            aria-pressed={choice?.choice === "rename"}
                            onClick={() => choose(s, { choice: "rename", name: choice?.choice === "rename" ? choice.name : "" })}
                            className={choiceClass(choice?.choice === "rename")}
                          >
                            Add as a second seat
                          </button>
                          <button type="button" aria-pressed={false} onClick={() => choose(s, "out")} className={choiceClass(false)}>
                            Leave it out
                          </button>
                        </div>
                        {choice?.choice === "rename" && (
                          <label className="grid gap-1 text-sm">
                            <span>A name of its own. A second seat with the same name stays blocked.</span>
                            <input
                              type="text"
                              value={choice.name}
                              maxLength={120}
                              onChange={(e) => choose(s, { choice: "rename", name: e.target.value })}
                              placeholder={`${s.name}, ${circleName(s.circleId)}`}
                              className="rounded-lg border border-border bg-background px-3 py-2 min-h-[44px]"
                            />
                          </label>
                        )}
                        <p className="text-[13px] text-muted-foreground">
                          {choice?.choice === "update"
                            ? `The live seat moves into ${circleName(s.circleId)} with ${source}'s wording. Whoever holds it keeps it.`
                            : choice?.choice === "rename"
                              ? "A new seat beside the live one, under the name you type."
                              : "Pick one. Nothing is decided for you."}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="grid gap-2.5" aria-labelledby="h-chg">
                <div className="flex flex-wrap justify-between items-baseline gap-2.5">
                  <h2 id="h-chg" className="font-display text-[22px]">Everything in this change</h2>
                  <button
                    type="button"
                    className={choiceClass(false)}
                    onClick={() => setExclude(allOut ? new Set() : new Set(allKeys))}
                  >
                    {allOut ? "Keep all" : "Leave all out"}
                  </button>
                </div>
                <div className={card}>
                  {groups.map((g) => {
                    const c = g.circleKey ? plan.circles.find((x) => x.key === g.circleKey) : null;
                    return (
                      <div key={g.key} className="pt-1.5">
                        <div className="flex gap-2.5 items-start px-4 py-3 border-b border-border">
                          {c ? (
                            <input
                              type="checkbox"
                              checked={!exclude.has(c.key)}
                              onChange={(e) => toggle(c.key, e.target.checked)}
                              aria-label={`Include the circle ${g.name}`}
                              className="w-[18px] h-[18px] mt-1 accent-[var(--color-notice)]"
                            />
                          ) : (
                            <span className="w-[18px]" aria-hidden="true" />
                          )}
                          <span className={`w-3 h-3 rounded-full flex-none mt-1.5 ${c?.status === "new" ? "bg-open" : "bg-muted-foreground"}`} aria-hidden="true" />
                          <div className="min-w-0">
                            <h3 className="font-display text-[17px]">{g.name}</h3>
                            <p className="text-xs text-muted-foreground">
                              {[g.meta, plural(g.seats.length, "seat", "seats")].filter(Boolean).join(" · ")}
                            </p>
                            {g.purpose && <p className="text-xs text-muted-foreground mt-0.5">{g.purpose}</p>}
                            {g.problem && <p className="text-xs text-destructive mt-0.5">{g.problem}. Leave it out to go ahead.</p>}
                            {c && (
                              <details className="text-xs text-muted-foreground mt-1">
                                <summary className="cursor-pointer min-h-[24px]">What {source} sent</summary>
                                <pre className="whitespace-pre-wrap break-words bg-background rounded-lg p-2 mt-1.5 text-[11px]">
                                  {JSON.stringify(c.sent, null, 1)}
                                </pre>
                              </details>
                            )}
                          </div>
                        </div>
                        {g.seats.length === 0 && (
                          <p className="px-4 py-3 text-[13px] text-muted-foreground border-b border-border">
                            No seats in this circle yet. It arrives empty.
                          </p>
                        )}
                        {g.seats.map((s) => (
                          <div
                            key={s.key}
                            id={`row-${s.key}`}
                            onMouseEnter={() => setHighlight(s.key)}
                            className={`grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 items-start px-4 py-3 border-b border-border last:border-b-0 ${
                              highlight === s.key ? "bg-muted" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={!exclude.has(s.key)}
                              onChange={(e) => toggle(s.key, e.target.checked)}
                              aria-label={`Include ${s.name}`}
                              className="w-[18px] h-[18px] mt-1 accent-[var(--color-notice)]"
                            />
                            <div className="min-w-0">
                              <p className="font-semibold">
                                {conflicts[s.key]?.choice === "rename" && (conflicts[s.key] as { name: string }).name.trim()
                                  ? (conflicts[s.key] as { name: string }).name
                                  : s.name || "A seat with no name"}
                              </p>
                              {s.aim && <p className="text-[13px] text-muted-foreground">{s.aim}</p>}
                              {s.circleProblem && <p className="text-[13px] text-destructive">{s.circleProblem}</p>}
                              {s.problem && <p className="text-[13px] text-destructive">{s.problem}</p>}
                              {s.match && !settledOrOut(s) && (
                                <p className="text-[13px] text-muted-foreground">Settle it above.</p>
                              )}
                              <details className="text-xs text-muted-foreground mt-1">
                                <summary className="cursor-pointer min-h-[24px]">What {source} sent</summary>
                                <pre className="whitespace-pre-wrap break-words bg-background rounded-lg p-2 mt-1.5 text-[11px]">
                                  {JSON.stringify(s.sent, null, 1)}
                                </pre>
                              </details>
                            </div>
                            {pill(s)}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                {newSeatsCount === 0 && plan.seats.length === 0 && (
                  <p className="text-sm text-muted-foreground">This arrival carries circles and no seats.</p>
                )}
              </section>

              <section className="grid gap-2.5" aria-labelledby="h-lands">
                <h2 id="h-lands" className="font-display text-[22px]">How it lands</h2>
                <ol className={`${card} grid sm:grid-cols-3`}>
                  {[
                    ["1. You accept it into a draft", `One draft holds every change you kept. ${source} can suggest; only people decide.`],
                    ["2. It is published", "Nothing is live until the draft is published. Until then you can withdraw it from the review queue."],
                    ["3. It goes live at once", "Circles and seats publish together. People keep their seats, and a seat somebody holds is never retired."],
                  ].map(([h, t], i) => (
                    <li key={h} className={`px-4 py-3.5 grid gap-1 ${i ? "border-t sm:border-t-0 sm:border-l border-border" : ""}`}>
                      <b className="font-display font-normal text-[17px]">{h}</b>
                      <span className="text-[13px] text-muted-foreground">{t}</span>
                    </li>
                  ))}
                </ol>
              </section>

              {preview && (
                <section className={`${card} p-4 grid gap-2`} aria-labelledby="h-preview" data-testid="draft-preview">
                  <h2 id="h-preview" className="font-display text-[22px]">The draft, as it would read</h2>
                  <p className="text-sm text-muted-foreground">
                    {preview.blocked
                      ? `${plural(preview.blocked, "line is", "lines are")} blocked. Each one says why.`
                      : "Nothing is blocked. Nothing was written: this is a preview."}
                  </p>
                  <ul className="text-sm grid gap-1">
                    {preview.lines.map((l, i) => (
                      <li key={i}>
                        {l.reads}
                        {l.blocked && <span className="block text-destructive">{l.blocked}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {done && (
                <section className={`${card} p-4 grid gap-2`} aria-labelledby="h-done" data-testid="accepted">
                  <h2 id="h-done" className="font-display text-[22px]">Accepted into a draft</h2>
                  <p className="text-sm text-muted-foreground">
                    It is not live yet. The draft publishes as one change, and it can be withdrawn from the review queue until then.
                    {done.leftInQueue > 0 ? ` ${plural(done.leftInQueue, "proposal stays", "proposals stay")} in the queue.` : ""}
                  </p>
                  {done.blockedLines.length > 0 && (
                    <ul className="text-sm grid gap-1">
                      {done.blockedLines.map((l, i) => (
                        <li key={i}>
                          {l.reads}
                          <span className="block text-destructive">{l.blocked}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link href="/review" className="underline">Back to the review queue</Link>
                </section>
              )}
            </div>
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur px-4 sm:px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
          <div className="max-w-[1180px] mx-auto flex flex-wrap gap-3 items-center justify-between">
            <p className="text-sm" role="status" data-testid="bar-status">
              {done ? (
                <b className="text-open">Accepted into a draft</b>
              ) : counts.unsettled ? (
                <>
                  <b className="text-destructive">{plural(counts.unsettled, "seat needs", "seats need")} your call</b>
                  <span className="text-muted-foreground"> · {plural(counts.kept, "change", "changes")} kept</span>
                </>
              ) : decided.problems.length ? (
                <b className="text-destructive">{decided.problems[0]}</b>
              ) : (
                <>
                  <b className="text-open">Ready</b>
                  <span className="text-muted-foreground">
                    {" "}· {plural(counts.kept, "change", "changes")} in one draft
                    {retire && counts.retiringCircles ? ` · retires ${plural(counts.retiringCircles, "old circle", "old circles")}` : ""}
                  </span>
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2.5 items-center">
              {failure && <span className="text-sm text-destructive" role="alert">{failure}</span>}
              <button
                type="button"
                disabled={!canAccept}
                onClick={() => void post(true)}
                className="rounded-full border border-border bg-muted px-[18px] py-2.5 min-h-[44px] font-semibold text-sm disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {busy === "preview" ? "Previewing" : "Preview as a draft"}
              </button>
              <button
                type="button"
                disabled={!canAccept}
                onClick={() => void post(false)}
                className="rounded-full border border-notice bg-notice text-background px-[18px] py-2.5 min-h-[44px] font-semibold text-sm disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {busy === "accept" ? "Accepting" : "Accept into a draft"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function choiceClass(on: boolean): string {
  return `rounded-full border px-3.5 py-2 min-h-[40px] text-[13px] font-medium bg-muted disabled:opacity-45 disabled:cursor-not-allowed ${
    on ? "border-notice text-notice" : "border-border text-foreground"
  }`;
}
