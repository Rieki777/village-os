/**
 * The small parts of the needs ceremony, every one of them at module scope.
 *
 * NOT ONE COMPONENT IN THIS FILE OR IN `NeedsPanel.tsx` IS DECLARED INSIDE
 * ANOTHER COMPONENT'S BODY. That rule cost this repository a real defect:
 * `Section` was declared inside `SetupWizard`, which made a new component TYPE
 * on every render, and React replaced the whole subtree on every keystroke. The
 * founder of the live village reported it as "every time I type a single letter
 * it takes down my keyboard". See `SetupSection.tsx` for the full account.
 *
 * Every colour here is a theme token. A brand hex or a `text-gray-500` would be
 * a colour a founder's seed colour can never reach, which is what
 * `scripts/check-theme-literals.mjs` and `scripts/check-tailwind-gray.mjs`
 * exist to stop. The one exception is a need's own `hue`, which is platform
 * taxonomy data and is drawn as a dot that never carries meaning on its own:
 * the label is always beside it.
 */
import {
  HUMAN_NEEDS_BY_ID,
  NEED_DEPTHS,
  NEED_DEPTH_LABELS,
  type HumanNeedDef,
  type NeedDepth,
} from "@shared/needs";
import { SCREENS, rungMeaning, type Drafts, type NeedDraft } from "./needsCopy";

/* -------------------------------------------------------------------------- *
 * Module-scope pieces. NOT ONE of these is declared inside a component body.
 * -------------------------------------------------------------------------- */

export const CARD = "rounded-xl border border-border bg-card text-card-foreground";
export const HINT = "text-xs text-muted-foreground";
export const PRIMARY =
  "px-4 py-2 rounded-lg text-sm font-medium bg-teal-deep text-white min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring";
export const QUIET =
  "px-3 py-2 rounded-lg text-sm font-medium border border-border bg-background text-foreground min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring";
export const FIELD =
  "rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** The colour dot beside a need. Never the only signal: the label is always there. */
export function NeedDot({ needKey }: { needKey: string }) {
  const def: HumanNeedDef | undefined = HUMAN_NEEDS_BY_ID[needKey];
  return (
    <span
      aria-hidden="true"
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ backgroundColor: def ? def.hue : "currentColor" }}
    />
  );
}

/** One tickable need on screen 1, with the deck's own expressions as its hint. */
export function NeedTickRow({
  draft,
  hint,
  onToggle,
}: {
  draft: NeedDraft;
  hint: string;
  onToggle: (key: string, on: boolean) => void;
}) {
  return (
    <label className={`${CARD} flex items-start gap-3 px-4 py-3 cursor-pointer`}>
      <input
        type="checkbox"
        checked={draft.on}
        onChange={(e) => onToggle(draft.key, e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-teal-deep shrink-0 focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <NeedDot needKey={draft.key} />
          {draft.label}
        </span>
        <span className={`${HINT} block mt-0.5`}>{hint}</span>
      </span>
    </label>
  );
}

/**
 * The five rungs, as a real radio group.
 *
 * Native radios and not buttons, so the arrow keys move between rungs and the
 * group announces itself as one choice with five options without this file
 * hand-rolling a roving tabindex that would be wrong in some browser.
 */
export function DepthLadder({
  draft,
  onPick,
}: {
  draft: NeedDraft;
  onPick: (key: string, depth: NeedDepth) => void;
}) {
  return (
    <div role="radiogroup" aria-label={`How far this village means to get on ${draft.label}`} className="grid gap-1.5">
      {NEED_DEPTHS.map((d) => (
        <label key={d} className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name={`depth-${draft.key}`}
            value={d}
            checked={draft.depth === d}
            onChange={() => onPick(draft.key, d)}
            className="mt-1 h-4 w-4 accent-teal-deep shrink-0 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span>
            <span className="font-medium text-foreground">{NEED_DEPTH_LABELS[d]}</span>
            <span className={`${HINT} block`}>{rungMeaning(d, draft.label)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** What the founder has already said, carried onto every screen after the first. */
export function Recap({ drafts, order, upTo }: { drafts: Drafts; order: string[]; upTo: number }) {
  const live = order.map((k) => drafts[k]).filter((d) => d && d.on);
  if (live.length === 0) {
    return <p className={HINT}>No need is ticked yet. Screen 1 is where that starts.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {live.map((d) => (
        <li
          key={d.key}
          className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground"
        >
          <NeedDot needKey={d.key} />
          {d.label}
          {upTo >= 2 ? <span className="text-muted-foreground">{NEED_DEPTH_LABELS[d.depth]}</span> : null}
          {upTo >= 3 ? <span className="text-muted-foreground">{d.breadth} percent</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** The numbered rail across the top of the panel. Every screen is reachable. */
export function ScreenRail({ at, onGo }: { at: number; onGo: (n: number) => void }) {
  return (
    <nav aria-label="The six screens of the needs setup" className="flex flex-wrap gap-1.5 mb-5">
      {SCREENS.map((s) => (
        <button
          key={s.n}
          type="button"
          onClick={() => onGo(s.n)}
          aria-current={at === s.n ? "step" : undefined}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border min-h-[36px] focus:outline-none focus:ring-2 focus:ring-ring ${
            at === s.n
              ? "border-teal-deep bg-teal-deep text-white"
              : "border-border bg-background text-muted-foreground"
          }`}
        >
          {s.n}. {s.title}
        </button>
      ))}
    </nav>
  );
}
