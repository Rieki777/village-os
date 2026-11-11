/**
 * ABOUT YOU: REFERENCES, THE BACKGROUND-CHECK CONSENT AND A FEW FACTS (joining
 * lane PR 2, 10 Nov 2026).
 *
 * Somebody proposing for a role can name up to three people who know their work
 * and say where they are based, which languages they use and what their story
 * with us is. Two things here are THIRD-PARTY PERSONAL DATA and are held to the
 * rules #1128 set for links and files (shared/proposalAttachments.ts):
 *
 *   - the references (a name, how the applicant knows them, an email or phone);
 *   - the applicant's background-check consent, with the day it was given.
 *
 * WHO SEES THEM: only the people who decide the proposal, on the one
 * members-only read the deciders' page uses, and the applicant sees a count of
 * the references they gave (never the details, to anybody else).
 *
 * NO AI READS THEM. `forAssistants` below is the single allow-list of the
 * proposal fields a model may be handed. A field not named in it never goes.
 * `server/lib/proposalAbout.privacy.test.ts` plants a reference in a body and
 * fails if any of it comes out the other side.
 *
 * KEPT AND REMOVED WITH THE PROPOSAL: the keys are `references`,
 * `backgroundCheck` and `about` of the proposal's body, removed by every path
 * that removes the links and files (server/repos/openProposals.ts). A member's
 * own application keeps the same three keys inside its `answers`, which member
 * erasure clears (`eraseApplicationWords`).
 *
 * Pure, so the page and the server import it alike.
 */

export const REFERENCES_MAX = 3;
export const REFERENCE_NAME_MAX = 80;
export const REFERENCE_HOW_MAX = 160;
export const REFERENCE_CONTACT_MAX = 120;
export const ABOUT_BASED_MAX = 120;
export const ABOUT_LANGUAGES_MAX = 160;
export const ABOUT_STORY_MAX = 400;

export interface ProposalReference {
  name: string;
  /** How the applicant knows them. */
  how: string;
  /** An email address or a phone number. */
  contact: string;
}

/** The applicant's own facts. Not third-party data, but still only for the deciders. */
export interface ProposalAbout {
  based?: string;
  languages?: string;
  story?: string;
}

/** Why a check is needed: no references were given, or a role picked is always checked. */
export type CheckBecause = "no_references" | "role";

/** What the intake worked out and stamped. `consent` is the tick, with the day and the wording version shown. */
export interface BackgroundCheck {
  needed: boolean;
  because: CheckBecause | null;
  consent?: { at: string; version: string };
}

/** The consent, in the lead's words, line by line. The tick below covers all of them. */
export const CHECK_WORDS = {
  heading: "References and a background check",
  referencesHint: "Up to three people who know your work. Leave all three blank if you prefer a background check.",
  lines: [
    "If you leave the three references blank, we'll run a background check instead. Its cost comes out of your first contractor pay.",
    "If we don't seat you, we cover it.",
    "The cost and the provider depend on your country, and we keep the cost as low as we can.",
  ],
  contactLine: "We contact your references only after our first conversation, and only with your OK.",
  roleLine: "A check happens for this role whatever the references say.",
  tick: "I have read this and I agree to the background check.",
} as const;

/** The version of the wording shown with the tick: it changes whenever a word does, so a stale tick is refused. */
export function checkConsentVersion(): string {
  const text = [...CHECK_WORDS.lines, CHECK_WORDS.contactLine, CHECK_WORDS.roleLine, CHECK_WORDS.tick].join("\n");
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `cc-${h.toString(16).padStart(8, "0")}`;
}

export const ABOUT_WORDS = {
  referenceNeedsAll: "Give each reference a name, how you know them, and an email or a phone number. Or clear the row.",
  referenceContact: "Give an email address or a phone number we can reach that reference on.",
  tooManyReferences: `Add up to ${REFERENCES_MAX} references.`,
  sameReferenceTwice: "You added the same reference twice.",
  tooLong: (what: string, max: number) => `${what} is too long. Keep it under ${max} characters.`,
  needConsent: "Tick the box to say you agree to the background check, or give three references.",
  consentChanged: "The words about the background check changed while you read them. Read them again and tick.",
  /** The deciders' page. */
  shownHeading: "About you, references and background check",
  shownNote: "Only the people who decide this proposal see these. No AI reads them. They are deleted with the proposal.",
  checkNeededNoReferences: "A background check is needed: no references were given.",
  checkNeededRole: "A background check is needed: a role picked is always background-checked, whatever the references say.",
  checkNotNeeded: "No background check is needed: references were given.",
  consentGiven: (day: string) => `Consent to the check was given on ${day}.`,
  noConsent: "No consent to a check was recorded.",
  /** The applicant's own page: a count only. */
  given: (n: number) => (n === 0 ? "You gave no references." : n === 1 ? "You gave 1 reference." : `You gave ${n} references.`),
} as const;

const clean = (v: unknown, max: number): string => String(typeof v === "string" ? v : "").replace(/\s+/g, " ").trim().slice(0, max + 1);

const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;
const PHONE = /^\+?[0-9][0-9 ().-]{4,28}[0-9]$/;

/** Whether a contact is an email address or a phone number. */
export function isReachable(contact: string): boolean {
  const c = contact.trim();
  if (EMAIL.test(c)) return true;
  return PHONE.test(c) && c.replace(/\D/g, "").length >= 6;
}

type Checked<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

/**
 * References as the form sent them. A wholly blank row is dropped; a row with
 * some of it needs all of it. The first problem is answered.
 */
export function parseReferences(raw: unknown): Checked<ProposalReference[]> {
  const rows = Array.isArray(raw) ? raw : [];
  const out: ProposalReference[] = [];
  const seen = new Set<string>();
  for (const r of rows as any[]) {
    const name = clean(r?.name, REFERENCE_NAME_MAX);
    const how = clean(r?.how, REFERENCE_HOW_MAX);
    const contact = clean(r?.contact, REFERENCE_CONTACT_MAX);
    if (!name && !how && !contact) continue;
    if (name.length > REFERENCE_NAME_MAX) return { ok: false, field: "references", error: ABOUT_WORDS.tooLong("A reference's name", REFERENCE_NAME_MAX) };
    if (how.length > REFERENCE_HOW_MAX) return { ok: false, field: "references", error: ABOUT_WORDS.tooLong("How you know them", REFERENCE_HOW_MAX) };
    if (contact.length > REFERENCE_CONTACT_MAX) return { ok: false, field: "references", error: ABOUT_WORDS.tooLong("A reference's contact", REFERENCE_CONTACT_MAX) };
    if (!name || !how || !contact) return { ok: false, field: "references", error: ABOUT_WORDS.referenceNeedsAll };
    if (!isReachable(contact)) return { ok: false, field: "references", error: ABOUT_WORDS.referenceContact };
    const key = contact.toLowerCase().replace(/[^a-z0-9@+.]/g, "");
    if (seen.has(key)) return { ok: false, field: "references", error: ABOUT_WORDS.sameReferenceTwice };
    seen.add(key);
    out.push({ name, how, contact });
    if (out.length > REFERENCES_MAX) return { ok: false, field: "references", error: ABOUT_WORDS.tooManyReferences };
  }
  return { ok: true, value: out };
}

/** The applicant's facts as sent; absent ones are left out. */
export function parseAbout(raw: unknown): Checked<ProposalAbout> {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const based = clean(o.based, ABOUT_BASED_MAX);
  const languages = clean(o.languages, ABOUT_LANGUAGES_MAX);
  const story = clean(o.story, ABOUT_STORY_MAX);
  if (based.length > ABOUT_BASED_MAX) return { ok: false, field: "about", error: ABOUT_WORDS.tooLong("Where you are based", ABOUT_BASED_MAX) };
  if (languages.length > ABOUT_LANGUAGES_MAX) return { ok: false, field: "about", error: ABOUT_WORDS.tooLong("Your languages", ABOUT_LANGUAGES_MAX) };
  if (story.length > ABOUT_STORY_MAX) return { ok: false, field: "about", error: ABOUT_WORDS.tooLong("Your story with us", ABOUT_STORY_MAX) };
  return { ok: true, value: { ...(based ? { based } : {}), ...(languages ? { languages } : {}), ...(story ? { story } : {}) } };
}

/** Whether a check is needed, and why. A role always checked wins the reason. */
export function checkNeeded(references: readonly ProposalReference[], alwaysChecked: boolean): { needed: boolean; because: CheckBecause | null } {
  if (alwaysChecked) return { needed: true, because: "role" };
  if (references.length === 0) return { needed: true, because: "no_references" };
  return { needed: false, because: null };
}

/**
 * The whole About-you section judged once, by the open form's intake and the
 * member door alike. `consent` is what the form sent (`{ given, version }`);
 * `at` is the server's own clock. A consent is required when a check is needed.
 * A tick sent when none is needed is kept all the same, since it was given.
 */
export function parseAboutYou(
  raw: { references?: unknown; about?: unknown; consent?: unknown },
  ctx: { alwaysChecked: boolean; at: Date },
): Checked<{ references: ProposalReference[]; about: ProposalAbout; backgroundCheck: BackgroundCheck }> {
  const refs = parseReferences(raw.references);
  if (!refs.ok) return refs;
  const about = parseAbout(raw.about);
  if (!about.ok) return about;
  const need = checkNeeded(refs.value, ctx.alwaysChecked);
  const sent = raw.consent && typeof raw.consent === "object" ? (raw.consent as Record<string, unknown>) : null;
  const ticked = sent?.given === true;
  if (need.needed && !ticked) return { ok: false, field: "checkConsent", error: ABOUT_WORDS.needConsent };
  if (ticked && sent?.version !== checkConsentVersion()) return { ok: false, field: "checkConsent", error: ABOUT_WORDS.consentChanged };
  return {
    ok: true,
    value: {
      references: refs.value,
      about: about.value,
      backgroundCheck: { ...need, ...(ticked ? { consent: { at: ctx.at.toISOString(), version: checkConsentVersion() } } : {}) },
    },
  };
}

/** Stored references, read back safely. Never throws. */
export function referencesOf(raw: unknown): ProposalReference[] {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, REFERENCES_MAX)
    .map((r: any) => ({ name: clean(r?.name, REFERENCE_NAME_MAX).slice(0, REFERENCE_NAME_MAX), how: clean(r?.how, REFERENCE_HOW_MAX).slice(0, REFERENCE_HOW_MAX), contact: clean(r?.contact, REFERENCE_CONTACT_MAX).slice(0, REFERENCE_CONTACT_MAX) }))
    .filter((r) => r.name && r.contact);
}

/** Stored facts, read back safely. */
export function aboutOf(raw: unknown): ProposalAbout {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const based = clean(o.based, ABOUT_BASED_MAX).slice(0, ABOUT_BASED_MAX);
  const languages = clean(o.languages, ABOUT_LANGUAGES_MAX).slice(0, ABOUT_LANGUAGES_MAX);
  const story = clean(o.story, ABOUT_STORY_MAX).slice(0, ABOUT_STORY_MAX);
  return { ...(based ? { based } : {}), ...(languages ? { languages } : {}), ...(story ? { story } : {}) };
}

/** A stored check, read back safely; undefined when there is none. */
export function backgroundCheckOf(raw: unknown): BackgroundCheck | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.needed !== "boolean") return undefined;
  const because = o.because === "no_references" || o.because === "role" ? o.because : null;
  const c = o.consent && typeof o.consent === "object" ? (o.consent as Record<string, unknown>) : null;
  const at = typeof c?.at === "string" && !Number.isNaN(Date.parse(c.at)) ? c.at : null;
  const version = typeof c?.version === "string" ? c.version.slice(0, 40) : null;
  return { needed: o.needed, because, ...(at && version ? { consent: { at, version } } : {}) };
}

/** The line the deciders read about the check. */
export function checkLine(check: BackgroundCheck | undefined): string {
  if (!check) return "";
  if (!check.needed) return ABOUT_WORDS.checkNotNeeded;
  return check.because === "role" ? ABOUT_WORDS.checkNeededRole : ABOUT_WORDS.checkNeededNoReferences;
}

// ── THE ONE DOOR TO A MODEL ──────────────────────────────────────────────────

/**
 * THE FIELDS OF A PROPOSAL A MODEL MAY BE HANDED, and the only way to hand
 * them. An allow-list: the roles asked for, why, and the aim. The references,
 * the check and its consent, the applicant's facts, links, files, name and
 * address are not named, so none can go. Nothing in the village calls a model
 * with a proposal today (shared/applicationReview.ts, `SELECTION_IS_HUMAN`);
 * if one ever does, it goes through here.
 */
export const AI_SAFE_PROPOSAL_FIELDS = ["roles", "why", "aim"] as const;

export function forAssistants(body: unknown): Record<string, unknown> {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const k of AI_SAFE_PROPOSAL_FIELDS) if (k in o) out[k] = o[k];
  return out;
}
