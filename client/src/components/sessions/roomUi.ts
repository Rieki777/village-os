/**
 * The live room's class strings and the small readings every stage shares.
 *
 * Light surfaces on the semantic tokens only, so a village's own colours reach
 * every control (index.css, shared/brandTokens.ts). Every control is at least
 * 44px tall, the phone's thumb target, and the same classes read on a shared
 * screen across a room.
 */
import { useState } from "react";
import {
  ROOM_COPY,
  consentTally,
  isConsentValue,
  type ConsentTally,
  type ConsentValue,
  type ResponseTarget,
  type SessionEntry,
  type SessionItem,
  type SessionPerson,
  type SessionView,
} from "@shared/sessions";
import type { RoomActions } from "./useSessionRoom";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2";

export const BTN_PRIMARY =
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal-deep px-5 py-2.5 font-semibold text-white hover:bg-teal-deep-dark disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

export const BTN_SECONDARY =
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-teal-deep bg-card px-4 py-2 font-semibold text-teal-deep hover:bg-teal-deep/5 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

export const BTN_QUIET =
  `inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-teal-deep underline underline-offset-2 hover:bg-teal-deep/5 disabled:opacity-50 ${FOCUS}`;

export const BTN_ICON =
  `inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 ${FOCUS}`;

export const CARD = "rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm";

export const SOFT = "rounded-xl bg-muted/60 px-4 py-3";

export const INPUT =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring";

export const LABEL = "block text-sm font-semibold text-foreground";

export const HINT = "text-sm text-muted-foreground";

export const H2 = "font-display text-2xl font-bold text-foreground";

export const H3 = "text-base font-semibold text-foreground";

export const CHIP = "inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground";

/** A tile that is chosen or not: the consent tiles, the eleven numbers, the facilitation choices. */
export function tile(on: boolean): string {
  return `min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${FOCUS} ${
    on ? "border-teal-deep bg-teal-deep text-white" : "border-border bg-card text-foreground hover:border-teal-deep"
  }`;
}

/** A person's name out of the room, or nothing for somebody the room does not know. */
export function nameOf(view: Pick<SessionView, "people">, userId: number | null | undefined): string | null {
  if (userId == null) return null;
  return view.people.find((p) => p.userId === userId)?.name ?? null;
}

/** First name, the way the rest of the village speaks to people. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** People who are here now. */
export function presentPeople(view: Pick<SessionView, "people">): SessionPerson[] {
  return view.people.filter((p) => p.present);
}

/** The agenda in its order. */
export function agendaOrder(items: SessionItem[]): SessionItem[] {
  return [...items].sort((a, b) => a.position - b.position || a.id - b.id);
}

/** The consent answers on one target, as values and as a tally against the people here. */
export function consentOn(view: Pick<SessionView, "responses" | "people">, target: ResponseTarget): { values: ConsentValue[]; tally: ConsentTally } {
  const mine = view.responses.filter((r) => r.target === target && isConsentValue(r.value));
  const values = mine.map((r) => r.value as ConsentValue);
  const answers = mine.map((r) => ({ who: r.userId, value: r.value as ConsentValue }));
  return { values, tally: consentTally(answers, presentPeople(view).map((p) => p.userId)) };
}

/**
 * Whether the server hands this viewer the room's answers. It sends them to the
 * people who joined and to admins (server/lib/liveSessions.ts, `buildView`), so
 * anybody else gets an empty list, which is not the same as nobody answering.
 */
export function seesAnswers(view: Pick<SessionView, "me">): boolean {
  return view.me.joined || view.me.admin;
}

/** This member's own answer on a target, if they gave one. */
export function myResponse(view: Pick<SessionView, "responses" | "me">, target: ResponseTarget) {
  return view.responses.find((r) => r.target === target && r.userId === view.me.userId) ?? null;
}

/** Who holds an action, as a line: the seat, the person, or nobody yet. */
export function ownerLine(e: Pick<SessionEntry, "ownerSeatName" | "ownerName" | "ownerUserId">): string {
  if (e.ownerSeatName && e.ownerName) return `${e.ownerSeatName} (${e.ownerName})`;
  if (e.ownerSeatName) return e.ownerSeatName;
  if (e.ownerName) return e.ownerName;
  return ROOM_COPY.nobodyHolds;
}

/** "Held by Water steward", or "Nobody holds this yet". */
export function heldLine(e: Pick<SessionEntry, "ownerSeatName" | "ownerName" | "ownerUserId" | "ownerSeatId">): string {
  return isHeld(e) || e.ownerSeatName || e.ownerName ? `${ROOM_COPY.heldBy} ${ownerLine(e)}` : ROOM_COPY.nobodyHolds;
}

/**
 * WHO SEES WHICH CONTROL. The server decides every write (server/lib/
 * liveSessions.ts, `rolesIn` and `entryRights`); these only keep a button off
 * the screen where the server would refuse it. An admin's backstop powers are
 * the server's to honour and are not drawn into the room, so an admin sitting
 * in a session as a member sees what a member sees.
 *
 *   leads  the person facilitating: moves the room, orders the agenda, sets
 *          an item's status, marks a proposal decided, closes.
 *   notes  the facilitator or the note taker: any item's words, any entry's
 *          text, status, seat and date.
 */
export function leads(view: Pick<SessionView, "me" | "status">): boolean {
  return view.status === "open" && view.me.facilitates;
}

export function keepsNotes(view: Pick<SessionView, "me" | "status">): boolean {
  return view.status === "open" && (view.me.facilitates || view.me.secretary);
}

/** What this member may do to one entry, the server's matrix read for the screen. */
export function entryRightsFor(view: Pick<SessionView, "me" | "status">, e: Pick<SessionEntry, "authorUserId" | "ownerUserId">) {
  const open = view.status === "open" && view.me.joined;
  const author = open && e.authorUserId === view.me.userId;
  const holder = open && e.ownerUserId != null && e.ownerUserId === view.me.userId;
  const notes = open && keepsNotes(view);
  return {
    edit: author || notes,
    seat: author || notes,
    dueOn: author || holder || notes,
    status: author || notes,
    remove: author || notes,
    claim: open && e.ownerUserId == null,
    release: e.ownerUserId != null && (holder || (open && leads(view))),
  };
}

/** Whether an action leaves with somebody. */
export function isHeld(e: Pick<SessionEntry, "ownerUserId" | "ownerSeatId">): boolean {
  return e.ownerUserId != null || !!e.ownerSeatId;
}

/** Seats for a picker: the meeting circle's own first, then the rest. */
export function seatOrder(view: Pick<SessionView, "seats" | "circleId">) {
  const mine = view.seats.filter((s) => view.circleId && s.circleId === view.circleId);
  const rest = view.seats.filter((s) => !(view.circleId && s.circleId === view.circleId));
  return [...mine, ...rest];
}

/** "Thursday 9 October", in the reader's own locale. */
export function dayLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/** What every stage is handed: the room, the room's clock, and the doors. */
export interface StageProps {
  view: SessionView;
  now: number;
  actions: RoomActions;
}

/**
 * WORDS BEING TYPED OUTLIVE THE FORM THEY ARE TYPED IN. The facilitator moves
 * the room, or starts another item, while somebody is halfway through a
 * sentence, and that unmounts the form under them. So what is typed is kept
 * here, outside every stage, keyed by session, item and field, and the form
 * that mounts again with the same key gets it back. Only a send the server
 * took clears it. It lives in this tab's memory and nowhere else, so a reload
 * starts clean and nothing typed is ever written down.
 */
const DRAFTS = new Map<string, string>();

export interface Draft {
  text: string;
  set(next: string): void;
  /** The server took it: forget the draft, and show `shown` (empty by default). */
  clear(shown?: string): void;
}

export function useDraft(key: string, fallback = ""): Draft {
  const [held, setHeld] = useState(() => ({ key, text: DRAFTS.get(key) ?? fallback }));
  const text = held.key === key ? held.text : (DRAFTS.get(key) ?? fallback);
  return {
    text,
    set(next) {
      if (next) DRAFTS.set(key, next);
      else DRAFTS.delete(key);
      setHeld({ key, text: next });
    },
    clear(shown = "") {
      DRAFTS.delete(key);
      setHeld({ key, text: shown });
    },
  };
}

/** Forget every draft. For tests, which share one module between cases. */
export function forgetDrafts(): void {
  DRAFTS.clear();
}
