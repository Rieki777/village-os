/**
 * What a route module is handed, instead of a 27,000-line closure.
 *
 * THE PROBLEM THIS SOLVES. Every route in server/index.ts is registered inside
 * one `async function startServer()` and can therefore reach every binding in
 * it: roughly 25 repositories, the gate helpers, the caches, the config
 * readers, and several hundred local helpers besides. Nothing declares what any
 * given route actually uses, so nothing can be moved without reading the file
 * to find out, and a contributor changing one domain has no smaller unit to
 * hold in their head than all of it.
 *
 * A route module in server/routes/ takes what it needs as an argument and can
 * reach nothing else. That is the whole mechanism. The type below is the
 * vocabulary of things a route may be given.
 *
 * HOW TO USE IT. Do NOT take the whole `AppDeps` in a route module. Take the
 * slice you actually use, so the module's own signature says what it touches:
 *
 *     import type { AppDeps } from "../lib/appDeps";
 *     type Deps = Pick<AppDeps, "isAdmin" | "guardCapability" | "faqsRepo">;
 *     export function register(app: Express, deps: Deps): void { ... }
 *
 * A reviewer then reads three names instead of auditing a file for what it
 * closed over, and a widening of that slice is a visible line in a diff rather
 * than a new free variable nobody notices.
 *
 * WHY THE GATES ARE HERE AND NOT IMPORTED DIRECTLY. `isAdmin` and friends read
 * live village state through repositories and caches that server/index.ts owns
 * and boots. Passing them keeps a route module free of that boot order, and
 * keeps the DEFAULT-DENY contract intact: whichever function is passed here
 * must be one that calls `markAdminGate` (server/lib/adminGate.ts) on entry, or
 * the middleware under /api/admin will refuse the route's own success. Passing
 * a hand-rolled gate that skips the marker is the one way to get this wrong.
 *
 * THIS TYPE GROWS ONE ENTRY PER EXTRACTION. It deliberately does not try to
 * describe everything in startServer up front. An entry earns its place when a
 * route module needs it, which keeps the type a record of what has actually
 * been untangled rather than a wish list.
 */
import type express from "express";
import type { Pool } from "mysql2/promise";
import type { Capability, CapabilityCtx } from "../../shared/capabilities";
import type { CrewsRepo } from "./crews";
import type { WeightModeSnapshot } from "./governanceWeights";
import type { NotifyDeps, NotifyInput, NotifyResult } from "./notify";
import type { LapseContext } from "./orgChart";
import type { StayRow } from "./stays";
import type { ClaimsRepo, QuestsRepo } from "../repos/quests";
import type { DbCollection, DbDocument, Row } from "../repos/store-db";
import type { MemberRecord, UsersRepo } from "../repos/users";

/**
 * The answer from the capability gate. Mirrors the interface in
 * server/index.ts, which remains the definition the gate itself is written
 * against; this is the shape a route module is allowed to see.
 */
export interface CapabilityVerdict {
  ok: boolean;
  reachedPast: boolean;
  villageHolds: boolean;
  /** The gate step that decided, for the caller's own audit line. */
  source: string;
  /** What to say to the person, when `ok` is false. */
  message: string;
  /** True for exactly one refusal: an admin, on a key the village holds, who did not break the glass. */
  needsOverride: boolean;
  /** Who holds it, as a bare name, when `needsOverride` is true. Null otherwise. */
  holderName: string | null;
}

/** The refusal a route already had, preserved through guardCapability. */
export interface CapabilityRefusal {
  status: number;
  body: Record<string, unknown>;
}

export interface AppDeps {
  // THE GATES
  // Each of these marks the request as gated on entry. See adminGate.ts.

  /** True when the request carries a valid member token whose role is admin or founder. */
  isAdmin(req: express.Request): Promise<boolean>;

  /** The member behind the request's bearer token, or null. */
  authedUser(req: express.Request): Promise<any | null>;

  /** Ask whether the actor may do a thing, without answering the request. */
  mayAct(req: express.Request, cap: Capability): Promise<CapabilityVerdict>;

  /**
   * Ask, and answer the request when the answer is no. Returns true only when
   * the caller should carry on. A false return means a response has already
   * been sent, so the handler must return immediately without touching `res`.
   */
  guardCapability(
    req: express.Request,
    res: express.Response,
    cap: Capability,
    refusal?: CapabilityRefusal,
  ): Promise<boolean>;

  /** The read-side gate: may this actor still SEE a thing they cannot change. */
  mayStillSee(req: express.Request, cap: Capability): Promise<boolean>;

  // ATTRIBUTION, WHICH IS NOT ONE OF THE GATES
  // It answers nothing about permission. It reads the account a gate above
  // attached to the request on its way past, so it is null until one of them
  // has already run and passed on this same request. It exists so an audit
  // line can name a person. Anything that calls it in place of a gate lets
  // every request through.

  /** The admin account a passing gate attached, for audit attribution. */
  adminActor(req: express.Request): { id: string; name?: string } | null;

  /**
   * Build the capability context for a member, for the rare route that asks
   * `hasCapability(cap, ctx)` about somebody rather than about the request.
   *
   * PREFER THE GATES ABOVE. This one never sees the request, so it cannot
   * carry a break-glass and cannot write the record that makes a
   * village-held power real. docs/ARCHITECTURE.md spells out which of the two
   * a route wants. Following this line for a route that REFUSES is what once
   * left seven powers unable to leave the admin panel.
   */
  capabilityCtx(user: any): Promise<CapabilityCtx>;

  // REPOSITORIES
  // One entry per document or collection an extracted route module reads.

  /** The FAQ document, keyed by pathway. */
  faqsRepo: DbDocument<Row>;

  /**
   * The brand overlay document: identity, the nine image slots, theme, skin.
   *
   * TAKEN FOR TWO CALLS ONLY, and the distinction is the whole reason the
   * brand preview exists. `get()` here answers from the boot-time cache, so
   * it reports what a VISITOR IS BEING SERVED and never what is saved. Any
   * surface that needs the saved truth reads the row itself; see
   * `readStoredBrand` in server/routes/brandPreview.ts.
   *
   * `load()` re-reads the row into that cache. It is the call boot makes, and
   * the only way a process picks up a write that did not go through `put()`.
   */
  brandRepo: DbDocument<Row>;

  /** Training modules, ordered by their `order` field at read time. */
  trainingRepo: DbCollection<Row>;

  /** Roadmap milestones, ordered by their `order` field at read time. */
  milestonesRepo: DbCollection<Row>;

  /**
   * The people. MySQL-authoritative, `all()` answers in join order.
   *
   * A wide entry, so it earns a second look in review the way `getPool` does:
   * a module holding this can read every member record in the village and
   * write any of them. Take it only for a domain whose subject IS the roster.
   */
  members: UsersRepo;

  /**
   * The safe shape of a member record for an API response.
   *
   * Strips the password hash, the session-revocation counter and the Google
   * link, and fills every field a page reads so a legacy row never returns
   * undefined where the client expects an array or a number. Passed for the
   * reason the gates are: server/index.ts holds it at module scope and still
   * calls it from several routes of its own, so exporting it would point the
   * arrow back at the file this work exists to shrink.
   */
  publicUser(u: any): any;

  /** Quest claims. `consentedCounts()` is one grouped read for a whole list. */
  claimsRepo: ClaimsRepo;

  /** The quest board. */
  questsRepo: QuestsRepo;

  /** Quest crews: forming, joining, leaving, and the invite codes. */
  crewsRepo: CrewsRepo;

  /**
   * The map's own words: what this village calls a circle, a seat, a quest.
   * Its own document, because the scene importer replaces it wholesale.
   */
  mapVocabRepo: DbDocument<any>;

  /**
   * The Welcome Walk, per language. An EMPTY document means the map artifact
   * runs its own seed, which is what an untouched fork should get.
   */
  mapWalkRepo: DbDocument<any>;

  /**
   * The founding team's own working tracker: checkboxes, kanban, decisions,
   * copy, resource links. One document, read and written whole.
   *
   * Typed loosely because it is: the document has no schema beyond what its
   * page writes into it, and server/index.ts declares it the same way.
   */
  journeyRepo: DbDocument<any>;

  // RAW DATABASE AND VOLUME ACCESS
  // Wider than a repository, so an entry here is a bigger claim than a repo
  // entry and is worth a second look in review. A domain whose table is read
  // and written with SQL rather than through `dbCollection` takes this.

  /** The connection pool, for a domain that owns its own table and its own SQL. */
  getPool(): Pool;

  /**
   * The uploads volume's path.
   *
   * Handed over rather than imported so that a route module writing a file
   * can be pointed at a scratch directory in a test. Every byte still goes
   * through server/lib/uploads.ts; this names WHERE, never HOW.
   */
  uploadsDir: string;

  // DERIVED MEMBER STATE
  // Where a person stands in the game. Each of these is declared at module
  // scope in server/index.ts and reads across game variables, quest claims and
  // the capability registry to answer. They are passed for the same reason the
  // gates are: importing them would mean exporting them from the file this
  // work exists to shrink, and would leave server/index.ts and the route
  // module importing each other. Passing keeps the arrow pointing one way.

  /** The stage a member has actually reached, given their consented quests. */
  computeStage(user: MemberRecord, consentedQuests: number): string;

  /** `computeStage` with the quest count looked up for you. One read. */
  stageOf(user: MemberRecord): Promise<string>;

  /** Whether this member holds village membership. */
  hasMembership(user: MemberRecord): boolean;

  /**
   * Record a stage change, and tell the member what it opened.
   *
   * A write, not a read. It is a no-op when the move is sideways or backwards,
   * so a caller may hand it any before/after pair without checking first.
   */
  recordStageEvent(user: MemberRecord, from: string, to: string, reason: string): Promise<void>;

  // THE VILLAGE'S CLOCK AND ITS VOICE
  // Small readers that every domain ends up wanting, and the one producer for
  // telling a member something happened.

  /** A person's first name, or "Someone". The one place that decides that. */
  firstName(name: string): string;

  /** Every role this village defines. Read live; the repo caches. */
  loadRoles(): { id: string; name: string }[];

  /** The ids of the roles one member holds. */
  roleIdsFor(userId: string): string[];

  /**
   * Everyone who may consent to a quest claim: admins, plus anyone the gate
   * grants `quest.consent`. A read across every member, so a caller should
   * ask once per request and not once per row.
   */
  questConsentRecipients(): Promise<string[]>;

  /** The season banner payload. Extracted routes read `current` from it. */
  seasonState(): { current: any };

  /** The pattern the running season names, or null. Most villages: null. */
  currentPatternId(): string | null;

  /** What every read uses to decide whether a seating's mandate has run out. */
  lapseContext(): LapseContext;

  /**
   * The weight-mode snapshot the NEXT ballot would freeze.
   *
   * Six lines over two game variables, and the one place that decides what a
   * village's weight mode is. A route module that rebuilt it locally would be
   * the second place, which is how a seat reads "equal" on one screen and
   * "token" on the next.
   */
  weightModeNow(): WeightModeSnapshot;

  /**
   * Tell one member one thing. Fire and forget by contract: the sender never
   * throws, so a caller may `void` it without swallowing a failure it could
   * have handled.
   */
  notify(input: NotifyInput): Promise<NotifyResult>;

  /**
   * What the nightly stay posting says to humans, as the two callbacks
   * `runNightlyPosting` takes.
   *
   * Passed rather than imported so the scheduler job and the admin catch-up
   * button keep speaking with one voice: both build their hooks from this,
   * and the dedupe keys carry the date, so one warning per stay per day
   * survives however many times either fires.
   */
  stayPostingHooks(): {
    onLowBalance: (stay: StayRow, nightsLeft: number) => Promise<void>;
    onStopped: (stay: StayRow, balance: number) => Promise<void>;
  };

  /**
   * The notification spine's own dependencies, as one bundle.
   *
   * WIDER THAN `notify`, and taken only by a domain that calls a producer
   * inside server/lib/ which takes the spine itself (messaging's
   * `onMessageSent` is the case this was added for). Prefer `notify` for
   * telling one member one thing; this carries the pool and the member
   * lookup with it.
   */
  notifyDeps: NotifyDeps;

  /**
   * One alert to EVERY admin and founder, deduped per recipient.
   *
   * The suffix on the dedupe key is what keeps "each admin hears it once" and
   * "the event fires once" separate concerns.
   */
  notifyAdmins(type: string, title: string, dedupeKey: string, link?: string): Promise<void>;

  /**
   * Tell whoever raised a report that a steward has read it and closed it.
   *
   * Three domains raise reports (forum, messages, place photographs) and all
   * three say the same sentence, deliberately: "resolved" and "dismissed"
   * read alike so a reporter is never handed a verdict about another member.
   * Passed rather than imported for the same reason `notify` is, and so the
   * one wording stays in one place while those three domains move out.
   */
  notifyReportReviewed(reporterId: string, reportId: string, where: "forum" | "message" | "place"): Promise<NotifyResult>;

  // MAIL, AND THE ABUSE GUARDS AROUND IT
  // For a domain that answers somebody who has no account, so the notify
  // spine above has no member id to key on. A public form is also the surface
  // a stranger can hit hardest, so the rate limiter and the client-IP reader
  // sit here beside the sender rather than in a different section: a module
  // taking one of these usually needs all four.

  /**
   * Send one email. Never throws; the result says what happened.
   *
   * Returns `sent: false` with a reason when the deployment has no API key,
   * no sender, or no recipients, which are ordinary states on a fresh fork
   * and must not read as an outage.
   */
  sendResendEmail(opts: {
    to: string[];
    subject: string;
    html: string;
    from?: string;
    replyTo?: string;
  }): Promise<{ sent: boolean; reason?: string }>;

  /** Escape a string for HTML. Every value interpolated into an email body. */
  escapeHtml(s: string): string;

  /** The configured inboxes for one pathway, falling back to all of them. */
  recipientsForType(type: string): string[];

  /**
   * True when this bucket has already had `max` hits inside `windowMs`.
   *
   * FAILS OPEN on a database outage, deliberately and like every other call
   * site: a guard that takes a public form down during an outage costs the
   * village real leads.
   */
  overLimit(bucket: string, max: number, windowMs: number): Promise<boolean>;

  /** The caller's address, for keying a rate-limit bucket. */
  clientIp(req: express.Request): string;

  /** Where this deployment lives, for a link inside an email. */
  deploymentOrigin(): string;

  /** What this village calls itself, for an email subject line. */
  projectName(): string;
}
