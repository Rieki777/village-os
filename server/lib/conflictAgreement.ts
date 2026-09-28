/**
 * THE CONFLICT AGREEMENT ON THE SERVER: how it is written, how the exit policy
 * reads through it, what the public is shown, and the ombuds door's pointer.
 * The document's shape and the rules the editor shares are in
 * shared/conflictAgreement.ts; read that header first.
 *
 * ── THE EXIT POLICY READS THROUGH IT ──────────────────────────────────────
 *
 * The exit policy's `restorative` block (server/lib/exitPolicy.ts) was the
 * only home of a village's conflict path: its steps, the intake role, the
 * cover role, the reply time and one outside contact. Once a village saves an
 * agreement, those five fields are ANSWERED BY IT (`withConflictAgreement`),
 * everywhere the policy is read: /exit-policy, /governance, /roles, the
 * restorative intake and the launch checklist's conflict door. So two pages
 * can never print two different conflict paths.
 *
 * NOTHING IS MIGRATED. A village that has no agreement keeps its exit policy
 * exactly as stored, and the agreement it would start from is its restorative
 * fields read as the document's defaults (`agreementFromRestorative`). No
 * stored document is rewritten to get there.
 *
 * ── THE CONSEQUENCE PEN ───────────────────────────────────────────────────
 *
 * Plan section 2.3: the founders (admins) write it before the Birthing; after
 * it, a change is a ballot at the structural tier. `conflictAgreementWrite`
 * is the admin half and refuses once the Game has started; the ballot half is
 * in server/routes/conflictAgreement.ts and server/lib/conflictAgreementCloser.ts,
 * and both run the same checks through `agreementForAdoption`.
 *
 * ── THE PUBLIC VIEW NAMES ROLES, NEVER MEMBERS ────────────────────────────
 *
 * The agreement is public with roles only. Outside contacts are named by
 * organisation or role, safety contacts are left out, and every piece of text
 * that names a member of this village is withheld (`memberNameMatcher`). The
 * same guard runs over the exit policy's restorative block for anybody who is
 * not a member, because that block now carries the agreement's words.
 *
 * ── THE OMBUDS DOOR KEEPS A POINTER AND NO WORDS ──────────────────────────
 *
 * A member can ask a named outside contact to talk. The platform records who
 * asked, when, and which contact, shows the member how to reach them, and
 * sends nothing anywhere. `ombudsAskProblem` refuses a request that carries
 * words, so no client can believe it sent some.
 */
import {
  CONFLICT_AGREEMENT_KEY,
  adoptionProblem,
  agreementFromRestorative,
  agreementOf,
  contactLabel,
  parseAgreementContent,
  restorativeFromAgreement,
  sameContent,
  type AgreementFrameId,
  type ConflictAgreement,
  type ConflictAgreementContent,
} from "../../shared/conflictAgreement";
import { outsideContactOf, replyHoursOf } from "./exitPolicy";

export { CONFLICT_AGREEMENT_KEY };

/** The key an open agreement ballot's proposed document waits under. */
export const CONFLICT_AGREEMENT_PROPOSAL_KEY = "conflict-agreement-proposal";

/** The key the ombuds door's pointers are kept under. */
export const OMBUDS_ASKS_KEY = "ombuds-asks";

/** What a signed-in account the village has not admitted is told by the members' door. */
export const AGREEMENT_MEMBERS_ONLY =
  "The full agreement and its contacts are for the village's members. The public page shows its roles.";

/** What an admin is told once the Game has started. */
export const AGREEMENT_BALLOT_NOW =
  "The Game has started, so a change to the conflict agreement goes to the village as a vote. Open it from the agreement, where every member can.";

/** What a member is told before the Birthing when they try to open a change vote. */
export const AGREEMENT_FOUNDERS_NOW =
  "Before the Game starts, the founders write the conflict agreement. Once it starts, a change goes to the village as a vote.";

/** The sentence a withheld piece of the public view carries. */
export const NAME_WITHHELD = "This part names a person, so it shows to members only.";

// ── Reading ─────────────────────────────────────────────────────────────────

/** Today as YYYY-MM-DD, in UTC like every date this document stores. */
export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The agreement a village has: its stored document, or the one its exit
 * policy's restorative fields describe. `stored` says which.
 */
export function effectiveAgreement(
  storedRaw: unknown,
  restorative: unknown,
  roleIds: readonly string[],
): { agreement: ConflictAgreement; stored: boolean } {
  const stored = agreementOf(storedRaw, roleIds);
  if (stored) return { agreement: stored, stored: true };
  return {
    agreement: {
      ...agreementFromRestorative(restorative as never),
      version: 0,
      adoptedBy: null,
      adoptedHow: null,
      adoptedAt: null,
      updatedAt: null,
    },
    stored: false,
  };
}

/**
 * THE EXIT POLICY, WITH ITS RESTORATIVE BLOCK READ THROUGH THE AGREEMENT.
 *
 * `policy` is the reader's copy (`withPolicyDefaults`). With no stored
 * agreement it comes back untouched. With one, the five restorative fields
 * are the agreement's and everything else in the policy is as stored.
 * `conflictAgreement` rides along so a reader can say where the words live.
 */
export function withConflictAgreement<P extends { restorative?: unknown }>(policy: P, storedRaw: unknown): P {
  const a = agreementOf(storedRaw, []);
  if (!a) return policy;
  const restorative = (policy.restorative ?? {}) as Record<string, unknown>;
  return {
    ...policy,
    restorative: { ...restorative, ...restorativeFromAgreement(a) },
    conflictAgreement: { version: a.version, adopted: !!a.adoptedAt },
  } as P;
}

/** What the exit policy's editor is told when it tries to change a block the agreement answers. */
export const RESTORATIVE_IN_AGREEMENT =
  "The restorative path, the intake and cover roles, the reply time and the outside contact now come from the village's conflict agreement. Change them there, on the governance page; the rest of this policy saves as usual.";

/**
 * Does an exit policy body's restorative block say the same as the one a
 * reader is served? Compared field by field, as the words and values a page
 * prints, so an editor that loaded the policy and changed nothing in this
 * block always matches.
 */
export function sameRestorative(a: unknown, b: unknown): boolean {
  const x = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
  const y = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const steps = (v: unknown) => (Array.isArray(v) ? v.map((s) => String(s ?? "").replace(/\s+/g, " ").trim()).filter(Boolean) : []);
  const txt = (v: unknown) => String(v ?? "").trim();
  return (
    JSON.stringify(steps(x.steps)) === JSON.stringify(steps(y.steps)) &&
    txt(x.intakeContactRole) === txt(y.intakeContactRole) &&
    txt(x.coverRole) === txt(y.coverRole) &&
    replyHoursOf(x.replyHours) === replyHoursOf(y.replyHours) &&
    JSON.stringify(outsideContactOf(x.outsideContact)) === JSON.stringify(outsideContactOf(y.outsideContact))
  );
}

// ── Writing, before the Birthing ────────────────────────────────────────────

export type AgreementWrite =
  | { ok: true; doc: ConflictAgreement; changed: boolean }
  | { ok: false; status: 400 | 409; error: string; frame?: AgreementFrameId };

/**
 * The content an adoption would store, or its refusal: the shape check, then
 * what adopting asks. The admin's adoption and a change ballot, at its open
 * and at its close, all come through here.
 */
export function agreementForAdoption(
  body: unknown,
  ctx: { roleIds: readonly string[]; platformSteps: readonly string[]; now: Date },
): { ok: true; content: ConflictAgreementContent } | { ok: false; error: string; frame: AgreementFrameId } {
  const parsed = parseAgreementContent(body, { roleIds: ctx.roleIds });
  if (!parsed.ok) return parsed;
  const problem = adoptionProblem(parsed.content, { today: dayOf(ctx.now), platformSteps: ctx.platformSteps });
  if (problem) return { ok: false, ...problem };
  return { ok: true, content: parsed.content };
}

/**
 * An admin's save, before the Birthing: a draft, or an adoption.
 *
 * PURE: the stored document, the roles, the account, the clock and whether the
 * Game has started all arrive as arguments.
 *
 *   - After the Birthing it refuses (409): the pen is a ballot now.
 *   - `adopt: true` stamps who and when, after `adoptionProblem` passes.
 *     Re-adopting the same words keeps the first stamp, so saving twice does
 *     not move the date the village made its promise.
 *   - A draft never replaces an ADOPTED agreement (409). Storing it would
 *     withdraw an adopted promise because somebody fixed a typo, the same
 *     rule the closing section keeps (server/lib/closingPolicy.ts). Changing
 *     adopted words is adopting new ones.
 *   - Saving exactly what is stored changes nothing and says so.
 */
export function conflictAgreementWrite(
  body: unknown,
  ctx: {
    storedRaw: unknown;
    roleIds: readonly string[];
    platformSteps: readonly string[];
    actorId: string | null;
    now: Date;
    gameStarted: boolean;
  },
): AgreementWrite {
  if (ctx.gameStarted) return { ok: false, status: 409, error: AGREEMENT_BALLOT_NOW };
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const adopt = b.adopt === true;
  const incoming = b.agreement ?? b;
  const stored = agreementOf(ctx.storedRaw, ctx.roleIds);

  let content: ConflictAgreementContent;
  if (adopt) {
    const checked = agreementForAdoption(incoming, ctx);
    if (!checked.ok) return { ok: false, status: 400, error: checked.error, frame: checked.frame };
    content = checked.content;
  } else {
    const parsed = parseAgreementContent(incoming, { roleIds: ctx.roleIds });
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, frame: parsed.frame };
    content = parsed.content;
    if (stored?.adoptedAt && !sameContent(stored, content)) {
      return {
        ok: false,
        status: 409,
        error: "This agreement is adopted. Changing it is adopting a new version: check its review date and adopt it.",
        frame: "adoption",
      };
    }
  }

  if (stored && sameContent(stored, content) && (!adopt || stored.adoptedAt)) {
    return { ok: true, doc: stored, changed: false };
  }
  const at = ctx.now.toISOString();
  return {
    ok: true,
    changed: true,
    doc: {
      ...content,
      version: (stored?.version ?? 0) + 1,
      adoptedBy: adopt ? ctx.actorId : null,
      adoptedHow: adopt ? "founders" : null,
      adoptedAt: adopt ? at : null,
      updatedAt: at,
    },
  };
}

/**
 * The agreement an open change ballot would adopt, as members read it, or null
 * when nothing is recorded against that ballot. Read without trusting the row,
 * like the stored agreement: a proposal that fails the shape check reads as none.
 */
export function proposedAgreement(storedRaw: unknown, ballotId: string, roleIds: readonly string[]): ConflictAgreementContent | null {
  const s = storedRaw && typeof storedRaw === "object" ? (storedRaw as { ballotId?: unknown; agreement?: unknown }) : null;
  if (!s || String(s.ballotId ?? "") !== ballotId) return null;
  const a = agreementOf(s.agreement, roleIds);
  if (!a) return null;
  return {
    steps: a.steps,
    careRole: a.careRole,
    coverRole: a.coverRole,
    replyHours: a.replyHours,
    outsideContacts: a.outsideContacts,
    whenPowerInvolved: a.whenPowerInvolved,
    safetyContacts: a.safetyContacts,
    consequencesLadder: a.consequencesLadder,
    practices: a.practices,
    reviewDate: a.reviewDate,
  };
}

/** The document a carried ballot stores. */
export function adoptedByBallot(content: ConflictAgreementContent, standing: ConflictAgreement | null, ballotId: string, now: Date): ConflictAgreement {
  const at = now.toISOString();
  return {
    ...content,
    version: (standing?.version ?? 0) + 1,
    adoptedBy: `ballot:${ballotId}`,
    adoptedHow: "ballot",
    adoptedAt: at,
    updatedAt: at,
  };
}

// ── Names, which the public never reads ─────────────────────────────────────

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Built with the constructor: the root tsconfig's target refuses a /u literal.
const MARKS = new RegExp("\\p{M}+", "gu");
const LETTER = new RegExp("\\p{L}", "u");
const EDGE_NON_LETTERS = new RegExp("^[^\\p{L}]+|[^\\p{L}]+$", "gu");

/** Accents off, so "José" and "Jose" are one name on both sides of the match. */
const foldAccents = (s: string) => s.normalize("NFD").replace(MARKS, "");

/** Titles a display name can start with, which are never the name a step calls someone by. */
const HONORIFICS = new Set(["dr", "mr", "mrs", "ms", "mx", "miss", "prof", "sir", "dame", "rev", "fr", "sr", "br"]);

/**
 * Does this text name a member of the village? Built once per request from
 * every account's display name, with accents folded on both sides.
 *
 * A full display name matches in any case. The first name and the surname
 * (the first and last words, after any title such as "Dr.", and each half of a
 * hyphenated one) match as the member typed them, Capitalised and in CAPITALS,
 * whatever case the member typed. Lower case is left out on purpose, so a
 * member called May does not withhold "we may talk". Whole words only, and
 * anything shorter than two letters is ignored.
 *
 * What it cannot see: a nickname, a middle name, or a first name written in
 * lower case inside the text ("ask mara"). The frames tell the writer to name
 * roles, and this is the backstop to that. Its other mistake goes the safe
 * way: a word that only looks like a member's name is withheld.
 */
export function memberNameMatcher(names: ReadonlyArray<string | null | undefined>): (text: string) => boolean {
  const full = new Set<string>();
  const words = new Set<string>();
  for (const raw of names) {
    const name = foldAccents(String(raw ?? "")).trim().replace(/\s+/g, " ");
    if (name.length < 2) continue;
    full.add(name.toLowerCase());
    const tokens = name.split(" ").filter((t) => LETTER.test(t) && !HONORIFICS.has(t.replace(/\.$/, "").toLowerCase()));
    if (!tokens.length) continue;
    for (const token of Array.from(new Set([tokens[0], tokens[tokens.length - 1]]))) {
      for (const part of [token, ...token.split("-")]) {
        const w = part.replace(EDGE_NON_LETTERS, "");
        if (w.length < 2) continue;
        words.add(w);
        words.add(w[0].toUpperCase() + w.slice(1).toLowerCase());
        words.add(w.toUpperCase());
      }
    }
  }
  const boundary = (s: string) => `(?<![\\p{L}\\p{N}])${escape(s)}(?![\\p{L}\\p{N}])`;
  const fullRe = full.size ? new RegExp(Array.from(full).map(boundary).join("|"), "iu") : null;
  const wordRe = words.size ? new RegExp(Array.from(words).map(boundary).join("|"), "u") : null;
  return (text: string) => {
    const t = foldAccents(String(text ?? ""));
    return !!t && ((fullRe?.test(t) ?? false) || (wordRe?.test(t) ?? false));
  };
}

/** A role as a reader sees it: its name, or null when the id no longer names a role. */
type RoleRef = { id: string; name: string } | null;

function roleRef(id: string, roles: ReadonlyArray<{ id: string; name?: string | null }>): RoleRef {
  if (!id) return null;
  const r = roles.find((x) => x.id === id);
  return r ? { id: r.id, name: String(r.name ?? r.id) } : null;
}

/** Text the public may read, or null when it names a member. */
type Guarded = string | null;

export interface PublicAgreementView {
  steps: Array<{ what: Guarded; whoInRoom: Guarded }>;
  careRole: { id: string; name: Guarded } | null;
  coverRole: { id: string; name: Guarded } | null;
  replyHours: number | null;
  outsideContacts: Array<{ id: string; label: Guarded }>;
  whenPowerInvolved: { role: Guarded; outsideContact: Guarded; words: Guarded };
  consequencesLadder: { rungs: Array<{ rung: number; words: Guarded }>; appeal: Guarded };
  practices: Array<{ name: Guarded; when: Guarded }>;
  version: number;
  adoptedHow: ConflictAgreement["adoptedHow"];
  adoptedAt: string | null;
  reviewDate: string | null;
  /** True when any piece above was withheld for naming a member. */
  withheld: boolean;
}

/**
 * THE AGREEMENT AS THE PUBLIC READS IT: roles only.
 *
 * No person's name leaves here. Outside contacts are their organisation or
 * role; the safety contacts are not in the view at all; who adopted it is
 * the how and the date; and every string that names a member of this
 * village comes back null, with `withheld` set so the page can say why.
 */
export function publicAgreementView(
  a: ConflictAgreement,
  roles: ReadonlyArray<{ id: string; name?: string | null }>,
  namesMember: (text: string) => boolean,
): PublicAgreementView {
  let withheld = false;
  const g = (text: string): Guarded => {
    const t = text.trim();
    if (!t) return "";
    if (namesMember(t)) {
      withheld = true;
      return null;
    }
    return t;
  };
  const role = (id: string) => {
    const r = roleRef(id, roles);
    return r ? { id: r.id, name: g(r.name) } : null;
  };
  const byId = new Map(a.outsideContacts.map((c) => [c.id, c]));
  const powerRole = roleRef(a.whenPowerInvolved.roleId, roles);
  const powerContact = byId.get(a.whenPowerInvolved.outsideContactId);
  const view: PublicAgreementView = {
    steps: a.steps.map((s) => ({ what: g(s.what), whoInRoom: g(s.whoInRoom) })),
    careRole: role(a.careRole),
    coverRole: role(a.coverRole),
    replyHours: a.replyHours,
    outsideContacts: a.outsideContacts.map((c) => ({ id: c.id, label: g(contactLabel(c)) })),
    whenPowerInvolved: {
      role: powerRole ? g(powerRole.name) : "",
      outsideContact: powerContact ? g(contactLabel(powerContact)) : "",
      words: g(a.whenPowerInvolved.words),
    },
    consequencesLadder: {
      rungs: a.consequencesLadder.rungs.map((r) => ({ rung: r.rung, words: g(r.words) })),
      appeal: g(a.consequencesLadder.appeal),
    },
    practices: a.practices.map((p) => ({ name: g(p.name), when: g(p.when) })),
    version: a.version,
    adoptedHow: a.adoptedHow,
    adoptedAt: a.adoptedAt,
    reviewDate: a.reviewDate,
    withheld: false,
  };
  view.withheld = withheld;
  return view;
}

/**
 * THE EXIT POLICY'S RESTORATIVE BLOCK FOR SOMEBODY WHO IS NOT A MEMBER.
 *
 * The block carries the agreement's words once there is one, and /exit-policy,
 * /governance and /roles print it to anybody, signed in or not. So it gets the
 * public view's rule: a step naming a member becomes `NAME_WITHHELD`, and the
 * outside contact is its organisation or role with no name and no way to
 * reach them. Members read the block whole.
 */
export function restorativeForPublic<R extends { steps?: unknown; outsideContact?: unknown }>(
  r: R,
  namesMember: (text: string) => boolean,
): R {
  const steps = Array.isArray(r.steps) ? r.steps.map((s) => (namesMember(String(s ?? "")) ? NAME_WITHHELD : s)) : r.steps;
  const c = (r.outsideContact && typeof r.outsideContact === "object" ? r.outsideContact : {}) as Record<string, unknown>;
  const org = String(c.organisation ?? "").trim();
  return {
    ...r,
    steps,
    outsideContact: { name: "", organisation: org && !namesMember(org) ? org : "", howToReach: "" },
  };
}

// ── The ombuds door ─────────────────────────────────────────────────────────

/** One ask, as it is kept. No words, ever. */
export interface OmbudsAsk {
  id: string;
  askedBy: string;
  askedAt: string;
  contactId: string;
  /** The contact's organisation or role on the day, so the record still reads after the list changes. */
  contactLabel: string;
}

/** The only keys an ask may carry. Anything else is words, and words are refused. */
const ASK_KEYS = new Set(["contactId"]);

/**
 * Why this ask cannot be kept, or null. Refuses any field beyond the contact's
 * id, so a client that sends a message learns it was not sent, and refuses a
 * contact the agreement does not name.
 */
export function ombudsAskProblem(body: unknown, a: ConflictAgreement): { status: 400 | 404; error: string } | null {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const extra = Object.keys(b).filter((k) => !ASK_KEYS.has(k));
  if (extra.length) {
    return {
      status: 400,
      error:
        "This door carries no words. It records that you asked and shows you how to reach them; what you want to say, you say to them yourself.",
    };
  }
  if (a.outsideContacts.length === 0) {
    return { status: 404, error: "This village's agreement names nobody outside the village yet." };
  }
  const id = String(b.contactId ?? "").trim().toLowerCase();
  if (!a.outsideContacts.some((c) => c.id === id)) {
    return { status: 400, error: "Choose one of the outside contacts the agreement names." };
  }
  return null;
}

/** The pointer an ask keeps. */
export function ombudsPointer(a: ConflictAgreement, contactId: string, askedBy: string, now: Date, id: string): OmbudsAsk {
  const c = a.outsideContacts.find((x) => x.id === contactId.trim().toLowerCase())!;
  return { id, askedBy, askedAt: now.toISOString(), contactId: c.id, contactLabel: contactLabel(c) };
}

/** A stored list of asks, read without trusting it, filtered to one member's own. */
export function asksBy(storedRaw: unknown, userId: string): Array<Omit<OmbudsAsk, "askedBy">> {
  const list = storedRaw && typeof storedRaw === "object" ? (storedRaw as { asks?: unknown }).asks : null;
  if (!Array.isArray(list)) return [];
  return list
    .filter((x): x is OmbudsAsk => !!x && typeof x === "object" && String((x as OmbudsAsk).askedBy) === String(userId))
    .map(({ id, askedAt, contactId, contactLabel: label }) => ({ id: String(id), askedAt: String(askedAt), contactId: String(contactId), contactLabel: String(label) }));
}
