/**
 * CHECK A PROPOSAL (0297): the room asks for a read of an open proposal before
 * it decides, and everybody in the room sees the same read.
 *
 * Rye, 2026-10-30, relayed by the "Bug fixes and improvements" session: a
 * "Check Sera" button in a live session runs a proposal against the village's
 * purpose so the room sees the result in the meeting. Rye, 2026-10-31, through
 * the master coordinator: the facilitator and the proposer may press it, and
 * the village's own half is built now, ahead of the outside agent's.
 *
 * WHAT THIS READ IS. Three things the village already holds, read against the
 * proposal's words, with no call to anybody:
 *   - the village's purpose (the Governing Purpose Statement,
 *     shared/governingPurpose.ts), shown beside the proposal. Whether the
 *     proposal serves it is the room's to say, so nothing here scores it;
 *   - the running season's priorities (the `goals` on the season in the
 *     app_config "season" document), each marked when the words name it;
 *   - the roles the words name, and whether each role's holder was in the
 *     room when the check ran.
 * The outside agent's own read arrives once the service offers a typed check
 * (asked of it on 2026-10-31). Until then the card says so in one line.
 *
 * WHAT IT NEVER HOLDS. No person. A role's holder is a place (`here`, `away`,
 * `open`) and never a name or a number, so the stored read needs no line in a
 * member's export or erasure, and a role renamed later still reads as the name
 * it had when the check ran.
 *
 * THE MATCHING IS PLAIN ON PURPOSE. A priority is named when its words are in
 * the proposal word for word, or when every meaningful word of it is there; a
 * role when its whole name is. A loose match would mark a priority the
 * proposal never meant, and the card would claim a link the room then trusts.
 * Every priority is listed either way, so one the words miss is still in front
 * of the room.
 *
 * Every string a member reads is here, so the voice gate reads it.
 */

export const CHECK_LIMITS = {
  /** Roles one read names at most. */
  roles: 6,
  /** Season priorities one read lists at most. */
  priorities: 12,
  /** A priority's words, as stored. The season view stores 200 (0292). */
  priorityText: 200,
  /** A role's name, as stored. */
  roleName: 120,
  /** A role name shorter than this names too much to count as one role. */
  roleNameMin: 3,
} as const;

/** Where a role's holder was when the check ran. Never who. */
export const HOLDER_PLACES = ["here", "away", "open"] as const;
export type HolderPlace = (typeof HOLDER_PLACES)[number];
const isHolderPlace = (v: unknown): v is HolderPlace => typeof v === "string" && (HOLDER_PLACES as readonly string[]).includes(v);

export interface CheckRead {
  /** The running season's name, or null when none runs. */
  season: string | null;
  /** The season's priorities, each marked when the proposal's words name it. */
  priorities: { text: string; named: boolean }[];
  /** The roles the words name, with where each holder was. */
  roles: { seatId: string; name: string; holder: HolderPlace }[];
  /** Whether the village had written its purpose when the check ran. */
  hasPurpose: boolean;
  /** When the purpose was last written, so a rewrite since shows. Empty when never. */
  purposeWrittenAt: string;
}

/** One proposal's check, as the room reads it. */
export interface EntryCheck {
  /** ISO instant the check ran. */
  at: string;
  read: CheckRead;
  /** The proposal's words changed after the check. */
  changed: boolean;
  /** The purpose was rewritten after the check. */
  purposeChanged: boolean;
}

/** What the room view carries for checks. Null on the view when the module that offers them is off. */
export interface CheckView {
  /** The name the outside agent answers under, for the button. */
  agent: string;
  /** The village's purpose as it reads now, or null when none is written. */
  purpose: string | null;
  /** Each checked proposal's check, by entry id. */
  byEntry: Record<string, EntryCheck>;
}

/** The door: POST, no body. */
export function entryCheckPath(sessionId: number, entryId: number): string {
  return `/api/sessions/${sessionId}/entries/${entryId}/check`;
}

// ── The matching ─────────────────────────────────────────────────────────────

/**
 * A letter or a digit, in any script: ASCII letters and digits, and every
 * character past ASCII except the punctuation blocks (Latin-1 signs, general
 * punctuation, CJK punctuation). Written out because this target has no `\p{L}`.
 */
function isWordChar(code: number): boolean {
  if (code >= 48 && code <= 57) return true;
  if (code >= 97 && code <= 122) return true;
  if (code < 128) return false;
  if ((code >= 0xa0 && code <= 0xbf) || code === 0xd7 || code === 0xf7) return false;
  if (code >= 0x2000 && code <= 0x206f) return false;
  if (code >= 0x3000 && code <= 0x303f) return false;
  return true;
}

/** Lower case, letters and digits only, one space between words. */
function words(s: string): string {
  const lower = s.toLowerCase();
  let out = "";
  for (let i = 0; i < lower.length; i++) out += isWordChar(lower.charCodeAt(i)) ? lower.charAt(i) : " ";
  return out.replace(/ +/g, " ").trim();
}

/** A phrase inside a text, on word boundaries. */
function hasPhrase(text: string, phrase: string): boolean {
  return !!phrase && ` ${text} `.includes(` ${phrase} `);
}

/** Words a priority shares with any sentence, which say nothing about which priority it is. */
const COMMON = new Set([
  "with", "from", "that", "this", "these", "those", "into", "onto", "their", "there", "they", "them",
  "what", "when", "where", "will", "have", "been", "were", "more", "each", "every", "some", "your",
  "ours", "over", "under", "about", "than", "then", "also", "just", "make", "made",
]);

/** A plural folded, so "systems" reads as "system". Short words are left as they are. */
const fold = (w: string): string => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** The words of a priority that say which priority it is. */
function meaningful(goal: string): string[] {
  return goal.split(" ").filter((w) => w.length >= 4 && !COMMON.has(w)).map(fold);
}

/**
 * Whether a proposal's words name one season priority: the priority word for
 * word, or every meaningful word of it when it has at least two.
 */
export function goalNamed(text: string, goal: string): boolean {
  const t = words(text);
  const g = words(goal);
  if (!t || !g) return false;
  if (hasPhrase(t, g)) return true;
  const need = meaningful(g);
  if (need.length < 2) return false;
  const have = new Set(t.split(" ").map(fold));
  return need.every((w) => have.has(w));
}

/**
 * The roles a proposal's words name, in the order the words name them. The
 * role the proposal already sits with (`ownerSeatId`) comes first, named or
 * not, because it is the role the proposal is about.
 */
export function seatsNamed<S extends { id: string; name: string }>(text: string, seats: readonly S[], ownerSeatId: string | null): S[] {
  const t = ` ${words(text)} `;
  const found: { seat: S; at: number }[] = [];
  for (const seat of seats) {
    const n = words(seat.name);
    if (n.length < CHECK_LIMITS.roleNameMin) continue;
    const at = t.indexOf(` ${n} `);
    if (at >= 0) found.push({ seat, at });
  }
  found.sort((a, b) => a.at - b.at);
  const out: S[] = [];
  const owner = ownerSeatId ? seats.find((s) => s.id === ownerSeatId) : undefined;
  if (owner) out.push(owner);
  for (const f of found) if (!out.some((s) => s.id === f.seat.id)) out.push(f.seat);
  return out.slice(0, CHECK_LIMITS.roles);
}

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/** The read itself, from what the village holds when the check runs. */
export function instantRead(input: {
  text: string;
  season: { name: string; goals: readonly string[] } | null;
  seats: readonly { id: string; name: string }[];
  ownerSeatId: string | null;
  holderOf: (seatId: string) => HolderPlace;
  purpose: { statement: string; writtenAt: string };
}): CheckRead {
  const goals = (input.season?.goals ?? []).filter((g) => g.trim()).slice(0, CHECK_LIMITS.priorities);
  return {
    season: input.season ? clip(input.season.name, CHECK_LIMITS.roleName) : null,
    priorities: goals.map((g) => ({ text: clip(g.trim(), CHECK_LIMITS.priorityText), named: goalNamed(input.text, g) })),
    roles: seatsNamed(input.text, input.seats, input.ownerSeatId).map((s) => ({
      seatId: s.id,
      name: clip(s.name, CHECK_LIMITS.roleName),
      holder: input.holderOf(s.id),
    })),
    hasPurpose: !!input.purpose.statement.trim(),
    purposeWrittenAt: input.purpose.writtenAt,
  };
}

/** A stored read, read back. Anything it cannot read is left out, and a read it cannot read at all is null. */
export function readCheckRead(raw: unknown): CheckRead | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const priorities = (Array.isArray(r.priorities) ? r.priorities : [])
    .filter((p): p is { text: string; named: unknown } => !!p && typeof (p as any).text === "string")
    .slice(0, CHECK_LIMITS.priorities)
    .map((p) => ({ text: clip(p.text, CHECK_LIMITS.priorityText), named: p.named === true }));
  const roles = (Array.isArray(r.roles) ? r.roles : [])
    .filter((x): x is { seatId: string; name: string; holder: HolderPlace } =>
      !!x && typeof (x as any).seatId === "string" && typeof (x as any).name === "string" && isHolderPlace((x as any).holder),
    )
    .slice(0, CHECK_LIMITS.roles)
    .map((x) => ({ seatId: x.seatId, name: clip(x.name, CHECK_LIMITS.roleName), holder: x.holder }));
  return {
    season: typeof r.season === "string" ? r.season : null,
    priorities,
    roles,
    hasPurpose: r.hasPurpose === true,
    purposeWrittenAt: typeof r.purposeWrittenAt === "string" ? r.purposeWrittenAt : "",
  };
}

// ── The words ────────────────────────────────────────────────────────────────

export const CHECK_COPY = {
  button: (agent: string) => `Check ${agent}`,
  again: "Check again",
  checking: "Checking",
  title: "A read before deciding",
  lead: "Read against the village's purpose and this season. It suggests, and the room decides.",
  purposeTitle: "The village's purpose",
  noPurpose: "The village has not written its purpose yet.",
  purposeRewritten: "The purpose was rewritten after this check.",
  prioritiesTitle: (season: string | null) => (season ? `${season} priorities` : "This season's priorities"),
  noSeason: "No season priorities are set yet.",
  named: "Named",
  rolesTitle: "Roles it names",
  noRoles: "It names no role.",
  holder: {
    here: "its holder is here",
    away: "its holder is not here",
    open: "nobody holds it now",
  } satisfies Record<HolderPlace, string>,
  agentLine: (agent: string) => `${agent}'s own read is not available yet, so this is the village's own read.`,
  changed: "The words changed after this check. Check again to read the new words.",
  checkedAt: (when: string) => `Checked ${when}`,
} as const;

export const CHECK_REFUSALS = {
  notYours: "Only the facilitator or the person who proposed it can check a proposal.",
  notAProposal: "Only a proposal can be checked.",
  decided: "A decided proposal is the room's agreement, and it is not checked again.",
  off: "Checks are not open in this village.",
} as const;
