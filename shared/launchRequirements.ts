/**
 * Launch requirements (S62): everything a village must configure or do
 * before its deployment is genuinely ready for members — as DATA, not prose.
 *
 * Before this file, "what's left before launch?" had four different wrong
 * answers: a hand-maintained tracker frozen in Amora's build schedule, a
 * runbook only the platform team reads, a setup wizard with hardcoded text,
 * and env vars whose absence surfaces as a 503 three weeks after the moment
 * someone could have fixed them. This registry is the ONE answer. Three
 * consumers render it and none of them may invent an item of their own:
 *
 *   - the Journey to Launch page (live status, grouped, deep-linked),
 *   - the admin banner that persists until the journey is complete,
 *   - Maia's launch-guide mode (she reads the same JSON the page does).
 *
 * The shape parallels shared/modules.ts on purpose — an id, founder-facing
 * copy with NO village brand in it, and declarative wiring the server
 * resolves into live status. Requirements carry `appliesWhen` so modules
 * contribute their own needs: enabling Stays surfaces the Stripe rows,
 * disabling it withdraws them. A requirement nobody can act on is noise.
 *
 * THE CHECKS LIVE SERVER-SIDE (server/lib/launch.ts), keyed by `checkKey`.
 * This file stays isomorphic — the client imports it for copy and grouping
 * without dragging in mysql2. Adding a requirement means: one entry here,
 * one check function there, and every consumer updates itself.
 */
import { MODULES } from "./modules";

export type LaunchGroup =
  | "identity" // who runs this village: admins, handles, the shared-password exit
  | "brand" // name, tagline, copy — the overlay that de-Amoras a fork
  | "integrations" // third-party keys: Stripe, Resend, Anthropic
  | "modules" // which parts of the platform this village runs
  | "reach"; // domain, DNS, email deliverability — being findable

export type LaunchSeverity =
  /** Launch is dishonest without it (e.g. per-admin identities). */
  | "blocking"
  /** The platform works, but a member will hit a wall (e.g. no email). */
  | "recommended"
  /** Worth doing, nobody is harmed while it waits. */
  | "optional";

export interface LaunchRequirement {
  id: string;
  group: LaunchGroup;
  /** Founder-facing title. Platform copy — never a village brand literal. */
  title: string;
  /** WHY this matters, in one or two plain sentences. Maia reads this aloud. */
  why: string;
  severity: LaunchSeverity;
  /**
   * Server-side check key, resolved in server/lib/launch.ts. A requirement
   * whose state the server cannot observe (a real-world act like "point DNS")
   * has checkKey "manual:<id>" and is confirmed by an admin instead.
   */
  checkKey: string;
  /** Where to fix it: an app route, "/admin?tab=x", or an external URL. */
  fixAt: string;
  /** Label for the fix link ("Open Integrations", "Railway dashboard"). */
  fixLabel: string;
  /**
   * Only require this while at least ONE of the named modules is non-off.
   * Absent = always required.
   *
   * A list, not a single id, because several modules can depend on the same
   * piece of setup: stays, exchange and commerce all settle through the one
   * Stripe spine, and gating the Stripe requirements on `stays` alone told a
   * commerce-only village it was 100% launch-ready while no payment it took
   * could ever settle.
   */
  appliesWhenModule?: string | string[];
  /** Docs anchor in FORK_RUNBOOK.md for the long-form instructions. */
  runbookAnchor?: string;
  /**
   * A REQUIREMENT A FOUNDER MAY ANSWER BY DECLINING, and the answer counts.
   *
   * Rye, on the village-wide issuance cap: "they can opt to not set a cap at
   * that moment." So one item on this list has a second real answer, and
   * declining it satisfies the item the way doing it does.
   *
   * IT IS A FLAG ON THE REQUIREMENT AND NEVER A GENERAL POWER, which is the
   * whole point of putting it here. If declining were something an admin could
   * do to any row, a village could decline "Give every admin their own login"
   * and reach `readyToLaunch` with the platform's oldest debt untouched.
   * `confirmManual` in server/lib/launch.ts refuses a decline on any row that
   * does not carry this, so the registry decides and nothing else can.
   */
  declinable?: boolean;
}

/**
 * WHETHER THE RECOGNITION TOKEN CARRIES THIS VILLAGE'S OWN WORD.
 *
 * The `brand-token-names` resolver, as a pure function, here rather than in
 * server/index.ts for two reasons. It is testable without a pool, and that file
 * is on a ratchet that only ever turns down.
 *
 * READS THE REGISTRY NAME, never `brand.currency.name`. `mergedConfig()`
 * computes `pick(registryName, pick(brandName, configName))` for this name, so
 * the registry beats the brand overlay every time. The old resolver read the
 * overlay, which made it wrong in both directions at once: a founder who
 * renamed correctly under Admin then Tokens left this item red forever, and a
 * founder who typed into the Setup Wizard's "Recognition currency name" box
 * turned it green while changing nothing anybody could read. Both of those
 * boxes have been removed and the wizard links to Admin then Tokens instead.
 *
 * Compared against the platform default rather than against emptiness: the
 * registry row always carries a name, so "is it named" was never the question.
 * "Has this village chosen its own word" is.
 */
export function recognitionNameCheck(
  registryName: string | undefined | null,
  platformDefault: string,
): { state: "ok" | "missing"; detail: string } {
  const n = String(registryName ?? "").trim();
  if (!n) return { state: "missing", detail: "The recognition token has no name in this village's registry" };
  if (n.toLowerCase() === String(platformDefault).trim().toLowerCase()) {
    return { state: "missing", detail: `Recognition still carries the platform's own word, “${n}”` };
  }
  return { state: "ok", detail: `Recognition is called “${n}” here` };
}

/** The platform's own requirements. Listings add theirs below, from the registry. */
const PLATFORM_REQUIREMENTS: LaunchRequirement[] = [
  // ── Identity: the shared-password exit is the platform's oldest debt ──────
  {
    id: "admin-identities",
    group: "identity",
    title: "Give every admin their own login",
    why: "A shared password means nobody can ever be removed and no action can ever be attributed. Funds-bearing modules refuse to open while this is the posture.",
    severity: "blocking",
    checkKey: "admin-identities",
    fixAt: "/admin?tab=players",
    fixLabel: "Open Admin accounts",
    runbookAnchor: "admin-identities",
  },
  {
    id: "founder-appointed",
    group: "identity",
    title: "Appoint at least one founder",
    why: "Marking the village launched and opening trading need a named founder, not just any admin.",
    severity: "blocking",
    checkKey: "founder-appointed",
    fixAt: "/admin?tab=players",
    fixLabel: "Open Admin accounts",
  },

  // ── Brand: the overlay that makes a fork its own village ─────────────────
  {
    id: "brand-basics",
    group: "brand",
    title: "Name your village",
    why: "The project name, tagline and location flow into every page, email and the network handshake. Until they are set, your village introduces itself as a template.",
    severity: "blocking",
    checkKey: "brand-basics",
    fixAt: "/admin?tab=setup",
    fixLabel: "Open Project Settings",
  },
  {
    id: "brand-token-names",
    group: "brand",
    title: "Name your recognition token",
    /*
     * POINTS AT THE TOKEN REGISTRY, and it always should have. This row used
     * to send a founder to the Setup Wizard's "Recognition currency name" box,
     * which the registry overrode every time, so the one link on the checklist
     * led to the one field that could not change the answer. Both the check
     * (server/index.ts) and this link now name the same surface.
     */
    why: "Members earn this every day, so it carries whatever word your village uses for appreciation. Every token this village runs is named on the same page.",
    severity: "recommended",
    checkKey: "brand-token-names",
    fixAt: "/admin?tab=tokens",
    fixLabel: "Open Tokens",
  },

  // ── Integrations: keys, each honest about what stops without it ──────────
  {
    id: "resend-key",
    group: "integrations",
    title: "Connect email (Resend)",
    why: "Without it nobody receives a welcome, a receipt, or a notification digest. The village goes quiet exactly when someone new arrives.",
    severity: "recommended",
    checkKey: "resend-key",
    fixAt: "/admin?tab=integrations",
    fixLabel: "Open Integrations",
    runbookAnchor: "resend",
  },
  {
    id: "email-domain",
    group: "reach",
    title: "Verify your sending domain",
    why: "Mail from an unverified domain lands in spam. Verification is DNS records at your registrar; the Integrations tab shows exactly which ones.",
    severity: "recommended",
    checkKey: "manual:email-domain",
    fixAt: "/admin?tab=integrations",
    fixLabel: "Open Integrations",
    runbookAnchor: "resend-domain",
  },
  {
    id: "stripe-keys",
    group: "integrations",
    title: "Connect card payments (Stripe)",
    why: "Stays and the exchange sell for real money through your own Stripe account. The platform never pools funds. Without keys, card checkout answers an honest 503 and manual payment still works.",
    severity: "recommended",
    checkKey: "stripe-keys",
    fixAt: "/admin?tab=integrations",
    fixLabel: "Open Integrations",
    appliesWhenModule: ["stays", "exchange", "commerce"],
    runbookAnchor: "stripe",
  },
  {
    id: "stripe-webhook",
    group: "integrations",
    title: "Point the Stripe webhook here",
    why: "Payments settle through a signed webhook. Cards charge but credits never arrive until Stripe knows where to call back.",
    severity: "blocking",
    checkKey: "stripe-webhook",
    fixAt: "/admin?tab=integrations",
    fixLabel: "Open Integrations",
    appliesWhenModule: ["stays", "exchange", "commerce"],
    runbookAnchor: "stripe-webhook",
  },
  {
    id: "assistant-key",
    group: "integrations",
    title: "Connect the AI guide (Anthropic)",
    // LANE Q: neutral wording. These are shared constants with no access to
    // the world config, so they cannot read the deployment's assistant name
    // the way a client page can. Naming the platform's first tenant's persona
    // here was false for every fork that renamed its guide, and gendering it
    // was false for every fork that did not choose a woman.
    why: "Your guide welcomes proposals and walks a founder through this launch journey. Without a key the guide is simply absent. Every form still works by hand.",
    severity: "optional",
    checkKey: "assistant-key",
    fixAt: "/admin?tab=integrations",
    fixLabel: "Open Integrations",
  },
  {
    id: "assistant-own-key",
    group: "integrations",
    title: "Move the AI guide onto your own key",
    // LANE Q: same reason. "her" assumed a persona this deployment may not run.
    why: "This deployment is running the guide on a key the platform lends it. That key can be rotated at any time, and when it is, your guide stops answering. Your own key means nobody else's decision can switch your guide off.",
    severity: "recommended",
    checkKey: "assistant-own-key",
    fixAt: "/admin?tab=integrations",
    fixLabel: "Open Integrations",
  },

  // ── Modules: an explicit decision, not a default ──────────────────────────
  {
    id: "modules-decided",
    group: "modules",
    title: "Choose which modules your village runs",
    why: "Everything ships off. A launch with zero modules beyond the core game is a valid choice. It should be a choice someone made, not a page nobody visited.",
    severity: "blocking",
    checkKey: "modules-decided",
    fixAt: "/admin?tab=modules",
    fixLabel: "Open Modules",
  },
  {
    id: "season-seeded",
    group: "modules",
    title: "Start your first season",
    why: "Cycles, quests and settlement all hang off the season calendar. The seed creates one; confirm its dates are yours and not the template's.",
    severity: "recommended",
    checkKey: "season-seeded",
    fixAt: "/admin?tab=season",
    fixLabel: "Open Seasons",
  },
  {
    id: "pool-token-spendable",
    group: "modules",
    title: "Give the pool's token somewhere to go",
    /*
     * THE GUARD THAT STOPS A DEAD END COMING BACK.
     *
     * A fork could set a pool size, name a token, distribute it every lunation
     * and ship with nothing that token buys. The earn side was complete and
     * the spend side did not exist, so a member did the work, got thanked, and
     * received a number. Nothing in the build noticed, because nothing in the
     * build had ever been asked to.
     *
     * Blocking on purpose. A village that has not decided where its value goes
     * has not finished designing its economy, and finding that out after the
     * first settlement means telling people their credits are worth nothing
     * yet. The check passes on a stock fork, because member-to-member sending
     * is open on the village credits by default, so this blocks only a village
     * that deliberately closed every door.
     */
    why: "The cycle pool pays real value. If nothing accepts that token, a member does the work, gets thanked, receives a number, and there it ends. Price a room or a gathering in it, or let members send it to each other.",
    severity: "blocking",
    checkKey: "pool-token-spendable",
    fixAt: "/admin?tab=tokens",
    fixLabel: "Open the token registry",
  },

  {
    id: "issuance-cap",
    group: "modules",
    title: "Decide this village's issuance cap",
    /*
     * RYE'S RULING, AND WHY IT IS BLOCKING. "the initial village wide issuance
     * needs to be added to the flow founders are going through, and they can
     * opt to not set a cap at that moment. So, It's critical this is added to
     * the Journey to launch process."
     *
     * Blocking is what makes the second answer real. On a recommended row,
     * declining and never looking are the same outcome: the item stays amber
     * and the launch vote opens either way, so "you may decline" would be a
     * sentence with no mechanism behind it. Blocking means the founder has to
     * ANSWER, and either answer opens the vote. That is the difference between
     * a choice and a step somebody skipped.
     *
     * DECLINING DOES NOT UNCAP ANYTHING. The platform's own number keeps
     * binding every door, which is the other half of the ruling: the
     * village-wide cap binds as it does today. What a founder declines is
     * naming a number of their own, at this moment.
     */
    why: "Every door that brings tokens into existence spends one number, per token, per lunar cycle: hand-mints, co-signed grants, treasury stocking, circle treasuries, stay-credit comps, purchases and what a work-exchange quest releases. Decide it now, while nothing has been issued and the number costs nothing to change. You can also decline and keep the platform's, which is a decision this journey records with your name on it.",
    severity: "blocking",
    checkKey: "decide:issuance-cap",
    declinable: true,
    fixAt: "/admin?tab=variables",
    fixLabel: "Open the game variables",
  },

  // ── Reach: the real-world acts only a human can do ───────────────────────
  {
    id: "custom-domain",
    group: "reach",
    title: "Serve from your own domain",
    why: "Members should arrive at your village's address, not a hosting subdomain. Point DNS at the deployment and confirm here once it resolves.",
    severity: "recommended",
    checkKey: "manual:custom-domain",
    fixAt: "https://docs.railway.com/guides/public-networking#custom-domains",
    fixLabel: "Railway custom domains",
    runbookAnchor: "domain",
  },
  {
    id: "session-secret",
    group: "reach",
    title: "Set a stable session secret",
    why:
      "Without AUTH_TOKEN_SECRET the server invents a new signing key every time it starts. " +
      "Nothing looks broken until a deploy silently signs everyone out, or a second copy of the " +
      "service starts and members are logged out at random depending on which one answers. It fails " +
      "safe, so no forged login is possible; it just quietly makes sessions unreliable.",
    severity: "blocking",
    checkKey: "session-secret",
    fixAt: "/admin?tab=integrations",
    fixLabel: "Set it in the environment",
    runbookAnchor: "env",
  },
  {
    id: "exit-policy-terms",
    group: "reach",
    title: "Write your exit policy's actual terms",
    why:
      "Every village ships with a placeholder that says the terms are still to be decided by the " +
      "community. Honest on day one, a broken promise once people have contributed real value and " +
      "money. Someone leaving needs to know how their contribution is honoured BEFORE they need to know.",
    severity: "blocking",
    checkKey: "exit-policy-terms",
    fixAt: "/admin?tab=settings",
    fixLabel: "Write the terms",
    runbookAnchor: "exit-policy",
  },
  {
    id: "backups-drilled",
    group: "reach",
    title: "Take one backup and restore it once",
    why: "A backup nobody has restored is a hope, not a backup. Do the drill before there is anything you cannot afford to lose.",
    severity: "blocking",
    checkKey: "manual:backups-drilled",
    fixAt: "/admin?tab=settings",
    fixLabel: "Open Data & backups",
    runbookAnchor: "backups",
  },
];

// ── Module library listings contribute their own ─────────────────────────────

/**
 * One requirement per listing, generated from the registry.
 *
 * Reusing this machinery rather than inventing a vendor registry buys four
 * things that already work: `appliesWhenModule` so a listing withdraws its own
 * requirement when the module is off, `effectiveLifecycle` gating so a DEMOTED
 * module withdraws it too, three consumers that render it without being told,
 * and a visible failure when a check is not wired. A parallel mechanism would
 * have had to earn all four again.
 *
 * Connected asks a village to connect its own account. Managed asks nothing of
 * the village and instead DISCLOSES the arrangement, using the sentence
 * `assistant-own-key` already ships, because that sentence is exactly the
 * managed risk and it is already in house voice: the deployment runs on a key
 * somebody else holds, that key can be rotated at any time, and when it is,
 * the thing stops answering.
 */
export function listingRequirements(
  listings: ReadonlyArray<{ id: string; name: string; tier: string; dataClass?: string; vendor?: { legalName: string } }>,
): LaunchRequirement[] {
  const out: LaunchRequirement[] = [];
  for (const m of listings) {
    /*
     * A listing that holds member personal data outside the village must be
     * able to delete one person and say so.
     *
     * Three things become false the day an outside store holds member data with
     * no driver behind it, and nothing anywhere goes red: `anonymizeMember`
     * sweeps thirty tables and signals nothing outward, the profile export's
     * own comment says everything has to mean everything, and a public page
     * publishes that leaving well is guaranteed.
     *
     * Blocking severity, and visible rather than fatal. It gates marking the
     * village launched and it persists in the admin banner and on the journey
     * page. It deliberately does NOT assert at boot: driver registration
     * happens during boot wiring, so a boot guard would read the registry
     * before the wiring filled it and report a missing driver for every
     * listing. The launch registry observes at request time, which is when the
     * answer is true.
     *
     * `included` is excluded because it has no outside store. All eighteen
     * platform modules are member-pii and none of them holds a copy anywhere
     * else; the obligation belongs to a vendor, not to a data class.
     */
    if (m.tier !== "included" && m.dataClass === "member-pii") {
      out.push({
        id: `listing-member-driver-${m.id}`,
        group: "integrations",
        title: `Prove ${m.name} can forget a member`,
        why: `${m.vendor?.legalName ?? "The service behind this module"} holds member personal data outside this village. Until it registers a deletion and export driver, a member who asks to be forgotten is told something the village cannot back up, and the export leaves out a store nobody named.`,
        severity: "blocking",
        checkKey: `listing-member-driver:${m.id}`,
        fixAt: "/admin?tab=modules",
        fixLabel: "Open Modules",
        appliesWhenModule: m.id,
        runbookAnchor: "module-library",
      });
    }
    if (m.tier === "connected") {
      out.push({
        id: `listing-credential-${m.id}`,
        group: "integrations",
        title: `Connect your own account for ${m.name}`,
        why: `${m.vendor?.legalName ?? "The service behind this module"} bills your village directly and you hold the account. Until the key is set, this module answers an honest 503 and says who to reach. Everything else keeps working.`,
        severity: "recommended",
        checkKey: `listing-credential:${m.id}`,
        fixAt: "/admin?tab=integrations",
        fixLabel: "Open Integrations",
        appliesWhenModule: m.id,
        runbookAnchor: "module-library",
      });
    }
    if (m.tier === "managed") {
      out.push({
        id: `listing-lent-key-${m.id}`,
        group: "integrations",
        title: `Know what ${m.name} runs on`,
        why: "This deployment is running that module on a key the platform lends it. That key can be rotated at any time, and when it is, the module stops answering. One bill and one number to call is what you bought here, so the escalation is ours; this is the thing to know about it.",
        severity: "optional",
        checkKey: `listing-credential:${m.id}`,
        fixAt: "/admin?tab=modules",
        fixLabel: "Open Modules",
        appliesWhenModule: m.id,
        runbookAnchor: "module-library",
      });
    }
  }
  return out;
}

/**
 * The ONE list every consumer reads. Composed rather than hand-maintained, so
 * a listing that lands in the registry appears on the launch journey, in the
 * admin banner and in the guide's answer without anybody editing this file.
 */
export const LAUNCH_REQUIREMENTS: LaunchRequirement[] = [
  ...PLATFORM_REQUIREMENTS,
  ...listingRequirements(MODULES),
];

/** Ids of requirements that gate "Mark launched" (severity: blocking). */
export function blockingIds(): string[] {
  return LAUNCH_REQUIREMENTS.filter((r) => r.severity === "blocking").map((r) => r.id);
}
