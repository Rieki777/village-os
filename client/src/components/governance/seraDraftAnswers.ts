/**
 * The member door's side of "Ask Sera for a first draft" (shared/seraDrafts.ts).
 *
 * The door's answers are a plain object the wizard saves as the member's own
 * draft, so the marks on Sera's words live in it under `seraDrafts` while the
 * words are unconfirmed, and nowhere else. `settleDraftAnswers` runs on every
 * change and drops a mark whose words were edited, so a kept or edited draft
 * leaves nothing behind. The publish reads neither the marks nor the goals'
 * `seraDraft` flag (roleApplicationType.ts leaves them out).
 */
import { aboutYouOf } from "@/components/openProposal/AboutYou";
import { settleMarks, type DraftMarks } from "@shared/seraDrafts";
import { pickedSeats } from "./SeatPicksField";

export const marksOf = (a: Record<string, unknown>): DraftMarks => {
  const m = a.seraDrafts && typeof a.seraDrafts === "object" ? (a.seraDrafts as Record<string, unknown>) : {};
  return { ...(typeof m.aim === "string" ? { aim: m.aim } : {}), ...(typeof m.story === "string" ? { story: m.story } : {}) };
};

/** The answers with every mark that no longer matches its words taken off. */
export function settleDraftAnswers(a: Record<string, unknown>): Record<string, unknown> {
  if (!("seraDrafts" in a)) return a;
  const left = settleMarks(marksOf(a), { aim: String(a.aim ?? ""), story: aboutYouOf(a.aboutYou).story });
  const { seraDrafts: _gone, ...rest } = a;
  return left ? { ...rest, seraDrafts: left } : rest;
}

/** The roles a draft is asked for: the seats picked on the first step. The member door carries no per-role note. */
export const draftRolesOf = (a: Record<string, unknown>) => pickedSeats(a.seatIds ?? a.seatId).map((roleId) => ({ roleId }));
