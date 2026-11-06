/**
 * THE CCOS SECTIONS OF ONE ROLE IN FULL, for the player card's view model
 * (`shared/playerCard.ts`), from the approved CCOS version of the card
 * (https://claude.ai/artifact/XGP6VP5WFU1T6ti7RD482P, Rye 2026-10-22):
 *
 *   - "This role exists while ...", inside the Purpose block;
 *   - "What I can decide on my own", in the box with "What I look after";
 *   - "What I do regularly", after "What you can count on me for";
 *   - "Holding this role well": "Signs I'm stretched", "What flows back" and
 *     "How I can step back" (CCOS ARC), before "Not mine to hold";
 *   - the time chip, and a "Review week of <date>" chip read from the role's
 *     own review date (`term.reviewOn` in its adopted terms or its terms on
 *     offer), "No review date set" otherwise.
 *
 * The rules are the card's (see `shared/playerCard.ts`): a field a host did
 * not read is a slot of kind "unread" and draws nothing; a field read and
 * empty carries its words, and the view draws those only in "Edit my card",
 * so a role with none of these written shows nothing extra.
 *
 * Every heading is plain words, with its CCOS term beside it for the hover,
 * or `null` where the village turned the terms off (`org.ccos_terms`).
 *
 * None of these counts toward handover: the handover meter keeps its five
 * card parts and the runbook (shared/roleHandover.ts).
 *
 * Pure: no pool, no clock.
 */
import { termLabel } from "./circleCardWords";
import { CARD_WORDS as W, ROLE_CCOS_TERMS, type RoleTermKey } from "./playerCardWords";
import { formatDay, type Read } from "./roleSheet";
import type { SeatSettings } from "./seatSettings";
// Types only, so the model importing this file makes no cycle at run time.
import type { Slot } from "./playerCard";

const UNREAD = { kind: "unread" } as const;
const empty = (words: string) => ({ kind: "empty", words }) as const;
const clean = (v: string | null | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function textSlot(v: Read<string | null> | undefined): Slot<string> {
  if (v === undefined) return UNREAD;
  const t = clean(v);
  return t ? { kind: "shown", value: t } : empty(W.notWritten);
}

function listSlot(v: Read<readonly (string | null)[] | null> | undefined): Slot<string[]> {
  if (v === undefined) return UNREAD;
  const items = (v ?? []).map((s) => clean(s)).filter((s): s is string => s !== null);
  return items.length ? { kind: "shown", value: items } : empty(W.notWritten);
}

/** The words a role's CCOS sections are built from. Field names match `/api/org`. */
export interface RoleCcosIn {
  existsWhile?: Read<string | null>;
  authorities?: Read<string[] | null>;
  responsibilities?: Read<string[] | null>;
  signsStretched?: Read<string | null>;
  flowsBack?: Read<string | null>;
  stepBack?: Read<string | null>;
  timeCommitment?: Read<string | null>;
  /** The role's terms, for its review date. Unread draws no review chip. */
  settings: Read<SeatSettings | null>;
}

export interface TextSectionOut {
  heading: string;
  /** "CCOS: Authorities", or null where the village turned the terms off. */
  term: string | null;
  text: Slot<string>;
}

export interface ListSectionOut {
  heading: string;
  term: string | null;
  items: Slot<string[]>;
}

export const HOLDING_KEYS = ["signsStretched", "flowsBack", "stepBack"] as const;
export type HoldingKey = (typeof HOLDING_KEYS)[number];

export interface HoldingWellOut {
  heading: string;
  /** The three ARC lines, in the card's order. */
  parts: Array<TextSectionOut & { key: HoldingKey }>;
  /** At least one line is written. */
  written: boolean;
}

export interface RoleCcosOut {
  existsWhile: TextSectionOut;
  authorities: ListSectionOut;
  responsibilities: ListSectionOut;
  holdingWell: HoldingWellOut;
  /** The time chip's words. Drawn as a chip when shown. */
  time: TextSectionOut;
  /** "Review week of 9 November", "No review date set", or null when the terms were not read. */
  review: string | null;
}

/** "CCOS: <term>" for a heading, or null when the village does not show the terms. */
export function roleTerm(key: RoleTermKey, on: boolean): string | null {
  return on ? termLabel(ROLE_CCOS_TERMS[key]) : null;
}

/** The Monday that starts the week a civil date ("2026-11-11") falls in, as a civil date. */
export function weekStartOf(civil: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(civil ?? "").trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (Number.isNaN(t) || d.toISOString().slice(0, 10) !== m[0]) return null;
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

/** The review chip: the week the role's own review date falls in. */
export function reviewChip(settings: Read<SeatSettings | null>): string | null {
  if (settings === undefined) return null;
  const monday = weekStartOf(settings?.term?.reviewOn ?? null);
  if (!monday) return W.noReviewDate;
  return W.reviewWeekOf(formatDay(monday, false) ?? monday);
}

/** The CCOS sections of one role, every heading with its term when `terms` is on. */
export function roleCcos(role: RoleCcosIn, terms: boolean): RoleCcosOut {
  const parts = HOLDING_KEYS.map((key) => ({ key, heading: W[key], term: roleTerm(key, terms), text: textSlot(role[key]) }));
  return {
    existsWhile: { heading: W.existsWhile, term: roleTerm("existsWhile", terms), text: textSlot(role.existsWhile) },
    authorities: { heading: W.authorities, term: roleTerm("authorities", terms), items: listSlot(role.authorities) },
    responsibilities: { heading: W.responsibilities, term: roleTerm("responsibilities", terms), items: listSlot(role.responsibilities) },
    holdingWell: { heading: W.holdingWell, parts, written: parts.some((p) => p.text.kind === "shown") },
    time: { heading: W.timeCommitment, term: roleTerm("timeCommitment", terms), text: textSlot(role.timeCommitment) },
    review: reviewChip(role.settings),
  };
}
