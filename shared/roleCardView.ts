/**
 * ONE VIEW MODEL FOR THE FULL CARD (role journey PR-C): /roles, the circle
 * page, the map, the draft board and the profile all read a seat's parameters
 * through this function, so they cannot say different things.
 *
 * The input is a seat as `/api/org` or `/api/map` sent it (server/lib/
 * roleCardProjection.ts builds `card`). Nothing is invented: a parameter the
 * role has not written is left out of `rows`, and the gate says which are
 * missing.
 *
 * Hours read "Roughly ..." everywhere (Rye, 9 Nov): they are an estimate.
 */
import {
  BEING_WRITTEN,
  TRACK_WORDS,
  WHERE_WORDS,
  beingWrittenLine,
  interviewLines,
  interviewTotalWords,
  roughHours,
  type CardPart,
  type InterviewStepView,
  type RoleTrack,
  type WhereWorked,
} from "./roleParams";
import { publicPayWords, type PublicPay } from "./rolePublicPay";

export interface CardRow {
  id: "hours" | "track" | "goals" | "where" | "languages" | "review" | "interviews" | "criteria" | "budget";
  label: string;
  lines: string[];
}

export interface RoleCardView {
  rows: CardRow[];
  /** The pay group in words, for a listed open role; null otherwise. */
  pay: { headline: string; lines: string[] } | null;
  /** True while the village holds Apply back for a card that is not complete. */
  beingWritten: boolean;
  /** The sentence that says so, with what is still to write. */
  beingWrittenLine: string | null;
  /** Whether Apply may show. */
  applyAllowed: boolean;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

export function roleCardView(seat: unknown, locale = "en-GB"): RoleCardView {
  const s = seat && typeof seat === "object" ? (seat as Record<string, any>) : {};
  const card: Record<string, any> = s.card && typeof s.card === "object" ? s.card : {};
  const rows: CardRow[] = [];

  const hours = roughHours(typeof s.timeCommitment === "string" ? s.timeCommitment : null);
  if (hours) rows.push({ id: "hours", label: "Hours", lines: [hours] });

  const track = card.track as RoleTrack | null | undefined;
  if (track && TRACK_WORDS[track]) rows.push({ id: "track", label: "Track", lines: [TRACK_WORDS[track]] });

  const goals = list(card.villageGoals);
  if (goals.length) rows.push({ id: "goals", label: "Village goals it serves", lines: goals });

  const where = card.whereWorked as WhereWorked | null | undefined;
  if (where && WHERE_WORDS[where]) rows.push({ id: "where", label: "Where", lines: [WHERE_WORDS[where]] });

  const languages = list(card.languages);
  if (languages.length) rows.push({ id: "languages", label: "Languages", lines: [languages.join(", ")] });

  const days = Number(card.reviewAfterDays);
  if (Number.isInteger(days) && days > 0) rows.push({ id: "review", label: "Review", lines: [`First review after ${days} ${days === 1 ? "day" : "days"}`] });

  const steps: InterviewStepView[] = Array.isArray(card.conversations) ? card.conversations : [];
  const first = typeof card.firstConversation === "string" && card.firstConversation.trim() ? `First conversation: ${card.firstConversation.trim()}` : null;
  const consent = typeof card.consentCircle === "string" && card.consentCircle.trim() ? `Paid roles are consented by ${card.consentCircle.trim()}` : null;
  if (steps.length || first || consent) {
    const lines = interviewLines(steps);
    const total = interviewTotalWords(steps);
    const head = first ? [first] : [];
    const tail = consent ? [consent] : [];
    rows.push({ id: "interviews", label: "How it is filled", lines: [...head, ...lines, ...(total ? [`${total} of conversations in all`] : []), ...tail] });
  }

  const criteria = list(card.selectionCriteria);
  if (criteria.length) rows.push({ id: "criteria", label: "Selection criteria", lines: criteria });

  if (typeof card.budgetLine === "string" && card.budgetLine.trim()) rows.push({ id: "budget", label: "Budget line", lines: [card.budgetLine.trim()] });

  const pay = card.publicPay && typeof card.publicPay === "object" ? publicPayWords(card.publicPay as PublicPay, locale) : null;
  const held = card.gated === true && card.complete !== true;
  return {
    rows,
    pay,
    beingWritten: held,
    beingWrittenLine: held ? beingWrittenLine({ missing: (Array.isArray(card.missing) ? card.missing : []) as CardPart[] }) : null,
    applyAllowed: !held,
  };
}

export { BEING_WRITTEN };
