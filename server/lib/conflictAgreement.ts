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
 * that names a member of this village (`memberNameMatcher`), or names one of
 * the agreement's own contacts or how to reach them (`contactsMatcher`), is
 * withheld. The same guard runs over the exit policy's restorative block for
 * anybody who is not a member, WHETHER OR NOT an agreement is stored: with
 * one, the block carries the agreement's words; without one, it still names
 * the outside contact the Departures editor stored.
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

/** The prefix every agreement ballot's proposed document waits under, one key per ballot (`proposalKeyFor`). */
export const CONFLICT_AGREEMENT_PROPOSAL_KEY = "conflict-agreement-proposal";

/**
 * THE KEY ONE BALLOT'S PROPOSED AGREEMENT IS KEPT UNDER, and it is never
 * reused by another ballot.
 *
 * This was one shared key, which every new ballot's open overwrote (Wave 3a
 * audit, 2026-09-28). A carried change does not land at its close: it waits
 * for its landing date, and the close frees the subject, so a second change
 * could open in that window, overwrite the first one's agreement, and leave
 * the village's carried vote held for ever with "not recorded against it".
 * One key per ballot, like `gps_change_proposals` keeps one row per ballot,
 * and the carried vote finds its own words however many open after it.
 * `bal-<ms>-<6>` is 24 characters, so the key fits `config_key` varchar(64).
 */
export const proposalKeyFor = (ballotId: string): string => `${CONFLICT_AGREEMENT_PROPOSAL_KEY}:${ballotId}`;

/** The key the ombuds door's pointers are kept under. */
export const OMBUDS_ASKS_KEY = "ombuds-asks";

/** What a signed-in account the village has not admitted is told by the members' door. */
export const AGREEMENT_MEMBERS_ONLY =
  "The full agreement and its contacts are for the village's members. The public page shows its roles.";

/** What an admin is told once the Game has started. Opening the vote takes `proposal.open` held as a member, so this never says "every member". */
export const AGREEMENT_BALLOT_NOW =
  "The Game has started, so a change to the conflict agreement goes to the village as a vote. A member who can open votes opens it from the agreement on the governance page.";

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

/**
 * What the exit policy's editor is told when it tries to change a block the
 * agreement answers. The refusal comes before any write, so it says that
 * nothing was saved: it used to end "the rest of this policy saves as usual",
 * which a steward read after pressing Publish as a partial save.
 */
export const RESTORATIVE_IN_AGREEMENT =
  "Nothing was saved. The restorative path, the intake and cover roles, the reply time and the outside contact now come from the village's conflict agreement, so change them there, on the governance page. Reload this page to edit the rest of the policy.";

/**
 * What the exit policy's editor is told after the Birthing when it tries to
 * change the restorative block, whether or not an agreement is stored.
 * Plan section 2.3 puts the conflict path under the consequence pen: the
 * founders before the Birthing, a village vote after it. The vote is
 * `POST /api/governance/conflict-agreement-changes`, which works with no
 * stored agreement too (its closer stores the one it carries).
 */
export const RESTORATIVE_IS_A_VOTE =
  "Nothing was saved. The Game has started, so the restorative path, the intake and cover roles, the reply time and the outside contact change only by a vote on the village's conflict agreement. A member who can open votes opens it from the agreement on the governance page. Reload this page to edit the rest of the policy.";

/** The door that vote is opened through, named in the refusal's body. */
export const AGREEMENT_CHANGE_DOOR = "/api/governance/conflict-agreement-changes";

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

/** Folded, lower case, with every space gone, so "0412 555 000" and "0412555000" are one phrase. */
const squash = (s: unknown) => foldAccents(String(s ?? "")).toLowerCase().replace(/\s+/g, "");

/**
 * DOES THIS TEXT NAME ONE OF THE AGREEMENT'S OWN CONTACTS, OR SAY HOW TO REACH ONE?
 *
 * The agreement tells the founder its outside contacts are named publicly by
 * organisation or role and never by name, and that the public never sees the
 * safety contacts. `memberNameMatcher` only knew the village's members, so a
 * contact's name or number written into a step, the power clause, a rung, the
 * appeal or a practice was printed to anybody (Wave 3a audit, 2026-09-28). The
 * people it exposed are third parties: a mediator, and a contact for abuse or
 * violence.
 *
 * An outside contact's name is matched the way a member's is (they are a
 * person by definition). A safety contact's name, which is as often a service
 * as a person, is matched as its whole phrase, and every way of reaching
 * either kind is matched as a phrase with the spaces taken out. Phrases under
 * four characters are ignored. Its mistakes go the safe way, like the
 * member rule: text that merely contains a contact's phrase is withheld.
 */
export function contactsMatcher(
  agreements: ReadonlyArray<Pick<ConflictAgreementContent, "outsideContacts" | "safetyContacts"> | null | undefined>,
): (text: string) => boolean {
  const present = agreements.filter((a): a is Pick<ConflictAgreementContent, "outsideContacts" | "safetyContacts"> => !!a);
  const people = memberNameMatcher(present.flatMap((a) => a.outsideContacts.map((c) => c.name)));
  const phrases = new Set<string>();
  for (const a of present) {
    for (const c of a.outsideContacts) phrases.add(squash(c.howToReach));
    for (const c of a.safetyContacts) {
      phrases.add(squash(c.name));
      phrases.add(squash(c.howToReach));
    }
  }
  const list = Array.from(phrases).filter((p) => p.length >= 4);
  return (text: string) => {
    if (people(text)) return true;
    const t = squash(text);
    return !!t && list.some((p) => t.includes(p));
  };
}

/** One guard from several: the text is withheld when any of them says so. */
export const anyOf =
  (...guards: ReadonlyArray<(text: string) => boolean>) =>
  (text: string): boolean =>
    guards.some((g) => g(text));

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
  /**
   * `heldToday` is the restorative intake's own reach rule (`liveIntakeRecipients`),
   * the same answer /exit-policy prints from, so the card promises a reply only
   * while somebody holds the role that would send it.
   */
  careRole: { id: string; name: Guarded; heldToday: boolean } | null;
  coverRole: { id: string; name: Guarded; heldToday: boolean } | null;
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
  heldToday: (roleId: string) => boolean = () => false,
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
    return r ? { id: r.id, name: g(r.name), heldToday: heldToday(r.id) } : null;
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
 * /exit-policy, /governance and /roles print this block to anybody, signed in
 * or not, and it applies whether or not an agreement is stored. So it gets
 * the public view's rule: a step naming a member or a contact (the caller
 * hands both guards, `anyOf`) becomes `NAME_WITHHELD`, and the outside
 * contact is its organisation or role with no name and no way to reach them.
 * Members read the block whole.
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
