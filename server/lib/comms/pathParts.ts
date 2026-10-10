/**
 * THE PATHS LANE'S PLUG INTO THE JOURNEY ENGINE (the comms build spec 5.6 and
 * 5.11): every skip and stop rule the path, member and joining journeys
 * carry, the words' values for their emails, the day 21 hand-off to a person,
 * and the rung emails. One call registers all of it,
 * `registerPathJourneyParts(deps)`, from server/routes/commsPaths.ts at boot.
 *
 * ── THE RULES, BY KEY ──────────────────────────────────────────────────────
 *
 * The keys are fixed in shared/comms/contracts.ts. Each answer is one query in
 * server/repos/commsPathFacts.ts (or the path table, or the comms settings):
 *
 *   resident_first_step_done    a housing request or a visit inquiry
 *   investor_first_step_done    the investor packet requested
 *   steward_first_step_done     a hand raised for a seat or a power
 *   prosperity_first_step_done  a Work With Us proposal
 *   member_first_step_done      a quest claimed
 *   going_to_next_gathering     a yes to the gathering the email would offer
 *   investor_words_unreviewed   comms-settings.investorWordsReviewed unset
 *   left_path                   the path row says they left
 *   resident_reserved           a reservation reached `reserved`
 *   investor_committed          an agreement signed, else an investor call accepted
 *   steward_seated              seated in a role now
 *   prosperity_venture_listed   a venture listed, else the proposal accepted
 *   joining_admitted            the account at their address was admitted
 *   joining_declined            the request was declined
 *   member_took_part            a quest consented, or came to a gathering
 *
 * A goal that holds also marks the path row done, which is what `done_at` is
 * for; a walk-through of a made-up person never reaches here.
 *
 * ── DAY 21 ─────────────────────────────────────────────────────────────────
 *
 * When a path's `check_in` step is posted, the path's contact person
 * (comms-settings.pathContacts) is asked through the notification spine to
 * write, by first name, with a link to the person's page in People
 * (`comms_path_handoff`, server/lib/comms/notices.ts). A path with no contact
 * person gets the same sentence as an email to the path's inbox instead.
 *
 * ── RUNGS ──────────────────────────────────────────────────────────────────
 *
 * Off unless a village turns them on for a path (`rungEmails`). Hourly, each
 * member on such a path has their ladder derived (server/lib/pathLadders.ts),
 * compared with the rung last seen (`path_enrollments.last_rung`), and a move
 * up posts "you reached X, here is the next step" once, inside daytime hours
 * in their zone. The first look only records where they stand: nobody gets
 * an email about a rung they reached before anybody was watching.
 */
import type { Pool } from "mysql2/promise";
import { emailKeyOf } from "../../../shared/comms/address";
import type { PostResult } from "../../../shared/comms/contracts";
import { pathJourneyKey } from "../../../shared/comms/defaults/journeys";
import { pathTitle } from "../../../shared/comms/defaults/templates";
import { guestPersonKey } from "../../../shared/comms/kinds";
import { gatheringWhen, type MergeValues } from "../../../shared/comms/mergeFields";
import { windowZone, nextInWindow } from "../../../shared/comms/quietHours";
import { nextGatheringOrder, type NextCandidate } from "../../../shared/comms/recap";
import { GAME_CONFIG } from "../../../shared/gameConfig";
import { AUTHORED_KINDS } from "../../../shared/gatherings";
import type { ModuleLifecycle } from "../../../shared/modules";
import { hasLadder, PATH_LADDERS } from "../../../shared/pathLadders";
import * as facts from "../../repos/commsPathFacts";
import { rsvpStatusOf } from "../../repos/commsEventFacts";
import { contactById } from "../../repos/commsContacts";
import { factsForMember } from "../../repos/investorPath";
import { seatingsForMember } from "../../repos/pathLadders";
import { reservationsForMember } from "../../repos/housing";
import { venturesForMember } from "../../repos/ventures";
import { activePathRows, hasLeftPath, markPathDone, setLastRung } from "../../repos/pathEnrollments";
import { listCalendarItems } from "../calendar";
import { isExampleUser } from "../examples";
import type { NotifyInput, NotifyResult } from "../notify";
import { isTombstone } from "../oauthAccounts";
import type { LapseContext } from "../orgChart";
import { laddersFor, NO_MOONS } from "../pathLadders";
import { numberVar } from "../variables";
import { villageTimezone } from "../villageReaders";
import { registerCondition, type ConditionContext, type RuleKey } from "./conditions";
import { guestDoorFacts, type GuestDeps } from "./guests";
import { journeyStatus, villagePathIds } from "./journeyDefinitions";
import { registerStepPosted, registerVarsBuilder, type StepPostedContext, type VarsContext } from "./journeyRegistry";
import { escapeHtml } from "./mailer";
import { noticePathHandoff } from "./notices";
import { pathIdOfJourney, PATHWAY_OF_PATH } from "./paths";
import type { MembersPort } from "./permissions";
import { post, type PostOfficeDeps } from "./postOffice";
import { rsvpNextLink, type NextGathering } from "./recaps";
import { loadEmailVillage, renderTemplate } from "./render";
import { readCommsSettings } from "./settings";

// ── What this file is handed ────────────────────────────────────────────────

export interface PathPartsDeps {
  getPool(): Pool;
  postOffice: PostOfficeDeps;
  members: MembersPort;
  /** The notification spine, for the day 21 hand-off. Absent: the hand-off goes to the path's inbox. */
  notify?(input: NotifyInput): Promise<NotifyResult>;
  /** The email-config document, for the path inboxes. */
  emailConfig?(): Record<string, unknown> | null;
  commsLifecycle(): ModuleLifecycle;
  eventsLifecycle(): ModuleLifecycle;
  /** For the steward ladder's lapsed seats. Absent: nothing lapses. */
  lapseContext?(): LapseContext;
  /** The village's zone. Absent: the zone the seasons turn on. */
  timezone?(): string;
  /** Epoch milliseconds, for tests. */
  now?(): number;
}

const zoneOf = (deps: PathPartsDeps): string => (deps.timezone ? deps.timezone() : villageTimezone()) || "UTC";
const nowOf = (deps: PathPartsDeps): number => (deps.now ? deps.now() : Date.now());

const realMember = (m: any): any | null => (!m || isExampleUser(m) || isTombstone({ email: String(m.email ?? "") }) ? null : m);
const firstNameOf = (name: string | null | undefined): string | null => {
  const first = String(name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
};

/** A path's name as the village shows it. */
export function pathNameOf(pathId: string): string {
  return GAME_CONFIG.paths.find((p) => p.id === pathId)?.label ?? pathTitle(pathId);
}

/** The next step on each shipped path, in a few words, and where it is taken. A fork's own path falls back to its page. */
const NEXT_STEPS: Readonly<Record<string, { step: string; route: string }>> = {
  resident: { step: "tell us what you're looking for", route: "/reserve" },
  investor: { step: "ask for the investor packet", route: "/investor" },
  steward: { step: "see the seats that are open and raise a hand", route: "/steward" },
  "prosperity-creator": { step: "tell us what you'd like to build", route: "/work-with-us" },
};

// ── The person a journey is about ───────────────────────────────────────────

/** The person the rules ask about: their address key and their account, from the contact and what the trigger stored. */
function personOf(ctx: Pick<ConditionContext, "contact" | "enrollment">): facts.PathPerson | null {
  if (!ctx.contact) return null;
  const stored = ctx.enrollment.stored.userId;
  return { emailKey: emailKeyOf(ctx.contact.email), userId: ctx.contact.userId ?? (typeof stored === "string" && stored ? stored : null) };
}

/** Their key on the gathering tables: the account, else `guest:<contactId>`. */
const personKeyOf = (ctx: Pick<ConditionContext, "contact" | "enrollment">): string | null => {
  const p = personOf(ctx);
  return p?.userId ?? (ctx.contact ? guestPersonKey(ctx.contact.id) : null);
};

// ── The next gathering an email offers ──────────────────────────────────────

const NEXT_LOOKAHEAD_DAYS = 120;
const NEXT_GUEST_TRIES = 12;

function guestDepsOf(deps: PathPartsDeps): GuestDeps {
  return {
    getPool: deps.getPool,
    postOffice: deps.postOffice,
    origin: () => deps.postOffice.origin(),
    commsLifecycle: deps.commsLifecycle,
    eventsLifecycle: deps.eventsLifecycle,
    members: deps.members,
    // Never asked: the door below reads the gathering, and the press itself asks again.
    memberMayRsvp: async () => false,
    timezone: () => zoneOf(deps),
    now: () => nowOf(deps),
  };
}

/**
 * The gathering a path, member or joining email offers: the soonest public
 * one (or village one, for a member), and for somebody with no account the
 * soonest one a guest may actually say yes to, so the button in the email
 * never opens onto a refusal.
 */
export async function nextGatheringFor(deps: PathPartsDeps, guest: boolean, at: number): Promise<NextGathering | null> {
  const layers = guest ? ["public"] : ["public", "village"];
  const items = await listCalendarItems(deps.getPool(), {
    from: new Date(at),
    to: new Date(at + NEXT_LOOKAHEAD_DAYS * 86_400_000),
    viewer: { userId: null, isAdmin: false },
    timezone: zoneOf(deps),
    kinds: AUTHORED_KINDS,
    layers: layers as Array<"public" | "village">,
    now: new Date(at),
  });
  const real = items.filter((i: any) => !i.isExample) as unknown as NextCandidate[];
  const order = nextGatheringOrder(real, { eventId: "", occurrenceKey: "", now: at, layers });
  for (const c of order.slice(0, guest ? NEXT_GUEST_TRIES : 1)) {
    if (guest && (await guestDoorFacts(guestDepsOf(deps), c.id, c.occurrenceKey)).refusal) continue;
    return { eventId: c.id, occurrenceKey: c.occurrenceKey, title: c.title, startsAt: new Date(c.startsAt) };
  }
  return null;
}

// ── The rules ───────────────────────────────────────────────────────────────

type PersonRule = (pool: Pool, p: facts.PathPerson) => Promise<boolean>;

/** The path a rule's journey is on, for a goal that marks the row done. */
const GOAL_PATH: Partial<Record<RuleKey, string>> = {
  resident_reserved: "resident",
  investor_committed: "investor",
  steward_seated: "steward",
  prosperity_venture_listed: "prosperity-creator",
};

/** A rule over the person, with a goal marking their path row done when it holds. */
function personRule(key: RuleKey, rule: PersonRule, needsAccount = false) {
  registerCondition(key, async (ctx) => {
    const p = personOf(ctx);
    if (!p) return null;
    if (needsAccount && !p.userId) return false;
    const holds = await rule(ctx.getPool(), p);
    const pathId = GOAL_PATH[key];
    if (holds && pathId && !ctx.madeUp) {
      await markPathDone(ctx.getPool(), { personKey: personKeyOf(ctx), contactId: ctx.contact?.id ?? null }, pathId);
    }
    return holds;
  });
}

/** Register every rule the path, member and joining journeys carry. A second call replaces each one. */
export function registerPathConditions(deps: PathPartsDeps): void {
  personRule("resident_first_step_done", facts.hasHousingRequest);
  personRule("investor_first_step_done", facts.packetRequested);
  personRule("steward_first_step_done", facts.raisedHand, true);
  personRule("prosperity_first_step_done", facts.sentProposal);
  personRule("member_first_step_done", (pool, p) => facts.claimedFirstQuest(pool, p.userId as string), true);
  personRule("resident_reserved", facts.housingReserved);
  personRule("investor_committed", facts.investorCommitted);
  personRule("steward_seated", facts.seatedInRole, true);
  personRule("prosperity_venture_listed", facts.prosperityGoal);
  personRule("joining_admitted", facts.admitted);
  personRule("member_took_part", (pool, p) => facts.tookPart(pool, p.userId as string), true);

  registerCondition("joining_declined", async (ctx) => {
    const m = ctx.enrollment.subjectRef.match(/^form:(.+)$/);
    return m ? facts.requestDeclined(ctx.getPool(), m[1]) : null;
  });

  registerCondition("left_path", async (ctx) => {
    const pathId = pathIdOfJourney(ctx.definition.key);
    if (!pathId) return null;
    return hasLeftPath(ctx.getPool(), { personKey: personKeyOf(ctx), contactId: ctx.contact?.id ?? null }, pathId);
  });

  registerCondition("investor_words_unreviewed", async (ctx) => (await readCommsSettings(ctx.getPool())).investorWordsReviewed === null);

  registerCondition("going_to_next_gathering", async (ctx) => {
    const personKey = personKeyOf(ctx);
    if (!personKey) return null;
    const next = await nextGatheringFor(deps, !personOf(ctx)?.userId, ctx.now.getTime());
    if (!next) return false;
    return (await rsvpStatusOf(ctx.getPool(), next.eventId, next.occurrenceKey, personKey)) === "going";
  });
}

// ── The words' values ───────────────────────────────────────────────────────

/** The path's contact person: their first name and reply address, else the path's inbox. */
async function contactFor(deps: PathPartsDeps, pool: Pool, pathId: string): Promise<{ userId: string | null; firstName: string | null; email: string | null }> {
  const settings = await readCommsSettings(pool);
  const userId = settings.pathContacts[pathId] ?? null;
  const holder = userId ? realMember(await deps.members.byId(userId)) : null;
  if (holder) return { userId: String(holder.id), firstName: firstNameOf(holder.name), email: holder.email ? String(holder.email) : null };
  return { userId: null, firstName: null, email: pathInbox(deps, pathId) };
}

/**
 * The path's own inbox (the four inboxes in Comms Settings), or null. This is
 * the only address a path email ever shows a reader: the contact person's
 * account address is theirs, and a stranger on a path never sees it.
 */
function pathInbox(deps: PathPartsDeps, pathId: string): string | null {
  const pathway = PATHWAY_OF_PATH[pathId];
  const inbox = pathway ? deps.emailConfig?.()?.[pathway] : null;
  return typeof inbox === "string" && inbox.trim() ? inbox.trim() : null;
}

/** The `nextGathering.*` values for one reader, with their own one-press link. */
async function nextGatheringValues(deps: PathPartsDeps, ctx: VarsContext): Promise<MergeValues> {
  const personKey = personKeyOf(ctx);
  if (!personKey || ctx.madeUp) return {};
  const at = ctx.now.getTime();
  const next = await nextGatheringFor(deps, !personOf(ctx)?.userId, at);
  if (!next) return {};
  const link = rsvpNextLink(deps.postOffice.origin(), next, personKey, at);
  return {
    "nextGathering.title": next.title,
    "nextGathering.when": gatheringWhen(next.startsAt, ctx.villageZone, ctx.contact?.timezone ?? null).when,
    ...(link ? { "nextGathering.rsvpLink": link } : {}),
  };
}

/** Every `path.*` value for one path. */
export async function pathValues(deps: PathPartsDeps, pool: Pool, pathId: string, site: string): Promise<MergeValues> {
  const next = NEXT_STEPS[pathId];
  const contact = await contactFor(deps, pool, pathId);
  const base = site.replace(/\/+$/, "");
  return {
    "path.name": pathNameOf(pathId),
    ...(next ? { "path.nextStep": next.step, ...(base ? { "path.nextStepLink": `${base}${next.route}` } : {}) } : {}),
    ...(contact.firstName ? { "path.contactName": contact.firstName } : {}),
    ...(pathInbox(deps, pathId) ? { "path.contactEmail": pathInbox(deps, pathId)! } : {}),
  };
}

/** Register the words' values for the path, member and joining journeys. */
export function registerPathVars(deps: PathPartsDeps): void {
  registerVarsBuilder(
    "path",
    async (ctx) => {
      const pathId = pathIdOfJourney(ctx.definition.key);
      const pathVals = pathId ? await pathValues(deps, ctx.getPool(), pathId, ctx.village.url) : {};
      return { vars: { ...pathVals, ...(await nextGatheringValues(deps, ctx)) } };
    },
    "comms-paths:path",
  );
  for (const kind of ["member", "joining"] as const) {
    registerVarsBuilder(kind, async (ctx) => ({ vars: await nextGatheringValues(deps, ctx) }), `comms-paths:${kind}`);
  }
}

// ── Day 21: a person takes over ─────────────────────────────────────────────

/** The People page for one contact, which the hand-off links to. */
export function peoplePageLink(contactId: string): string {
  return `/admin?tab=comms-people&person=${encodeURIComponent(contactId)}`;
}

/**
 * A post the hand-off should follow: one that is going, or went. A REHEARSED
 * check-in asks nobody to write: the person on the path is a rehearsal's
 * reader, and the contact person is a real one who would be asked to write to
 * somebody the village never actually emailed.
 */
const HANDED: ReadonlySet<PostResult["status"]> = new Set<PostResult["status"]>(["queued", "sending", "sent", "delivered"]);

/** The step every path journey hands off on. */
export const HANDOFF_STEP = "check_in";

/** After the day 21 check-in is posted, ask the path's contact person to write. */
export async function handOff(deps: PathPartsDeps, ctx: StepPostedContext): Promise<"notified" | "inbox" | "nobody" | "not_this_step" | "rehearsal"> {
  const pathId = pathIdOfJourney(ctx.definition.key);
  if (!pathId || ctx.step.key !== HANDOFF_STEP || !ctx.contact) return "not_this_step";
  if (ctx.result.status === "rehearsed") return "rehearsal";
  if (!HANDED.has(ctx.result.status)) return "not_this_step";
  const pool = ctx.getPool();
  const firstName = firstNameOf(ctx.contact.name) ?? "Somebody";
  const pathName = pathNameOf(pathId);
  const link = peoplePageLink(ctx.contact.id);
  const contact = await contactFor(deps, pool, pathId);
  if (contact.userId && deps.notify) {
    await noticePathHandoff(deps.notify, { contactUserId: contact.userId, enrollmentId: ctx.enrollment.id, firstName, pathName, link });
    return "notified";
  }
  if (!contact.email) return "nobody";
  const site = ctx.village.url.replace(/\/+$/, "");
  const sentence = `${firstName} has been on the ${pathName} path for three weeks. Write to them.`;
  const href = `${site}${link}`;
  await post(deps.postOffice, {
    idempotencyKey: `comms_path_handoff:${ctx.enrollment.id}`,
    kind: "essential",
    origin: "comms.path_handoff",
    to: { email: contact.email },
    subject: sentence,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f2937"><p>${escapeHtml(sentence)}</p><p><a href="${escapeHtml(href)}">See them in People</a></p></body></html>`,
    text: `${sentence}\n\nSee them in People: ${href}\n`,
    source: { journeyKey: ctx.definition.key, stepKey: ctx.step.key, enrollmentId: ctx.enrollment.id },
  });
  return "inbox";
}

// ── Rungs ───────────────────────────────────────────────────────────────────

export const PATH_RUNGS_JOB = "comms-path-rungs";
export const PATH_RUNGS_EVERY_MS = 60 * 60_000;
/** At most this many people on one path are looked at in one run. */
const RUNG_BATCH = 500;

/** Where one member stands on one path's ladder: the highest lit rung, 0 for none. */
export async function rungOf(deps: PathPartsDeps, pathId: string, userId: string): Promise<number> {
  if (!hasLadder(pathId)) return 0;
  const pool = deps.getPool();
  const rows = {
    seatings: pathId === "steward" ? await seatingsForMember(pool, userId) : [],
    reservations: pathId === "resident" ? await reservationsForMember(pool, userId) : [],
    investorFacts: pathId === "investor" ? await factsForMember(pool, userId) : [],
    ventures: pathId === "prosperity-creator" ? await venturesForMember(pool, userId) : [],
  };
  const lapse: LapseContext = deps.lapseContext ? deps.lapseContext() : { currentSeasonId: null, cadence: "never" };
  return laddersFor([pathId], rows, lapse, NO_MOONS)[0]?.position ?? 0;
}

/**
 * One run of the rung emails: every path a village has with rung emails on,
 * every member on it (bounded). Answers what it did.
 */
export async function runPathRungs(deps: PathPartsDeps): Promise<{ looked: number; posted: number; recorded: number }> {
  const out = { looked: 0, posted: 0, recorded: 0 };
  if (deps.commsLifecycle() === "off") return out;
  const pool = deps.getPool();
  let village: Awaited<ReturnType<typeof loadEmailVillage>> | null = null;
  for (const pathId of villagePathIds()) {
    if (!hasLadder(pathId)) continue;
    const status = await journeyStatus({ getPool: deps.getPool }, pathJourneyKey(pathId));
    if (!status || status.state !== "on" || status.definition.rungEmails !== true) continue;
    const rungs = PATH_LADDERS[pathId].rungs;
    for (const row of await activePathRows(pool, pathId, { membersOnly: true, limit: RUNG_BATCH })) {
      out.looked += 1;
      const position = await rungOf(deps, pathId, row.userId as string);
      const last = row.lastRung === null ? Number.NaN : Number(row.lastRung);
      if (!Number.isFinite(last) || position <= last || !row.contactId) {
        if (!Number.isFinite(last) || position !== last) {
          await setLastRung(pool, row.id, String(position));
          out.recorded += 1;
        }
        continue;
      }
      const contact = await contactById(pool, row.contactId);
      if (!contact) continue;
      village = village ?? (await loadEmailVillage(pool, deps.postOffice.origin()));
      const reached = rungs[position - 1];
      const vars: MergeValues = {
        ...(await pathValues(deps, pool, pathId, village.url)),
        "path.rung": reached?.name ?? "",
        ...(firstNameOf(contact.name) ? { "person.firstName": firstNameOf(contact.name) as string, "person.name": contact.name as string } : {}),
      };
      const email = await renderTemplate("path.rung", vars, { getPool: deps.getPool, village, contactId: contact.id, kind: "paths" });
      const quietStart = numberVar("comms.quiet_start_hour");
      const quietEnd = numberVar("comms.quiet_end_hour");
      await post(deps.postOffice, {
        idempotencyKey: `path_rung:${row.id}:${position}`,
        kind: "paths",
        origin: "path.rung",
        to: { email: contact.email, name: contact.name, userId: contact.userId, contactId: contact.id },
        subject: email.subject,
        html: email.html,
        text: email.text,
        preheader: email.preheader,
        source: { templateKey: "path.rung", ...(email.version !== null ? { templateVersion: email.version } : {}), journeyKey: pathJourneyKey(pathId) },
        sendAfter: nextInWindow(new Date(nowOf(deps)), windowZone(contact.timezone, zoneOf(deps)), quietStart, quietEnd),
      });
      await setLastRung(pool, row.id, String(position));
      out.posted += 1;
    }
  }
  return out;
}

// ── Registering it all ──────────────────────────────────────────────────────

/** Register the rules, the values and the day 21 hand-off. Calling it again replaces each one. */
export function registerPathJourneyParts(deps: PathPartsDeps): void {
  registerPathConditions(deps);
  registerPathVars(deps);
  registerStepPosted("path", async (ctx) => void (await handOff(deps, ctx)), "comms-paths:handoff");
}
