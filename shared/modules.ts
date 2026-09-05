/**
 * THE module registry (S13). One list of everything the platform can be,
 * shared by server and client. This file is the single framework — the
 * per-module `<module>.enabled` game variables that older design docs
 * sketched are void; enablement lives in module_settings, read through
 * server/lib/modules.ts, and NOWHERE else.
 *
 * Names and descriptions here are founder-facing catalog copy for the Admin
 * Modules tab — platform language, never one village's brand.
 */
import type { Capability } from "./capabilities";

export type ModuleLifecycle = "off" | "preview" | "members" | "public";

/**
 * The Module Library's five shelves. Labels, order and glosses live in
 * `shared/moduleCatalog.ts`; this is the id a registry entry points at.
 */
export type ModuleGroup =
  | "coordinate"
  | "recognise"
  | "host-and-earn"
  | "know-and-decide"
  | "connect";

/**
 * What standing a module up looks like, declared instead of guessed at.
 *
 *   none      works the moment it is on. The Go-live card offers itself right
 *             after Turn on.
 *   optional  better with content, honest without it.
 *   required  needs real content before going live (a room and a price, a
 *             stocked treasury), and the Go-live card waits for readiness.
 */
export type ModuleSetup = "none" | "optional" | "required";

/** Rank order for posture comparisons: off < preview < members < public. */
export const LIFECYCLE_RANK: Record<ModuleLifecycle, number> = {
  off: 0,
  preview: 1,
  members: 2,
  public: 3,
};

// ── The module library ───────────────────────────────────────────────────────
// A listing is a module that connects this platform to an outside paid
// service. Every listing is first-party code in this repository: a connector
// the platform writes and maintains against somebody's API. No vendor code
// runs inside a village's server and there is no plugin runtime.

/**
 * The contract version a listing is accepted under. Stamped at enable time.
 *
 * THIS CONSTANT IS THE ONE THAT BINDS. `docs/MODULE_LIBRARY_CONTRACT.md` is
 * what a builder reads; this is what a village's `listingStamp` actually
 * records, so a listing accepted while the two disagree is accepted under the
 * NUMBER, whatever the document says. It went to 1.1 when the document did.
 *
 * Raising it is never retroactive. A stamp already written stays on the terms
 * it was written under, which is the whole reason the stamp exists: a later
 * version is a re-acceptance and never a silent rewrite.
 *
 * `node scripts/module-facts.mjs` compares the two and says so out loud, and
 * `shared/moduleListing.test.ts` fails when they disagree, so the agreement is
 * checked rather than reported. The intake workflow treats a disagreement as a
 * WARNING for a builder's pull request on purpose: our bookkeeping is not
 * their problem, and it should never block their listing.
 *
 * It went to 1.2 when R72 changed what clause 14 promises: a share is sized by
 * how many members open a module, the platform's own modules compete on the
 * same measure, and a payout handle now travels with the account system that
 * asserts it.
 */
export const MODULE_LIBRARY_CONTRACT_VERSION = "1.2";

/**
 * Concurrent managed listings, hard. Two, and the second is a transition slot.
 * The reason lives beside the check in `moduleListingProblems`, where anybody
 * tempted to raise the number has to read it first.
 */
export const MANAGED_LISTING_CAP = 2;

/**
 * Who bills and who supports. That pair is the only thing anybody asks at the
 * moment they need an answer, so it is the tier; who BUILT something is a
 * credit line and never a badge.
 *
 *   included   the platform bills (it is in the platform price) and supports
 *              it end to end. Credential is none, or the village's own
 *              upstream account where the village is the merchant of record.
 *              No pill in the catalog: included is the absence of a badge,
 *              the same way everything that is not core is silent today.
 *   connected  the vendor bills the village directly and answers for the
 *              service; the platform answers for the connector. The
 *              credential is a secrets-store entry the village holds and can
 *              see as source and last4. That visibility IS the tier: the
 *              village has its own account and can revoke it unaided.
 *   managed    the platform bills and takes the first call; the vendor sits
 *              behind a private escalation the village never sees. The
 *              credential is platform-held, env-only, and never returned to a
 *              village even masked, because it is not the village's to see.
 *              This is the PLATFORM_ASSISTANT_KEY posture generalised, and it
 *              is settled policy under hub ADR-49.
 *
 * The credential PLANE is the mechanical definition of the tier, never a
 * description of it. That is what makes a tier checkable instead of
 * decorative, and `moduleListingProblems` below is where it is checked.
 *
 * The tier is a label and never a gate. Enabling a module makes no network
 * call, reads no secret and checks no licence; the credential is the
 * entitlement in every tier.
 */
export type ModuleTier = "included" | "connected" | "managed";

/**
 * The widest class of data this module's own domain holds. Orthogonal to
 * tier, deliberately: data protection does not soften because somebody else
 * sends the invoice.
 *
 * Read it as the widest thing in the module's tables, never the average. A
 * booking, an RSVP, a loan and a private message all identify a named person,
 * which is why most of this platform carries `member-pii`. The gate hanging
 * off it applies at every tier: nothing marked `member-pii` goes live behind a
 * vendor driver without a signed processing agreement, a documented
 * hard-delete endpoint, and a `forgetMember` driver wired into the deletion
 * sweep that fails VISIBLY when it cannot confirm.
 */
export type ModuleDataClass = "none" | "village-content" | "member-pii";

/**
 * What healthy looks like, declared by the listing instead of guessed at.
 *
 * Absence of a failure is not evidence of health. A module that is off, a
 * driver that never fires and a job that quietly stopped all produce no
 * failure record at all, and that blind spot is exactly where slow rot lives.
 * So a listing states one of two things and lives with it:
 *
 *   window     a successful call is normally expected inside `withinHours`.
 *              Silence longer than that reads as stale.
 *   on-demand  this integration is called when somebody asks and silence is
 *              normal. Stated plainly so silence is never read as health
 *              either.
 */
export type ModuleLiveness =
  | { mode: "window"; withinHours: number }
  | { mode: "on-demand" };

/** How often a price recurs. `once` is a single charge and never a trial. */
export type ModulePricePeriod = "month" | "year" | "once";

/**
 * What a listing costs a village, as DATA.
 *
 * Every field is a value rather than a sentence, for the same reason the vendor
 * record is: `scripts/check-voice.mjs` parses `shared/` and reads string
 * literals, so a price written as prose would be catalog copy held to the house
 * writing rules AND would drift from the number beside it. The vendor supplies
 * values; the platform writes the sentences. `priceLine` below is the one place
 * a price becomes words.
 *
 * THE CREDENTIAL IS THE LICENCE, and `licenceKey` is what makes that mechanical
 * instead of aspirational. A village forks this repository and owns this file,
 * so any `if (licensed)` a developer writes here is one edit away from deleted,
 * by somebody legally entitled to edit it who has the file open anyway. A code
 * gate is not a weak form of enforcement in that setting, it is none. The only
 * plane a fork cannot forge is a credential the developer holds the other end
 * of, which is why a connected listing that charges anything MUST name the slot
 * its licence lives in, and why a managed listing may not name one at all: that
 * credential is platform-held and env-only (hub ADR-49) and is not the
 * village's to hold.
 *
 * What a lapse may do is bounded, and the bound is not a style preference.
 * Absence of the licence takes the listing's own routes to the already-built
 * 503, which says who to reach, and touches nothing else. A listing may not
 * disable a village surface, lock an admin screen, or alter village data when
 * its licence lapses. Every open-source ecosystem that let a vendor reach
 * deeper than "stop serving my own feature" litigated it in public and the
 * vendor lost.
 */
export interface ModulePricing {
  /** Minor units of `currency`, a whole number. Zero is a real answer, said out loud. */
  amount: number;
  /** ISO 4217, uppercase. */
  currency: string;
  period: ModulePricePeriod;
  /** Where a village goes to buy it. In v1 the developer bills the fork directly. */
  billingUrl: string;
  /**
   * The `vendor.secretKeys` slot holding the licence this price buys. Required
   * once `amount` is above zero at connected, refused at managed.
   */
  licenceKey?: string;
}

/**
 * A listing that is no longer offered.
 *
 * Withdrawn is a STATE and never a deletion, and that difference is the whole
 * clause. Removing the registry entry instead would leave every village that
 * enabled it holding a `module_settings` row pointing at nothing, which
 * `loadModuleSettings` reports as an orphan: exactly the outcome the contract
 * promises never happens. The entry stays, so the row always resolves.
 *
 * It blocks a NEW enable and changes nothing already serving. A village running
 * it keeps running it, may still move between preview, members and public, and
 * may still switch it off. Only the transition out of `off` is refused, so
 * withdrawn means withdrawn from the catalog and never withdrawn from a
 * village.
 */
export interface ModuleWithdrawal {
  /** The day it stopped being offered, as YYYY-MM-DD. */
  since: string;
  /** The listing that replaces it, where there is one. Must be a real module id. */
  replacedBy?: string;
}

/**
 * The named counterparty behind a listing. Every field here is DATA rather
 * than shipped prose: `scripts/check-voice.mjs` parses `shared/` and reads
 * string literals, so a vendor's name written into `description` would be
 * catalog copy held to the house writing rules, while `legalName` is a value
 * in a field. Keep it that way.
 *
 * `supportUrl` and `supportEmail` are BOTH required at every tier and are
 * validated. A listing with nowhere to send a person cannot exist, whoever
 * bills. Which address a village is sent to keys on who SUPPORTS and never on
 * who built: connected points at the vendor, included and managed point at
 * whoever runs this deployment.
 */
export interface ModuleVendor {
  legalName: string;
  /**
   * The exact product URL. Never the bare product name: at least eight live
   * products share the word "Orbit" and one of those companies shut down in
   * 2023, so a name identifies nothing.
   */
  url: string;
  supportUrl: string;
  supportEmail: string;
  statusUrl: string;
  termsUrl: string;
  /**
   * Secret slots this listing contributes to the village's own secrets store,
   * where an admin sets a key and reads back its source and last4. MUST be
   * empty for a managed listing: that credential belongs to the platform and
   * lives in env only.
   */
  secretKeys: string[];
  /**
   * The environment variable holding a MANAGED listing's platform-owned
   * credential. Read from env at call time, never added to SECRET_KEYS, never
   * returned by any route to any village, not even masked (hub ADR-49,
   * accepted 2026-08-14). Absent at every other tier.
   */
  managedEnvKey?: string;
  /**
   * Steps a founder performs inside the vendor's own product, rendered on the
   * setup card. An empty list is the goal: every step here is a permanent
   * per-village human cost and it changes the commercial terms.
   */
  setupSteps?: string[];
  liveness: ModuleLiveness;
}

export interface ModuleDef {
  id: string;
  /** Founder-facing catalog name (platform copy, no village brand). */
  name: string;
  description: string;
  /** Core modules are listed for legibility but cannot be disabled in v1. */
  core?: boolean;
  /**
   * Module library: who bills and who supports. Every module the platform
   * itself writes and carries is `included`, which is why all eighteen are.
   */
  tier: ModuleTier;
  /** Module library: the widest class of data this module's domain holds. */
  dataClass: ModuleDataClass;
  /**
   * Which of the five Module Library shelves this sits on. Optional in the
   * TYPE so test fixtures stay small; every real entry sets it, and
   * `shared/moduleCatalog.test.ts` fails the build when one does not.
   */
  group?: ModuleGroup;
  /** What standing this module up looks like. Same optionality rule as `group`. */
  setup?: ModuleSetup;
  /**
   * Is there enough real content here to go live, and if not, what first?
   * Server-attached at boot like `openStateCheck`, so the shared registry
   * stays import-clean for the client bundle. Default reader: real rows in
   * the module's own tables (`server/lib/modules.ts`).
   */
  readiness?: () => Promise<{ ready: boolean; hint: string }>;
  /** The named counterparty. Required at connected and managed, absent at included. */
  vendor?: ModuleVendor;
  /**
   * Who wrote this module. A CREDIT LINE and never a tier.
   *
   * Tier answers who bills and who supports, which is what somebody asks at the
   * moment they need an answer. Who BUILT something is a different fact and
   * gets a different line. It lives on the module rather than on the vendor
   * record on purpose, so it is available at every tier including `included`,
   * where a vendor record is refused outright: that is the only way to credit
   * somebody who contributed a module without making them its counterparty,
   * and it is exactly the case a healthy library should make easy.
   */
  builtBy?: string;
  /**
   * The builder's account handle, where a cycle settlement looks to find out
   * who to pay. Read it with `builtByNamespace` below, which says on which
   * system the handle is held. Neither half is usable alone.
   *
   * A HANDLE and never an address, which is Rye's ruling and is the whole
   * safety of the thing. An address written here is asserted by whoever edits
   * this file, in a public repository a fork can edit, for a payment somebody
   * else receives. A handle is asserted by the builder themselves: they hold an
   * account, they link their Hypha account and Base address in their own
   * profile setup there, and whoever settles a cycle reads the address off that
   * profile at the moment they write a statement. The registry never learns the
   * address and a pull request can never redirect a payment.
   *
   * A sibling of `builtBy` rather than a field inside it, because `builtBy` is
   * a credit LINE: a name a person wrote for a reader, and it stays readable
   * whether or not the person holds an account anywhere.
   *
   * Optional on purpose, and absence is a real state rather than a gap. A
   * module with no handle still earns its share; the hub's cycle statement
   * records that share as unpaid and names what is missing, so a builder can
   * open an account, link an address, and collect what accrued. Eligibility
   * never depends on this field, only settlement does.
   */
  builtByAccount?: string;
  /**
   * The account system that asserts `builtByAccount`, as a host name.
   *
   * REQUIRED whenever `builtByAccount` is set, and refused without it, because
   * a bare handle only resolves if everybody shares one account system. R64 is
   * the ruling that makes that assumption unsafe: "these tools and currency
   * aren't the governance domain of a single organisation, but very quickly to
   * form a network of them." The moment a second organisation runs this code
   * there are two rosters, "alice" is a different person on each, and a report
   * carrying only the handle pays the wrong one.
   *
   * A host rather than a free label, because a host is the one identifier a
   * stranger can act on: a counter that has never heard of it can fetch its
   * discovery document and find out what it is.
   *
   * NO DEFAULT, deliberately. Defaulting it to this platform's own namespace
   * would weld one organisation into every fork, which is the thing
   * `scripts/check-brand-refs.mjs` exists to stop, and it would make a fork's
   * own builder silently claim an account on somebody else's system. The pair
   * travels with the module in the registry entry, so a fork inherits both by
   * pulling and a counter needs no list of its own.
   *
   * `shared/moduleProvenance.ts` is the authority on how the pair reaches a
   * counter, and it checks this shape again on the wire.
   */
  builtByNamespace?: string;
  /** What this listing costs. Absent means it adds no charge of its own. */
  pricing?: ModulePricing;
  /** Set once the listing stops being offered. Blocks new enables, serves as before. */
  withdrawn?: ModuleWithdrawal;
  /**
   * The domain this listing claims.
   *
   * A vendor is never a source of truth. A domain is, the platform owns it,
   * and vendors are drivers behind it. Carried as DATA now so a listing can
   * declare what it claims; the at-most-one-driver-per-domain refusal on the
   * enable path deliberately waits for a second vendor inside one domain,
   * because a catalog is supposed to list two services side by side and only
   * an ENABLE of the second is a conflict.
   */
  provides?: string;
  /** Hard dependencies: block enabling this while one is off, and block
   *  disabling a dependency while this is non-off. */
  requires: string[];
  /** Soft dependencies: the admin panel warns, never blocks. */
  recommends: string[];
  /** Capability keys this module ADDS to the one gate — never a second
   *  permission mechanism. */
  capabilities: Capability[];
  /** Namespaced game-variable keys ('tools.*'); Admin hides the group while
   *  the module is off. */
  variableKeys: string[];
  /** API prefixes mounted behind requireModule(id). */
  apiPrefixes: string[];
  /** Named Hypha deep links this module's UI renders. */
  hyphaLinks?: string[];
  /** Show the legal caution card before enabling (funds-bearing modules).
   *  Enabling is REFUSED outright while ops/auth preconditions fail. */
  legalReview?: boolean;
  /** Share-like surface: deep-link display only, never a mint path. */
  hyphaOnly?: boolean;
  /** The ONE module allowed to sell this token slug for fiat (economy
   *  invariant #3: a token has at most one selling module — boot-asserted). */
  sellsToken?: string;
  /** Validate structural config before write; return a human message or null. */
  validateConfig?: (config: unknown) => string | null;
  /** Default structural config, seeded when the module first configures. */
  defaultConfig?: Record<string, any>;
  /** Open economic state that blocks disabling (invariant #13): count > 0
   *  refuses `off` with settle-first guidance. */
  openStateCheck?: () => Promise<{ count: number; description: string }> | { count: number; description: string };
}

export const MODULES: ModuleDef[] = [
  // ── Core: the game the platform is born playing. Listed so the catalog is
  //    honest about what exists; not disableable in v1. ──────────────────────
  {
    id: "quests",
    tier: "included",
    dataClass: "member-pii",
    group: "coordinate",
    setup: "none",
    name: "Quests",
    description: "The contribution board: post work, claim it, submit it, consent to release recognition.",
    core: true,
    requires: [],
    recommends: [],
    capabilities: ["quest.consent"],
    variableKeys: ["quest.consent_cap_mode", "quest.consent_cap_multiplier", "quest.require_submission_before_consent"],
    apiPrefixes: ["/api/quests", "/api/game/quests"],
  },
  {
    id: "gratitude",
    tier: "included",
    dataClass: "member-pii",
    group: "recognise",
    setup: "none",
    name: "Gratitude",
    description: "Recognition sends, lunar cycles, and the value pool distributed at each close.",
    core: true,
    requires: [],
    recommends: [],
    capabilities: [],
    variableKeys: [
      "gratitude.base_budget",
      "gratitude.require_message",
      "gratitude.max_share_per_recipient",
      "gratitude.pool_per_cycle",
      "gratitude.pool_token",
    ],
    // Cycle close and the settlement preview hang off /api/admin/cycles, which
    // this list forgot. Inert while gratitude is core and nothing is above
    // `included`, and wrong the moment any listing above `included` uses the
    // same shape: the vendor-lapse loop mounts one gate per declared prefix,
    // so an admin surface missing from the list is a surface the gate skips.
    apiPrefixes: ["/api/game/gratitude", "/api/game/cycle", "/api/admin/cycles"],
  },
  {
    id: "progression",
    tier: "included",
    dataClass: "member-pii",
    group: "recognise",
    setup: "none",
    name: "Stages & Roles",
    description: "The path from guest to co-creator: stages, capabilities, and appointed roles.",
    core: true,
    requires: [],
    recommends: [],
    capabilities: ["proposal.open", "proposal.decide"],
    variableKeys: [],
    apiPrefixes: ["/api/game/progression", "/api/roles"],
  },
  {
    id: "profiles",
    tier: "included",
    dataClass: "member-pii",
    group: "connect",
    setup: "none",
    name: "Profiles",
    description: "Member identity: handles, journeys, balances, and each member's own ledger.",
    core: true,
    requires: [],
    recommends: [],
    capabilities: [],
    variableKeys: [],
    apiPrefixes: ["/api/profile"],
  },

  // ── Optional modules. Everything ships OFF; enabling is a deliberate,
  //    per-deployment admin act. ──────────────────────────────────────────────
  {
    id: "map",
    tier: "included",
    dataClass: "member-pii",
    group: "know-and-decide",
    setup: "optional",
    // Renamed from "Village Map" (proposal §8 item 14, R28): the card is about
    // how power is held, and its copy carries the gloss "includes the Living
    // Map of the land". The id stays `map`; the land/power split is a queued
    // ADR, not this round.
    name: "How Power Is Held",
    description:
      "The living org chart: circles, the roles that orbit them, who holds each seat, which seats are open calls, plus a concierge that routes 'I want to help with X' to the right person.",
    requires: [],
    recommends: [],
    capabilities: ["map.viewPeople", "map.contact", "map.photograph", "map.curatePhotos"],
    variableKeys: [
      "map.public_structure",
      "map.concierge_enabled",
      "map.contact_daily_cap",
      "map.contact_recipient_daily_cap",
      "map.show_quests",
      "map.vacant_highlight",
      "map.contact_retention_days",
      "map.photo_max_mb",
      "map.photos_per_place",
      "map.photos_per_member_daily",
      "map.photo_report_hide_threshold",
      "map.photo_tombstone_days",
    ],
    apiPrefixes: ["/api/map", "/api/circles", "/api/places", "/api/admin/places"],
  },
  {
    id: "resources",
    tier: "included",
    dataClass: "village-content",
    group: "know-and-decide",
    setup: "optional",
    name: "How Resources Flow",
    description:
      "A declared map of how money and resources are governed: who may spend what, with whose approval, paid from where, and where the money comes from; it describes the flow and moves nothing.",
    // A hard dependency, like feed on forum: the resources picture is a LENS
    // drawn over the village map's circles and seats.
    requires: ["map"],
    recommends: ["forum"],
    capabilities: [],
    variableKeys: [],
    apiPrefixes: ["/api/resources"],
    defaultConfig: { requestCategory: "governance", measuredVisibleTo: "members", labels: {} },
    validateConfig: (c: any) => {
      if (!c || typeof c !== "object") return "config must be an object";
      if (c.requestCategory !== undefined && !/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(c.requestCategory))) {
        return "requestCategory must be a lowercase slug naming a forum category";
      }
      if (c.measuredVisibleTo !== undefined && !["members", "admins"].includes(String(c.measuredVisibleTo))) {
        return "measuredVisibleTo must be members or admins";
      }
      if (c.labels !== undefined) {
        if (!c.labels || typeof c.labels !== "object" || Array.isArray(c.labels)) {
          return "labels must be an object of id to wording";
        }
        for (const [k, v] of Object.entries(c.labels)) {
          if (typeof v !== "string" || !v.trim()) return `label "${k}" needs words`;
          if (String(v).length > 80) return `label "${k}" runs past 80 characters`;
        }
      }
      return null;
    },
  },
  {
    id: "forum",
    tier: "included",
    dataClass: "member-pii",
    group: "know-and-decide",
    setup: "none",
    name: "Forum & Decisions",
    description:
      "Village conversations: threads by circle-of-life category, @mentions, thread follows, community moderation, and the decision primitive, where proposals are opened and outcomes recorded.",
    requires: [],
    recommends: ["map"],
    capabilities: ["forum.post", "forum.moderate"],
    variableKeys: ["forum.report_hide_threshold"],
    apiPrefixes: ["/api/forum"],
    defaultConfig: {
      categories: [
        { id: "village-life", label: "Village Life", sortOrder: 1 },
        { id: "projects", label: "Projects & Work", sortOrder: 2 },
        { id: "governance", label: "Governance", sortOrder: 3 },
        { id: "questions", label: "Questions & Help", sortOrder: 4 },
      ],
    },
    validateConfig: (c: any) => {
      if (!c || typeof c !== "object" || !Array.isArray(c.categories)) {
        return "config must be { categories: [{id, label, sortOrder}] }";
      }
      for (const cat of c.categories) {
        if (!cat?.id || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(cat.id))) {
          return `category id "${String(cat?.id)}" must be a lowercase slug`;
        }
        if (!cat?.label) return `category "${cat.id}" needs a label`;
      }
      const ids = c.categories.map((x: any) => x.id);
      if (new Set(ids).size !== ids.length) return "category ids must be unique";
      return null;
    },
  },
  {
    id: "feed",
    tier: "included",
    dataClass: "member-pii",
    group: "connect",
    setup: "none",
    name: "Village Feed",
    description:
      "The everyday stream: microposts, events and announcements from one forum category, woven with the village's own milestones, where a tap of appreciation is a real gift from your cycle budget.",
    // A hard dependency, on purpose: the feed is a LENS over forum threads.
    requires: ["forum"],
    recommends: [],
    capabilities: ["feed.announce"],
    variableKeys: ["feed.category_slug", "feed.heart_amount", "feed.max_hearts_per_recipient_per_cycle"],
    apiPrefixes: ["/api/feed"],
  },
  {
    id: "messaging",
    tier: "included",
    dataClass: "member-pii",
    group: "connect",
    setup: "none",
    name: "Messages",
    description:
      "Private conversations between members: one to one, or a named group carrying its own membership and read state. A direct message is the two-party case of the same thread, so every conversation in the village has one home, one report path, and one place to moderate.",
    requires: [],
    recommends: [],
    capabilities: ["message.send"],
    variableKeys: ["messaging.sends_per_minute", "messaging.max_members"],
    apiPrefixes: ["/api/messages", "/api/admin/messages"],
    // No openStateCheck, on purpose. That hook exists for modules holding
    // VALUE somebody is owed: open loans, active stays, unsettled orders,
    // standing warnings. Messaging holds none, so a village may switch it off
    // whenever it likes. Off hides the surface; the conversations stay in the
    // table and come back intact when it is switched on again. Read the
    // module doc before adding one here: an unread message is not a debt.
  },
  {
    id: "stays",
    tier: "included",
    dataClass: "member-pii",
    group: "host-and-earn",
    setup: "required",
    name: "Stays",
    description:
      "Accommodation on stay credits: rooms post credit (and optional USD) prices per audience, credits are bought or earned through work-exchange quests, and one credit hosts one night. Funds-bearing: read the legal card before enabling.",
    requires: [],
    recommends: ["quests"],
    capabilities: ["stay.member_rate"],
    variableKeys: [
      "stay.guest_booking_enabled",
      "stay.autopay_default",
      "stay.autopay_post_hour",
      "stay.low_balance_warn_nights",
      "stay.grace_nights",
      "stay.max_purchase_nights",
      "stay.credit_expiry_days",
      "stay.credits_transferable",
      "stay.work_exchange_tag",
      "payments.purchase_limit_per_order_usd",
      "payments.purchase_limit_30d_usd",
      "payments.purchase_limit_annual_usd",
    ],
    apiPrefixes: ["/api/stays"],
    legalReview: true,
    // Economy invariant #3: stays is the ONE module that may sell stay-credit
    // for fiat. Boot-asserted against every other module's claim.
    sellsToken: "stay-credit",
    // openStateCheck is attached by the server at boot (it needs the pool);
    // the shared registry stays import-clean for the client bundle.
  },
  {
    id: "automation",
    tier: "included",
    dataClass: "member-pii",
    group: "coordinate",
    setup: "optional",
    name: "Call Automation",
    description:
      "The weekly call becomes assigned work, not content distribution: recordings in, transcripts kept, an AI synthesis whose every task suggestion carries a verbatim quote and timestamp (or is dropped), published to the forum by a human, with suggestions routed to the roles they name. Nothing publishes or applies itself.",
    requires: [],
    recommends: ["forum"],
    capabilities: [],
    variableKeys: [],
    apiPrefixes: ["/api/recordings"],
    defaultConfig: { youtubeChannelId: "", maxReadyQueue: 15, forumCategory: "village-life" },
    validateConfig: (c: any) => {
      if (!c || typeof c !== "object") return "config must be an object";
      if (c.maxReadyQueue !== undefined && !(Number.isInteger(c.maxReadyQueue) && c.maxReadyQueue >= 1 && c.maxReadyQueue <= 100)) {
        return "maxReadyQueue must be an integer between 1 and 100";
      }
      return null;
    },
  },
  {
    id: "health",
    tier: "included",
    dataClass: "village-content",
    group: "know-and-decide",
    setup: "optional",
    name: "Village Health",
    description:
      "The village's vital signs: per-lunation snapshots frozen at each cycle close, the land's own regeneration ledger (trees, water, hectares: absolute counts, never leaderboards), and season goals. Snapshot COLLECTION runs from the day this ships; turn the dashboard on once a few lunations of history exist.",
    requires: [],
    recommends: ["gratitude", "quests"],
    // The people who count the trees are rarely the people who hold the admin
    // password. Logging a measurement was admin-only, which meant either the
    // land steward never recorded anything or somebody handed out admin to
    // make it possible — the exact trade the capability gate exists to avoid.
    capabilities: ["health.record"],
    variableKeys: ["health.alert_change_pct"],
    apiPrefixes: ["/api/health"],
  },
  {
    id: "library",
    tier: "included",
    dataClass: "member-pii",
    group: "host-and-earn",
    setup: "required",
    name: "Material Library",
    description:
      "The village's shared tools and goods: donate an item and earn library credits (appraised, capped, dual-signed above a threshold), then borrow against an escrowed deposit. Credits are backed by the shelves; they never swap, and selling them for fiat is a separate caution-card opt-in (L9).",
    requires: [],
    recommends: [],
    capabilities: [],
    variableKeys: [
      "library.intake_award_pct",
      "library.intake_member_cycle_cap",
      "library.intake_dual_signoff_over",
      "library.escrow_pct",
      "library.usage_fee_pct",
      "library.loan_days_default",
      "library.dispute_deadline_days",
      "library.intake_stall_days",
    ],
    apiPrefixes: ["/api/library"],
    // L9 (Gate F, opened 2026-07-27): selling credits for fiat is OFF by
    // default forever and requires the version-stamped caution card — the
    // same posture as the exchange's tradingEnabled. The server stamps who
    // accepted and when; the client may not author that record.
    defaultConfig: { creditSaleEnabled: false },
    validateConfig: (c: any) => {
      if (!c || typeof c !== "object") return "config must be an object";
      if (c.creditSaleEnabled !== undefined && typeof c.creditSaleEnabled !== "boolean") {
        return "creditSaleEnabled must be true or false";
      }
      if (c.creditSaleEnabled) {
        const ack = c.creditSaleAck;
        if (!ack || typeof ack !== "object" || !ack.cardVersion || !ack.acceptedBy || !ack.acceptedAt) {
          return "selling library credits requires an accepted caution card: creditSaleAck { cardVersion, acceptedBy, acceptedAt }";
        }
      }
      return null;
    },
    // openStateCheck attached by the server at boot: open loans block off.
  },
  {
    id: "badges",
    tier: "included",
    dataClass: "member-pii",
    group: "recognise",
    setup: "optional",
    name: "Badges & Skills",
    description:
      "Recognition of who people are and what they can do: self-declared skills, badges earned from settled contribution, granted honors, and warning badges that suspend specific capabilities until resolved. Earned badges never ride applause metrics into permissions.",
    requires: [],
    recommends: ["quests"],
    capabilities: [],
    variableKeys: [],
    apiPrefixes: ["/api/badges"],
    // openStateCheck attached by the server at boot (needs the pool):
    // standing warnings are live governance and block a silent off.
  },
  {
    id: "exchange",
    tier: "included",
    dataClass: "member-pii",
    group: "host-and-earn",
    setup: "required",
    name: "Exchange",
    description:
      "Buy the village's own platform tokens for fiat, out of a stocked treasury, buy-only in v1. Recognition and Hypha-governed tokens can never be listed; a token another module sells can't be listed twice. Funds-bearing: read the legal card before enabling.",
    requires: [],
    recommends: [],
    capabilities: ["exchange.buy", "exchange.swap", "exchange.manage"],
    variableKeys: [
      "exchange.price_change_max_pct",
      "exchange.swap_spread_bps",
      "exchange.swap_fiat_hold_days",
      "exchange.swap_max_receive_per_order",
      "payments.purchase_limit_per_order_usd",
      "payments.purchase_limit_30d_usd",
      "payments.purchase_limit_annual_usd",
    ],
    apiPrefixes: ["/api/exchange"],
    legalReview: true,
    // Gate B's opt-in switch. OFF by default, forever: internal trading is
    // a decision each deployment makes for itself, with its own legal
    // posture. Turning it on requires accepting the caution card, and the
    // acceptance is version-stamped so amended terms must be re-read.
    defaultConfig: { tradingEnabled: false },
    validateConfig: (c: any) => {
      if (!c || typeof c !== "object") return "config must be an object";
      if (typeof c.tradingEnabled !== "boolean") return "tradingEnabled must be true or false";
      if (c.tradingEnabled) {
        const ack = c.legalAck;
        if (!ack || typeof ack !== "object" || !ack.cardVersion || !ack.acceptedBy || !ack.acceptedAt) {
          return "internal trading requires an accepted legal caution card: legalAck { cardVersion, acceptedBy, acceptedAt }";
        }
      }
      return null;
    },
    // openStateCheck attached by the server at boot (needs the pool).
  },
  {
    id: "commerce",
    tier: "included",
    dataClass: "member-pii",
    group: "host-and-earn",
    setup: "required",
    name: "Payments & Donations",
    description:
      "Every payment your project issues or receives, as products you define: application fees, donations, deposits and down payments, waitlist seats, recurring memberships, and token packs granted from treasury stock. Rides the same verified Stripe spine as stays and the exchange; Zeffy and manual payment paths for fee-free giving. Money flows IN only, always.",
    requires: [],
    recommends: [],
    capabilities: [],
    variableKeys: [],
    apiPrefixes: ["/api/products"],
    // Funds-bearing: same enabling posture as stays/exchange — per-admin
    // identities first, the caution copy shown, refusal while shared-password.
    legalReview: true,
  },
  {
    id: "network",
    tier: "included",
    dataClass: "village-content",
    group: "connect",
    setup: "none",
    name: "Village Network",
    description:
      "Federation with other villages running this platform: publish your needs and offers to the network, and read what peer villages share. Foundations for co-hiring, shared events and resource pooling. You choose exactly which villages to listen to; publishing an item is an explicit act, and nothing about individual members is ever shared.",
    requires: [],
    recommends: [],
    capabilities: [],
    variableKeys: [],
    apiPrefixes: ["/api/network"],
  },
  {
    id: "crowdpool",
    tier: "included",
    // The cache holds hub-public campaign content and the public names its
    // feed already shows. No member of THIS village appears in it at all.
    dataClass: "village-content",
    group: "connect",
    setup: "optional",
    name: "Crowdpool",
    description:
      "The village's hub crowdpool, told in the living map's own language: a gold funding ring, a star lantern counting toward build day, a needs shelf with claim links to the hub, partner funders, and a ledger of arrivals. The game server reads the hub's public data and shows aggregates; every pledge happens on the hub itself.",
    requires: [],
    recommends: ["map"],
    capabilities: [],
    variableKeys: [],
    apiPrefixes: ["/api/crowdpool"],
    defaultConfig: { villageCampaigns: [] },
    validateConfig: (c: any) => {
      if (!c || typeof c !== "object") return "config must be an object";
      const list = c.villageCampaigns;
      if (list === undefined) return null; // an image-only config write stays valid
      if (!Array.isArray(list)) {
        return "villageCampaigns must be a list: [{ id or slug, hubBaseUrl optional }]";
      }
      const keys: string[] = [];
      for (const e of list) {
        if (!e || typeof e !== "object") return "each campaign must be an object";
        const hasId = Number.isInteger(e.id) && e.id > 0;
        const hasSlug = typeof e.slug === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(e.slug);
        if (!hasId && !hasSlug) {
          return "each campaign needs a numeric hub id or a lowercase slug";
        }
        if (e.hubBaseUrl !== undefined && !/^https:\/\/[^\s]+$/.test(String(e.hubBaseUrl))) {
          return "hubBaseUrl must be an https address";
        }
        keys.push(typeof e.slug === "string" && e.slug ? e.slug : String(e.id));
      }
      if (new Set(keys).size !== keys.length) return "campaign slugs must be unique";
      return null;
    },
  },
  {
    id: "tools",
    tier: "included",
    dataClass: "member-pii",
    group: "coordinate",
    setup: "optional",
    name: "Tools Hub",
    description:
      "An audience-aware registry of the village's tools: one place to find the chat, the documents, the governance space, with a pinned card that deep-links to your Hypha DHO.",
    requires: [],
    recommends: [],
    capabilities: [],
    variableKeys: ["tools.click_tracking", "tools.link_check_days"],
    apiPrefixes: ["/api/tools"],
    hyphaLinks: ["governance", "proposals", "treasury", "members"],
    defaultConfig: {
      categories: [
        { id: "governance", label: "Governance", sortOrder: 1 },
        { id: "communication", label: "Communication", sortOrder: 2 },
        { id: "documents", label: "Documents", sortOrder: 3 },
        { id: "coordination", label: "Coordination", sortOrder: 4 },
      ],
    },
    validateConfig: (c: any) => {
      if (!c || typeof c !== "object" || !Array.isArray(c.categories)) {
        return "config must be { categories: [{id, label, sortOrder}] }";
      }
      for (const cat of c.categories) {
        if (!cat?.id || typeof cat.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(cat.id)) {
          return `category id "${String(cat?.id)}" must be a lowercase slug`;
        }
        if (!cat?.label || typeof cat.label !== "string") return `category "${cat.id}" needs a label`;
      }
      const ids = c.categories.map((x: any) => x.id);
      if (new Set(ids).size !== ids.length) return "category ids must be unique";
      return null;
    },
  },
  {
    id: "events",
    tier: "included",
    dataClass: "member-pii",
    group: "coordinate",
    setup: "none",
    // "Village Calendar", by L5a's request: the module carries the one
    // calendar, village time and the lunar wheel now, and "Events" undersold
    // it. The id stays `events`.
    name: "Village Calendar",
    description:
      "The village's calendar: gatherings with a time, a place, a capacity and an RSVP. Other surfaces read it, so the map can light the building something is happening in.",
    // Nothing hard-required. A gathering is a time and a place, and neither
    // needs another module to exist. The map is a RECOMMEND because events
    // are what make its buildings light up, and the calendar is worth having
    // on its own for a village with no map at all.
    requires: [],
    recommends: ["map"],
    capabilities: ["event.rsvp", "event.manage"],
    // The calendar.* knobs are L5a's (0085): the year anchor, the hemisphere
    // and the cross-quarter days all shape what this module's calendar draws,
    // so Game Mechanics shows them with the module and hides them while it is
    // off, like every other module-scoped variable.
    variableKeys: [
      "events.rsvp_enabled",
      "events.upcoming_days",
      "events.past_visible_days",
      "calendar.year_anchor",
      "calendar.hemisphere",
      "calendar.cross_quarters",
    ],
    apiPrefixes: ["/api/events", "/api/admin/events"],
  },
  {
    id: "introductions",
    tier: "included",
    dataClass: "member-pii",
    group: "connect",
    setup: "none",
    name: "Introductions",
    description:
      "Members say in plain words what they seek, confirm offers the village already knows about them, and receive a few good introductions a week. A match is a proposal with its reasoning attached; both people say yes separately before one conversation opens.",
    // A mutual yes opens a Messages thread, so the thread's home must exist
    // before the first introduction can land (the feed-requires-forum shape).
    requires: ["messaging"],
    recommends: ["badges", "map"],
    capabilities: [],
    variableKeys: [
      "introductions.recipient_daily_cap",
      "introductions.match_floor",
      "introductions.opportunity_days",
      "introductions.retention_days",
    ],
    apiPrefixes: ["/api/intents"],
  },
  {
    id: "governance",
    tier: "included",
    dataClass: "member-pii",
    group: "know-and-decide",
    setup: "none",
    name: "Governance",
    description:
      "The village decides on-site: staged proposals go to weighted ballots with frozen electorates, votes stay changeable until a human closes with a stated outcome, and passed mechanics changes apply through the one amendment ledger. Off keeps the shipped Hypha loop exactly as it is.",
    // Nothing hard-required: a ballot needs members and a subject, and the
    // mechanics loop it extends is core machinery. OFF is the fork-safe
    // default (absent row = off, house rule): hundreds of forks inherit the
    // shipped Hypha/manual loop unchanged until a founder turns this on.
    requires: [],
    recommends: ["forum"],
    capabilities: ["ballot.vote", "member.vouch"],
    variableKeys: [
      "governance.weight_mode",
      "governance.weight_token",
      "governance.unity_pct",
      "governance.quorum_pct",
      "governance.vote_days",
      "governance.consent_window_days",
      "governance.default_method",
      "membership.vouch_threshold",
    ],
    apiPrefixes: ["/api/governance", "/api/admin/governance"],
  },
  {
    id: "hypha",
    tier: "included",
    // The module's own tables hold contract addresses, what those contracts
    // call themselves, village-level supply and treasury figures, and a log of
    // outcomes that arrived. Not one of them identifies a member. Per-member
    // chain balances live in `onchain_balances`, which the economics section
    // owns and this module does not touch.
    dataClass: "village-content",
    group: "know-and-decide",
    // Required, and honestly so: without a DHO address and a confirmed contract
    // there is nothing to read. The Go-live card waits for readiness, which is
    // what stops a fork shipping an empty page that looks broken.
    setup: "required",
    name: "Hypha Bridge",
    description:
      "Your DAO on Hypha, read from Base and shown here: the contracts this village actually holds, total supply and treasury balance as the chain reports them, and governance outcomes that find their way back to the proposal they came from. Read only, always. Needs a Base endpoint somebody pays for, and it says which of the two listener paths this village is on.",
    // FREE TO EVERY VILLAGE (R58c). No pricing record, no licence key, no
    // entitlement gate, and that is the v1.0 commercial shape for every module:
    // modules earn $ReGen from the builders' pool and cost a village nothing.
    // A `pricing` block here would be refused at `included` anyway, and the
    // absence is the statement.
    //
    // Nothing hard-required. The read-only deep links in `shared/hypha.ts` and
    // the mechanics loop in `hypha-bridge.ts` are platform machinery that ships
    // with or without this module, so OFF leaves today's Hypha behaviour
    // exactly as it is. Governance is a RECOMMEND because the outcome log is
    // most useful to a village running its own decisions beside the Hypha ones.
    requires: [],
    recommends: ["governance", "tools"],
    capabilities: [],
    // ONLY the variable this module introduces. `hypha.org_url`, `space_id`,
    // `founder_base_address` and the four link overrides are DELIBERATELY
    // absent: an off module's variables are hidden from Admin, and those seven
    // configure surfaces that work with this module off. Listing them here
    // would take a village's Hypha links away the moment this shipped.
    variableKeys: ["hypha.treasury_address"],
    // `/api/hypha` is mounted whole behind requireModule. `/api/admin/hypha`
    // carries the contract lookup (/candidates), which is deliberately
    // ungated: it took over from the retired find-token route, and a founder
    // needs it BEFORE this module is on, because the addresses it discovers
    // are what the module is then configured with,
    // so that prefix is gated per route instead of wholesale. Mounting it whole
    // would 404 a working founder surface on the deploy that added this module.
    apiPrefixes: ["/api/hypha", "/api/admin/hypha"],
    hyphaLinks: ["governance", "proposals", "treasury", "members"],
    // Share-like: deep-link display only, never a mint path. Ring 0 says a
    // chain-governed token is read, displayed and linked out to, and never
    // minted, moved or priced. `server/lib/ledger.ts` refuses those tokens
    // outright and `weightTokenProblem` refuses them for voting weight, so this
    // flag is a declaration beside two enforcements rather than instead of them.
    hyphaOnly: true,
    // readiness attached by the server at boot (needs the pool).
  },
];

export const MODULES_BY_ID: Record<string, ModuleDef> = Object.fromEntries(
  MODULES.map((m) => [m.id, m]),
);

// ── The library, derived ─────────────────────────────────────────────────────

/** Every listing with a named counterparty. Empty until the first one lands. */
export function vendorModules(defs: readonly ModuleDef[] = MODULES): ModuleDef[] {
  return defs.filter((m) => m.tier !== "included");
}

/**
 * Secret slots the registry contributes to the store, deduped and sorted.
 * Managed listings contribute nothing here on purpose: their credential is the
 * platform's and lives in env only (hub ADR-49).
 */
export function registrySecretKeys(defs: readonly ModuleDef[] = MODULES): string[] {
  const out = new Set<string>();
  for (const m of defs) {
    if (m.tier === "managed") continue;
    for (const k of m.vendor?.secretKeys ?? []) out.add(k);
  }
  return Array.from(out).sort();
}

/**
 * A price as one plain line, and the ONE place a price becomes words.
 *
 * The server renders this into its payloads so the client shows a string it was
 * handed rather than formatting money itself. That keeps the wording in
 * `shared/`, where `check-voice` can see it, and keeps the whole registry out
 * of the client bundle for the sake of one formatter.
 *
 * Minor units in, because a price held as a float is a rounding bug waiting for
 * a currency with three decimal places. The exponent comes from `Intl` rather
 * than from an assumed two, since a listing priced in yen has none and dividing
 * by a hundred would have quietly overcharged by a factor of a hundred.
 */
export function priceLine(p: ModulePricing): string {
  if (p.amount === 0) return "Free";
  let money: string;
  try {
    const fmt = new Intl.NumberFormat("en", { style: "currency", currency: p.currency });
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    money = fmt.format(p.amount / Math.pow(10, digits));
  } catch {
    // An unknown currency code is caught by moduleListingProblems, so this is
    // the belt to that braces: show the honest raw values instead of throwing
    // inside a render.
    money = `${p.amount} ${p.currency}`;
  }
  if (p.period === "once") return `${money} once`;
  return p.period === "year" ? `${money} a year` : `${money} a month`;
}

/** True where a village would be paying somebody for this listing. */
export function isPaid(def: ModuleDef): boolean {
  return !!def.pricing && def.pricing.amount > 0;
}

/** Listings a village may still turn on. A withdrawn one is listed, never offered. */
export function offeredModules(defs: readonly ModuleDef[] = MODULES): ModuleDef[] {
  return defs.filter((m) => !m.withdrawn);
}

export interface SupportRoute {
  /** Who answers. Keys on who SUPPORTS this listing, never on who built it. */
  party: "platform" | "vendor";
  /** The vendor's legal name where the vendor supports it. Null where the platform does. */
  vendorName: string | null;
  supportUrl: string | null;
  supportEmail: string | null;
}

/**
 * Where a village is sent when this module needs a human.
 *
 * Included and managed answer `platform`, and managed deliberately carries no
 * vendor name at all: in managed the platform sold the sentence "call us", and
 * naming the party behind it to a village would sell something else. Connected
 * answers `vendor`, with the address the listing is required to carry.
 *
 * Triage stays the platform's obligation in all three. Routing is what happens
 * after triage and never instead of it.
 */
export function supportRoute(def: ModuleDef): SupportRoute {
  if (def.tier === "connected" && def.vendor) {
    return {
      party: "vendor",
      vendorName: def.vendor.legalName,
      supportUrl: def.vendor.supportUrl,
      supportEmail: def.vendor.supportEmail,
    };
  }
  return { party: "platform", vendorName: null, supportUrl: null, supportEmail: null };
}

const HTTPS = /^https:\/\/[^\s]+$/;
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const PRICE_PERIODS: readonly ModulePricePeriod[] = ["month", "year", "once"];

/**
 * A dotted host name, lowercase, for `builtByNamespace`.
 *
 * Shape is all any code here can honestly check. Whether that host runs an
 * account system, and whether it knows the handle beside it, are questions
 * only that host can answer, and a check here that pretended to answer them
 * would be the kind of green that means nothing. 253 is the length a host name
 * is allowed to be.
 */
const NAMESPACE_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function isBuilderNamespace(value: string): boolean {
  return value.length <= 253 && NAMESPACE_HOST.test(value);
}

/**
 * Registry-shape problems, as a list of sentences.
 *
 * The tier is defined by where the credential lives, so a listing whose
 * credential is in the wrong plane is not mislabelled, it is a different tier
 * pretending. Checking it here is what keeps the tier mechanical.
 *
 * Boot asserts on this (server/lib/modules.ts, beside the one-seller-per-token
 * assertion, which is the house precedent for a registry-shape invariant that
 * throws). A unit test asserts on it too, so a malformed entry fails in CI
 * without anybody having to boot a server.
 */
export function moduleListingProblems(defs: readonly ModuleDef[] = MODULES): string[] {
  const problems: string[] = [];
  const say = (id: string, what: string) => problems.push(`module "${id}": ${what}`);

  /*
   * The managed cap, in code, with its reason beside the number so a later
   * reader does not mistake it for caution.
   *
   * Two slots, and the SECOND is explicitly a transition slot: one
   * steady-state managed listing, plus room to onboard a replacement without
   * going dark. The cap exists for the four obligations that routing does not
   * touch, because managed points at the platform by definition and sends
   * nothing away: credit risk, variable cost inside a fixed price, the
   * data-return obligation on exit, and an SLA for software the platform
   * cannot patch. It moves on evidence (a clean quarter on the first listing,
   * a measured ticket count and time to resolution, somebody other than one
   * person answering) and never on appetite.
   */
  const managed = defs.filter((m) => m.tier === "managed");
  if (managed.length > MANAGED_LISTING_CAP) {
    problems.push(
      `the module library holds ${managed.length} managed listings (${managed.map((m) => m.id).join(", ")}) against a cap of ${MANAGED_LISTING_CAP}`,
    );
  }

  const knownIds = new Set(defs.map((m) => m.id));

  for (const m of defs) {
    /*
     * Checks that apply at EVERY tier, so they sit above the `included`
     * short-circuit rather than below it. Credit, price and withdrawal are all
     * orthogonal to who bills: an included module can carry a credit line, and
     * the platform's own module can be withdrawn the same way a listing can.
     */
    if (m.builtBy !== undefined && !m.builtBy.trim()) {
      say(m.id, "carries an empty builtBy credit. Name somebody or leave the field out");
    }
    /*
     * The payout identity is a HANDLE plus the NAMESPACE that asserts it, and
     * neither half is usable alone. A handle with no namespace resolves in
     * whichever roster the reader happens to hold, which is how a payment
     * reaches the wrong "alice" the moment a second organisation runs this
     * code (R64). A namespace with no handle names a system and nobody in it.
     *
     * Checked here rather than only on the wire so a registry entry that could
     * never be paid is refused at boot and in the listing lint, before a
     * builder waits a cycle to find out.
     */
    const account = m.builtByAccount?.trim();
    const namespace = m.builtByNamespace?.trim();
    if (account && !namespace) {
      say(m.id, `names the account "${account}" and no account system that asserts it. Set builtByNamespace to the host that holds the account`);
    }
    if (namespace && !account) {
      say(m.id, `names the account system "${namespace}" and no account in it. A payment needs somebody to pay`);
    }
    if (namespace && !isBuilderNamespace(namespace)) {
      say(m.id, `gives "${namespace}" as an account system. That is a host name, lowercase, with at least one dot`);
    }
    if (m.withdrawn) {
      if (!ISO_DAY.test(String(m.withdrawn.since ?? ""))) {
        say(m.id, "is withdrawn and gives no withdrawal date in YYYY-MM-DD form");
      }
      if (m.withdrawn.replacedBy === m.id) {
        say(m.id, "is withdrawn and names itself as its own replacement");
      } else if (m.withdrawn.replacedBy && !knownIds.has(m.withdrawn.replacedBy)) {
        say(m.id, `is withdrawn and names "${m.withdrawn.replacedBy}" as its replacement, which is not a module in this registry`);
      }
    }
    const price = m.pricing;
    if (price) {
      if (m.tier === "included") {
        say(m.id, "is included and carries a price. Included means the platform bills it inside the platform price already");
      }
      if (!Number.isInteger(price.amount) || price.amount < 0) {
        say(m.id, "must price itself as a whole number of minor units, zero or more");
      }
      if (!CURRENCY.test(String(price.currency ?? ""))) {
        say(m.id, "needs a three letter uppercase currency code");
      }
      if (!PRICE_PERIODS.includes(price.period)) {
        say(m.id, "must charge per month, per year, or once");
      }
      if (!HTTPS.test(String(price.billingUrl ?? ""))) {
        say(m.id, "billingUrl must be an https address");
      }
    }

    if (m.tier === "included") {
      if (m.vendor) say(m.id, "is included and carries a vendor record. An included module is the platform's own");
      continue;
    }
    const v = m.vendor;
    if (!v) {
      say(m.id, `is ${m.tier} and names no counterparty. No name, no listing`);
      continue;
    }
    if (!v.legalName?.trim()) say(m.id, "needs a legal entity name");
    for (const [field, value] of [
      ["url", v.url],
      ["supportUrl", v.supportUrl],
      ["statusUrl", v.statusUrl],
      ["termsUrl", v.termsUrl],
    ] as const) {
      if (!HTTPS.test(String(value ?? ""))) say(m.id, `${field} must be an https address`);
    }
    // Rye's ruling, settled 2026-08-14: a support URL AND a support email, at
    // every tier, stored as fields the product renders. A listing whose
    // support address stops resolving is reviewed and can be withdrawn, and
    // none of that is possible if the address lives in a document instead.
    if (!EMAILISH.test(String(v.supportEmail ?? ""))) say(m.id, "needs a support email address");
    if (v.liveness?.mode === "window" && !(v.liveness.withinHours > 0)) {
      say(m.id, "declares a liveness window of zero hours or less");
    }
    if (!v.liveness?.mode) say(m.id, "must declare a liveness expectation, either a window or on demand only");

    if (m.tier === "managed") {
      if (v.secretKeys.length) {
        say(m.id, "is managed and lists secret slots. A managed credential is platform-held and lives in env only");
      }
      if (!v.managedEnvKey?.trim()) say(m.id, "is managed and names no environment variable for its platform-held credential");
      // A managed card is the first card in this product with nothing to type.
      // The village has no account with anybody here, so a step performed
      // inside somebody else's product is a step it cannot take, and printing
      // one on the card is an instruction to a person with no login.
      if (v.setupSteps?.length) say(m.id, "is managed and lists setup steps. The village has no account here, so there is nothing for it to do");
    } else {
      if (!v.secretKeys.length) say(m.id, "is connected and lists no secret slot the village can hold and see");
      if (v.managedEnvKey) say(m.id, "is connected and names a platform-held credential. The village holds its own key at this tier");
    }

    /*
     * The licence slot, which is where "the credential is the licence" stops
     * being a sentence in a document and starts being a refusal.
     *
     * A fork owns this file, so a paid listing whose paid behaviour rests on a
     * code gate here is selling something the buyer can switch on by deleting a
     * line. Naming a slot means the paid path runs through `secretKeys`, which
     * `vendorCredentialPresent` reads and `requireVendor` answers 503 for. That
     * is the one plane a fork cannot forge, so it is the only place a price can
     * honestly rest.
     */
    if (price) {
      if (m.tier === "managed") {
        if (price.licenceKey) {
          say(m.id, "is managed and names a licence slot. A managed credential is platform-held and lives in env only");
        }
      } else {
        if (price.amount > 0 && !price.licenceKey) {
          say(m.id, "charges for itself and names no licence slot. A price with no credential behind it is a price any fork can delete");
        }
        if (price.licenceKey && !v.secretKeys.includes(price.licenceKey)) {
          say(m.id, `names licence slot "${price.licenceKey}". A licence slot must be one of this listing's own secret slots`);
        }
      }
    }
  }
  return problems;
}
