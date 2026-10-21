/**
 * The live room's class strings and the small readings every stage shares.
 *
 * THE ROOM IS A WORLD, the way the character sheet is. While a session is
 * open the room sits under `.sheet-night` and `.room-night` (index.css), so
 * the same semantic tokens these strings name (`bg-card`, `text-foreground`,
 * `border-border`, `text-notice`) resolve to the village's own canopy ground,
 * moonlight ink and earned gold. The closed record stays on the light linen,
 * and the very same strings read emerald on linen there, with `text-notice`
 * resolving to bronze. So nothing here names a colour, only a role, and a
 * village's brand reaches every control without a component edit.
 *
 * Every control is at least 44px tall, the phone's thumb target, and the same
 * classes read on a shared screen across a room.
 *
 * THE SEAT CARD IS THE MODEL. The profile's role card set the game's look:
 * one foil card per screen, small gold eyebrows, a display face set large and
 * light, monoline glyphs in a thin gold ring, and one gold button for the next
 * step. The names below borrow that card's parts, so the room and the role
 * card read as one world.
 */
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Feather, Hammer, Handshake, Lightbulb, Sprout, StickyNote } from "lucide-react";
import {
  ROOM_COPY,
  SESSION_SOMEONE,
  consentTally,
  isConsentValue,
  type ConsentTally,
  type ConsentTarget,
  type ConsentValue,
  type EntryKind,
  type ResponseTarget,
  type SessionEntry,
  type SessionItem,
  type SessionPerson,
  type SessionView,
} from "@shared/sessions";
import type { RoomActions } from "./useSessionRoom";

/* The focus ring is the theme's own `--ring`, which the night sets to the
   earned gold and the light page sets to the village's seed. The offset takes
   the ground's colour, so on the night it is a dark gap and never a white one. */
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// -- Type ---------------------------------------------------------------------

/** Section label inside a card: Notes, Ideas, Proposal, What we learned, Actions. The `!` beats the night's heading rule. */
export const LABEL_CAPS = "font-body text-[11px] !font-semibold uppercase !tracking-[0.2em] text-muted-foreground";
/** The gold eyebrow before a line, as the seat card's AIM. */
export const EYEBROW = "font-body text-[11px] font-bold uppercase tracking-[0.18em] text-notice";
/*
 * Every line set in the display face carries `lining-nums`. A village's display
 * face may draw old-style figures by default (a garden serif usually does),
 * and then a "1" sits low and thin enough that "D1" reads as "DI". Lining
 * figures stand at capital height, so a code, a date or a count in a title
 * reads as what it is. Body text is set in a UI face whose figures already line.
 */
export const STAGE_TITLE = "font-display text-4xl font-normal leading-[1.08] lining-nums text-foreground sm:text-5xl";
export const STAGE_LEDE = "mt-2 max-w-2xl text-lg text-muted-foreground";
/** An item's name on its own page, the seat card's name scale. Needs an `@container` ancestor. */
export const ITEM_TITLE = "font-display text-[29px] font-normal leading-[1.08] lining-nums text-balance text-foreground @min-[440px]:text-[31px]";

// -- Surfaces -----------------------------------------------------------------

/** The one foil card per screen: the item page, the consent round, arrival, close. */
export const HERO_SHELL = "@container seat-card-foil relative w-full rounded-[20px] p-[2px]";
export const HERO_INNER =
  "relative rounded-[18px] bg-[radial-gradient(130%_55%_at_50%_0%,var(--muted)_0%,var(--card)_62%)] p-5 sm:p-7 after:pointer-events-none after:absolute after:inset-[5px] after:rounded-[14px] after:border after:border-notice/25";
export const HERO_CONTENT = "relative z-[1] space-y-7";
/** Every other panel. */
export const PANEL = "rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm";

/** One entry card: a note, an idea, what we learned, an action, a tension. */
export const ENTRY_TILE = "flex items-start gap-3 rounded-xl border border-border bg-muted px-3.5 py-3 text-foreground";
export const ENTRY_TILE_EDITING =
  "flex flex-col gap-2 rounded-xl border border-notice/60 bg-muted px-3.5 py-3 text-foreground ring-1 ring-notice/30";
export const ENTRY_TEXT = "min-w-0 flex-1 whitespace-pre-line break-words text-base leading-relaxed text-foreground";
export const ENTRY_META = "mt-1 block text-xs text-muted-foreground";
/** A card's pencil and remove. Stacked on a phone, so the two 44px targets take
    one button's width beside the words, and side by side from `sm` up. */
export const ENTRY_TOOLS = "flex shrink-0 flex-col items-center gap-0.5 sm:flex-row";
/** The monoline glyph in its thin gold ring, the seat card's mark. */
export const GLYPH = "mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full text-notice ring-1 ring-inset ring-notice/60";
export const GLYPH_ICON = "size-3.5";
export const GLYPH_STROKE = 1.6;
/** Which glyph each kind of entry wears. The stored kind `seed` reads "What we learned" and wears the sprout. */
export const ENTRY_GLYPH: Record<EntryKind, LucideIcon> = {
  note: StickyNote,
  idea: Lightbulb,
  seed: Sprout,
  decision: Handshake,
  action: Hammer,
  tension: Feather,
};
/** What we learned, as the item's pull-quote. */
export const LEARNED_QUOTE = "border-l-2 border-notice pl-3 font-display text-[19px] leading-snug lining-nums text-foreground";
/** A lock line under something final on purpose. */
export const LOCK_LINE = "flex items-center gap-1.5 text-xs text-muted-foreground";

// -- Writing ------------------------------------------------------------------

/** The growing text box, used for every sentence anybody writes in the room. */
export const TEXTBOX =
  "block min-h-11 w-full resize-none overflow-y-auto rounded-xl border border-border bg-background px-3.5 py-2.5 text-base leading-relaxed text-foreground placeholder:text-muted-foreground outline-none focus:border-notice focus:ring-2 focus:ring-ring";
/** The tallest a box grows before it scrolls. */
export const TEXTBOX_MAX = "max-h-[min(24rem,50vh)]";
export const COUNTER = "text-xs tabular-nums text-muted-foreground";
/** The controls under a box: holder, date, buttons. Wraps, never squeezes the box. */
export const UNDER_BOX = "flex flex-wrap items-end gap-2";
/** A select that never takes the row: long seat names truncate. */
export const SELECT_CAPPED =
  "min-h-11 w-full max-w-[16rem] truncate rounded-xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring sm:w-auto";
/** Notes beside ideas only when the card is wide enough. Needs an `@container` ancestor. */
export const ITEM_STREAMS = "grid gap-6 @min-[760px]:grid-cols-2";

// -- Buttons ------------------------------------------------------------------

/**
 * The one gold button per screen: Begin, Next stage, Move the room here. It is
 * the seat card's GOLD (components/power/SeatAction.tsx), lit at the top and
 * settling into the earned gold, with dark ink on it. Only the facilitator's
 * bar uses it, and the bar marks it `data-forward`, so a test can hold the
 * rule of one per screen. It reads the night's own `--sheet-earned-lit`, so it
 * belongs in the open room only.
 */
export const BTN_FORWARD =
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-(--sheet-earned-lit) to-notice px-5 py-2.5 font-semibold text-background shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_25%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

/** Moonlight on the night, canopy on the linen: the plain strong button. */
export const BTN_PRIMARY =
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-2.5 font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

/** The seat card's flip bar: a quiet tile with a gold edge. */
export const BTN_SECONDARY =
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-notice/55 bg-muted px-4 py-2 font-semibold text-foreground hover:border-notice disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

export const BTN_QUIET =
  `inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-foreground underline decoration-notice/60 underline-offset-4 hover:bg-muted disabled:opacity-50 ${FOCUS}`;

export const BTN_ICON =
  `inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 ${FOCUS}`;

// -- The older names, kept for every caller -----------------------------------

export const CARD = PANEL;

export const SOFT = "rounded-xl border border-border bg-muted px-4 py-3";

export const INPUT =
  "min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-notice focus:ring-2 focus:ring-ring";

export const LABEL = "block text-sm font-semibold text-foreground";

export const HINT = "text-sm text-muted-foreground";

export const H2 = STAGE_TITLE;

export const H3 = LABEL_CAPS;

export const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground";

/**
 * A tile that is chosen or not: the consent tiles, the eleven numbers, the
 * facilitation choices. Chosen is solid gold with dark ink. It is never the
 * village's brand colour, because on the night the ground already is that
 * colour, and canopy on canopy disappears.
 */
export function tile(on: boolean): string {
  return `min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${FOCUS} ${
    on ? "border-notice bg-notice text-background" : "border-border bg-muted text-foreground hover:border-notice"
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

/**
 * Who a consent question is still waiting on, by first name, in the order the
 * server gave them. The server names them (`view.waiting`) only for viewers
 * who already see the answers, and only while the session is open, so anybody
 * else, and an older view without the field, gets an empty list.
 */
export function waitingNames(view: Pick<SessionView, "waiting">, target: ResponseTarget): string[] {
  if (target !== "agenda" && !target.startsWith("decision:")) return [];
  const people = view.waiting?.[target as ConsentTarget] ?? [];
  // The server says SESSION_SOMEONE for a person whose name the village no
  // longer holds. That is a phrase, so it stays whole: cut to its first word
  // it would read "Waiting for A". And two people who share a first name are
  // given their full names, so the facilitator can tell which one to ask.
  const first = people.map((p) => (p.name === SESSION_SOMEONE ? p.name : firstName(p.name)));
  const count = new Map<string, number>();
  for (const f of first) count.set(f, (count.get(f) ?? 0) + 1);
  return people
    .map((p, i) => (p.name !== SESSION_SOMEONE && (count.get(first[i]) ?? 0) > 1 ? p.name.trim() : first[i]))
    .filter(Boolean);
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
 * the screen where the server would refuse it.
 *
 *   leads       the person facilitating: moves the room, orders the agenda,
 *               sets an item's status, marks a proposal decided, closes.
 *   keepsNotes  the facilitator or the note taker: the people hosting the
 *               room. Other callers read it to mean exactly "hosts", so it
 *               stays as it is.
 *   editsWords  the hosts, and an admin who has joined: any item's words, any
 *               entry's text, status, seat and date, and the session's title.
 *
 * AN ADMIN IN THE ROOM. Since wave 2 an admin who has joined is shown the
 * word-editing controls, because a typo on a card is anybody's to fix who
 * holds the village. An admin is still not shown the run controls (moving the
 * room, deciding, closing): those stay with whoever facilitates, and an admin
 * who wants them takes over facilitating first. An admin who has not joined
 * sees what any visitor sees, because the server asks everyone to join before
 * they write.
 */
export function leads(view: Pick<SessionView, "me" | "status">): boolean {
  return view.status === "open" && view.me.facilitates;
}

export function keepsNotes(view: Pick<SessionView, "me" | "status">): boolean {
  return view.status === "open" && (view.me.facilitates || view.me.secretary);
}

/** Whoever may change the words of entries and items for everyone: facilitator, secretary, an admin in the room. */
export function editsWords(view: Pick<SessionView, "me" | "status">): boolean {
  return view.status === "open" && view.me.joined && (view.me.facilitates || view.me.secretary || view.me.admin);
}

/** May this member rename the session. */
export function mayRenameSession(view: Pick<SessionView, "me" | "status">): boolean {
  return editsWords(view);
}

/** May this member change an item's title (its aim and minutes: see mayEditItemPlan). */
export function mayEditItemTitle(view: Pick<SessionView, "me" | "status">, item: Pick<SessionItem, "addedBy" | "status">): boolean {
  return editsWords(view) || (view.status === "open" && view.me.joined && item.addedBy === view.me.userId && item.status !== "done");
}

/**
 * May this member change an item's aim, minutes or presenter. The person who
 * added it may while it waits; once it starts, the clock reads its minutes, so
 * they stay with the people who edit the room's words.
 */
export function mayEditItemPlan(view: Pick<SessionView, "me" | "status">, item: Pick<SessionItem, "addedBy" | "status">): boolean {
  return editsWords(view) || (view.status === "open" && view.me.joined && item.addedBy === view.me.userId && item.status === "waiting");
}

/** What this member may do to one entry, the server's matrix read for the screen. */
export function entryRightsFor(view: Pick<SessionView, "me" | "status">, e: Pick<SessionEntry, "authorUserId" | "ownerUserId">) {
  const open = view.status === "open" && view.me.joined;
  const author = open && e.authorUserId === view.me.userId;
  const holder = open && e.ownerUserId != null && e.ownerUserId === view.me.userId;
  const notes = open && editsWords(view);
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
