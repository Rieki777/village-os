/**
 * THE SHEET AS A MAP, ORDERED BY HOW FAR ALONG IT SITS.
 *
 * Rye's rule, and it is a better one than "hide what is empty": the further
 * down the profile you read, the further along the journey it is. Everything
 * a member can act on today is at the top; everything they cannot reach yet is
 * still THERE, further down, quiet, saying what would open it. The map stays
 * whole and the reachable end is nearest the reader.
 *
 * ── WHY THIS ORDER IS FIXED FOR EVERYBODY ────────────────────────────────
 *
 * It does not re-sort per member, and that is deliberate. A page that
 * rearranges as somebody progresses moves the thing they had learned to scroll
 * to. A fixed map that you advance THROUGH is how a skill tree is learned, and
 * what moves is your position on it, not the furniture.
 *
 * The one exception is the surface-once rule (see `sheetPrefs.ts`): a section
 * that has just opened is lifted to the top for a session or two, then goes
 * home. One thing at a time, in the order it unlocked.
 *
 * ── A SUBJECT STAYS WHOLE ────────────────────────────────────────────────
 *
 * The gradient cuts across subjects and the subject wins. Giving is a day-one
 * act and the gratitude ledger is empty for months, but they are one thing, so
 * the vessel sits at the height of its most actionable part and its history
 * rides inside it. Splitting a subject to satisfy the ordering would undo the
 * consolidation that made the page legible.
 *
 * ── PATHS MARK, THEY DO NOT FILTER ───────────────────────────────────────
 *
 * Each path opens its own section, and an unwalked path's section is present
 * and quiet rather than absent. Filtering was the first idea and it breaks on
 * the case this whole redesign is for: a NEW MEMBER HAS NO PATHS, so a
 * filtered sheet shows them nothing on the page they land on straight after
 * signing up. Marked instead, a day-one member sees the entire map, quiet, and
 * every quiet section is an argument for claiming a path. That makes the
 * day-one act obvious without a tutorial.
 *
 * The four paths already have four data models behind them (0156 investor
 * facts, 0157 ventures, the housing index, org seatings), so a path section is
 * a surface for facts that already exist rather than a new invention.
 */

/** How far along the journey a section sits. Lower reads first. */
export type Band =
  /** Act on it today, with nothing required first. */
  | "now"
  /** Real things to do, once there is anything to do them with. */
  | "open"
  /** Your record. Fills in as you go, and says so while it is empty. */
  | "record"
  /** Opens with a path. Quiet, and naming its path, until that path is walked. */
  | "path"
  /** Always available, rarely wanted. Last for frequency, not for maturity. */
  | "settings";

export const BAND_ORDER: Band[] = ["now", "open", "record", "path", "settings"];

export interface SheetSection {
  id: string;
  band: Band;
  /** The path that opens it, for band "path". */
  path?: "investor" | "steward" | "resident" | "prosperity-creator";
  /**
   * The one line a quiet section shows in place of itself.
   *
   * THIS IS LOAD-BEARING AND NOT A STYLING DETAIL. At eight thousand pixels,
   * "show the whole map" is a scroll rather than a map. A quiet section has to
   * collapse to ONE LINE for the map to be legible as one, which is what makes
   * showing everything viable at all.
   */
  quiet: string;
}

/**
 * Every section of the sheet, in the order it is read.
 *
 * Ids are camelCase and the `path` values are not: those must match
 * `shared/gameConfig.ts`'s own path ids exactly, hyphens included, because a
 * mismatch there silently shows a walked path as unwalked. The section ids are
 * ours, so they avoid the hyphen that check-hyphen-dash reads as punctuation.
 *
 * The array order inside a band is the order it renders; the band order above
 * decides the bands. Keeping both here rather than in the JSX means the shape
 * of the page can be read, and argued about, in one place.
 */
export const SHEET_SECTIONS: SheetSection[] = [
  // ── NOW: nothing has to happen first ───────────────────────────────────
  { id: "nextStep", band: "now", quiet: "" },
  // Quests rides with nextStep inside GameDashboard, and belongs here anyway:
  // browsing and claiming a quest needs nothing earned first.
  { id: "quests", band: "now", quiet: "" },
  { id: "vessel", band: "now", quiet: "" },
  { id: "aboutYou", band: "now", quiet: "" },
  { id: "paths", band: "now", quiet: "" },

  // ── OPEN: real things to do, once there is anything to do them with ────
  { id: "powers", band: "open", quiet: "" },
  { id: "maturity", band: "open", quiet: "" },

  // ── RECORD: fills in as you go ─────────────────────────────────────────
  { id: "contributions", band: "record", quiet: "" },
  { id: "journey", band: "record", quiet: "" },

  // ── PATH: present and quiet until the path is walked ───────────────────
  {
    id: "investorFacts",
    band: "path",
    path: "investor",
    quiet: "What you have put in, and what came back, once you walk the Investor path.",
  },
  {
    id: "ventures",
    band: "path",
    path: "prosperity-creator",
    quiet: "The ventures you open here, once you walk the Prosperity Creator path.",
  },
  {
    id: "reservations",
    band: "path",
    path: "resident",
    quiet: "Where you are staying and what you have reserved, once you walk the Resident path.",
  },
  {
    id: "seats",
    band: "path",
    path: "steward",
    quiet: "The positions you hold and when each began, once you walk the Village Steward path.",
  },

  // ── SETTINGS: always available, rarely wanted ──────────────────────────
  { id: "wallet", band: "settings", quiet: "" },
  { id: "sendCredits", band: "settings", quiet: "" },
  { id: "onchain", band: "settings", quiet: "" },
  { id: "notifications", band: "settings", quiet: "" },
  { id: "agent", band: "settings", quiet: "" },
  { id: "links", band: "settings", quiet: "" },
];

/** The sections one path opens, for the claim button's own sentence. */
export function sectionsForPath(path: string): SheetSection[] {
  return SHEET_SECTIONS.filter((s) => s.path === path);
}
