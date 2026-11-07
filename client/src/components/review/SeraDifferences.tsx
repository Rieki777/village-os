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
 * ── READ-ONLY IN THIS RELEASE ────────────────────────────────────────────
 *
 * No button here changes anything. Taking, keeping, editing and acting on
 * many at once arrive with the next release; until then each row's way on is
 * the structure review, which is where a steward decides today, and nothing is
 * drawn that would do nothing when pressed. The words of every difference
 * come from the server (shared/seraDifferenceWords.ts), never from here.
 *
 * ── A FAILED READ IS NEVER AN EMPTY LIST ─────────────────────────────────
 *
 * The page's own rule (Review.tsx). A list that did not load says so and may
 * hold changes; "in step" is said only when the last read was whole, nothing
 * waits and no draft is open (R29).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { headlineCount } from "@shared/seraWaiting";
import { whoDecidesWords, whoSetsPayWords, type Door } from "@shared/seraDecides";
import { STRUCTURE_KINDS } from "@shared/structurePlan";
import SeraCompare, { CompareBlocks } from "@/components/review/SeraCompare";
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
  SERA_MODULE,
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
  if (sera > 0) parts.push(<a key="sera" href="#sera-changes" className={link}>{sera} {agent} {sera === 1 ? "change" : "changes"}</a>);
  if (witness > 0)
    parts.push(<a key="witness" href="#witness" className={link}>{witness} finished {witness === 1 ? "Quest" : "Quests"} to witness</a>);
  return (
    <p className="text-[13px] text-muted-foreground">
      Waiting for you:{" "}
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

const card = "bg-card border border-border rounded-xl";
/** A ring offset from the fill, so focus shows on a teal control (QA Q2): the default outline is the fill's own colour. */
const ring = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";
const primary =
  `inline-flex items-center justify-center min-h-[44px] px-3.5 rounded-lg bg-teal-deep text-white text-sm font-semibold hover:bg-teal-deep-dark ${ring}`;
const secondary =
  "inline-flex items-center justify-center min-h-[44px] px-3.5 rounded-lg border border-border bg-card text-foreground text-sm font-medium hover:bg-muted";
const inlineLink = "text-teal-deep underline hover:text-teal-deep-dark";
const chip = "self-start rounded-md bg-amber-light text-amber-ink font-semibold";

/** Flags in words, then the conflict, each its own chip and never a colour alone (R39). */
function Chips({ d, small, inline }: { d: ListedDifference; small?: boolean; inline?: boolean }) {
  const Tag = inline ? "span" : "p";
  const size = small ? "px-2 py-0.5 text-xs" : "px-2 py-1 text-[13px]";
  if (d.words.flags.length === 0 && d.state !== "conflict") return null;
  return (
    <>
      {d.words.flags.map((f, i) => (
        <Tag key={i} className={`${chip} ${size}`}>{f}</Tag>
      ))}
      {d.state === "conflict" && <Tag className={`${chip} ${size}`}>Conflict</Tag>}
    </>
  );
}

/** "Edited in Sera 29 Oct · Open in Sera", the link built by the server from the configured address (R10). */
function Source({ d }: { d: ListedDifference }) {
  return (
    <>
      {d.words.source}
      {d.words.open && (
        <>
          {" · "}
          <a href={d.words.open} target="_blank" rel="noopener noreferrer" className={inlineLink}>
            {d.words.openWords}
          </a>
        </>
      )}
    </>
  );
}

interface Ctx {
  agent: string;
  /** Who holds the power to set pay, from the count, or null when it could not be said. */
  pay: Door | null;
  onCompare: (d: ListedDifference) => void;
}

/** The way on from a row while the list is read-only: the structure review, or a plain sentence when nothing waits there. */
function DecideThere({ ctx, d, block }: { ctx: Ctx; d: ListedDifference; block?: boolean }) {
  if (d.kind === "pay") return ctx.pay ? <p className="text-[13px] text-muted-foreground">{whoSetsPayWords(ctx.pay)}</p> : null;
  // The arrival that holds THIS difference (review C7), never one link for every row.
  if (!d.batchId) {
    return <p className="text-[13px] text-muted-foreground">No arrival from {ctx.agent} waits in the structure review right now.</p>;
  }
  return (
    <Link href={`/review/structure/${encodeURIComponent(d.batchId)}`} className={block ? `${primary} min-h-[48px] w-full text-[15px]` : primary}>
      Decide it in the structure review
    </Link>
  );
}

function Actions({ ctx, d }: { ctx: Ctx; d: ListedDifference }) {
  const compare = comparable(d) && (
    <button type="button" data-compare={d.key} onClick={() => ctx.onCompare(d)} className={d.state === "conflict" ? primary : secondary}>
      Compare them
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!(d.state === "conflict" && compare) && <DecideThere ctx={ctx} d={d} />}
      {compare}
    </div>
  );
}

const nestedWords = (n: number) =>
  `${n === 1 ? "Its role comes" : `Its ${n} roles come`} with it, and leaving the circle out leaves ${n === 1 ? "it" : "them"} out too.`;

/** One row on the phone: the sentence, where it came from, its flags, and the way on (the "Waiting for you" board). */
function RowCard({ ctx, d, nested }: { ctx: Ctx; d: ListedDifference; nested: ListedDifference[] }) {
  return (
    <article className={`${card} p-3 flex flex-col gap-1.5`}>
      <p className="text-[15px] leading-snug font-medium text-foreground [overflow-wrap:anywhere]">{d.words.sentence}</p>
      <p className="text-[13px] text-muted-foreground">
        <Source d={d} />
      </p>
      <Chips d={d} />
      <Actions ctx={ctx} d={d} />
      {nested.length > 0 && (
        <div className="mt-2 pl-3 border-l-2 border-border flex flex-col gap-3">
          <p className="text-[13px] text-muted-foreground">{nestedWords(nested.length)}</p>
          {nested.map((n) => (
            <div key={n.key} className="flex flex-col gap-1">
              <p className="text-sm leading-snug font-medium text-foreground">{n.words.sentence}</p>
              <p className="text-[13px] text-muted-foreground">
                <Source d={n} />
              </p>
              <Chips d={n} small />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/** One row at 1280 px: the sentence and its chips, and pressing it shows it in the pane. */
function CompactRow({ d, selected, onSelect, inset }: { d: ListedDifference; selected: boolean; onSelect: () => void; inset?: boolean }) {
  return (
    <article className={`bg-card rounded-[10px] ${selected ? "border-2 border-teal-deep" : "border border-border"}${inset ? " ml-6" : ""}`}>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-controls="sera-pane"
        onClick={onSelect}
        className={`w-full text-left min-h-[44px] flex flex-col gap-1 rounded-[10px] ${selected ? "p-[11px]" : "p-3"}`}
      >
        <span className={`text-sm leading-normal text-foreground [overflow-wrap:anywhere]${selected ? " font-semibold" : ""}`}>{d.words.sentence}</span>
        <Chips d={d} small inline />
      </button>
    </article>
  );
}

/** The detail pane at 1280 px, sticky beside the list. */
function Pane({ ctx, d }: { ctx: Ctx; d: ListedDifference | null }) {
  if (!d) return null;
  return (
    <section
      id="sera-pane"
      aria-labelledby="sera-pane-h"
      className={`${card} flex-1 min-w-0 p-5 flex flex-col gap-3.5 sticky top-24 self-start max-h-[calc(100vh-7rem)] overflow-y-auto`}
    >
      <h3 id="sera-pane-h" className="text-lg leading-snug font-bold text-foreground [overflow-wrap:anywhere]">
        {d.words.sentence.replace(/\.$/, "")}
      </h3>
      <p className="text-sm text-muted-foreground">
        <Source d={d} />
      </p>
      {(d.words.flags.length > 0 || d.state === "conflict") && (
        <div className="flex flex-col gap-1.5">
          <Chips d={d} />
        </div>
      )}
      {comparable(d) && <CompareBlocks key={d.key} d={d} agent={ctx.agent} layout="columns" />}
      <div className="flex flex-wrap gap-2 mt-2">
        <DecideThere ctx={ctx} d={d} />
      </div>
    </section>
  );
}

type View = "decide" | "small" | "all";
type Only = "checkFirst" | "conflicts" | null;

/** The list a reader with the queue's key sees. */
function SeraList({
  list,
  pay,
  draftOpen,
  onRetry,
}: {
  list: ListAnswer;
  pay: Door | null;
  draftOpen: boolean;
  onRetry: () => Promise<void>;
}) {
  const wide = useWide();
  const now = new Date();
  const agent = list.agent;
  const w = useMemo(() => splitWaiting(list.differences), [list]);
  const step = inStep(list, w, draftOpen);
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
    onCompare: (d) => {
      backTo.current = d.key;
      setComparing(d.key);
    },
  };

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
    setAsked("Asking now.");
    const token = authToken();
    const r = await fetch("/api/saberra/sync", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }).catch(() => null);
    const at = clockWords(new Date().toISOString()) ?? "now";
    if (!r) return setAsked("Could not reach the server.");
    const body = (await r.json().catch(() => null)) as { error?: unknown } | null;
    if (r.status === 502) setAsked(`${agent} still didn't answer at ${at}.`);
    else if (!r.ok) setAsked(typeof body?.error === "string" ? body.error : `The check did not run (${r.status}).`);
    await onRetry();
    if (r.ok) setAsked(`answered:${at}`);
  };

  const headline = headlineWords(agent, w, step);
  const facts = factsWords(w);
  const small = smallWords(w);
  const checked = lastCheckedWords(list.lastReadAt, now);
  const ahead = aheadWords(agent, w.oursAhead.length);
  const headCount = w.toDecide.length || w.small.length;
  const nChecks = waiting.filter(checkFirst).length;
  const nConflicts = waiting.filter((d) => d.state === "conflict").length;
  // What the chips and the filter show, said out loud and under the chips (QA Q4).
  const shownLabel =
    only === "checkFirst" ? "Check first" : only === "conflicts" ? "Conflicts" : view === "decide" ? "To decide" : view === "small" ? "Small changes" : null;
  const circleName = circle ? allGroups.find((g) => g.key === circle)?.name ?? "Not in a circle" : null;
  const shownWords = [shownLabel, circleName].filter(Boolean).join(", ");
  const status_ = waiting.length > 0 && (
    <p role="status" className="text-sm text-muted-foreground">
      {shownWords ? `Showing ${changes(shownList.length)}: ${shownWords}` : `Showing all ${shownList.length} waiting changes`}
    </p>
  );

  const compareRow = !wide && comparing ? waiting.find((d) => d.key === comparing) ?? null : null;
  if (compareRow) {
    return (
      <section ref={root} id="sera-changes" aria-labelledby={`${ids}-cmp`} className="scroll-mt-24">
        <span id={`${ids}-cmp`} className="sr-only">{headline}</span>
        <SeraCompare
          d={compareRow}
          agent={agent}
          backWords={`Back to all ${headCount}`}
          onBack={() => setComparing(null)}
          source={<Source d={compareRow} />}
          chips={
            compareRow.words.flags.length > 0 || compareRow.state === "conflict" ? (
              <div className="flex flex-col gap-1.5"><Chips d={compareRow} /></div>
            ) : null
          }
          action={<DecideThere ctx={ctx} d={compareRow} block />}
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
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {w.toDecide.length > 0 ? (
          <button type="button" aria-pressed={view === "decide" && only === null} onClick={() => { setView("decide"); setOnly(null); }} className={pressed(view === "decide" && only === null)}>
            To decide {w.toDecide.length}
          </button>
        ) : (
          <button type="button" aria-pressed={view === "small" && only === null} onClick={() => { setView("small"); setOnly(null); }} className={pressed(view === "small" && only === null)}>
            Small changes {w.small.length}
          </button>
        )}
        {nChecks > 0 && (
          <button type="button" aria-pressed={only === "checkFirst"} onClick={() => { setOnly(only === "checkFirst" ? null : "checkFirst"); setView("all"); }} className={pressed(only === "checkFirst")}>
            Check first {nChecks}
          </button>
        )}
        {nConflicts > 0 && (
          <button type="button" aria-pressed={only === "conflicts"} onClick={() => { setOnly(only === "conflicts" ? null : "conflicts"); setView("all"); }} className={pressed(only === "conflicts")}>
            Conflicts {nConflicts}
          </button>
        )}
        <button type="button" aria-expanded={filterOpen} aria-controls={`${ids}-filter`} onClick={() => setFilterOpen((o) => !o)} className={pressed(false)}>
          Filter
        </button>
      </div>
      {filterOpen && (
        <div id={`${ids}-filter`} className={`${card} p-3.5 flex flex-wrap gap-4`}>
          <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
            Which changes
            <select
              value={view}
              onChange={(e) => { setView(e.target.value as View); setOnly(null); }}
              className="min-h-[44px] rounded-lg border border-border bg-card px-3 text-sm font-normal"
            >
              <option value="all">Everything waiting</option>
              {w.toDecide.length > 0 && <option value="decide">To decide</option>}
              {w.small.length > 0 && <option value="small">Small changes</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
            Circle
            <select value={circle} onChange={(e) => setCircle(e.target.value)} className="min-h-[44px] rounded-lg border border-border bg-card px-3 text-sm font-normal">
              <option value="">Every circle</option>
              {allGroups.map((g) => (
                <option key={g.key} value={g.key}>{g.name ?? "Not in a circle"}</option>
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
        Nothing here matches what is chosen above.{" "}
        <button type="button" onClick={() => { setView("all"); setOnly(null); setCircle(""); }} className={inlineLink}>
          Show everything waiting
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
                    <CompactRow key={d.key} d={d} inset={i > 0} selected={pick?.key === d.key} onSelect={() => setSelected(d.key)} />
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
        See them at the bottom of this page.
      </a>
    </>
  );

  // What Check again found, said in the card while the card stands, and under the headline once the read is whole.
  const askedWords = asked.startsWith("answered:") ? `${agent} ${trouble?.noAnswer ? "still didn't answer" : "answered"} at ${asked.slice(9)}.` : asked;
  const askedLine = !trouble?.noAnswer && asked && (
    <p role="status" className="text-sm text-foreground">{askedWords}</p>
  );
  const troubleCards = trouble && (
    <>
      {trouble.noAnswer ? (
        <section aria-labelledby={`${ids}-err`} className={`bg-card border border-coral rounded-xl p-3.5 flex flex-col gap-2.5`}>
          <h3 id={`${ids}-err`} className="text-base font-bold text-coral">
            {agent} didn't answer at {clockWords(list.lastReadAt, now)}
          </h3>
          {trouble.lines.map((l) => (
            <p key={l} className="text-[15px] leading-normal text-foreground">{l}</p>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void checkAgain()} className={`${primary} self-start px-4`}>
              Check again
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
        Nothing counts as removed because of a check that failed. A role leaves the list only when {agent} archives it, or when it
        is missing from two full checks in a row.
      </p>
    </>
  );

  const bottom = (
    <>
      {ahead && (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-normal text-muted-foreground">
            {ahead}{" "}
            <button type="button" aria-expanded={aheadOpen} onClick={() => setAheadOpen((o) => !o)} className={inlineLink}>
              {aheadOpen ? "Hide them" : `See which ${w.oursAhead.length === 1 ? "one" : w.oursAhead.length}`}
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
            Facts updated since yesterday: {w.facts.length}
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">Review dates, sectors and role types {agent} keeps.</p>
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
          {checked ?? `Nothing has been read from ${agent} yet.`}
          {step ? " Nothing waits for you, and no draft is open." : draftOpen ? " A draft from this queue is still open." : ""}
        </p>
        {facts && <p className="text-sm leading-normal text-muted-foreground">{factsLine}</p>}
        {list.lastReadAt !== null && (
          <section aria-labelledby={`${ids}-sw`} className={`${card} p-3.5 flex flex-col gap-2`}>
            <h3 id={`${ids}-sw`} className="text-base font-bold text-foreground">Small changes apply by themselves: off</h3>
            <p className="text-sm leading-normal text-muted-foreground">Until it is on, each small change waits for you in this list.</p>
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
        {status_}
        <div className="flex gap-6 items-start">
          <div className="w-[480px] shrink-0 flex flex-col gap-2">{groups(true)}</div>
          <Pane ctx={ctx} d={pick} />
        </div>
        {bottom}
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
        {status_}
      </div>
      {groups(false)}
      {bottom}
    </section>
  );
}

/** R38: what a member without the queue's key sees. The count, who decides, and never a subject. */
function SeraMember({ count, agent }: { count: CountAnswer; agent: string }) {
  const ids = useId();
  // The headline's own rule (shared/seraWaiting.ts), so a member and a moderator read one number.
  const n = headlineCount(count);
  const small = count.toDecide === 0;
  const heading =
    n > 0
      ? `${agent} suggests ${small ? `${n} small ${n === 1 ? "change" : "changes"}` : changes(n)} for the chart`
      : count.lastReadWhole && count.lastReadAt
        ? `The chart and ${agent} are in step`
        : `Nothing from ${agent} waits for the chart`;
  return (
    <section id="sera-changes" aria-labelledby={`${ids}-h`} className="scroll-mt-24 flex flex-col gap-4">
      <div className={`${card} p-3.5 flex flex-col gap-2.5`}>
        <h2 id={`${ids}-h`} className="text-[19px] leading-snug font-bold text-foreground">{heading}</h2>
        {n > 0 && count.decides && <p className="text-[15px] leading-normal text-foreground">{whoDecidesWords(count.decides, n)}</p>}
        {count.reader?.decides && (
          <p className="text-[15px] leading-normal text-foreground">These reach you as a draft to publish, once someone who reads the list puts them in one.</p>
        )}
        <p className="text-sm leading-normal text-muted-foreground">Small changes applying by themselves: off.</p>
      </div>
      <p className="text-[13px] leading-normal text-muted-foreground">
        Members see how many changes wait and who decides them. The changes themselves are read by the people who decide.
      </p>
    </section>
  );
}

/** The section, by what the two reads answered. */
export default function SeraDifferences({
  read,
  draftOpen,
  onRetry,
}: {
  read: SeraRead;
  draftOpen: boolean;
  onRetry: () => Promise<void>;
}) {
  if (read.phase === "loading" || read.phase === "off") return null;
  if (read.phase === "member") return <SeraMember count={read.count} agent={read.agent} />;
  if (read.phase === "failed") {
    return (
      <section id="sera-changes" aria-labelledby="sera-failed-h" className={`${card} p-5 scroll-mt-24`}>
        <h2 id="sera-failed-h" className="text-xl font-bold text-foreground">The list of changes did not load</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {read.error}. There may be changes waiting; this is not an empty list.
        </p>
        <button type="button" onClick={() => void onRetry()} className={`${secondary} mt-4`}>
          Read the list again
        </button>
      </section>
    );
  }
  return <SeraList list={read.list} pay={read.count.paySetBy} draftOpen={draftOpen} onRetry={onRetry} />;
}

/**
 * The service's old batch cards, once the list above holds the same records:
 * folded, with no accept, so nothing is offered twice. Retiring them is a
 * later release (spec R28); until then each opens in the structure review.
 */
export function SeraEarlierArrivals({
  agent,
  batches,
  when,
  chartKinds,
}: {
  agent: string;
  batches: ReadonlyArray<{ batchId: string; receivedAt: string | null; items: ReadonlyArray<{ kind: string }> }>;
  when: (iso: string | null) => string;
  chartKinds: readonly string[];
}) {
  if (batches.length === 0) return null;
  return (
    <details className={`${card} p-5`}>
      <summary className="min-h-[44px] flex items-center font-semibold text-foreground cursor-pointer">
        Earlier {agent} arrivals, now listed above
      </summary>
      <p className="text-sm text-muted-foreground mt-2">
        What each of these holds is in the list above, so none of it is offered here a second time.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {batches.map((b) => (
          <li key={b.batchId} className="text-sm text-foreground flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>
              Arrived {when(b.receivedAt)}, with {b.items.length === 1 ? "1 proposal" : `${b.items.length} proposals`}.
            </span>
            {b.items.some((i) => chartKinds.includes(i.kind)) && (
              <Link href={`/review/structure/${encodeURIComponent(b.batchId)}`} className={secondary}>
                Review it as one structure change
              </Link>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── What /review carries of all this ────────────────────────────────────────

/** The kinds that change the chart, as the structure review reads them. */
const CHART_KINDS: readonly string[] = STRUCTURE_KINDS;

/** The two reads, what waits on this reader, and which of the queue's batches fold away, for /review. */
export function useSeraOnReview() {
  const { read, load } = useSeraDifferences();
  // An old arrival folds away unoffered only when EVERY item in it changes the chart and the newest read
  // holds it whole (review S1): a note keeps its Accept, Reject and text box, and an arrival landed after
  // a failed snapshot stays offered. Spec R28 retires them later.
  const held = read.phase === "listed" && read.list.lastReadAt !== null ? new Set(read.list.heldBatches ?? []) : new Set<string>();
  return {
    read,
    load,
    waits: seraWaiting(read),
    folds: (b: { batchId: string; moduleId: string | null; items: ReadonlyArray<{ kind: string }> }) =>
      b.moduleId === SERA_MODULE && held.has(b.batchId) && b.items.length > 0 && b.items.every((i) => CHART_KINDS.includes(i.kind)),
  };
}
export type SeraOnReview = ReturnType<typeof useSeraOnReview>;

type QueueBatch = { batchId: string; moduleId: string | null; receivedAt: string | null; items: ReadonlyArray<{ kind: string }> };

/** The top of /review: the summary line with its jump links, then the section (R37). */
export function SeraTop({
  sera,
  queue,
  witness,
}: {
  sera: SeraOnReview;
  queue: { batches?: QueueBatch[]; openDrafts?: unknown[] } | null;
  witness: number;
}) {
  return (
    <>
      <SeraSummaryLine read={sera.read} witness={witness} />
      <SeraDifferences read={sera.read} draftOpen={(queue?.openDrafts ?? []).length > 0} onRetry={sera.load} />
    </>
  );
}

/** The page a member the queue refuses is shown: how many changes wait and who decides them (R38). */
export function SeraMemberPage({ sera }: { sera: SeraOnReview }) {
  return (
    <>
      <h1 className="text-2xl font-bold text-foreground">Review</h1>
      <SeraDifferences read={sera.read} draftOpen={false} onRetry={sera.load} />
    </>
  );
}

/** The service's old batches, folded once the list holds them. */
export function SeraFold({ sera, batches, when }: { sera: SeraOnReview; batches: QueueBatch[]; when: (iso: string | null) => string }) {
  if (sera.read.phase !== "listed") return null;
  return <SeraEarlierArrivals agent={sera.read.list.agent} batches={batches.filter(sera.folds)} when={when} chartKinds={CHART_KINDS} />;
}
