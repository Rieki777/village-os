/**
 * The module framework's single reader/writer (S13). Everything about "which
 * modules are on, for whom" flows through this file: the lifecycle cache, the
 * requireModule() gate, the dependency rules, boot reconciliation, and the
 * preview-leak guard (moduleActivity).
 *
 * Lifecycle semantics (rank-ordered, off < preview < members < public):
 *   off      routes 404, zero nav, zero admin tabs, variables hidden
 *   preview  admins only — non-admins get the IDENTICAL 404 body, so the
 *            catalog of what a village is trying out never leaks
 *   members  signed-in only (anon gets 401, so the client can prompt login)
 *   public   everyone; per-route capability checks still apply on top
 *
 * Absent module_settings row = OFF (delta-only, like game variables): forks
 * inherit every new platform module as off, and enabling is always a
 * deliberate admin act recorded in module_events.
 */
import type { NextFunction, Request, Response } from "express";
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  LIFECYCLE_RANK,
  MODULE_LIBRARY_CONTRACT_VERSION,
  MODULES,
  MODULES_BY_ID,
  moduleListingProblems,
  supportRoute,
  type ModuleDef,
  type ModuleLifecycle,
  type SetupTarget,
} from "../../shared/modules";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { recordEvent } from "./events";
import { hasRealContent } from "./examples";
import { markModuleUse, usageMarkPending } from "./moduleUsage";
import { secretValue } from "./secrets";
import { isAnswered, stringVar } from "./variables";

interface ModuleRow {
  lifecycle: ModuleLifecycle;
  config: any;
  updatedAt: string | null;
}

let pool: Pool | null = null;
const settings = new Map<string, ModuleRow>();
/** Modules present in storage but absent from the registry — listed, never served. */
let orphanIds: string[] = [];
/** Modules served as OFF because a hard dependency is off (boot reconciliation). */
let demoted = new Map<string, string[]>();
/**
 * Modules served as OFF because their own data failed a boot invariant.
 *
 * The SAME consequence as a demotion and a different cause, so it gets its own
 * map rather than sharing one: a demotion is answered by turning a dependency
 * back on, and a quarantine is answered by mending rows. Telling a founder the
 * wrong one costs them the afternoon.
 *
 * Deliberately NOT cleared by `reconcileGraph`. The graph reconciles whenever
 * module settings reload, which an admin can cause at any moment by toggling
 * something unrelated, and a quarantine that evaporated on an unrelated click
 * would put the broken module back in front of members with nothing fixed.
 * This process refuses this module until the process restarts and the check
 * passes, which is a button a founder already has.
 */
const quarantined = new Map<string, string[]>();

export async function loadModuleSettings(p: Pool): Promise<void> {
  pool = p;
  const [rows] = await p.query<RowDataPacket[]>(
    "SELECT module_id, lifecycle, config, updated_at FROM module_settings",
  );
  settings.clear();
  orphanIds = [];
  for (const r of rows) {
    const id = String(r.module_id);
    if (!MODULES_BY_ID[id]) {
      orphanIds.push(id);
      continue;
    }
    let config = r.config;
    if (typeof config === "string") {
      try { config = JSON.parse(config); } catch { config = null; }
    }
    settings.set(id, {
      lifecycle: (r.lifecycle ?? "off") as ModuleLifecycle,
      config,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at ?? null,
    });
  }
  reconcileGraph();
}

/** The STORED lifecycle (before demotion). Absent row = off. */
export function storedLifecycle(id: string): ModuleLifecycle {
  return settings.get(id)?.lifecycle ?? "off";
}

/**
 * The SERVED lifecycle: a module whose hard dependency is off is served as
 * off, however its row is set — a hand-edited table must degrade loudly,
 * not half-serve a module missing its substrate.
 */
export function effectiveLifecycle(id: string): ModuleLifecycle {
  const def = MODULES_BY_ID[id];
  if (!def) return "off";
  if (def.core) return "public";
  // Below the core check on purpose. Core modules are the village's substrate,
  // they have no per-module invariant of their own to fail, and nothing here
  // should ever be able to switch the front door off.
  if (quarantined.has(id)) return "off";
  if (demoted.has(id)) return "off";
  return storedLifecycle(id);
}

export function moduleConfig<T = any>(id: string): T | null {
  return (settings.get(id)?.config as T) ?? null;
}

export function moduleOrphans(): string[] {
  return [...orphanIds];
}

/**
 * Module ids someone has DECIDED about — a settings row exists, whatever it
 * says. Launch readiness asks "did a human visit this question?", which is a
 * different fact from "is anything on": leaving every module off is a valid
 * launch, but only as a choice, and a row is the fossil of a choice.
 */
export function decidedModuleIds(): string[] {
  return Array.from(settings.keys());
}

export function moduleDemotions(): Array<{ id: string; missing: string[] }> {
  return Array.from(demoted.entries()).map(([id, missing]) => ({ id, missing }));
}

/**
 * ONE MODULE'S BAD DATA STOPS BEING THE WHOLE VILLAGE'S OUTAGE.
 *
 * The per-module boot invariants (exchange firewalls, badge validity, library
 * escrow reconciliation) each threw and each took the entire deployment down
 * with them. That is the right instinct pointed at the wrong blast radius: the
 * thing being protected is one module's own correctness, and the price was
 * every other module, for everybody, until somebody with production SQL
 * mended a row. No founder has production SQL. The failure they actually met
 * was a village that would not come back, at an hour with nobody to ask.
 *
 * So the module goes off and the village serves. This is not leniency: OFF is
 * the strictest thing available. It unmounts the routes, stops the scheduler
 * jobs and closes the only code that could compound the discrepancy, which is
 * more protection than a dead process ever gave. What it stops doing is
 * punishing the other twenty modules for it.
 *
 * `reasons` are sentences a founder can act on, naming the rows. They land in
 * the log, in the admin modules payload and in the village's health events.
 *
 * VILLAGE-WIDE TRUTHS ARE NOT THIS. Migrations and ledger conservation stay
 * fail-loud and fatal, because there is no single module to quarantine when
 * the schema or the economy as a whole is wrong.
 */
export function quarantineModule(id: string, reasons: string[]): void {
  if (!MODULES_BY_ID[id]) return;
  const existing = quarantined.get(id) ?? [];
  quarantined.set(id, [...existing, ...reasons]);
}

export function moduleQuarantines(): Array<{ id: string; reasons: string[] }> {
  return Array.from(quarantined.entries()).map(([id, reasons]) => ({ id, reasons }));
}

function reconcileGraph() {
  demoted = new Map();
  for (const def of MODULES) {
    if (def.core) continue;
    if (storedLifecycle(def.id) === "off") continue;
    const missing = def.requires.filter(
      (dep) => (MODULES_BY_ID[dep]?.core ? "public" : storedLifecycle(dep)) === "off",
    );
    if (missing.length) demoted.set(def.id, missing);
  }
}

/**
 * Boot reconciliation: loud, never brick. Demotions and orphans are logged
 * at fatal volume and surfaced in the admin panel; the site keeps serving.
 * Also asserts economy invariant #3: a token has at most one selling module.
 */
export function assertModuleGraph(): void {
  for (const [id, missing] of Array.from(demoted.entries())) {
    console.error(
      `[modules] FATAL-LEVEL CONFIG: "${id}" is configured ${storedLifecycle(id)} but requires [${missing.join(", ")}] which ${missing.length === 1 ? "is" : "are"} off; serving "${id}" as OFF until resolved`,
    );
  }
  for (const id of orphanIds) {
    console.error(`[modules] stored settings reference unknown module "${id}": ignored, listed as orphan`);
  }
  const sellers = new Map<string, string>();
  for (const def of MODULES) {
    if (!def.sellsToken) continue;
    const prior = sellers.get(def.sellsToken);
    if (prior) {
      throw new Error(
        `module graph invalid: token "${def.sellsToken}" has two selling modules (${prior}, ${def.id}); one selling module per token is a boot assertion, not a convention`,
      );
    }
    sellers.set(def.sellsToken, def.id);
  }
  /*
   * Module library shape, asserted the same way and for the same reason.
   *
   * A malformed listing is a defect in platform code and never a village's
   * configuration, so it belongs with the one-seller-per-token throw above and
   * not with the demote-and-log treatment a hand-edited table gets. The two
   * facts it protects are the ones a village cannot recover from on its own: a
   * support address that does not exist, and a credential sitting in the wrong
   * plane for its tier.
   */
  const listing = moduleListingProblems();
  if (listing.length) {
    throw new Error(`module library invalid:\n  ${listing.join("\n  ")}`);
  }
}

// ── The vendor lapse gate ────────────────────────────────────────────────────

/**
 * Where a village is sent when the PLATFORM is the supporting party. Env, with
 * a runbook line, because platform code carries no operator's brand and every
 * fork's own operator is its own managed support desk.
 */
function platformSupport(): { url: string | null; email: string | null } {
  return {
    url: process.env.PLATFORM_SUPPORT_URL?.trim() || null,
    email: process.env.PLATFORM_SUPPORT_EMAIL?.trim() || null,
  };
}

/**
 * Is this listing's credential present? The tier decides which plane to look
 * in, which is the whole point of defining the tier by the plane.
 *
 * Included never lapses: it has no vendor and no credential of its own, so its
 * routes keep whatever honest refusal they already carry.
 */
export function vendorCredentialPresent(def: ModuleDef): boolean {
  if (!def.vendor) return true;
  if (def.tier === "managed") {
    const envKey = def.vendor.managedEnvKey;
    return !!(envKey && String(process.env[envKey] ?? "").trim());
  }
  return def.vendor.secretKeys.every((k) => !!secretValue(k));
}

export interface VendorLapseBody {
  /**
   * THE SENTENCE, and the field name is the point.
   *
   * Around six client pages already render `d.error` from a response body
   * verbatim, so putting the machine code here would show a member the words
   * "vendor_unavailable" on the screen where they needed a sentence. The code
   * lives in `reason` beside it, which is where a program should look anyway.
   */
  error: string;
  reason: "vendor_unavailable";
  module: string;
  tier: string;
  /** Who answers for this. Keys on who supports, never on who built. */
  responsibleParty: "platform" | "vendor";
  /** Where to reach them. Null when the deployment has published no address. */
  supportAt: string | null;
  /** What is unaffected, so the answer is never only bad news. */
  stillWorks: string;
}

/**
 * The body a lapsed listing answers with, written in exactly one place.
 *
 * Connected NAMES the vendor and their support link, because the village holds
 * that account and the plan is its own. Managed never names the vendor at all:
 * managed sold the sentence "call us", and a village that never had an account
 * with anybody cannot act on a name. Included never reaches here, so a
 * platform module keeps whatever honest refusal it already carries.
 */
export function vendorLapseBody(def: ModuleDef): VendorLapseBody {
  const route = supportRoute(def);
  const stillWorks = "Everything else in the village keeps working.";
  if (route.party === "vendor") {
    const at = route.supportUrl ?? route.supportEmail;
    const where = at ? ` Reach them at ${at}.` : "";
    return {
      error: `${route.vendorName} is not answering. Your plan with them is the village's own.${where} ${stillWorks}`,
      reason: "vendor_unavailable",
      module: def.id,
      tier: def.tier,
      responsibleParty: "vendor",
      supportAt: at,
      stillWorks,
    };
  }
  const platform = platformSupport();
  const at = platform.url ?? platform.email;
  const where = at ? ` Reach us at ${at}.` : "";
  return {
    error: `This one is on us. We know, and we are on it.${where} ${stillWorks}`,
    reason: "vendor_unavailable",
    module: def.id,
    tier: def.tier,
    responsibleParty: "platform",
    supportAt: at,
    stillWorks,
  };
}

/**
 * Mounted AFTER requireModule, never instead of it.
 *
 * `requireModule` answers 404 for a module that is off, deliberately, so a
 * fork's site never advertises what a village has not turned on. Routing a
 * PAID entitlement through that same gate tells a village its feature was
 * deleted, which is the one thing that must not happen when the module is on,
 * paid for, and the vendor simply is not answering. Neither the tier nor the
 * lifecycle enum can say "enabled and lapsed", so 503 says it.
 */
export function requireVendor(id: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const def = MODULES_BY_ID[id];
    if (!def?.vendor) return next();
    if (vendorCredentialPresent(def)) return next();
    return res.status(503).json(vendorLapseBody(def));
  };
}

// ── The gate ─────────────────────────────────────────────────────────────────

export interface ModuleAuthDeps {
  /** Attaches req.adminUser when true (the host's isAdmin). */
  isAdmin(req: Request): Promise<boolean>;
  /** True when the request carries a valid member token. */
  isAuthed(req: Request): Promise<boolean>;
  /**
   * Who to credit this request to in the meter, or null for a stranger.
   *
   * SYNCHRONOUS AND FREE, which is the whole reason it is a separate dep from
   * `isAuthed`. It reads the member id straight out of the signed token and
   * touches no database, so putting the meter on the request path of every
   * module route in the product costs nothing on a `public` module that
   * `isAuthed` would never have looked at.
   *
   * The one thing it skips is SESSION REVOCATION, and skipping it here is
   * still right: paying a database read per request would be the write
   * amplification problem wearing a different hat. What was wrong was skipping
   * it altogether. A revoked token names a real member, so this cannot invent
   * anybody, but a member who has been signed out or removed kept counting for
   * the rest of the lunation, in numbers the pool is paid on.
   *
   * So `served()` below asks `isAuthed` before it writes a mark, and only when
   * a mark would actually be written. The revocation check is paid once per
   * member per module per cycle instead of once per request, and this function
   * stays what its name says it is.
   */
  meterUserId(req: Request): string | null;
}

let authDeps: ModuleAuthDeps | null = null;
export function wireModuleAuth(deps: ModuleAuthDeps) {
  authDeps = deps;
}

/**
 * Route gate factory. Mount once per module prefix:
 *   app.use("/api/tools", requireModule("tools"));
 * Settlement webhooks are NEVER mounted behind this — in-flight orders must
 * settle even when a module is disabled (economy invariant #13).
 */
export function requireModule(id: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lc = effectiveLifecycle(id);
      // One 404 body for off AND preview-to-outsiders: existence is hidden.
      const hidden = () => res.status(404).json({ error: "module_disabled", module: id });
      if (lc === "off") return hidden();
      if (lc === "preview") {
        if (!authDeps || !(await authDeps.isAdmin(req))) return hidden();
        return served(id, req, res, next);
      }
      if (lc === "members") {
        if (!authDeps || !(await authDeps.isAuthed(req))) {
          return res.status(401).json({ error: "auth_required", module: id });
        }
        return served(id, req, res, next);
      }
      return served(id, req, res, next); // public — capability checks still apply per route
    } catch (e) {
      next(e);
    }
  };
}

/**
 * The module is about to serve this request, so the meter hears about it.
 *
 * Here and not in each module's own code, for the same reason `moduleActivity`
 * exists: a structural no-op beats a review-enforced rule. Every non-core
 * module mounts behind this gate, so every non-core module is metered the day
 * it lists, and a builder cannot forget to call anything or choose to call it
 * twice. It also cannot fire for a request the gate refused, because the
 * refusing branches return before they reach here, so a stranger bouncing off a
 * `members` module never counts as having used it.
 *
 * A signed-in member is the unit, so anonymous traffic on a `public` module
 * earns that module nothing. That is a real cost and it is the right side of
 * the trade: an anonymous visitor cannot be counted once instead of a hundred
 * times, and a measure that saturates per person stops meaning anything the
 * moment it admits people it cannot tell apart.
 *
 * The four core modules do not mount behind this gate and are therefore not
 * metered. Their share would recycle to the pool under R59 either way, so
 * nothing is owed to anybody differently; what it does mean is that the weight
 * they would have absorbed stays with the modules that are measured. See the
 * report for why that is worth the founder's attention.
 */
function served(id: string, req: Request, res: Response, next: NextFunction): void {
  // An admin route is CONFIGURATION and not use. Every module mounts its admin
  // prefix behind this same gate, so without this line an admin who opens the
  // library's settings and never borrows anything counts as a library user, and
  // in a village of four that is a quarter of the module's reach bought with a
  // visit to a settings page. The pool is supposed to measure a village living
  // in a module. Lowercased because Express matches mounts case-insensitively
  // by default, so `/API/Admin/library` reaches the same handler and would
  // otherwise walk straight past a case-sensitive test.
  if (req.originalUrl.toLowerCase().startsWith("/api/admin/")) return next();

  const deps = authDeps;
  const userId = deps?.meterUserId(req) ?? null;
  if (!deps || !userId) return next();

  /*
   * THE MARK WAITS FOR THE RESPONSE, and this is the difference between
   * measuring use and measuring traffic.
   *
   * `requireModule` is mounted with `app.use("/api/library", ...)`, so it runs
   * for EVERY path under the prefix before Express has decided whether the
   * route exists and before any per-route capability check. Marking here
   * directly would mean `GET /api/library/anything-at-all` set a member's bit
   * for the cycle: a member could claim every enabled module with twenty curls,
   * and a stray prefetch would credit a module nobody opened. The number would
   * be counting "issued a request that reached the gate", which is not what the
   * header promises and not what the pool should pay for.
   *
   * `finish` fires once the response is written, so the status is known. Under
   * 400 means the module actually served this person something. A 404 for a
   * path that does not exist, a 403 from a capability check, and a 500 all
   * leave the count where it was.
   */
  /*
   * AND THE MARK ASKS WHETHER THE SESSION IS STILL ALIVE.
   *
   * `meterUserId` reads the id out of the signed token and stops there, which
   * cannot be handed an id this deployment did not mint but also cannot tell a
   * live session from one the member ended an hour ago. A village that signs
   * somebody out, or removes them, was still counting them in
   * `membersReached` and in the `activeMembers` denominator for the rest of
   * the lunation, and both of those numbers are reported upstream to the pool.
   * A revoked session that can still move the meter is a way to move money.
   *
   * `isAuthed` is the full auth path, `token_version` check included, so it is
   * the same answer `/api/profile` gives the same token. It costs a row read,
   * which is why it is asked HERE and not in `meterUserId`: `usageMarkPending`
   * is false for every request after a member's first on a module this cycle,
   * so the read is paid once per member per module per cycle, the same order
   * as the insert it guards. A member who is signed out pays it per request,
   * which is exactly what any authenticated route in the product pays.
   *
   * A failed read leaves the mark unwritten. The member keeps their page, and
   * the number is short by one rather than carrying somebody nobody verified.
   */
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    if (!usageMarkPending(id, userId)) return;
    void deps
      .isAuthed(req)
      .then((live) => { if (live) markModuleUse(id, userId); })
      .catch((e) => console.error(`[modules] could not confirm the session behind a ${id} mark`, e));
  });
  next();
}

// ── Readiness (the Go-live card's question) ──────────────────────────────────

/**
 * What "there is something here" means per module, said as the FIRST STEP a
 * founder takes rather than as a verdict. Only modules whose setup is not
 * "none" get a reader at all; the default reader is the examples engine's own
 * real-content check (real rows in the module's tables, examples excluded),
 * because that is already the platform's one definition of "this village made
 * something here".
 */
const READINESS_HINTS: Record<string, string> = {
  map: "Draw one circle first",
  tools: "Add one tool card first",
  badges: "Create a badge and award it once first",
  health: "Record one measurement of the land first",
  automation: "Feed it one call recording first",
  stays: "Post one room and a price first",
  library: "Put one item on the shelves first",
  exchange: "List a token and post its price first",
  commerce: "Create one product first",
  crowdpool: "Link one hub campaign first",
  hypha: "Set your DHO address, then confirm one token contract first",
  redemption: "Write how redemption works here first",
  events: "Say which hemisphere this village is in first",
};

/**
 * WHERE EACH HINT SENDS SOMEBODY, which is the half a sentence cannot carry
 * (Rye, 2026-09-21: "have a link to direct people to exactly what they need").
 *
 * A hint names a step; this names the control. The pairing lives beside the
 * hints so a module cannot gain one without the other, and every module whose
 * setup is not "none" must appear in both — `moduleReadiness.test.ts` walks
 * the registry rather than a copied list, so a new module with a hint and no
 * address fails the build instead of shipping a link to nowhere.
 *
 * A `tab` target is content the village makes on the module's own screen. That
 * screen is unreachable while the module is off (the rail hides it and its
 * routes are behind requireModule), which the link builder knows; a `setting`
 * or `config` target is on the module card and works at every lifecycle.
 */
const READINESS_TARGETS: Record<string, SetupTarget> = {
  map: { kind: "tab", tab: "circles-map", label: "the living map" },
  tools: { kind: "tab", tab: "tools-admin", label: "Tools Hub" },
  badges: { kind: "tab", tab: "badges-admin", label: "Badges & Skills" },
  health: { kind: "tab", tab: "health-admin", label: "Village Health" },
  automation: { kind: "tab", tab: "calls-admin", label: "Call Automation" },
  stays: { kind: "tab", tab: "stays-admin", label: "Stays" },
  library: { kind: "tab", tab: "library-admin", label: "Material Library" },
  exchange: { kind: "tab", tab: "exchange-admin", label: "Exchange" },
  commerce: { kind: "tab", tab: "products", label: "Payments & Donations" },
  resources: { kind: "tab", tab: "resources-admin", label: "How Resources Flow" },
  crowdpool: { kind: "config", module: "crowdpool", label: "Crowdpool" },
  redemption: settingTarget("redemption.process_text"),
  events: settingTarget("calendar.hemisphere"),
  // Hypha's address moves as its two halves are answered, so its reader picks
  // between these rather than reading one fixed entry.
  hypha: settingTarget("hypha.org_url"),
};

/**
 * A dial's address, with the label a founder is shown read from the registry
 * rather than typed here. Two copies of "Hemisphere" would be one rename away
 * from a link that promises one control and lands on another.
 */
function settingTarget(key: string): SetupTarget {
  return { kind: "setting", key, label: VARIABLES_BY_KEY[key]?.label ?? key };
}

let readinessAttached = false;

/**
 * Attach a readiness reader to every module that declares setup. Idempotent,
 * and called at route-registration time (immediately before the admin modules
 * route mounts), which runs once at boot: the same pattern as the
 * openStateCheck attachments, so the shared registry stays import-clean for
 * the client bundle.
 *
 * FIVE modules read their own readiness, and each one is here because the
 * default check cannot answer for it. Stays counts two tables rather than
 * either (a room without a price reads as real content to the default, and a
 * stay nobody can book is not ready). Crowdpool and redemption have no rows
 * at all to count, so their content is config: a linked campaign, and the
 * words a member is told to follow. Hypha needs an address and a confirmed
 * binding, neither of which the examples engine knows how to see. Events is
 * not waiting on content at all, but on an ANSWER — see its reader below.
 *
 * Every answer carries its `target` as well as its hint, so the surfaces that
 * show one can link to the control instead of describing it.
 */
export function attachModuleReadiness(getPool: () => Pool): void {
  if (readinessAttached) return;
  readinessAttached = true;
  for (const def of MODULES) {
    if (!def.setup || def.setup === "none") continue;
    const hint = READINESS_HINTS[def.id] ?? "Add the first real item before going live";
    const target = READINESS_TARGETS[def.id];
    if (def.id === "events") {
      /*
       * THE FIFTH READER, and the only one that asks whether a question was
       * ANSWERED rather than whether content exists.
       *
       * `calendar.hemisphere` ships "north". A village south of the equator
       * that never opened this dial gets solstices the wrong way round and a
       * moon lit on the wrong side, and nothing anywhere said so, because the
       * module told every fork there was nothing to set up.
       *
       * Ready cannot mean "the value is south", because "north" is a true
       * answer for most of this platform's villages, and it cannot mean "the
       * value differs from the default", because that is the same sentence.
       * It means a row exists: `placeDependent` keeps one for this dial even
       * when the value equals the default (server/lib/variables.ts), so the
       * row is the fossil of somebody having looked.
       *
       * No pool, deliberately. The answer is in the boot cache, so this costs
       * nothing on the admin payload and answers identically in a village
       * with no tables of its own.
       */
      def.readiness = async () => ({
        ready: isAnswered("calendar.hemisphere"),
        hint,
        target,
      });
      continue;
    }
    if (def.id === "stays") {
      def.readiness = async () => {
        try {
          const p = getPool();
          const [[rooms]] = await p.query<RowDataPacket[]>(
            "SELECT COUNT(*) n FROM accommodations WHERE is_example = 0",
          );
          const [[prices]] = await p.query<RowDataPacket[]>(
            "SELECT COUNT(*) n FROM accommodation_prices WHERE is_example = 0",
          );
          return { ready: Number(rooms.n) > 0 && Number(prices.n) > 0, hint, target };
        } catch {
          return { ready: false, hint, target };
        }
      };
      continue;
    }
    if (def.id === "crowdpool") {
      // The second custom reader, for the same reason as stays: the default
      // check reads a module's own tables, and crowdpool has none. Its
      // content is CONFIG (linked hub campaigns), so ready means at least one
      // campaign is linked.
      def.readiness = async () => {
        try {
          const cfg = moduleConfig<{ villageCampaigns?: unknown[] }>("crowdpool");
          return { ready: (cfg?.villageCampaigns?.length ?? 0) > 0, hint, target };
        } catch {
          return { ready: false, hint, target };
        }
      };
      continue;
    }
    if (def.id === "hypha") {
      /*
       * The third custom reader, and the one that keeps an unconfigured fork
       * honest. This module's content is a DHO address plus at least one token
       * contract a human confirmed, and neither is a row the examples engine
       * knows how to count.
       *
       * Both halves are required and the order matters to the founder reading
       * the hint. Without the org URL every Hypha surface hides by design
       * (`shared/hypha.ts`), so a binding with no DHO behind it has nowhere to
       * link out to. Without a confirmed binding there is no name, no supply
       * and no treasury figure to show, and a page of empty cards is exactly
       * the broken-looking module this reader exists to prevent.
       */
      /*
       * ITS ADDRESS MOVES WITH ITS ANSWER, which is why this reader builds one
       * rather than reading a fixed entry. Sending a founder who has already
       * set the DHO address back to the DHO address field is a link that looks
       * like help and is not; once that half is answered, what is left is the
       * contract to confirm, which is the Hypha panel further down the same
       * card.
       */
      const bindings: SetupTarget = { kind: "config", module: "hypha", label: "the Hypha Bridge" };
      def.readiness = async () => {
        try {
          if (!stringVar("hypha.org_url").trim()) return { ready: false, hint, target };
          const [[bound]] = await getPool().query<RowDataPacket[]>(
            "SELECT COUNT(*) n FROM hypha_token_bindings",
          );
          return { ready: Number(bound.n) > 0, hint, target: bindings };
        } catch {
          return { ready: false, hint, target };
        }
      };
      continue;
    }
    if (def.id === "redemption") {
      /*
       * The fourth custom reader, and it exists because redemption's content
       * is not rows. The default reader counts a module's own non-example
       * tables through the examples engine, and redemption has no entry
       * there at all, so the default would answer "not ready" for every
       * village forever and the Go-live card would never appear.
       *
       * What ready MEANS here is one dial: `redemption.process_text`, the
       * village's own words for who to speak to and how the money reaches a
       * member. It ships empty and an empty one shows no card at all
       * (shared/gameVariables.ts), so a village that switched redemption on
       * without writing it handed every member who asked to cash out no
       * instructions. The other thirteen dials all carry a working default,
       * which is why exactly this one is the gate.
       */
      def.readiness = async () => ({
        ready: stringVar("redemption.process_text").trim().length > 0,
        hint,
        target,
      });
      continue;
    }
    def.readiness = async () => {
      try {
        return { ready: await hasRealContent(getPool(), def.id), hint, target };
      } catch {
        return { ready: false, hint, target };
      }
    };
  }
}

/**
 * The widest lifecycle this module's hard dependencies allow: the lowest
 * effectiveLifecycle among `requires` (core counts as public, and a module
 * with no dependencies is unbounded). The Go-live card greys "Everyone" with
 * this; setModuleLifecycle refuses past it, so feed-at-public over
 * forum-at-members is impossible instead of discouraged (§8 item 11).
 */
export function moduleMaxLifecycle(id: string): ModuleLifecycle {
  const def = MODULES_BY_ID[id];
  if (!def) return "off";
  if (def.core) return "public";
  let bound: ModuleLifecycle = "public";
  for (const dep of def.requires) {
    const depLc: ModuleLifecycle = MODULES_BY_ID[dep]?.core ? "public" : effectiveLifecycle(dep);
    if (LIFECYCLE_RANK[depLc] < LIFECYCLE_RANK[bound]) bound = depLc;
  }
  return bound;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type LifecycleResult =
  | { ok: true; lifecycle: ModuleLifecycle }
  | { ok: false; status: number; error: string; missing?: string[]; dependents?: string[]; count?: number; description?: string; withdrawnSince?: string; limitedBy?: string[]; maxLifecycle?: ModuleLifecycle };

export interface LifecycleGuards {
  /** True while the deployment's only admin credential is a shared password —
   *  funds-bearing modules REFUSE to enable under that posture (invariant #11/#12). */
  sharedPasswordPosture(): boolean;
}

export async function setModuleLifecycle(
  id: string,
  next: ModuleLifecycle,
  byUserId: string | null,
  guards: LifecycleGuards,
): Promise<LifecycleResult> {
  if (!pool) throw new Error("module settings not loaded");
  const def = MODULES_BY_ID[id];
  if (!def) return { ok: false, status: 400, error: `Unknown module "${id}"` };
  if (def.core) return { ok: false, status: 400, error: `"${def.name}" is core and cannot change lifecycle in v1` };
  if (!(next in LIFECYCLE_RANK)) return { ok: false, status: 400, error: "lifecycle must be off, preview, members or public" };

  const current = storedLifecycle(id);
  if (next !== "off") {
    /*
     * A withdrawn listing refuses a NEW enable, and refuses nothing else.
     *
     * The condition is `current === "off"`, not `def.withdrawn` alone, and the
     * difference is the entire clause. A village already running this keeps
     * running it, can still move between preview, members and public, and can
     * still switch it off. Only the transition OUT of off is refused, so
     * withdrawn means withdrawn from the catalog rather than withdrawn from a
     * village. The registry entry stays in `MODULES` either way, so the row
     * never becomes an orphan, which is the promise this exists to keep.
     */
    if (def.withdrawn && current === "off") {
      const successor = def.withdrawn.replacedBy
        ? MODULES_BY_ID[def.withdrawn.replacedBy]?.name ?? def.withdrawn.replacedBy
        : null;
      return {
        ok: false,
        status: 409,
        error:
          `"${def.name}" was withdrawn from the module library on ${def.withdrawn.since} and cannot be turned on.` +
          (successor ? ` ${successor} replaces it.` : ""),
        withdrawnSince: def.withdrawn.since,
      };
    }
    // Enabling (or staying on): every hard dependency must itself be non-off.
    const missing = def.requires.filter(
      (dep) => (MODULES_BY_ID[dep]?.core ? "public" : storedLifecycle(dep)) === "off",
    );
    if (missing.length) {
      return { ok: false, status: 409, error: `"${def.name}" requires ${missing.join(", ")} to be enabled first`, missing };
    }
    /*
     * The publish rank bound (§8 item 11): a module may not stand WIDER than
     * a hard dependency serves. Feed at public over forum at members is a
     * wall of links only members can open, so the Go-live card greys the
     * option and this refuses the write that would sneak past the card. The
     * missing-dependency check above already owns the off case, which is why
     * this only ever fires for members and public asks. Lowering a dependency
     * under an already-wider dependent stays as today, deliberately.
     */
    const bound = moduleMaxLifecycle(id);
    if (LIFECYCLE_RANK[next] > LIFECYCLE_RANK[bound]) {
      const limiting = def.requires.filter(
        (dep) => !MODULES_BY_ID[dep]?.core && LIFECYCLE_RANK[effectiveLifecycle(dep)] < LIFECYCLE_RANK[next],
      );
      const names = limiting.map(
        (dep) => `${MODULES_BY_ID[dep]?.name ?? dep} (now ${effectiveLifecycle(dep)})`,
      );
      return {
        ok: false,
        status: 409,
        error: `"${def.name}" can only go as wide as what it depends on. ${names.join(" and ")} must reach ${next} first.`,
        limitedBy: limiting,
        maxLifecycle: bound,
      };
    }
    if (def.legalReview && current === "off" && guards.sharedPasswordPosture()) {
      return {
        ok: false,
        status: 403,
        error:
          "This module touches funds and cannot be enabled while a shared password is the only admin credential. Bootstrap per-admin identities first (economy invariants #11-#12).",
      };
    }
  } else {
    // Disabling: nothing non-off may still require this module…
    const dependents = MODULES.filter(
      (m) => !m.core && m.requires.includes(id) && storedLifecycle(m.id) !== "off",
    ).map((m) => m.id);
    if (dependents.length) {
      return { ok: false, status: 409, error: `${dependents.join(", ")} still require${dependents.length === 1 ? "s" : ""} "${def.name}"`, dependents };
    }
    // …and open economic state blocks the switch (invariant #13).
    if (def.openStateCheck) {
      const open = await def.openStateCheck();
      if (open.count > 0) {
        return {
          ok: false,
          status: 409,
          error: `"${def.name}" has open state: ${open.description}. Settle it first, then disable.`,
          count: open.count,
          description: open.description,
        };
      }
    }
  }

  await pool.query(
    "INSERT INTO module_settings (module_id, lifecycle, updated_by) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE lifecycle = VALUES(lifecycle), updated_by = VALUES(updated_by)",
    [id, next, byUserId],
  );
  const row = settings.get(id) ?? { lifecycle: "off" as ModuleLifecycle, config: null, updatedAt: null };
  row.lifecycle = next;
  settings.set(id, row);
  reconcileGraph();
  await pool.query(
    "INSERT INTO module_events (id, module_id, kind, from_value, to_value, by_user_id) VALUES (?,?,?,?,?,?)",
    [`mev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, id, "lifecycle", current, next, byUserId],
  );
  if (next !== "off") await stampListing(def, byUserId);
  return { ok: true, lifecycle: next };
}

/** What a village agreed to when it turned a listing on. Written into module_settings.config. */
export interface ListingStamp {
  tier: string;
  contractVersion: string;
  acceptedAt: string;
  acceptedBy: string | null;
}

export function listingStamp(id: string): ListingStamp | null {
  const cfg = settings.get(id)?.config as any;
  const s = cfg?.listing;
  return s && typeof s === "object" ? (s as ListingStamp) : null;
}

/**
 * The registry tier is the OFFER. The tier a village is ON is this stamp.
 *
 * `shared/modules.ts` is a compile-time constant, so a tier change ships to
 * every fork at once: a village that enabled something under managed could
 * wake up connected with its support arrangement rewritten and nobody would
 * have told it. Keeping the accepted tier and the contract version in the
 * village's own row turns that into a re-acceptance an admin has to read.
 *
 * This is the version-stamped acknowledgement shape the exchange's legal card
 * already uses, and it follows the same rule: the SERVER stamps who and when,
 * because who agreed to what is a record about a person and the client may not
 * author it.
 *
 * Re-stamping is deliberately a no-op while the tier and version are unchanged,
 * so toggling members to public does not manufacture an acceptance nobody made.
 *
 * ONLY LISTINGS ARE STAMPED, and the reason is a defect this nearly shipped.
 * Six read sites resolve a module's config as `moduleConfig(id) ?? defaultConfig`,
 * so writing ANY key into a previously empty config makes that fallback stop
 * firing. Stamping every module on enable would have left a freshly enabled
 * forum with `{listing}` in its config, no `categories` in it, and the seeded
 * default silently skipped: a village turns the forum on and finds it has no
 * categories at all. Included modules have no support arrangement to accept
 * anyway, so restricting the stamp is both the fix and the honest scope. The
 * defaults are seeded UNDER the stamp below so a listing that carries its own
 * defaultConfig cannot fall into the same hole.
 */
async function stampListing(def: ModuleDef, byUserId: string | null): Promise<void> {
  if (!pool) return;
  if (def.tier === "included") return;
  const prior = listingStamp(def.id);
  if (prior && prior.tier === def.tier && prior.contractVersion === MODULE_LIBRARY_CONTRACT_VERSION) return;
  const stamp: ListingStamp = {
    tier: def.tier,
    contractVersion: MODULE_LIBRARY_CONTRACT_VERSION,
    acceptedAt: new Date().toISOString(),
    acceptedBy: byUserId,
  };
  const row = settings.get(def.id) ?? { lifecycle: "off" as ModuleLifecycle, config: null, updatedAt: null };
  const config = {
    ...(def.defaultConfig ?? {}),
    ...(row.config && typeof row.config === "object" ? row.config : {}),
    listing: stamp,
  };
  await pool.query(
    "INSERT INTO module_settings (module_id, config, updated_by) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE config = VALUES(config), updated_by = VALUES(updated_by)",
    [def.id, JSON.stringify(config), byUserId],
  );
  row.config = config;
  settings.set(def.id, row);
  await pool.query(
    "INSERT INTO module_events (id, module_id, kind, from_value, to_value, by_user_id) VALUES (?,?,?,?,?,?)",
    [
      `mev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      def.id,
      "listing",
      prior ? `${prior.tier}@${prior.contractVersion}` : null,
      `${stamp.tier}@${stamp.contractVersion}`,
      byUserId,
    ],
  );
}

export async function setModuleConfig(
  id: string,
  config: unknown,
  byUserId: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!pool) throw new Error("module settings not loaded");
  const def = MODULES_BY_ID[id];
  if (!def) return { ok: false, status: 400, error: `Unknown module "${id}"` };
  if (def.validateConfig) {
    const problem = def.validateConfig(config);
    if (problem) return { ok: false, status: 400, error: problem };
  }
  await pool.query(
    "INSERT INTO module_settings (module_id, config, updated_by) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE config = VALUES(config), updated_by = VALUES(updated_by)",
    [id, JSON.stringify(config ?? null), byUserId],
  );
  const row = settings.get(id) ?? { lifecycle: "off" as ModuleLifecycle, config: null, updatedAt: null };
  row.config = config;
  settings.set(id, row);
  await pool.query(
    "INSERT INTO module_events (id, module_id, kind, from_value, to_value, by_user_id) VALUES (?,?,?,?,?,?)",
    [`mev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, id, "config", null, "updated", byUserId],
  );
  return { ok: true };
}

/**
 * The preview-leak guard (critique override #6): module code emits public
 * activity through THIS, and nothing lands on the Pulse while the module is
 * below 'members'. A structural no-op beats a review-enforced rule.
 */
export async function moduleActivity(
  moduleId: string,
  kind: string,
  text: string,
  extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
): Promise<void> {
  if (!pool) return;
  if (LIFECYCLE_RANK[effectiveLifecycle(moduleId)] < LIFECYCLE_RANK.members) return;
  await recordEvent(pool, { kind, text, ...extra });
}

// ── Settlement seam ──────────────────────────────────────────────────────────
// The S13 stub registry moved to payments.ts (S32): modules with fiat
// settlement call registerPaymentHandlers(moduleId, {settle, reversal}) there,
// and the ONE raw-body webhook in index.ts routes through handleStripeEvent.
