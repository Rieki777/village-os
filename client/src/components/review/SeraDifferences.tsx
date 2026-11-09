/**
 * The outside service's differences on /review: one list of the ways its
 * chart and the live chart here differ now, in place of a pile of batches
 * (spec US1, section 8.6). The approved boards are "Waiting for you", "A
 * conflict, stacked", "Sera didn't answer", "In step", "What a member sees"
 * and "Waiting for you (1280 px)".
 *
 * ── TWO READS, TWO AUDIENCES (R25, R38) ──────────────────────────────────
 *
 * `GET /api/saberra/differences/count` answers any signed-in member with
 * totals and no subject. `GET /api/saberra/differences` answers the review
 * queue's key with every difference and its words. A member the list refuses
 * sees the count and who decides, and never a subject. A module that is off
 * answers the count 404 and the section draws nothing.
 *
 * ── ANSWERING THEM (spec R12 to R16, R30 to R32) ─────────────────────────
 *
 * Each row offers what it can do: Add to draft, Retire it here, Keep ours,
 * Compare them, Edit (components/review/SeraActs.tsx). Ticked rows act
 * together through the bar and its sheet (SeraBulk.tsx); what a person took
 * shows in its own card with the draft's doors (SeraInDraft.tsx); the keyboard
 * is off until a person turns it on (SeraKeys.tsx). No answer changes the
 * chart: a take is a draft, published through the doors every draft has. The
 * words of every difference come from the server (shared/seraDifferenceWords.ts),
 * never from here.
 *
 * ── A FAILED READ IS NEVER AN EMPTY LIST ─────────────────────────────────
 *
 * The page's own rule (Review.tsx). A list that did not load says so and may
 * hold changes; "in step" is said only when the last read was whole, nothing
 * waits and no draft is open (R29).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { authToken } from "@/lib/gameApi";
import type { Door } from "@shared/seraDecides";
import SeraCompare from "@/components/review/SeraCompare";
import { SeraMember } from "@/components/review/SeraMember";
import { CompactRow, Pane, RowCard, Source, Chips, type Ctx } from "@/components/review/SeraRows";
import { ConflictSubtitle, EditPanel, RowActions, StatusStrip } from "@/components/review/SeraActs";
import { BulkBar, BulkSheet } from "@/components/review/SeraBulk";
import { InDraftCard } from "@/components/review/SeraInDraft";
import { handleListKey, KeysLegend, KeysToggle, useKeysToggle } from "@/components/review/SeraKeys";
import { useSeraActs } from "@/components/review/useSeraActs";
import { card, inlineLink, primary, ring, secondary } from "@/components/review/seraStyles";
import {
  aheadWords,
  changes,
  clockWords,
  comparable,
  factsWords,
  GROUP_OPEN_MAX,
  groupByCircle,
  groupHeading,
  headlineWords,
  inStep,
  lastCheckedWords,
  checkFirst,
  readCount,
  readList,
  readTrouble,
  smallWords,
  splitWaiting,
  type CountAnswer,
  type ListAnswer,
  type ListedDifference,
} from "@/lib/seraReview";

export type SeraRead =
  | { phase: "loading" }
  | { phase: "off" }
  | { phase: "failed"; error: string }
  | { phase: "member"; count: CountAnswer; agent: string }
  | { phase: "listed"; count: CountAnswer; list: ListAnswer };

/** Said wherever the agent's own name could not be read. */
const NEUTRAL_AGENT = "The outside service";

const errorOf = (b: unknown): string | null =>
  b && typeof b === "object" && typeof (b as { error?: unknown }).error === "string" ? (b as { error: string }).error : null;

function agentFromGuide(g: unknown): string {
  const options = g && typeof g === "object" ? (g as { options?: unknown }).options : null;
  const row = Array.isArray(options) ? options.find((o) => o && typeof o === "object" && (o as { id?: unknown }).id === "saberra") : null;
  const name = row && typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name.trim() : "";
  return name || NEUTRAL_AGENT;
}

/**
 * The two reads, and for a member the guide's name. Each call names its path
 * and carries the token itself, so scripts/check-auth-fetch.mjs reads every one
 * (review S6). Who decides and who sets pay ride on the count (review S2).
 */
export function useSeraDifferences() {
  const [read, setRead] = useState<SeraRead>({ phase: "loading" });
  const load = useCallback(async () => {
    const token = authToken();
    if (!token) return setRead({ phase: "off" });
    const answer = async (r: Response) => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => null) });
    try {
      const c = await answer(await fetch("/api/saberra/differences/count", { headers: { Authorization: `Bearer ${token}` } }));
      // Off, or signed out: the section is not this reader's, and says nothing.
      if (c.status === 401 || c.status === 403 || c.status === 404) return setRead({ phase: "off" });
      if (!c.ok) return setRead({ phase: "failed", error: errorOf(c.body) ?? "Could not read the differences" });
      const count = readCount(c.body);
      if (!count) return setRead({ phase: "off" });
      // A reader the list would refuse is never sent to it (QA Q5): no 401 on every member's page.
      const l =
        count.reader?.mayRead === false
          ? { status: 401, ok: false, body: null }
          : await answer(await fetch("/api/saberra/differences", { headers: { Authorization: `Bearer ${token}` } }));
      if (l.status === 401 || l.status === 403) {
        const guide = await fetch("/api/guide", { headers: { Authorization: `Bearer ${token}` } }).then(answer).catch(() => null);
        return setRead({ phase: "member", count, agent: agentFromGuide(guide?.ok ? guide.body : null) });
      }
      if (!l.ok) return setRead({ phase: "failed", error: errorOf(l.body) ?? "Could not read the differences" });
      const list = readList(l.body);
      if (!list) return setRead({ phase: "failed", error: "The list came back in a shape this page cannot read" });
      setRead({ phase: "listed", count, list });
    } catch {
      setRead({ phase: "failed", error: "Could not reach the server" });
    }
  }, []);
  return { read, load };
}

/** What waits for this reader, by the list's own rule. Zero for a member: nothing waits on them. */
export function seraWaiting(read: SeraRead): number {
  if (read.phase !== "listed") return 0;
  const w = splitWaiting(read.list.differences);
  return w.toDecide.length + w.small.length;
}

/** The headline's number: what is to decide, or the small changes when nothing else waits (R29). */
function seraHeadCount(read: SeraRead): number {
  if (read.phase !== "listed") return 0;
  const w = splitWaiting(read.list.differences);
  return w.toDecide.length || w.small.length;
}

/** R37: the summary line at the top of /review, with a jump link to each section that waits. */
export function SeraSummaryLine({ read, witness }: { read: SeraRead; witness: number }) {
  const sera = seraHeadCount(read);
  if (sera === 0 && witness === 0) return null;
  const agent = read.phase === "listed" ? read.list.agent : "";
  const parts: ReactNode[] = [];
  const link = "text-teal-deep underline hover:text-teal-deep-dark";
  if (sera > 0)
    parts.push(
      <a key="sera" href="#sera-changes" className={link}>
        {sera === 1 ? <Trans context="sera changes">{sera} {agent} change</Trans> : <Trans context="sera changes">{sera} {agent} changes</Trans>}
      </a>,
    );
  if (witness > 0)
    parts.push(
      <a key="witness" href="#witness" className={link}>
        {witness === 1 ? (
          <Trans context="sera changes">{witness} finished Quest to witness</Trans>
        ) : (
          <Trans context="sera changes">{witness} finished Quests to witness</Trans>
        )}
      </a>,
    );
  return (
    <p className="text-[13px] text-muted-foreground">
      <Trans context="sera changes">Waiting for you:</Trans>{" "}
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {p}
        </span>
      ))}
    </p>
  );
}

/** From 1280 px the list and the detail pane sit side by side (the 1280 px board). */
function useWide(): boolean {
  const query = "(min-width: 1280px)";
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const on = () => setWide(mql.matches);
    mql.addEventListener?.("change", on);
    on();
    return () => mql.removeEventListener?.("change", on);
  }, []);
  return wide;
}


type View = "decide" | "small" | "all";
type Only = "checkFirst" | "conflicts" | null;

/** The list a reader with the queue's key sees. */
function SeraList({
  list,
  pay,
  draftOpen,
  onRetry,
  onReload,
}: {
  list: ListAnswer;
  pay: Door | null;
  /** The page's whole read, queue included, after a sync. */
  onReload?: () => Promise<void>;
  draftOpen: boolean;
  onRetry: () => Promise<void>;
}) {
  const { t } = useLingui();
  const wide = useWide();
  const now = new Date();
  const agent = list.agent;
  const w = useMemo(() => splitWaiting(list.differences), [list]);
  // A draft the list's answers opened is a draft that is open (R29).
  const step = inStep(list, w, draftOpen || (list.inDraft ?? []).length > 0);
  const trouble = readTrouble(list, now);
  const waiting = useMemo(() => [...w.toDecide, ...w.small], [w]);
  const [view, setView] = useState<View>(w.toDecide.length > 0 ? "decide" : "small");
  const [only, setOnly] = useState<Only>(null);
  const [circle, setCircle] = useState<string>("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const [aheadOpen, setAheadOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [comparing, setComparing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [asked, setAsked] = useState("");
  const backTo = useRef<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const ids = useId();
  const reload = onReload ?? onRetry;
  const acts = useSeraActs(list.differences, reload);
  const [keysOn, setKeysOn] = useKeysToggle();
  const drafts = list.inDraft ?? [];

  const order = useMemo(() => list.circleOrder ?? [], [list]);
  const allGroups = useMemo(() => groupByCircle(waiting, order), [waiting, order]);
  const shown = useMemo(() => {
    const lane = view === "decide" ? w.toDecide : view === "small" ? w.small : waiting;
    const keep = lane.filter((d) => (only === "checkFirst" ? checkFirst(d) : only === "conflicts" ? d.state === "conflict" : true));
    return groupByCircle(keep, order).filter((g) => circle === "" || g.key === circle);
  }, [view, only, circle, w, waiting, order]);
  const shownList = useMemo(() => shown.flatMap((g) => g.rows.flatMap((r) => [r.d, ...r.nested])), [shown]);
  const pick = shownList.find((d) => d.key === selected) ?? shownList[0] ?? null;
  const ctx: Ctx = {
    agent,
    pay,
    acts,
    onCompare: (d) => {
      backTo.current = d.key;
      setComparing(d.key);
    },
  };

  // After an act the row leaves the list: focus moves to the row that took its place (R32).
  const rowOrder = shownList.map((d) => d.key);
  const lastOrder = useRef<string[]>(rowOrder);
  const orderKey = rowOrder.join("\n");
  useEffect(() => {
    const acted = acts.acted;
    if (acted && lastOrder.current.includes(acted) && !rowOrder.includes(acted)) {
      const next = rowOrder[Math.min(lastOrder.current.indexOf(acted), rowOrder.length - 1)];
      const rows = root.current?.querySelectorAll<HTMLElement>("[data-sera-row]") ?? [];
      rows.forEach((r) => {
        if (r.dataset.seraRow === next) r.focus();
      });
      acts.setActed(null);
    }
    lastOrder.current = rowOrder;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);
  // A compared row that was answered has left the list: back to the list.
  useEffect(() => {
    if (comparing && !waiting.some((d) => d.key === comparing)) setComparing(null);
  }, [comparing, waiting]);
  const onKeys = (e: React.KeyboardEvent<HTMLElement>) => {
    handleListKey(e, keysOn, e.currentTarget, (k) => wide && setSelected(k));
  };
  // What "Tick all shown" ticks: every row shown that has its own tick (a new circle's roles go with it).
  const tickable = shownList.filter((d) => d.kind !== "pay" && !(d.kind === "roleAdd" && d.subject.ourId === null && (d.subject.circleId ?? "").startsWith("sera:")));

  // Back from a comparison, focus returns to the button that opened it, in a layout effect so it is
  // settled before the click that caused it returns (the test raced a passive effect under load).
  useLayoutEffect(() => {
    if (comparing !== null || backTo.current === null) return;
    const key = backTo.current;
    backTo.current = null;
    root.current?.querySelectorAll<HTMLButtonElement>("button[data-compare]").forEach((b) => {
      if (b.dataset.compare === key) b.focus();
    });
  }, [comparing]);

  /**
   * Check again asks the service now, through the same by-hand sync the admin panel offers
   * (`POST /api/saberra/sync`, behind the list's own key). It writes nothing to the chart; a
   * sync already running is its own named refusal. The outcome stays in the card (QA Q3).
   */
  const checkAgain = async () => {
    setAsked(t({ message: "Asking now.", context: "sera changes" }));
    const token = authToken();
    const r = await fetch("/api/saberra/sync", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }).catch(() => null);
    const askedAt = clockWords(new Date().toISOString()) ?? "now";
    if (!r) return setAsked(t`Could not reach the server.`);
    const body = (await r.json().catch(() => null)) as { error?: unknown } | null;
    const status = r.status;
    if (status === 502) setAsked(t({ message: `${agent} still didn't answer at ${askedAt}.`, context: "sera changes" }));
    // The server's busy sentence points at the admin panel's Sync now; this page says what is true here (R3-2).
    else if (status === 409 && (body as { state?: unknown } | null)?.state === "busy") setAsked(t`A sync is already running. Try again in a minute.`);
    else if (!r.ok) setAsked(typeof body?.error === "string" ? body.error : t`The check did not run (${status}).`);
    // The whole page reads again: a sync moves waiting proposals, so the queue must follow (R3-2).
    await (onReload ?? onRetry)();
    if (r.ok) setAsked(`answered:${askedAt}`);
  };

  const headline = headlineWords(agent, w, step);
  const facts = factsWords(w);
  const small = smallWords(w);
  const checked = lastCheckedWords(list.lastReadAt, now);
  const ahead = aheadWords(agent, w.oursAhead.length);
  const headCount = w.toDecide.length || w.small.length;
  const nChecks = waiting.filter(checkFirst).length;
  const nConflicts = waiting.filter((d) => d.state === "conflict").length;
  const nDecide = w.toDecide.length;
  const nSmall = w.small.length;
  const checkFirstWords = t({ message: "Check first", context: "sera changes" });
  const conflictsWords = t({ message: "Conflicts", context: "sera changes" });
  const toDecideWords = t({ message: "To decide", context: "sera changes" });
  const smallChangesWords = t({ message: "Small changes", context: "sera changes" });
  const noCircleWords = t({ message: "Not in a circle", context: "sera changes" });
  // What the chips and the filter show, said out loud and under the chips (QA Q4).
  const shownLabel =
    only === "checkFirst" ? checkFirstWords : only === "conflicts" ? conflictsWords : view === "decide" ? toDecideWords : view === "small" ? smallChangesWords : null;
  const circleName = circle ? allGroups.find((g) => g.key === circle)?.name ?? noCircleWords : null;
  const shownWords = [shownLabel, circleName].filter(Boolean).join(", ");
  const shownCount = changes(shownList.length);
  const nShown = shownList.length;
  const status_ = waiting.length > 0 && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p role="status" className="text-sm text-muted-foreground">
        {shownWords
          ? t({ message: `Showing ${shownCount}: ${shownWords}`, context: "sera changes" })
          : t({ message: `Showing all ${nShown} waiting changes`, context: "sera changes" })}
      </p>
      {tickable.length > 1 && (
        <button type="button" onClick={() => acts.tickAll(tickable.map((d) => d.key))} className={`min-h-[44px] text-sm ${inlineLink}`}>
          <Trans context="sera answers">Tick all shown</Trans>
        </button>
      )}
    </div>
  );
  // What waits in a draft, and what the last act did (R13, R30).
  const answers = (
    <>
      <StatusStrip acts={acts} />
      {drafts.map((g) => (
        <InDraftCard key={g.draftId} group={g} onChanged={reload} say={acts.say} />
      ))}
    </>
  );
  const bulk = (
    <>
      <BulkBar acts={acts} agent={agent} />
      <BulkSheet acts={acts} agent={agent} />
    </>
  );

  const compareRow = !wide && comparing ? waiting.find((d) => d.key === comparing) ?? null : null;
  if (compareRow) {
    return (
      <section ref={root} id="sera-changes" aria-labelledby={`${ids}-cmp`} className="scroll-mt-24">
        <span id={`${ids}-cmp`} className="sr-only">{headline}</span>
        <SeraCompare
          d={compareRow}
          agent={agent}
          backWords={t({ message: `Back to all ${headCount}`, context: "sera changes" })}
          onBack={() => setComparing(null)}
          source={<Source d={compareRow} />}
          chips={
            compareRow.words.flags.length > 0 || compareRow.state === "conflict" ? (
              <div className="flex flex-col gap-1.5"><Chips d={compareRow} /></div>
            ) : null
          }
          subtitle={<ConflictSubtitle d={compareRow} />}
          action={
            <>
              <RowActions d={compareRow} acts={acts} agent={agent} pay={pay} layout="compare" />
              <EditPanel d={compareRow} acts={acts} agent={agent} />
            </>
          }
        />
      </section>
    );
  }

  const pressed = (on: boolean) =>
    `min-h-[44px] px-3.5 rounded-full border text-sm ${
      on ? `bg-teal-deep border-teal-deep text-white font-semibold hover:bg-teal-deep-dark ${ring}` : "bg-card border-border text-foreground font-medium hover:bg-muted"
    }`;
  const chipRow = waiting.length > 0 && (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t({ message: "Show", context: "sera changes" })} className="flex flex-wrap gap-2">
        {w.toDecide.length > 0 ? (
          <button type="button" aria-pressed={view === "decide" && only === null} onClick={() => { setView("decide"); setOnly(null); }} className={pressed(view === "decide" && only === null)}>
            <Trans context="sera changes">To decide {nDecide}</Trans>
          </button>
        ) : (
          <button type="button" aria-pressed={view === "small" && only === null} onClick={() => { setView("small"); setOnly(null); }} className={pressed(view === "small" && only === null)}>
            <Trans context="sera changes">Small changes {nSmall}</Trans>
          </button>
        )}
        {nChecks > 0 && (
          <button type="button" aria-pressed={only === "checkFirst"} onClick={() => { setOnly(only === "checkFirst" ? null : "checkFirst"); setView("all"); }} className={pressed(only === "checkFirst")}>
            <Trans context="sera changes">Check first {nChecks}</Trans>
          </button>
        )}
        {nConflicts > 0 && (
          <button type="button" aria-pressed={only === "conflicts"} onClick={() => { setOnly(only === "conflicts" ? null : "conflicts"); setView("all"); }} className={pressed(only === "conflicts")}>
            <Trans context="sera changes">Conflicts {nConflicts}</Trans>
          </button>
        )}
        <button type="button" aria-expanded={filterOpen} aria-controls={`${ids}-filter`} onClick={() => setFilterOpen((o) => !o)} className={pressed(false)}>
          <Trans context="sera changes">Filter</Trans>
        </button>
        <KeysToggle on={keysOn} set={setKeysOn} />
      </div>
      <KeysLegend on={keysOn} />
      {filterOpen && (
        <div id={`${ids}-filter`} className={`${card} p-3.5 flex flex-wrap gap-4`}>
          <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
            <Trans context="sera changes">Which changes</Trans>
            <select
              value={view}
              onChange={(e) => { setView(e.target.value as View); setOnly(null); }}
              className="min-h-[44px] rounded-lg border border-border bg-card px-3 text-sm font-normal"
            >
              <option value="all">{t({ message: "Everything waiting", context: "sera changes" })}</option>
              {w.toDecide.length > 0 && <option value="decide">{toDecideWords}</option>}
              {w.small.length > 0 && <option value="small">{smallChangesWords}</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
            <Trans context="sera changes">Circle</Trans>
            <select value={circle} onChange={(e) => setCircle(e.target.value)} className="min-h-[44px] rounded-lg border border-border bg-card px-3 text-sm font-normal">
              <option value="">{t({ message: "Every circle", context: "sera changes" })}</option>
              {allGroups.map((g) => (
                <option key={g.key} value={g.key}>{g.name ?? noCircleWords}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );

  const groups = (compact: boolean) =>
    shown.length === 0 && waiting.length > 0 ? (
      <p className="text-sm text-muted-foreground">
        <Trans>Nothing here matches what is chosen above.</Trans>{" "}
        <button type="button" onClick={() => { setView("all"); setOnly(null); setCircle(""); }} className={inlineLink}>
          <Trans context="sera changes">Show everything waiting</Trans>
        </button>
      </p>
    ) : (
      shown.map((g) => {
        const collapsible = g.size > GROUP_OPEN_MAX;
        const open = !collapsible || flipped.has(g.key);
        const hid = `${ids}-g-${g.key}`;
        const toggle = () =>
          setFlipped((s) => {
            const next = new Set(s);
            if (next.has(g.key)) next.delete(g.key);
            else next.add(g.key);
            return next;
          });
        return (
          <section key={g.key} aria-labelledby={hid} className="flex flex-col gap-2">
            <h3 id={hid} className={`${compact ? "text-[15px] my-1" : "text-base"} font-bold text-foreground`}>
              {collapsible ? (
                <button type="button" aria-expanded={open} onClick={toggle} className="inline-flex items-center gap-2 min-h-[44px] text-left">
                  {groupHeading(g)}
                  <ChevronDown aria-hidden="true" className={`w-4 h-4 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
              ) : (
                groupHeading(g)
              )}
            </h3>
            {open &&
              g.rows.map((r) =>
                compact ? (
                  [r.d, ...r.nested].map((d, i) => (
                    <CompactRow key={d.key} ctx={ctx} d={d} inset={i > 0} selected={pick?.key === d.key} onSelect={() => setSelected(d.key)} />
                  ))
                ) : (
                  <RowCard key={r.d.key} ctx={ctx} d={r.d} nested={r.nested} />
                ),
              )}
          </section>
        );
      })
    );

  const factsLine = facts && (
    <>
      {facts}{" "}
      <a href="#sera-facts" onClick={() => setFactsOpen(true)} className={inlineLink}>
        <Trans>See them at the bottom of this page.</Trans>
      </a>
    </>
  );

  // What Check again found, said in the card while the card stands, and under the headline once the read is whole.
  const askedAt = asked.slice(9);
  const askedWords = asked.startsWith("answered:")
    ? trouble?.noAnswer
      ? t({ message: `${agent} still didn't answer at ${askedAt}.`, context: "sera changes" })
      : t({ message: `${agent} answered at ${askedAt}.`, context: "sera changes" })
    : asked;
  const askedLine = !trouble?.noAnswer && asked && (
    <p role="status" className="text-sm text-foreground">{askedWords}</p>
  );
  const lastAt = clockWords(list.lastReadAt, now) ?? "";
  const troubleCards = trouble && (
    <>
      {trouble.noAnswer ? (
        <section aria-labelledby={`${ids}-err`} className={`bg-card border border-coral rounded-xl p-3.5 flex flex-col gap-2.5`}>
          <h3 id={`${ids}-err`} className="text-base font-bold text-coral">
            <Trans context="sera changes">{agent} didn't answer at {lastAt}</Trans>
          </h3>
          {trouble.lines.map((l) => (
            <p key={l} className="text-[15px] leading-normal text-foreground">{l}</p>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void checkAgain()} className={`${primary} self-start px-4`}>
              <Trans context="sera changes">Check again</Trans>
            </button>
            <p role="status" className="text-sm text-foreground">{askedWords}</p>
          </div>
        </section>
      ) : (
        <div className={`${card} p-3.5`}>
          <p className="text-[15px] leading-normal text-foreground">{trouble.lines.join(" ")}</p>
        </div>
      )}
      <p className="text-sm leading-normal text-muted-foreground">
        <Trans>
          Nothing counts as removed because of a check that failed. A role leaves the list only when {agent} archives it, or when it
          is missing from two full checks in a row.
        </Trans>
      </p>
    </>
  );

  const nAhead = w.oursAhead.length;
  const nFacts = w.facts.length;
  const bottom = (
    <>
      {ahead && (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-normal text-muted-foreground">
            {ahead}{" "}
            <button type="button" aria-expanded={aheadOpen} onClick={() => setAheadOpen((o) => !o)} className={inlineLink}>
              {aheadOpen
                ? t({ message: "Hide them", context: "sera changes" })
                : nAhead === 1
                  ? t({ message: "See which one", context: "sera changes" })
                  : t({ message: `See which ${nAhead}`, context: "sera changes" })}
            </button>
          </p>
          {aheadOpen && (
            <ul className="flex flex-col gap-2">
              {w.oursAhead.map((d) => (
                <li key={d.key} className={`${card} p-3 text-sm text-foreground [overflow-wrap:anywhere]`}>
                  {d.words.sentence}
                  <span className="block text-[13px] text-muted-foreground mt-1"><Source d={d} /></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {w.facts.length > 0 && (
        <details
          id="sera-facts"
          open={factsOpen}
          onToggle={(e) => setFactsOpen((e.currentTarget as HTMLDetailsElement).open)}
          className={`${card} px-3.5 py-3 scroll-mt-24`}
        >
          <summary className="min-h-[44px] flex items-center text-[15px] font-semibold text-foreground cursor-pointer">
            <Trans context="sera changes">Facts updated since yesterday: {nFacts}</Trans>
          </summary>
          <p className="mt-2 text-sm text-muted-foreground"><Trans>Review dates, sectors and role types {agent} keeps.</Trans></p>
          <ul className="mt-3 flex flex-col gap-3">
            {w.facts.map((d) => (
              <li key={d.key} className="text-sm text-foreground [overflow-wrap:anywhere]">
                {d.words.sentence}
                <span className="block text-[13px] text-muted-foreground mt-0.5"><Source d={d} /></span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );

  if (step || waiting.length === 0) {
    return (
      <section ref={root} id="sera-changes" aria-labelledby={`${ids}-h`} className="scroll-mt-24 flex flex-col gap-4">
        <h2 id={`${ids}-h`} className="text-[22px] leading-tight font-bold text-foreground">{headline}</h2>
        {troubleCards}
        {askedLine}
        <p className="text-[15px] leading-normal text-muted-foreground">
          {checked ?? t`Nothing has been read from ${agent} yet.`}
          {step ? ` ${t`Nothing waits for you, and no draft is open.`}` : draftOpen ? ` ${t`A draft from this queue is still open.`}` : ""}
        </p>
        {facts && <p className="text-sm leading-normal text-muted-foreground">{factsLine}</p>}
        {answers}
        {list.lastReadAt !== null && (
          <section aria-labelledby={`${ids}-sw`} className={`${card} p-3.5 flex flex-col gap-2`}>
            <h3 id={`${ids}-sw`} className="text-base font-bold text-foreground"><Trans>Small changes apply by themselves: off</Trans></h3>
            <p className="text-sm leading-normal text-muted-foreground"><Trans>Until it is on, each small change waits for you in this list.</Trans></p>
          </section>
        )}
        {bottom}
      </section>
    );
  }

  if (wide) {
    return (
      <section ref={root} id="sera-changes" aria-labelledby={`${ids}-h`} className="scroll-mt-24 flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-6">
          <h2 id={`${ids}-h`} className="text-[26px] leading-tight font-bold text-foreground">{headline}</h2>
          {checked && <p className="shrink-0 text-sm text-muted-foreground">{checked.replace(/\.$/, "")}</p>}
        </div>
        {(facts || small) && (
          <p className="text-sm text-muted-foreground">
            {factsLine}
            {facts && small ? " " : ""}
            {small}
          </p>
        )}
        {troubleCards}
        {askedLine}
        {chipRow}
        {answers}
        {status_}
        <div className="flex gap-6 items-start" onKeyDown={onKeys}>
          <div className="w-[480px] shrink-0 flex flex-col gap-2">{groups(true)}</div>
          <Pane ctx={ctx} d={pick} />
        </div>
        {bottom}
        {bulk}
      </section>
    );
  }

  return (
    <section ref={root} id="sera-changes" aria-labelledby={`${ids}-h`} className="scroll-mt-24 flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h2 id={`${ids}-h`} className="text-[22px] leading-tight font-bold text-foreground">{headline}</h2>
        {troubleCards}
        {askedLine}
        {facts && <p className="text-sm leading-normal text-muted-foreground">{factsLine}</p>}
        {(small || checked) && (
          <p className="text-sm leading-normal text-muted-foreground">
            {small}
            {small && checked ? " " : ""}
            {checked}
          </p>
        )}
        {chipRow}
        {answers}
        {status_}
      </div>
      <div className="flex flex-col gap-4" onKeyDown={onKeys}>
        {groups(false)}
      </div>
      {bottom}
      {bulk}
    </section>
  );
}

/** The section, by what the two reads answered. */
export default function SeraDifferences({
  read,
  draftOpen,
  onRetry,
  onReload,
}: {
  read: SeraRead;
  onReload?: () => Promise<void>;
  draftOpen: boolean;
  onRetry: () => Promise<void>;
}) {
  if (read.phase === "loading" || read.phase === "off") return null;
  if (read.phase === "member") return <SeraMember count={read.count} agent={read.agent} />;
  if (read.phase === "failed") {
    const error = read.error;
    return (
      <section id="sera-changes" aria-labelledby="sera-failed-h" className={`${card} p-5 scroll-mt-24`}>
        <h2 id="sera-failed-h" className="text-xl font-bold text-foreground"><Trans>The list of changes did not load</Trans></h2>
        <p className="text-sm text-muted-foreground mt-2">
          <Trans>{error}. There may be changes waiting; this is not an empty list.</Trans>
        </p>
        <button type="button" onClick={() => void onRetry()} className={`${secondary} mt-4`}>
          <Trans context="sera changes">Read the list again</Trans>
        </button>
      </section>
    );
  }
  return <SeraList list={read.list} pay={read.count.paySetBy} draftOpen={draftOpen} onRetry={onRetry} onReload={onReload} />;
}
