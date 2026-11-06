/**
 * WHAT `GET /api/people/:handle/role-card` SENDS, named once for the server
 * that builds it and the client that draws it.
 */
import type { PlayerCard } from "./playerCard";

export type CardLevel = "stranger" | "member" | "self";

/** A sign's sheet: the rows behind a count, at the reader's tier. Never ranked. */
export interface SignSheetOut {
  title: string;
  countedFrom: string;
  /** `who` is a first name at the member tier, and null below it. */
  rows: { at: string | null; words: string; who: string | null }[];
  note: string;
}

export interface PlayerCardPayload {
  card: PlayerCard;
  viewer: { level: CardLevel; isSelf: boolean };
  /** The village's IANA zone, for the dates on a sign's sheet. */
  timeZone: string;
  /** Sheets by `SignOut.sheetKey`. Empty below the member tier. */
  sheets: Record<string, SignSheetOut>;
  links: { wallet?: string; apply: string; plan: string; newApplication?: string };
}
