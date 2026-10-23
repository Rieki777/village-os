/**
 * A ROLE'S HANDOVER WORDS: "Bring me", "Not mine to hold" and the runbook.
 *
 * Rye, 2026-10-22: these three live on the ROLE (`org_roles.bring_me`,
 * `not_mine`, `runbook`, migration 0268). They change by consent through an
 * org-chart draft (`update_seat`), the same way aim and domain do, so they
 * outlive whoever holds the role and count toward its handover.
 *
 * The parser (`shared/roleHandoverParse.ts`) serves every door: the draft preview refuses with these
 * sentences, the publish refuses again with the same ones, a proposal from an
 * outside service is read through them, and the editor shows them under its
 * inputs. So the red line a steward sees and the refusal the server sends are
 * the same words.
 *
 * `handoverChecks` is the pure helper the player card's handover meter calls.
 * It reports facts as booleans: a field is written or it is not. A runbook
 * counts as written when it is not empty, and its quality is never judged.
 *
 * Pure: no pool, no clock, no Node builtins, and no import of the terms model
 * (`shared/seatSettings.ts`). `server/lib/orgChart.ts` reads the stored
 * columns through this file, and modules that move value import that one, so
 * the parser that needs the payment-detail rule lives in its own file
 * (`shared/seatSettings.boundary.test.ts` holds the wall).
 */

/** The most items "Bring me" or "Not mine to hold" may hold. */
export const ROLE_LIST_MAX_ITEMS = 8;
/** The most characters one item may hold. */
export const ROLE_LIST_ITEM_MAX = 160;
/** The most characters a runbook may hold. */
export const RUNBOOK_MAX = 2000;

/** The draft payload keys, in the order the card reads them. */
export const ROLE_HANDOVER_FIELDS = ["bringMe", "notMine", "runbook"] as const;
export type RoleHandoverField = (typeof ROLE_HANDOVER_FIELDS)[number];

/** The `org_roles` column each draft payload key writes. */
export const ROLE_HANDOVER_COLUMNS: Record<RoleHandoverField, "bring_me" | "not_mine" | "runbook"> = {
  bringMe: "bring_me",
  notMine: "not_mine",
  runbook: "runbook",
};

export const ROLE_HANDOVER_WORDS = {
  bringMe: "Bring me",
  notMine: "Not mine to hold",
  runbook: "Runbook",
  bringMeHint: "What people should bring to this role. One per line.",
  notMineHint: "What this role does not hold, so people take it elsewhere. One per line.",
  runbookHint: "How the work is done: a few words, or one https link to where it is written down.",
  notWritten: "Not written yet",
  paymentDetails: "This looks like a bank or card number. Payment details are never stored on a role.",
  httpsOnly: "Links need to start with https://.",
  notALink: "That link cannot be read. Write it as https:// and the address.",
  notWords: "This needs to be words.",
  tooMany: `Up to ${ROLE_LIST_MAX_ITEMS} lines.`,
  itemTooLong: `Keep each line to ${ROLE_LIST_ITEM_MAX} characters.`,
  runbookTooLong: `Keep it to ${RUNBOOK_MAX} characters.`,
} as const;

/**
 * A stored list column read back: the JSON text or the parsed value MySQL
 * hands over. Anything that is not a list of strings reads as `null`, so a
 * malformed row draws "not written" and never a broken card.
 */
export function readStoredRoleList(v: unknown): string[] | null {
  let x = v;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(x)) return null;
  const items = x.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim());
  return items.length ? items : null;
}

/** A stored runbook read back: trimmed text, or `null`. */
export function readStoredRunbook(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The runbook is one https link and nothing else, so a reader can draw it as a link. */
export function runbookIsLink(runbook: string | null | undefined): boolean {
  const s = runbook?.trim();
  if (!s || /\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}

// ── The handover checks ─────────────────────────────────────────────────────

/** A role as the handover meter reads it. Field names match `/api/org`. */
export interface HandoverRoleIn {
  aim?: string | null;
  domain?: string | null;
  accountabilities?: readonly (string | null)[] | null;
  bringMe?: readonly (string | null)[] | null;
  notMine?: readonly (string | null)[] | null;
  runbook?: string | null;
}

/** The five parts of the role card, in the order the card reads them. */
export const HANDOVER_CARD_KEYS = ["purpose", "decide", "countOnMe", "bringMe", "notMine"] as const;
export type HandoverCardKey = (typeof HANDOVER_CARD_KEYS)[number];
export type HandoverCheckKey = HandoverCardKey | "runbook";

export const HANDOVER_CHECK_WORDS: Record<HandoverCheckKey, { label: string; done: string; missing: string }> = {
  purpose: { label: "Purpose", done: "Purpose written", missing: "No purpose written yet" },
  // The domain, which the card labels "What I look after" since 0274 split
  // out what the role can decide on its own. Still one of the five parts.
  decide: { label: "What it looks after", done: "What it looks after is written", missing: "What it looks after is not written yet" },
  countOnMe: {
    label: "What people can count on it for",
    done: "What people can count on it for is written",
    missing: "What people can count on it for is not written yet",
  },
  bringMe: { label: "Bring me", done: "Bring me is written", missing: "Bring me is not written yet" },
  notMine: { label: "Not mine to hold", done: "Not mine to hold is written", missing: "Not mine to hold is not written yet" },
  runbook: { label: "Runbook", done: "Runbook written", missing: "No runbook written yet" },
};

export interface HandoverCheck {
  key: HandoverCheckKey;
  done: boolean;
  label: string;
  /** The line to draw: the done words or the missing words. */
  words: string;
}

export interface HandoverChecks {
  purpose: boolean;
  decide: boolean;
  countOnMe: boolean;
  bringMe: boolean;
  notMine: boolean;
  /** All five card parts are written. */
  cardComplete: boolean;
  /** The runbook is written: not empty. Its quality is never judged. */
  runbook: boolean;
  /** The card is complete and the runbook is written. */
  ready: boolean;
  /** How many of the six checks are done. */
  done: number;
  total: number;
  /** Every check, in card order then the runbook, with its words. */
  checks: HandoverCheck[];
}

const hasText = (v: string | null | undefined): boolean => typeof v === "string" && v.trim() !== "";
const hasItem = (v: readonly (string | null)[] | null | undefined): boolean =>
  Array.isArray(v) && v.some((s) => typeof s === "string" && s.trim() !== "");

/** What a role has written down for whoever holds it next. Pure. */
export function handoverChecks(role: HandoverRoleIn): HandoverChecks {
  const flags: Record<HandoverCheckKey, boolean> = {
    purpose: hasText(role.aim),
    decide: hasText(role.domain),
    countOnMe: hasItem(role.accountabilities),
    bringMe: hasItem(role.bringMe),
    notMine: hasItem(role.notMine),
    runbook: hasText(role.runbook),
  };
  const keys: HandoverCheckKey[] = [...HANDOVER_CARD_KEYS, "runbook"];
  const checks = keys.map((key) => {
    const w = HANDOVER_CHECK_WORDS[key];
    return { key, done: flags[key], label: w.label, words: flags[key] ? w.done : w.missing };
  });
  const cardComplete = HANDOVER_CARD_KEYS.every((k) => flags[k]);
  const done = checks.filter((c) => c.done).length;
  return {
    ...flags,
    cardComplete,
    ready: cardComplete && flags.runbook,
    done,
    total: checks.length,
    checks,
  };
}
