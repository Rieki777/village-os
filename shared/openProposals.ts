/**
 * OPEN ROLE PROPOSALS: somebody with no account proposes to hold roles next
 * season (Rye, 2026-10-30; master coordinator's calls of 2026-10-31 and sheet
 * 19i). PURE, so the page and the server read one spelling.
 *
 *   /propose-a-role           the village's public link, on unless an admin
 *                             switches it off
 *   /propose-a-role/<token>   a link an admin made for one person, which they
 *                             can switch off
 *
 * The person picks one to three of next season's roles, says what they bring
 * to each and why, and gives their name and address. Nothing reaches anybody
 * until the address answers a confirmation email: an unconfirmed proposal is
 * deleted after 48 hours. Once confirmed it waits for the village, and only an
 * adoption makes an account, at the Member stage, with its roles starting at
 * the season's start (the adoption half is a later change).
 *
 * In the 2026-10-02 voice: the next step, never the machinery.
 */

/** The village's public link. */
import { termOf, type OpenProposalTerm } from "./openProposalTerm";

export const OPEN_PROPOSAL_PATH = "/propose-a-role";

/** The public link with one role already picked: the door a visitor or a guest is offered on a role. */
export function openProposalHref(roleId?: string | null): string {
  const id = String(roleId ?? "").trim();
  return id ? `${OPEN_PROPOSAL_PATH}?role=${encodeURIComponent(id)}` : OPEN_PROPOSAL_PATH;
}

/** One to this many roles in one proposal. */
export const OPEN_PROPOSAL_MAX_ROLES = 3;
export const OPEN_NAME_MAX = 120;
export const OPEN_NOTE_MAX = 600;
export const OPEN_WHY_MAX = 1200;
export const OPEN_AIM_MAX = 300;
/** How long a confirmation link works, and how long an unconfirmed proposal is kept. */
export const OPEN_CONFIRM_HOURS = 48;

/**
 * THE GATES A PUBLIC FORM NEEDS WHEN A ROLE IS SHARED WIDELY (red team, 9 Nov
 * 2026: "the village can be made to email any address you name, at scale").
 * Every confirmation is an email the village sends to an address a stranger
 * typed, so the caps are on what reaches inboxes:
 *   - an overall hourly cap, whatever the connections and addresses;
 *   - the per-address cap counts an address without its "+tag", so
 *     victim+1@, victim+2@ ... share one allowance;
 *   - the per-connection cap counts an IPv6 address by its /64, the block
 *     one household or one server is handed.
 */
export const OPEN_GLOBAL_HOURLY = 60;

/** The address as the per-address cap counts it: folded, without a "+tag". */
export function limiterAddressKey(emailKey: string): string {
  const at = emailKey.lastIndexOf("@");
  if (at <= 0) return emailKey;
  const local = emailKey.slice(0, at).split("+")[0] || emailKey.slice(0, at);
  return `${local}${emailKey.slice(at)}`;
}

/** The connection as the per-connection cap counts it: IPv4 as is, IPv6 by its /64. */
export function ipBucket(ip: string): string {
  const raw = String(ip ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1];
  if (!raw.includes(":")) return raw;
  const [head, tail = ""] = raw.split("::");
  const h = head ? head.split(":") : [];
  const t = raw.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = raw.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (parseInt(g || "0", 16) || 0).toString(16)).join(":")}::/64`;
}

/** Letters in any script (Unicode classes, so the pattern is built at runtime), apostrophes and hyphens. */
const GREETING = new RegExp("^[\\p{L}\\p{M}'\\u2019-]{1,40}$", "u");

/** A first name safe to greet with: letters (any script), apostrophes and hyphens, never a link or an address. */
export function safeGreeting(name: string): string | null {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return GREETING.test(first) ? first : null;
}
/**
 * How long a declined or withdrawn proposal keeps its name and address, and an
 * adopted one whose invitation nobody used (open proposals part B), counted
 * from the decision.
 */
export const OPEN_ANONYMISE_DAYS = 90;

export const OPEN_PROPOSAL_STATUSES = ["unconfirmed", "confirmed", "adopted", "declined", "withdrawn"] as const;
export type OpenProposalStatus = (typeof OPEN_PROPOSAL_STATUSES)[number];

export interface OpenProposalBody {
  roles: Array<{ roleId: string; note: string }>;
  why: string;
  aim: string;
  /** Set by the server when the village's proposals are for the moon (shared/openProposalTerm.ts). Absent: next season. */
  term?: OpenProposalTerm;
}

export interface OpenProposalInput {
  name: string;
  email: string;
  body: OpenProposalBody;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

/** Trimmed, and cut one past the cap so "too long" can still be told from "at the cap". `trim()`, never a regex: an anchored `\s+$` runs slow on a long run of spaces. */
const text = (v: unknown, max: number): string => String(typeof v === "string" ? v : "").trim().slice(0, max + 1);

/** What a stored body reads as, whatever was stored. Never throws. */
export function openBodyOf(raw: unknown): OpenProposalBody {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const roles = Array.isArray(o.roles) ? o.roles : [];
  return {
    roles: roles
      .map((r: any) => ({ roleId: String(r?.roleId ?? "").trim(), note: text(r?.note, OPEN_NOTE_MAX).slice(0, OPEN_NOTE_MAX) }))
      .filter((r) => r.roleId)
      .slice(0, OPEN_PROPOSAL_MAX_ROLES),
    why: text(o.why, OPEN_WHY_MAX).slice(0, OPEN_WHY_MAX),
    aim: text(o.aim, OPEN_AIM_MAX).slice(0, OPEN_AIM_MAX),
    ...(termOf(o.term) ? { term: termOf(o.term) } : {}),
  };
}

/**
 * A proposal as the form sent it, checked against the roles the village is
 * offering. `address` decides whether an address is one (shared/comms/address.ts
 * on the server). The first problem is answered, with the field it is on.
 */
export function parseOpenProposal(raw: unknown, ctx: { roleIds: ReadonlySet<string>; address: (s: string) => string | null }): Parsed<OpenProposalInput> {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = text(o.name, OPEN_NAME_MAX);
  if (!name) return { ok: false, field: "name", error: OPEN_WORDS.needName };
  if (name.length > OPEN_NAME_MAX) return { ok: false, field: "name", error: OPEN_WORDS.tooLong("Your name", OPEN_NAME_MAX) };
  const email = ctx.address(String(o.email ?? ""));
  if (!email) return { ok: false, field: "email", error: OPEN_WORDS.needEmail };
  const picked = Array.isArray(o.roles) ? o.roles : [];
  if (picked.length === 0) return { ok: false, field: "roles", error: OPEN_WORDS.needRole };
  if (picked.length > OPEN_PROPOSAL_MAX_ROLES) return { ok: false, field: "roles", error: OPEN_WORDS.tooManyRoles };
  const roles: OpenProposalBody["roles"] = [];
  for (const r of picked as any[]) {
    const roleId = String(r?.roleId ?? "").trim();
    if (!ctx.roleIds.has(roleId)) return { ok: false, field: "roles", error: OPEN_WORDS.unknownRole };
    if (roles.some((x) => x.roleId === roleId)) return { ok: false, field: "roles", error: OPEN_WORDS.sameRoleTwice };
    const note = text(r?.note, OPEN_NOTE_MAX);
    if (note.length > OPEN_NOTE_MAX) return { ok: false, field: "roles", error: OPEN_WORDS.tooLong("What you bring to a role", OPEN_NOTE_MAX) };
    roles.push({ roleId, note });
  }
  const why = text(o.why, OPEN_WHY_MAX);
  if (!why) return { ok: false, field: "why", error: OPEN_WORDS.needWhy };
  if (why.length > OPEN_WHY_MAX) return { ok: false, field: "why", error: OPEN_WORDS.tooLong("Why you", OPEN_WHY_MAX) };
  const aim = text(o.aim, OPEN_AIM_MAX);
  if (aim.length > OPEN_AIM_MAX) return { ok: false, field: "aim", error: OPEN_WORDS.tooLong("Your aim", OPEN_AIM_MAX) };
  return { ok: true, value: { name, email, body: { roles, why, aim } } };
}

/** "A", "A and B", "A, B and C". */
export function andList(items: readonly string[]): string {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/** The email that asks the address to confirm. Nothing else reaches anybody until it is answered. */
export function confirmLetter(i: { firstName: string | null; village: string; roleNames: readonly string[]; link: string; when?: string }): { subject: string; text: string } {
  return {
    subject: `Confirm your proposal to ${i.village}`,
    text: [
      i.firstName ? `Hi ${i.firstName},` : "Hi,",
      "",
      `You proposed to hold ${andList(i.roleNames) || "a role"} in ${i.village} ${i.when ? `for ${i.when}` : "next season"}.`,
      "",
      "Confirm it's you, and your proposal goes to the village:",
      i.link,
      "",
      `The link works for ${OPEN_CONFIRM_HOURS} hours. If this wasn't you, leave it, and nothing happens.`,
      "",
    ].join("\n"),
  };
}

export const OPEN_WORDS = {
  // The page.
  heading: (village: string) => `Propose a role in ${village}`,
  lede: (season: string) => `Pick up to ${OPEN_PROPOSAL_MAX_ROLES} roles for ${season}, say what you bring, and send it. You don't need an account.`,
  noSeason: "The village hasn't set its next season yet, so there's nothing to propose for right now. Check back soon.",
  /** The lede when the village's proposals are for the moon. */
  ledeMoon: (from: string, to: string) => `Pick up to ${OPEN_PROPOSAL_MAX_ROLES} roles for this moon, from ${from} to the next new moon on ${to}, say what you bring, and send it. You don't need an account.`,
  noCurrentSeason: "The village has no season running right now, so there's nothing to propose for this moon. Check back soon.",
  closed: "This page isn't taking proposals right now.",
  pickRoles: `Pick up to ${OPEN_PROPOSAL_MAX_ROLES} roles`,
  noteLabel: "What you bring to this role",
  whyLabel: "Why you, and why now",
  aimLabel: "Your aim for the season (optional)",
  nameLabel: "Your name",
  emailLabel: "Your email",
  emailNote: "We'll only write to you about this proposal.",
  /** The retention, in one plain line on the form (sheet 19i). */
  keptFor: `If you don't confirm within ${OPEN_CONFIRM_HOURS} hours, we delete what you sent. If the village says no, or says yes and you never make your account, we remove your name and email ${OPEN_ANONYMISE_DAYS} days later.`,
  send: "Send my proposal",
  sent: (email: string) => `Check ${email}. We sent a link to confirm it's you. Your proposal reaches the village once you open it.`,
  confirmed: "Confirmed. Your proposal is with the village now, and you'll hear back by email.",
  confirmGone: "That link has run out or was already used. Send your proposal again, and open the new link within 48 hours.",
  // Refusals, each with what to do.
  needName: "Add your name.",
  needEmail: "Add an email address we can reach you at.",
  needRole: "Pick at least one role.",
  tooManyRoles: `Pick up to ${OPEN_PROPOSAL_MAX_ROLES} roles.`,
  unknownRole: "One of those roles isn't open any more. Reload the page and pick again.",
  sameRoleTwice: "You picked the same role twice.",
  needWhy: "Say why you, and why now.",
  tooLong: (what: string, max: number) => `${what} is too long. Keep it under ${max} characters.`,
  notSent: "We couldn't send the confirmation email just now. Try again later.",
  tooMany: "Too many proposals from here. Wait a little and try again.",
  // The desk.
  linkMade: "Link made. Copy it now: it won't be shown again.",
  linkOff: "That link is switched off. It no longer opens the form.",
  publicOn: "The public link is on. Anyone with it can propose.",
  publicOff: "The public link is off. Only links you make for one person open the form.",
} as const;
