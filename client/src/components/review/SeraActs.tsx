/**
 * What a row of the outside service's differences offers on /review, and the
 * edit panel and status strip beside it (spec R30, R32, R34; the approved
 * "Waiting for you", "A conflict, stacked" and "1280 px" boards).
 *
 * ACTIONS SAY WHAT THEY DO (R30). A decision is "Add to draft", and a line
 * under it says it goes into a draft before it is live. A role or circle the
 * service archived is "Retire it here", which goes into the same draft. A
 * conflict is compared first, and its compare offers "Take Sera's: add to
 * draft", "Keep ours" and "Edit: start from Sera's" (R34: "ours", never the
 * village's name; the agent's name from config). Every action is a real
 * button whose name starts with its visible label (R32), and carries
 * `data-act` so the keyboard can press it.
 *
 * Nothing here changes the chart: a take is a draft, and the draft is
 * published through the doors every draft has (SeraInDraft.tsx).
 */
import { useEffect, useId, useRef } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { whoSetsPayWords, type Door } from "@shared/seraDecides";
import { comparable, possessive, type ListedDifference } from "@/lib/seraReview";
import { editable, type SeraActs } from "@/components/review/useSeraActs";
import { card, inlineLink, primary, secondary } from "@/components/review/seraStyles";

const isRest = (d: ListedDifference) => d.kind === "roleRest" || d.kind === "circleRest";

/** The tick on a row, with a 44 px target and the row's sentence in its name (the boards' "Tick: ..."). */
export function RowTick({ d, acts, compact }: { d: ListedDifference; acts: SeraActs; compact?: boolean }) {
  const { t } = useLingui();
  const sentence = d.words.sentence;
  return (
    <label className={`flex ${compact ? "items-start justify-center min-w-[44px] min-h-[44px] pt-3 pl-1.5" : "items-start justify-center min-w-[44px] min-h-[44px] pt-0.5"} shrink-0 cursor-pointer`}>
      <input
        type="checkbox"
        data-tick={d.key}
        checked={acts.ticked.has(d.key)}
        onChange={(e) => acts.tick(d.key, e.target.checked)}
        aria-label={t({ message: `Tick: ${sentence}`, context: "sera answers" })}
        className={`${compact ? "w-5 h-5" : "w-[22px] h-[22px]"} accent-notice`}
      />
    </label>
  );
}

/** "1 Nov", in the reader's own zone, the way the boards date things. */
const dayMonth = (iso: string): string => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/**
 * The conflict's subtitle: when somebody here rewrote it, only when published
 * history gives a real time for it, then the choice. With no such time it says
 * only the choice (the server leaves `changedHereAt` out).
 */
export function ConflictSubtitle({ d }: { d: ListedDifference }) {
  const at = d.changedHereAt ? dayMonth(d.changedHereAt) : null;
  if (d.state !== "conflict") return null;
  return (
    <p className="text-sm leading-normal text-muted-foreground">
      {at && (d.kind === "rename" ? <Trans context="sera answers">Someone here renamed it on {at}.</Trans> : <Trans context="sera answers">Someone here rewrote it on {at}.</Trans>)}{" "}
      <Trans context="sera answers">Choose one, or write your own.</Trans>
    </p>
  );
}

/** The line under a decision: what its button does before anything is live (R30). */
export function DecisionNote({ d }: { d: ListedDifference }) {
  if (d.lane !== "decision" || d.state !== "suggestion" || d.kind === "pay" || d.words.flags.length > 0) return null;
  return (
    <p className="text-[13px] text-muted-foreground">
      <Trans context="sera answers">A decision. It goes into a draft before it is live.</Trans>
    </p>
  );
}

/** The chip a set-aside row carries: a moderator kept it, and the people who decide still see it (R16). */
export function SetAsideChip({ d }: { d: ListedDifference }) {
  if (!d.setAside) return null;
  return (
    <p className="self-start rounded-lg bg-muted text-foreground px-2 py-1 text-[13px] font-semibold">
      <Trans context="sera answers">Set aside: kept by someone who does not decide these</Trans>
    </p>
  );
}

interface ActionsProps {
  d: ListedDifference;
  acts: SeraActs;
  agent: string;
  /** Who sets pay, for the pay row's line. */
  pay: Door | null;
  /** A row card, the 1280 px pane, or the phone's compare view. */
  layout: "card" | "pane" | "compare";
  onCompare?: (d: ListedDifference) => void;
}

/** The buttons a row offers, by what it is and where it is drawn. */
export function RowActions({ d, acts, agent, pay, layout, onCompare }: ActionsProps) {
  const { t } = useLingui();
  if (d.kind === "pay") return pay ? <p className="text-[13px] text-muted-foreground">{whoSetsPayWords(pay)}</p> : null;
  const owner = possessive(agent);
  const busy = acts.busy;
  const block = layout === "compare";
  const size = block ? " min-h-[48px] w-full text-[15px]" : "";
  const canEdit = editable(d);
  const conflict = d.state === "conflict";

  if (layout === "card" && conflict && comparable(d)) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-compare={d.key} data-act="compare" onClick={() => onCompare?.(d)} className={primary}>
          <Trans context="sera answers">Compare them</Trans>
        </button>
      </div>
    );
  }
  const takeLabel = isRest(d)
    ? t({ message: "Retire it here", context: "sera answers" })
    : conflict || layout !== "card"
      ? t({ message: `Take ${owner}: add to draft`, context: "sera answers" })
      : t({ message: "Add to draft", context: "sera answers" });
  // Words that name a member start from ours (R9, review 1), and the button says so.
  const editLabel =
    layout !== "compare"
      ? t({ message: "Edit", context: "sera answers" })
      : d.namesAMember
        ? t({ message: "Edit: start from ours", context: "sera answers" })
        : t({ message: `Edit: start from ${owner}`, context: "sera answers" });
  // aria-disabled while an act is under way, so focus stays on the button pressed (review 23).
  const guard = (fn: () => void) => () => {
    if (!busy) fn();
  };
  const take = d.takeable && (
    <button type="button" data-act="take" aria-disabled={busy || undefined} onClick={guard(() => void acts.take(d))} className={`${primary}${size}`}>
      {takeLabel}
    </button>
  );
  // Never the primary button on a row whose words name a member: there is nothing of the service's to take there.
  const edit = canEdit && (layout !== "card" || !d.takeable) && (
    <button type="button" data-act="edit" data-edit-for={d.key} aria-disabled={busy || undefined} onClick={guard(() => acts.startEdit(d, "sera"))} className={`${secondary}${size}`}>
      {editLabel}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      {!d.takeable && !canEdit && (
        <p className="text-[13px] text-muted-foreground">
          <Trans context="sera answers">Its words name a member here, so they cannot be taken as they are.</Trans>
        </p>
      )}
      <div className={block ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2"}>
        {take}
        <button type="button" data-act="keep" aria-disabled={busy || undefined} onClick={guard(() => void acts.keep(d))} className={`${secondary}${size}`}>
          <Trans context="sera answers">Keep ours</Trans>
        </button>
        {edit}
        {layout === "card" && comparable(d) && onCompare && (
          <button type="button" data-compare={d.key} onClick={() => onCompare(d)} className={secondary}>
            <Trans context="sera answers">Compare them</Trans>
          </button>
        )}
      </div>
      {layout === "compare" && (
        <p className="text-[13px] leading-normal text-muted-foreground">
          <Trans>Keep ours means {owner} version stays out of the list until {agent} changes it again. Undo brings it back.</Trans>
        </p>
      )}
    </div>
  );
}

/**
 * Write your own (the conflict board's edit panel): prefilled with the
 * service's words or ours, "Add my words to draft", Cancel, and the other
 * starting point. Escape leaves it (R32), and focus starts in the words.
 */
export function EditPanel({ d, acts, agent }: { d: ListedDifference; acts: SeraActs; agent: string }) {
  const { t } = useLingui();
  const id = useId();
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const e = acts.editing;
  useEffect(() => {
    if (e?.key === d.key) field.current?.focus();
  }, [e?.key, e?.from, d.key]);
  if (!e || e.key !== d.key) return null;
  const name = possessive(d.subject.name);
  const owner = possessive(agent);
  const label = d.kind === "rename" ? t({ message: `${name} name`, context: "sera answers" }) : t({ message: `${name} purpose`, context: "sera answers" });
  const inputClass = "w-full box-border p-2.5 border border-border rounded-lg bg-card text-[15px] leading-normal text-foreground";
  return (
    <section
      aria-labelledby={`${id}-h`}
      onKeyDown={(ev) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          acts.stopEdit();
        }
      }}
      className={`${card} border-notice p-3.5 flex flex-col gap-2`}
    >
      <h3 id={`${id}-h`} className="text-[15px] font-bold text-foreground">
        <Trans context="sera answers">Write your own</Trans>
      </h3>
      <label htmlFor={`${id}-v`} className="text-sm font-semibold text-foreground">
        {label}
      </label>
      {d.kind === "rename" ? (
        <input id={`${id}-v`} ref={field} value={e.value} onChange={(ev) => acts.setValue(ev.target.value)} className={inputClass} />
      ) : (
        <textarea id={`${id}-v`} ref={field} rows={5} value={e.value} onChange={(ev) => acts.setValue(ev.target.value)} className={inputClass} />
      )}
      <div className="flex gap-2">
        <button type="button" data-act="edit-save" aria-disabled={acts.busy || undefined} onClick={() => !acts.busy && void acts.edit(d, e.value)} className={`${primary} flex-1`}>
          <Trans context="sera answers">Add my words to draft</Trans>
        </button>
        <button type="button" onClick={() => acts.stopEdit()} className={secondary}>
          <Trans context="sera answers">Cancel</Trans>
        </button>
      </div>
      {/* Words that name a member are never offered back to type over (R9). */}
      {!d.namesAMember && (
        <button type="button" onClick={() => acts.startEdit(d, e.from === "sera" ? "ours" : "sera")} className={`self-start min-h-[44px] text-sm font-semibold ${inlineLink}`}>
          {e.from === "sera" ? <Trans context="sera answers">Start from ours instead</Trans> : <Trans context="sera answers">Start from {owner} instead</Trans>}
        </button>
      )}
    </section>
  );
}

/**
 * ONE polite live region for the list (R32, review 28), drawn above both the
 * list and the phone's compare view so it stays put when the view changes. It
 * says the latest of two things, once each: what an act did, and what a
 * filter now shows (QA Q4).
 */
export function LiveRegion({ words }: { words: string }) {
  return (
    <p role="status" className="sr-only">
      {words}
    </p>
  );
}

/**
 * What the last act did, with its Undo, until the next one (R30). It sticks
 * under the header while it has something to say (the page's `top-24`
 * convention), so an act far down the list still shows its outcome and its
 * Undo, where the bulk board floats it. It is not itself a live region:
 * LiveRegion announces the words once. Focus comes here after an act that
 * leaves nothing else to focus (review 23).
 */
export function StatusStrip({ acts }: { acts: SeraActs }) {
  const s = acts.strip;
  if (!s) return null;
  return (
    <div data-sera-strip-on="" className="sticky top-24 z-30 rounded-[10px] bg-card shadow-sm">
      <div data-sera-strip="" tabIndex={-1} className="bg-notice/10 border border-notice rounded-[10px] px-3 py-1.5 text-sm leading-snug text-foreground [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring">
        <span className="inline-block py-1.5">{s.words}</span>
        {s.undo && (
          <>
            {" "}
            <button type="button" aria-disabled={acts.busy || undefined} onClick={() => !acts.busy && void acts.undo(s.undo!)} className={`inline-flex items-center min-h-[44px] px-1 font-semibold ${inlineLink}`}>
              <Trans context="sera answers">Undo</Trans>
            </button>
          </>
        )}
        {s.leftOut.length > 0 && (
          <span className="block pb-1.5 text-[13px] text-muted-foreground">
            <Trans context="sera answers">Left out: {s.leftOut.join("; ")}.</Trans>
          </span>
        )}
      </div>
    </div>
  );
}
