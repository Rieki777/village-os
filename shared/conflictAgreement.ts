/**
 * THE CONFLICT AGREEMENT: block 8 of the governance canvas, as one document
 * (plan section 6.2). Isomorphic, so the editor on the page checks a draft
 * with the same words the server refuses it with.
 *
 * ── WHAT IT HOLDS, FRAME BY FRAME ─────────────────────────────────────────
 *
 * The editor walks eight frames, one per screen, in `AGREEMENT_FRAMES` order:
 *
 *   1. steps        the steps, in order, and who is in the room at each
 *   2. care         the care role and a cover role, both PERMISSION roles (the
 *                   plane the restorative intake already reads), plus up to
 *                   three named contacts outside the village
 *   3. reply        a promised reply time in hours, with NO platform default
 *   4. power        when a conflict involves someone who holds power here,
 *                   who holds it instead
 *   5. safety       who to call when it is not something to mediate. These
 *                   are for members only and never reach the public view
 *   6. ladder       the consequences ladder, and how someone appeals
 *   7. practices    what keeps small tensions small. Offered, never seeded
 *   8. adoption     who adopted it, how, and when it comes back for review
 *
 * ── WHERE THE RULES LIVE ──────────────────────────────────────────────────
 *
 * `parseAgreementContent` is the shape check every save passes, draft or
 * adopted. `adoptionProblem` is what an adoption asks on top: steps in the
 * village's own words with who is in the room, a door (a care role or a named
 * outside contact), a reply time and a review date. The server wraps both in
 * server/lib/conflictAgreement.ts, which adds what only the server knows: the
 * platform's own starting steps, the Birthing, and who is writing.
 *
 * ── THE PLATFORM'S RUNGS ARE RULES, THE VILLAGE'S WORDS ARE ITS OWN ───────
 *
 * The ladder has four rungs the platform defines (`LADDER_RUNGS`) and a
 * village writes its own words for whichever it uses. Any rung past a request
 * needs a stated appeal before the document saves at all, and
 * `consequenceBeyondRequestProblem` is the check a later route asks before it
 * applies one.
 */

/** The ballot subject a change to the agreement opens under, once the Game has started. */
export const CONFLICT_AGREEMENT = "conflict_agreement";

/** The `app_config` key the agreement is stored under. */
export const CONFLICT_AGREEMENT_KEY = "conflict-agreement";

// ── Limits ──────────────────────────────────────────────────────────────────

/** The longest promised reply: thirty days, in hours. server/lib/exitPolicy.ts reads the same number. */
export const AGREEMENT_REPLY_HOURS_MAX = 720;
/** A contact's name, organisation or role. server/lib/exitPolicy.ts reads the same number. */
export const AGREEMENT_NAME_MAX = 120;
/** How to reach a contact. server/lib/exitPolicy.ts reads the same number. */
export const AGREEMENT_REACH_MAX = 300;
export const STEPS_MAX = 12;
export const STEP_WHAT_MAX = 300;
export const STEP_WHO_MAX = 200;
export const OUTSIDE_CONTACTS_MAX = 3;
export const SAFETY_CONTACTS_MAX = 8;
export const PRACTICES_MAX = 12;
/** A rung's words, the appeal, the power clause's words. */
export const AGREEMENT_WORDS_MAX = 600;
/** Short fields: when a practice happens, when to call a safety contact. */
export const AGREEMENT_WHEN_MAX = 200;
/** The furthest a review date may sit from today. Every seat has a term, and so does this. */
export const REVIEW_YEARS_MAX = 5;

// ── The shape ───────────────────────────────────────────────────────────────

export interface AgreementStep {
  what: string;
  whoInRoom: string;
}

/**
 * Somebody outside the village a member can bring a conflict to. `organisation`
 * or `role` is what the public reads; the name and the way to reach them are
 * for members.
 */
export interface OutsideContact {
  id: string;
  name: string;
  organisation: string;
  role: string;
  howToReach: string;
}

export interface SafetyContact {
  name: string;
  howToReach: string;
  when: string;
}

/** Who holds a conflict instead when it involves someone who holds power here. At most one of the two ids. */
export interface PowerClause {
  roleId: string;
  outsideContactId: string;
  words: string;
}

export type LadderRungNumber = 1 | 2 | 3 | 4;

export interface LadderRung {
  rung: LadderRungNumber;
  words: string;
}

export interface ConsequencesLadder {
  rungs: LadderRung[];
  appeal: string;
}

export interface AgreementPractice {
  name: string;
  when: string;
}

export type AdoptedHow = "founders" | "ballot";

/** Everything a village writes. The adoption stamp is the server's. */
export interface ConflictAgreementContent {
  steps: AgreementStep[];
  careRole: string;
  coverRole: string;
  replyHours: number | null;
  outsideContacts: OutsideContact[];
  whenPowerInvolved: PowerClause;
  safetyContacts: SafetyContact[];
  consequencesLadder: ConsequencesLadder;
  practices: AgreementPractice[];
  /** YYYY-MM-DD, or null while nobody has set one. Required to adopt. */
  reviewDate: string | null;
}

/** The stored document. */
export interface ConflictAgreement extends ConflictAgreementContent {
  /** Counts every stored change, so a later record can say which version it was read under. */
  version: number;
  /** The admin account that adopted it, or `ballot:<id>`. Kept in the record and never served. */
  adoptedBy: string | null;
  adoptedHow: AdoptedHow | null;
  adoptedAt: string | null;
  updatedAt: string | null;
}

/** The stored document as a reader is served it: everything but who adopted it. */
export type ConflictAgreementForReaders = Omit<ConflictAgreement, "adoptedBy"> & { ballotId: string | null };

// ── The frames ──────────────────────────────────────────────────────────────

export type FrameWeight = "blocking" | "recommended" | "optional" | "recorded";

export const AGREEMENT_FRAMES = [
  {
    id: "steps",
    title: "The steps",
    question: "When two of us disagree, what are the steps, in order, and who is in the room at each?",
    hint: "\"We talk it out, then ask the care holder\" is an honest first answer. Name roles here: the public page shows this frame.",
    weight: "blocking",
  },
  {
    id: "care",
    title: "Who hears it first",
    question: "Who hears a request for care first, and who covers when they are away?",
    hint: "Both are roles from the Roles page, so whoever holds the role today is who a request reaches. A contact outside the village can stand in for both.",
    weight: "blocking",
  },
  {
    id: "reply",
    title: "The reply time",
    question: "How quickly will someone who reaches out hear back?",
    hint: "In hours. There is no suggested number: the village chooses one it can keep.",
    weight: "blocking",
  },
  {
    id: "power",
    title: "When power is involved",
    question: "When it involves someone who holds power here, such as a founder, a steward or the care holder, who holds it instead?",
    hint: "A role, or one of the outside contacts. The care role cannot hold it instead, because the conflict may be about its holder.",
    weight: "recommended",
  },
  {
    id: "safety",
    title: "Safety contacts",
    question: "When it is not something to mediate, such as abuse, violence or a crisis, who do we call?",
    hint: "Members see these in full. The public page never shows them.",
    weight: "recommended",
  },
  {
    id: "ladder",
    title: "Consequences and appeal",
    question: "What is our ladder of consequences, and how does someone appeal?",
    hint: "Write words for the rungs this village uses. Any rung past a request needs an appeal written here first.",
    weight: "recommended",
  },
  {
    id: "practices",
    title: "Practices",
    question: "Which shared practices keep small tensions small, and when?",
    hint: "Nothing is filled in for you. Add the ones this village actually keeps.",
    weight: "optional",
  },
  {
    id: "adoption",
    title: "Adoption and review",
    question: "Who adopted this, how, and when does it come back for review?",
    hint: "Adopting records who and when. The review date is required, and it is when the village reads this again.",
    weight: "recorded",
  },
] as const satisfies ReadonlyArray<{ id: string; title: string; question: string; hint: string; weight: FrameWeight }>;

export type AgreementFrameId = (typeof AGREEMENT_FRAMES)[number]["id"];

/**
 * The platform's four rungs. The village's words go beside them, and the
 * platform's rule for each is printed with them so nobody reads a rung as
 * gentler than it is.
 */
export const LADDER_RUNGS: Readonly<Record<LadderRungNumber, { name: string; rule: string }>> = {
  1: { name: "A request", rule: "A request to change, made in conversation. Nothing is enforced." },
  2: { name: "A written care agreement", rule: "Written down with check-ins, and it carries a review date." },
  3: {
    name: "A pause on some keys, for a set time",
    rule: "Some of a member's keys are paused, with a note and an end date. Their vote is never touched.",
  },
  4: { name: "Asking someone to leave", rule: "The village asks a member to leave, on the grounds its exit policy names." },
};

/** Said wherever the ladder is shown, until a panel exists that enforces an appeal. */
export const APPEAL_NOT_ENFORCED = "The platform does not yet enforce an appeal. The words above are what a member can hold the village to.";

// ── Reading and checking ────────────────────────────────────────────────────

export type ParsedContent =
  | { ok: true; content: ConflictAgreementContent }
  | { ok: false; error: string; frame: AgreementFrameId };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** A contact id the page may choose: short, lower case, digits and hyphens. */
const CONTACT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A promised reply, as whole hours from 1 to the maximum, or null. A digit string counts. */
export function agreementReplyHours(v: unknown): number | null {
  const raw = typeof v === "string" ? v.trim() : v;
  if (typeof raw !== "number" && !(typeof raw === "string" && /^\d+$/.test(raw))) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= AGREEMENT_REPLY_HOURS_MAX ? n : null;
}

/** YYYY-MM-DD that names a real day, or null. */
export function calendarDate(v: unknown): string | null {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/** "the first", "the second" ... for a refusal that points at one row. */
function nth(i: number): string {
  return ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"][i] ?? `number ${i + 1}`;
}

const fail = (frame: AgreementFrameId, error: string): ParsedContent => ({ ok: false, error, frame });

/**
 * Turn a body into agreement content, or the first refusal with the frame it
 * belongs to. Every save passes this, a draft included.
 *
 * `roleIds` is every permission role the village has. Blank rows the editor
 * leaves behind are dropped; a half-filled row is refused and named, because
 * dropping it would lose words somebody typed.
 */
export function parseAgreementContent(body: unknown, ctx: { roleIds: readonly string[] }): ParsedContent {
  const b = obj(body);

  // 1. Steps.
  const steps: AgreementStep[] = [];
  const stepRows = list(b.steps);
  for (let i = 0; i < stepRows.length; i++) {
    const raw = stepRows[i];
    const s = typeof raw === "string" ? { what: raw, whoInRoom: "" } : obj(raw);
    const what = str(s.what);
    const whoInRoom = str(s.whoInRoom);
    if (!what && !whoInRoom) continue;
    if (!what) return fail("steps", `The ${nth(i)} step says who is in the room and not what happens. Say what happens, or remove the step.`);
    if (what.length > STEP_WHAT_MAX) return fail("steps", `Keep each step to ${STEP_WHAT_MAX} characters. The ${nth(i)} is ${what.length}.`);
    if (whoInRoom.length > STEP_WHO_MAX) return fail("steps", `Keep who is in the room to ${STEP_WHO_MAX} characters. The ${nth(i)} step's is ${whoInRoom.length}.`);
    steps.push({ what, whoInRoom });
  }
  if (steps.length === 0) return fail("steps", "Write at least one step. The exit policy prints these as the village's restorative path.");
  if (steps.length > STEPS_MAX) return fail("steps", `An agreement holds ${STEPS_MAX} steps at most. This one has ${steps.length}.`);

  // 2. Who hears it first.
  const careRole = str(b.careRole);
  const coverRole = str(b.coverRole);
  if (careRole && !ctx.roleIds.includes(careRole)) return fail("care", `Unknown care role "${careRole}"`);
  if (coverRole && !ctx.roleIds.includes(coverRole)) return fail("care", `Unknown cover role "${coverRole}"`);
  if (coverRole && !careRole) return fail("care", "A cover role covers the care role, so choose the care role first.");
  if (coverRole && coverRole === careRole) {
    return fail("care", "The cover role is the care role itself, so nobody covers when its holders cannot. Choose a second role, or leave cover empty.");
  }

  const outsideContacts: OutsideContact[] = [];
  const takenIds = new Set<string>();
  const contactRows = list(b.outsideContacts);
  for (let i = 0; i < contactRows.length; i++) {
    const raw = contactRows[i];
    const c = obj(raw);
    const contact = { name: str(c.name), organisation: str(c.organisation), role: str(c.role), howToReach: str(c.howToReach) };
    if (!contact.name && !contact.organisation && !contact.role && !contact.howToReach) continue;
    if (!contact.name || !contact.howToReach) {
      return fail("care", `The ${nth(i)} outside contact needs a name and a way to reach them.`);
    }
    if (!contact.organisation && !contact.role) {
      return fail(
        "care",
        `Say which organisation the ${nth(i)} outside contact is with, or the role they hold here, such as cohort ombuds. The public page names them that way and never by name.`,
      );
    }
    for (const field of ["name", "organisation", "role"] as const) {
      if (contact[field].length > AGREEMENT_NAME_MAX) {
        return fail("care", `Keep an outside contact's name, organisation and role to ${AGREEMENT_NAME_MAX} characters each.`);
      }
    }
    if (contact.howToReach.length > AGREEMENT_REACH_MAX) {
      return fail("care", `Keep how to reach an outside contact to ${AGREEMENT_REACH_MAX} characters.`);
    }
    const wanted = str(c.id).toLowerCase();
    let id = CONTACT_ID.test(wanted) && !takenIds.has(wanted) ? wanted : "";
    if (!id) {
      let n = outsideContacts.length + 1;
      while (takenIds.has(`oc-${n}`) || contactRows.some((o) => str(obj(o).id).toLowerCase() === `oc-${n}`)) n += 1;
      id = `oc-${n}`;
    }
    takenIds.add(id);
    outsideContacts.push({ id, ...contact });
  }
  if (outsideContacts.length > OUTSIDE_CONTACTS_MAX) {
    return fail("care", `An agreement names ${OUTSIDE_CONTACTS_MAX} outside contacts at most. This one names ${outsideContacts.length}.`);
  }

  // 3. The reply time.
  const rawHours = typeof b.replyHours === "string" ? b.replyHours.trim() : b.replyHours;
  const replyHours = agreementReplyHours(rawHours);
  if (rawHours !== undefined && rawHours !== null && rawHours !== "" && replyHours === null) {
    return fail("reply", `A promised reply time is a whole number of hours, from 1 to ${AGREEMENT_REPLY_HOURS_MAX}.`);
  }

  // 4. When power is involved.
  const p = obj(b.whenPowerInvolved);
  const powerRole = str(p.roleId);
  const powerContact = str(p.outsideContactId).toLowerCase();
  const powerWords = str(p.words);
  if (powerRole && powerContact) return fail("power", "Choose one to hold it instead: a role, or an outside contact.");
  if (powerRole && !ctx.roleIds.includes(powerRole)) return fail("power", `Unknown role "${powerRole}"`);
  if (powerRole && powerRole === careRole) {
    return fail("power", "The care role cannot hold it instead, because the conflict may be about the person holding it. Choose another role, or an outside contact.");
  }
  if (powerContact && !outsideContacts.some((c) => c.id === powerContact)) {
    return fail("power", "The outside contact chosen to hold it instead is not in the list on the second frame.");
  }
  if (powerWords.length > AGREEMENT_WORDS_MAX) return fail("power", `Keep these words to ${AGREEMENT_WORDS_MAX} characters.`);

  // 5. Safety contacts.
  const safetyContacts: SafetyContact[] = [];
  const safetyRows = list(b.safetyContacts);
  for (let i = 0; i < safetyRows.length; i++) {
    const raw = safetyRows[i];
    const c = obj(raw);
    const contact = { name: str(c.name), howToReach: str(c.howToReach), when: str(c.when) };
    if (!contact.name && !contact.howToReach && !contact.when) continue;
    if (!contact.name || !contact.howToReach) return fail("safety", `The ${nth(i)} safety contact needs a name and a way to reach them.`);
    if (contact.name.length > AGREEMENT_NAME_MAX) return fail("safety", `Keep a safety contact's name to ${AGREEMENT_NAME_MAX} characters.`);
    if (contact.howToReach.length > AGREEMENT_REACH_MAX) return fail("safety", `Keep how to reach a safety contact to ${AGREEMENT_REACH_MAX} characters.`);
    if (contact.when.length > AGREEMENT_WHEN_MAX) return fail("safety", `Keep when to call them to ${AGREEMENT_WHEN_MAX} characters.`);
    safetyContacts.push(contact);
  }
  if (safetyContacts.length > SAFETY_CONTACTS_MAX) {
    return fail("safety", `An agreement names ${SAFETY_CONTACTS_MAX} safety contacts at most. This one names ${safetyContacts.length}.`);
  }

  // 6. The ladder.
  const l = obj(b.consequencesLadder);
  const rungs: LadderRung[] = [];
  for (const raw of list(l.rungs)) {
    const r = obj(raw);
    const words = str(r.words);
    const rung = Number(r.rung);
    if (!words) continue;
    if (![1, 2, 3, 4].includes(rung)) return fail("ladder", "A rung is one of the four the page offers.");
    if (rungs.some((x) => x.rung === rung)) return fail("ladder", `The rung "${LADDER_RUNGS[rung as LadderRungNumber].name}" is written twice.`);
    if (words.length > AGREEMENT_WORDS_MAX) return fail("ladder", `Keep each rung's words to ${AGREEMENT_WORDS_MAX} characters.`);
    rungs.push({ rung: rung as LadderRungNumber, words });
  }
  rungs.sort((a, c) => a.rung - c.rung);
  const appeal = str(l.appeal);
  if (appeal.length > AGREEMENT_WORDS_MAX) return fail("ladder", `Keep the appeal to ${AGREEMENT_WORDS_MAX} characters.`);
  if (rungs.some((r) => r.rung > 1) && !appeal) {
    return fail("ladder", "Any consequence past a request needs a way to appeal it. Say how someone appeals, or keep the ladder to a request.");
  }

  // 7. Practices.
  const practices: AgreementPractice[] = [];
  const practiceRows = list(b.practices);
  for (let i = 0; i < practiceRows.length; i++) {
    const raw = practiceRows[i];
    const pr = obj(raw);
    const practice = { name: str(pr.name), when: str(pr.when) };
    if (!practice.name && !practice.when) continue;
    if (!practice.name) return fail("practices", `The ${nth(i)} practice says when and not what. Name it, or remove it.`);
    if (practice.name.length > AGREEMENT_NAME_MAX) return fail("practices", `Keep a practice's name to ${AGREEMENT_NAME_MAX} characters.`);
    if (practice.when.length > AGREEMENT_WHEN_MAX) return fail("practices", `Keep when a practice happens to ${AGREEMENT_WHEN_MAX} characters.`);
    practices.push(practice);
  }
  if (practices.length > PRACTICES_MAX) return fail("practices", `An agreement holds ${PRACTICES_MAX} practices at most.`);

  // 8. The review date. Required to adopt, checked there; here it only has to be a date.
  const rawDate = str(b.reviewDate);
  const reviewDate = calendarDate(rawDate);
  if (rawDate && !reviewDate) return fail("adoption", "A review date is a day in the calendar, written as year, month and day.");

  return {
    ok: true,
    content: {
      steps,
      careRole,
      coverRole,
      replyHours,
      outsideContacts,
      whenPowerInvolved: { roleId: powerRole, outsideContactId: powerContact, words: powerWords },
      safetyContacts,
      consequencesLadder: { rungs, appeal },
      practices,
      reviewDate,
    },
  };
}

/** Add whole years to a YYYY-MM-DD date. */
function plusYears(day: string, years: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

const sameWords = (a: string, b: string): boolean =>
  a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * What an adoption asks on top of the shape, or null.
 *
 * `today` is YYYY-MM-DD. `platformSteps` is the platform's own starting
 * steps: adopting them word for word would publish the platform's procedure
 * as the village's, the rule the exit policy's publish gate already keeps.
 */
export function adoptionProblem(
  c: ConflictAgreementContent,
  ctx: { today: string; platformSteps: readonly string[] },
): { error: string; frame: AgreementFrameId } | null {
  if (
    c.steps.length === ctx.platformSteps.length &&
    c.steps.every((s, i) => sameWords(s.what, ctx.platformSteps[i]) && !s.whoInRoom)
  ) {
    return { frame: "steps", error: "These steps are still word for word the platform's. Write them in the village's own words before adopting them." };
  }
  const nobody = c.steps.findIndex((s) => !s.whoInRoom);
  if (nobody >= 0) return { frame: "steps", error: `Say who is in the room at each step. The ${nth(nobody)} step does not say yet.` };
  if (!c.careRole && c.outsideContacts.length === 0) {
    return { frame: "care", error: "A request for care needs somewhere to go. Choose a care role, or name a contact outside the village." };
  }
  if (c.replyHours === null) return { frame: "reply", error: "Say within how many hours someone who reaches out hears back." };
  if (!c.reviewDate) return { frame: "adoption", error: "Set the date this agreement comes back for review. Adopting needs one." };
  if (c.reviewDate <= ctx.today) return { frame: "adoption", error: "The review date has to be after today." };
  if (c.reviewDate > plusYears(ctx.today, REVIEW_YEARS_MAX)) {
    return { frame: "adoption", error: `Set a review date within ${REVIEW_YEARS_MAX} years. A later one is a date nobody will keep.` };
  }
  return null;
}

/**
 * May a consequence past a request be applied under this agreement? Null when
 * it may. The rung-3 and rung-4 routes ask this before they act; the document
 * itself already refuses a ladder past a request with no appeal.
 */
export function consequenceBeyondRequestProblem(
  a: Pick<ConflictAgreement, "adoptedAt" | "consequencesLadder"> | null,
  rung: 2 | 3 | 4,
): string | null {
  if (!a || !a.adoptedAt) {
    return "The village has not adopted a conflict agreement, so no consequence past a request can be applied yet.";
  }
  if (!a.consequencesLadder.rungs.some((r) => r.rung === rung)) {
    return `The village's conflict agreement does not include "${LADDER_RUNGS[rung].name}", so it cannot be applied.`;
  }
  if (!a.consequencesLadder.appeal.trim()) {
    return "The village's conflict agreement names no appeal, so no consequence past a request can be applied.";
  }
  return null;
}

// ── From the exit policy, and back into it ──────────────────────────────────

/** The restorative block of the exit policy, as far as this file reads it. */
export interface RestorativeFields {
  intakeContactRole?: unknown;
  steps?: unknown;
  coverRole?: unknown;
  replyHours?: unknown;
  outsideContact?: unknown;
}

/**
 * THE AGREEMENT A VILLAGE HAS BEFORE IT SAVES ONE: its exit policy's restorative
 * fields, read as the document's defaults. Nothing is written: a village that
 * never opens the editor keeps exactly the policy it has, and one that does
 * starts from what it already wrote.
 */
export function agreementFromRestorative(r: RestorativeFields | null | undefined): ConflictAgreementContent {
  const x = obj(r);
  const contact = obj(x.outsideContact);
  const named = str(contact.name) || str(contact.organisation) || str(contact.howToReach);
  return {
    steps: list(x.steps)
      .map((s) => str(s))
      .filter((s) => s.length > 0)
      .map((what) => ({ what, whoInRoom: "" })),
    careRole: str(x.intakeContactRole),
    coverRole: str(x.coverRole),
    replyHours: agreementReplyHours(x.replyHours),
    outsideContacts: named
      ? [{ id: "oc-1", name: str(contact.name), organisation: str(contact.organisation), role: "", howToReach: str(contact.howToReach) }]
      : [],
    whenPowerInvolved: { roleId: "", outsideContactId: "", words: "" },
    safetyContacts: [],
    consequencesLadder: { rungs: [], appeal: "" },
    practices: [],
    reviewDate: null,
  };
}

/** One step as a line of the exit policy's restorative path. */
export function stepLine(s: AgreementStep): string {
  const what = s.what.trim();
  const who = s.whoInRoom.trim();
  if (!who) return what;
  return `${what}${/[.!?]$/.test(what) ? "" : "."} In the room: ${who}`;
}

/** How the public names an outside contact: by organisation or role, never by name. */
export function contactLabel(c: Pick<OutsideContact, "organisation" | "role">): string {
  const role = c.role.trim();
  const org = c.organisation.trim();
  if (role && org) return `${role} at ${org}`;
  return role || org || "An outside contact";
}

/**
 * The exit policy's restorative fields, as the agreement answers them. The
 * first outside contact is the one the exit policy's single slot carries.
 */
export function restorativeFromAgreement(c: ConflictAgreementContent): {
  steps: string[];
  intakeContactRole: string;
  coverRole: string;
  replyHours: number | null;
  outsideContact: { name: string; organisation: string; howToReach: string };
} {
  const first = c.outsideContacts[0];
  return {
    steps: c.steps.map(stepLine),
    intakeContactRole: c.careRole,
    coverRole: c.coverRole,
    replyHours: c.replyHours,
    outsideContact: first
      ? {
          name: first.name,
          organisation: first.role && first.organisation ? `${first.role}, ${first.organisation}` : first.organisation || first.role,
          howToReach: first.howToReach,
        }
      : { name: "", organisation: "", howToReach: "" },
  };
}

/**
 * A stored document, read without trusting it. The column is written by this
 * platform alone, so a document that fails the shape check is a corruption,
 * and it reads as no document: the exit policy then stands as it was, which
 * is the answer that changes nothing a member was promised.
 */
export function agreementOf(stored: unknown, roleIds: readonly string[]): ConflictAgreement | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const s = stored as Record<string, unknown>;
  // Roles are checked on the way in. A role deleted since must not make the
  // whole stored agreement unreadable, so the stored ids are taken as known here.
  const known = [...roleIds, str(s.careRole), str(s.coverRole), str(obj(s.whenPowerInvolved).roleId)].filter(Boolean);
  const parsed = parseAgreementContent(s, { roleIds: known });
  if (!parsed.ok) return null;
  const how = s.adoptedHow === "founders" || s.adoptedHow === "ballot" ? s.adoptedHow : null;
  const version = Number(s.version);
  return {
    ...parsed.content,
    version: Number.isInteger(version) && version > 0 ? version : 1,
    adoptedBy: how ? str(s.adoptedBy) || null : null,
    adoptedHow: how,
    adoptedAt: how ? str(s.adoptedAt) || null : null,
    updatedAt: str(s.updatedAt) || null,
  };
}

/** Everything the village wrote, compared as words: the stamp and the version are not content. */
export function sameContent(a: ConflictAgreementContent, b: ConflictAgreementContent): boolean {
  const pick = (c: ConflictAgreementContent) =>
    JSON.stringify([
      c.steps,
      c.careRole,
      c.coverRole,
      c.replyHours,
      c.outsideContacts,
      c.whenPowerInvolved,
      c.safetyContacts,
      c.consequencesLadder,
      c.practices,
      c.reviewDate,
    ]);
  return pick(a) === pick(b);
}

/** The stored document without who adopted it, with the ballot that carried it when one did. */
export function agreementForReaders(a: ConflictAgreement): ConflictAgreementForReaders {
  const { adoptedBy, ...rest } = a;
  const ballotId = a.adoptedHow === "ballot" && adoptedBy?.startsWith("ballot:") ? adoptedBy.slice("ballot:".length) : null;
  return { ...rest, ballotId };
}
