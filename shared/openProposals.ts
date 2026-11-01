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
/** How long a declined or withdrawn proposal keeps its name and address. */
export const OPEN_ANONYMISE_DAYS = 90;

export const OPEN_PROPOSAL_STATUSES = ["unconfirmed", "confirmed", "adopted", "declined", "withdrawn"] as const;
export type OpenProposalStatus = (typeof OPEN_PROPOSAL_STATUSES)[number];

export interface OpenProposalBody {
  roles: Array<{ roleId: string; note: string }>;
  why: string;
  aim: string;
}

export interface OpenProposalInput {
  name: string;
  email: string;
  body: OpenProposalBody;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

const text = (v: unknown, max: number): string => String(typeof v === "string" ? v : "").replace(/\s+$/g, "").replace(/^\s+/g, "").slice(0, max + 1);

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
export function confirmLetter(i: { firstName: string | null; village: string; roleNames: readonly string[]; link: string }): { subject: string; text: string } {
  return {
    subject: `Confirm your proposal to ${i.village}`,
    text: [
      i.firstName ? `Hi ${i.firstName},` : "Hi,",
      "",
      `You proposed to hold ${andList(i.roleNames) || "a role"} in ${i.village} next season.`,
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
  closed: "This page isn't taking proposals right now.",
  pickRoles: `Pick up to ${OPEN_PROPOSAL_MAX_ROLES} roles`,
  noteLabel: "What you bring to this role",
  whyLabel: "Why you, and why now",
  aimLabel: "Your aim for the season (optional)",
  nameLabel: "Your name",
  emailLabel: "Your email",
  emailNote: "We'll only write to you about this proposal.",
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
