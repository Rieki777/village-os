/**
 * A facilitator fills in for a member (0288). Rye, 2026-10-30: "Facilitator
 * can fill other people's stuff out", live sessions first, with a notice to
 * the person.
 *
 * ── WHO, AND WHEN ────────────────────────────────────────────────────────
 *
 * Only the person facilitating the session, only while it is open, and only
 * for somebody who has joined the room. Not the secretary and not an admin:
 * the facilitator is the one holding the room, and a fill-in is part of
 * holding it. An admin who wants to fill in takes the facilitation first.
 *
 * ── WHAT MAY BE FILLED IN ────────────────────────────────────────────────
 *
 *   arrival   POST /arrival  { score, wish?, forUserId }
 *   item      POST /items    { ..., forUserId }: the item is added by them
 *   entry     POST /entries  { ..., forUserId }: a tension, a proposal, an
 *             action, any kind, written by them
 *   holder    PATCH /entries/:id { ownerUserId }: an action handed to somebody
 *             in the room, who then holds it
 *   changes   the facilitator changing the words, plan, role or date on
 *             something a member added (an item they added, an entry they
 *             wrote, an action they hold) is a fill-in too, without asking
 *
 * Every one of those writes a row naming both people. `forUserId` naming the
 * facilitator themself is an ordinary write and leaves no row.
 *
 * ── WHAT IS NEVER FILLED IN ──────────────────────────────────────────────
 *
 * A consent answer. Consent, a concern, an objection, a night, the closing
 * word and the feedback on the facilitation stay each person's own:
 * POST /respond with a `forUserId` is refused with `ownAnswer`, whoever sends
 * it. Marking a proposal decided reads the answers people gave; it gives none.
 *
 * ── THE PERSON KEEPS THE LAST WORD ───────────────────────────────────────
 *
 * The room shows `filledInBy` on whatever was filled in, to everybody. The
 * person hears about it through the notification spine, once per fill-in.
 * They can change it the way they change anything of their own, and while the
 * room is open they can undo it:
 *
 *   POST /api/sessions/:id/on-behalf/:fillId/undo   {} -> { ok }
 *
 * An undo puts back what was there: an added item or entry goes, a changed
 * one gets its old words, plan, holder or date, an arrival goes back to what
 * the person gave or to none. The facilitator who filled it in may undo it
 * too. A proposal decided by consent, or an item already talked about, is
 * past undoing.
 */

import type { EntryKind } from "./sessions";

/** Fill-in marks on what the room shows. Optional on the wire shapes so older fixtures still type. */
export interface FilledIn {
  /** The row in `live_session_on_behalf`, which the undo door names. */
  id: number;
  /** Whose it is: their number in the room. */
  personUserId: number;
  act: "added" | "changed";
  /** The viewer may undo it now: the person, or the facilitator who filled it in, while the room is open. */
  canUndo: boolean;
}

export const ON_BEHALF_TARGETS = ["arrival", "item", "entry"] as const;
export type OnBehalfTarget = (typeof ON_BEHALF_TARGETS)[number];

export const onBehalfUndoPath = (sessionId: number, fillId: number): string => `/api/sessions/${sessionId}/on-behalf/${fillId}/undo`;

/**
 * The role, never the person (Rye, 2026-10-22): the room names who filled it
 * in by the role they held. One function so the "Facilitator (FirstName)"
 * style lands here in one place.
 */
export const facilitatorRoleLabel = (): string => "the Facilitator";

export const ON_BEHALF_COPY = {
  filledInBy: (role: string = facilitatorRoleLabel()) => `Filled in by ${role}`,
  changedBy: (role: string = facilitatorRoleLabel()) => `Changed by ${role}`,
  undo: "Undo",
  undoing: "Undoing...",
  undone: "Undone. It is back the way it was.",
  /** The facilitator's own control: who their next writes are for. */
  fillingForLabel: "Filling in for",
  fillingForNobody: "Myself",
  fillingForLine: (name: string) => `What you add now goes in as ${name}'s, and they are told.`,
  /** The facilitator's control on an action: hand it to somebody in the room. */
  handActionTo: "Hand it to",
  handActionNobody: "Choose someone",
} as const;

export const ON_BEHALF_REFUSALS = {
  facilitatorOnly: "Only the person facilitating can fill something in for someone else.",
  personNotHere: "Choose someone who has joined the room.",
  ownAnswer: "Each person gives their own answer. Nobody can answer for someone else.",
  fillUnknown: "That is not something filled in during this session.",
  undoNotYours: "Only the person it was filled in for, or the facilitator who filled it in, can undo it.",
  undoneAlready: "That was undone already.",
  pastUndoing: "That has been talked about or decided, so it stays as it is. Change it the usual way.",
  holderNotAction: "Only an action can be handed to someone.",
} as const;

/** An entry's kind in the notice's words. */
export const ON_BEHALF_KIND_WORDS: Record<EntryKind, string> = {
  note: "a note",
  idea: "an idea",
  seed: "a line on what you learned",
  decision: "a proposal",
  action: "an action",
  tension: "a tension",
  win: "a win",
};

/** What was filled in, in the notice's words: "your arrival", "an agenda item", "a tension". */
export function onBehalfWhat(target: OnBehalfTarget, act: "added" | "changed", kind?: EntryKind | null): string {
  if (target === "arrival") return "your arrival";
  if (target === "item") return act === "added" ? "an agenda item" : "your agenda item";
  const words = kind ? ON_BEHALF_KIND_WORDS[kind] : "an entry";
  return act === "added" ? words : `${words.replace(/^an? /, "your ")}`;
}

export const ON_BEHALF_NOTICES = {
  /** "The Facilitator filled in a tension for you in "Weekly circle"". */
  title: (sessionTitle: string, what: string, act: "added" | "changed", role: string = facilitatorRoleLabel()) => {
    const did = act === "changed" ? `changed ${what}` : what.startsWith("your ") ? `filled in ${what}` : `filled in ${what} for you`;
    return `${role.charAt(0).toUpperCase()}${role.slice(1)} ${did} in "${sessionTitle}"`;
  },
  body: "It is yours. You can change it, or undo it from the room while the session is open.",
} as const;
