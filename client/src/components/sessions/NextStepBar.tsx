/**
 * THE NEXT STEP, ALWAYS IN SIGHT. Rye, 2026-10-30: "make this a more obvious
 * button and find other places to make the next step more obvious and easy
 * for other facilitators to find to move the meeting along in a clear way."
 *
 * The facilitator sees one bar under the stage, held to the bottom of the
 * screen while they scroll (above the tab bar on a phone). It names the one
 * next thing and offers one button to do it:
 *
 *   agenda   up next is the first item: start it, which moves the room to
 *            the items and starts that item's clock
 *   items    with an item on: up next is the following one, wrap this up and
 *            start it (or wrap it up, on the last); with none on: start the
 *            next; with every item done: on to the actions
 *   close    the last step, which takes them to the close button
 *
 * WHEN THE TIME IS UP the bar says so, in the room's notice colour, and offers
 * five more minutes beside the wrap up, so the prompt is where their thumb
 * already is. Its line is a polite live region, so the change is heard.
 *
 * The other stages have the facilitator's bar and its one gold button, which
 * already names the next stage. This bar's button is the plain strong one, so
 * the gold stays one per screen.
 */
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { ROOM_COPY, SESSION_COPY, SESSION_LIMITS, STAGE_DEFS, timebox, type SessionAction, type SessionStage, type SessionView } from "@shared/sessions";
import { BTN_PRIMARY, BTN_SECONDARY, agendaOrder, leads } from "./roomUi";
import type { RoomActions } from "./useSessionRoom";

/** What a button does: moves for the room, in order, or a place on the page to go to. */
type Move = { acts: SessionAction[] } | { focus: string };

export interface NextStep {
  line: string;
  over: boolean;
  primary: { label: string; move: Move };
  secondary?: { label: string; move: Move };
}

/** Where the close stage's button lives, for the bar to take the facilitator to. */
export const CLOSE_TARGET = "close-session";

/** The one next thing on the stage the room is on, for whoever leads it. Null where the facilitator's bar already says it. */
export function nextStep(view: Pick<SessionView, "state" | "items" | "status" | "me">, now: number): NextStep | null {
  if (!leads(view) || view.state.startedAt == null) return null;
  const order = agendaOrder(view.items);
  const stage = view.state.stage;
  if (stage === "agenda") {
    const first = order.find((i) => i.status === "waiting");
    if (!first) return null;
    return {
      line: ROOM_COPY.upNext(first.title),
      over: false,
      primary: { label: ROOM_COPY.startFirst, move: { acts: [{ type: "go", stage: "items" }, { type: "item", itemId: first.id }] } },
    };
  }
  if (stage === "items") {
    const active = view.items.find((i) => i.id === view.state.activeItemId) ?? null;
    const next = order.find((i) => i.status === "waiting" && i.id !== active?.id) ?? null;
    if (active) {
      const over = timebox(view.state.itemStartedAt, active.minutes, view.state.itemExtraMin, now).phase === "over";
      return {
        line: over ? ROOM_COPY.timeUpFor(active.title) : next ? ROOM_COPY.upNext(next.title) : ROOM_COPY.lastItem,
        over,
        primary: { label: next ? ROOM_COPY.wrapNext : ROOM_COPY.wrapUp, move: { acts: [{ type: "item", itemId: next?.id ?? null }] } },
        ...(over ? { secondary: { label: ROOM_COPY.extendFive, move: { acts: [{ type: "extend", minutes: SESSION_LIMITS.extendStepMin }] } } } : {}),
      };
    }
    if (next) {
      const begun = view.items.some((i) => i.status === "done");
      return {
        line: ROOM_COPY.upNext(next.title),
        over: false,
        primary: { label: begun ? ROOM_COPY.startNext : ROOM_COPY.startFirst, move: { acts: [{ type: "item", itemId: next.id }] } },
      };
    }
    return {
      line: ROOM_COPY.itemsDone,
      over: false,
      primary: { label: `${ROOM_COPY.nextStage}: ${STAGE_DEFS.actions.short}`, move: { acts: [{ type: "go", stage: "actions" }] } },
    };
  }
  if (stage === "close") {
    return { line: ROOM_COPY.closeLast, over: false, primary: { label: ROOM_COPY.goToClose, move: { focus: CLOSE_TARGET } } };
  }
  return null;
}

export default function NextStepBar({
  view,
  now,
  actions,
  shown,
  onMoved,
}: {
  view: SessionView;
  now: number;
  actions: RoomActions;
  /** The stage on this screen: the bar speaks for the room's own stage only. */
  shown: SessionStage;
  onMoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const step = shown === view.state.stage ? nextStep(view, now) : null;
  if (!step) return null;

  const run = async (move: Move) => {
    if ("focus" in move) {
      const target = document.getElementById(move.focus);
      target?.scrollIntoView({ block: "center" });
      target?.querySelector<HTMLElement>("button")?.focus();
      return;
    }
    setBusy(true);
    try {
      for (const action of move.acts) {
        const r = await actions.act(action);
        if (!r.ok) return;
      }
      onMoved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={ROOM_COPY.nextStepLabel}
      data-next-step=""
      className={`sticky bottom-[calc(var(--tabbar-h)+0.75rem)] z-30 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 shadow-lg backdrop-blur ${
        step.over ? "border-destructive/60 bg-muted/95" : "border-notice/60 bg-card/95"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ROOM_COPY.nextStepLabel}</p>
        <p role="status" aria-live="polite" aria-atomic="true" className="mt-0.5 font-semibold text-foreground">
          {step.line}
          {step.over && <span className="sr-only"> {SESSION_COPY.overChoices}</span>}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {step.secondary && (
          <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void run(step.secondary!.move)}>
            {step.secondary.label}
          </button>
        )}
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void run(step.primary.move)}>
          {step.primary.label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
