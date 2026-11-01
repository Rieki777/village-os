/**
 * GUILDS: what every module needs planted before it works, as one closed
 * catalog of seeds.
 *
 * A SEED is one requirement a founder has to put in place: a key pasted into
 * the village's secrets store, an OAuth client, a DNS record, a hosting
 * variable, or one scoped "master root" token the platform then works inside.
 * A GUILD is the set of seeds one module needs. Every module in
 * `shared/modules.ts` names its guild in `guild`, by seed id, and the
 * platform's own always-on layers (hosting, email, sign-in, the AI guide, the
 * governance crossings) carry theirs in `PLATFORM_GUILDS` below. Choosing
 * modules therefore tells the setup game exactly what to plant, in what order,
 * and nothing else.
 *
 * THE CATALOG IS CLOSED, AND THAT IS THE SAFETY RULE. The setup game lets a
 * village's own AI agent choose the next seed and explain why it is next. It
 * never lets the agent ADD a seed or write the text a founder consents to.
 * Every consequence line, undo line, cost note and compost step a founder
 * reads is rendered from this file, which is reviewed at module intake. A
 * document, an email or a knowledge base the agent read cannot put words on a
 * consent screen, because no consent screen reads anything but this.
 *
 * EXTENDS, NEVER DUPLICATES. The values a seed fills already live in their own
 * homes, and this file only POINTS at them:
 *
 *   - secrets-store slots: `SECRET_KEYS` in `server/lib/secrets.ts`, which is
 *     the platform's own slots plus each listing's `vendor.secretKeys`. There
 *     is ONE root cellar (ruling of 2026-10-13): the master roots live there
 *     too, beside every other key;
 *   - hosting variables: `.env.example`, and the Go live table
 *     `GO_LIVE_ENV` in `client/src/components/admin/goLivePlan.ts`;
 *   - live checks: the resolvers in `server/lib/launch.ts`, keyed by the
 *     `checkKey` of a row in `shared/launchRequirements.ts`, and the probes
 *     named below.
 *
 * `shared/guilds.test.ts` holds this file to all three in both directions:
 * every handle named here exists there, and every slot and Go live variable
 * there is planted by some seed here. So a key added to the store without a
 * seed fails the build, and so does a seed naming a key nobody reads.
 *
 * GREEN MEANS ALIVE (ruling of 2026-10-13). A plant is healthy only after a
 * live check of strength `alive` has passed. A value being present is never
 * health, and neither is a person saying so. Many seeds below can only be
 * checked for presence today, and each says exactly that in its `liveCheck`;
 * `seedsNotYetAlive()` lists them and module intake prints the list.
 *
 * CERTAINTY. Every claim below was read out of this repository or out of the
 * provider's own documentation on 2026-10-09 or 2026-10-13. Where it could not
 * be confirmed, the seed says `certainty: "unverified"` and `open` names
 * exactly what is unconfirmed. A seed packet that states a guess in the voice
 * of a fact breaks the setup game's first promise, which is that the forest
 * matches what is really configured.
 *
 * THE COPY IS SHIPPED COPY. `scripts/check-voice.mjs` reads every string here,
 * so the house writing rules apply to consequence and undo lines the same as
 * to any page. A module author writes them; intake reviews them.
 *
 * Author guide: `docs/modules/GUILD_MANIFEST.md`.
 */

// ── The schema ───────────────────────────────────────────────────────────────

/**
 * How much the founder has to do, which is the order the setup game prefers.
 *
 *   oauth         one consent on the provider's own page; the rest is automated.
 *   master-root   one narrowly scoped token the founder grants; the platform
 *                 then sets records or variables through the provider's API,
 *                 inside that token's scope.
 *   hand-carried  no OAuth exists. The game shows the exact page and button,
 *                 and the paste field writes straight into the secrets store.
 *   minted        the platform creates it through the provider's API, using a
 *                 setup seed the founder planted. The founder never sees it.
 *   dns-record    a record at the village's DNS host, planted through the DNS
 *                 root or by hand from a copy card.
 *   hosting-var   a variable on the hosting service, planted through the
 *                 Railway root or by hand.
 */
export type SeedKind = "oauth" | "master-root" | "hand-carried" | "minted" | "dns-record" | "hosting-var";

/**
 * `keystone` is anything that touches production, money, or sends as the
 * village. What a keystone planting asks for depends on whether the village
 * has launched (ruling of 2026-10-13: "any founder should have full ability to
 * do a task before they go live"):
 *
 *   always          a mandatory pause where the planter reads the seed packet.
 *   before launch   any ONE founder plants it. Every other founder gets a
 *                   receipt. No co-sign, no cooling-off.
 *   after launch    a second person's co-sign, one tap on their own device.
 *                   A village with nobody to co-sign gets a cooling-off pause
 *                   and a receipt email instead.
 *
 * `keystoneRule` below is the one place that turns a risk and a phase into
 * those demands, and `PlantingPhase` says where the phase comes from.
 */
export type SeedRisk = "ordinary" | "keystone";

/**
 * Before or after launch, for planting.
 *
 * THE ONE SIGNAL is `founderPowerStands` in `server/lib/gameStart.ts`, read
 * through `plantingPhase` there: founder power stands means `before-launch`.
 * Chosen over `launch-state.launchedAt` (`server/lib/launch.ts`) on purpose.
 * The launch ballot writes both in the same moment, so for a new village they
 * agree. They disagree for every village that was already live before the
 * ballot existed: migration 0112 recorded those as started, because the
 * ledger proves they were issuing, and left `launchedAt` empty, because no
 * vote was ever held. Keyed on `launchedAt`, every one of those live villages
 * would read as pre-launch and let one founder plant production keys with no
 * co-sign. `founderPowerStands` is also already the rule for "what may one
 * founder do alone" (R90), which is exactly this question.
 */
export type PlantingPhase = "before-launch" | "after-launch";

/** What a planting asks of people, decided by risk and phase. */
export interface PlantingDemand {
  /** A mandatory pause on the seed packet before the provider's page opens. */
  readPause: boolean;
  /** Who may say yes. */
  approval: "one-founder" | "co-sign-or-cooling-off";
  /** Everyone else who holds a founder or admin seat gets a receipt. */
  receiptToOthers: boolean;
}

export function keystoneRule(risk: SeedRisk, phase: PlantingPhase): PlantingDemand {
  if (risk === "ordinary") return { readPause: false, approval: "one-founder", receiptToOthers: false };
  return {
    readPause: true,
    approval: phase === "before-launch" ? "one-founder" : "co-sign-or-cooling-off",
    receiptToOthers: true,
  };
}

/** Read out of the repository or the provider's docs, or an open question. */
export type SeedCertainty = "verified" | "unverified";

/** How badly the village misses this seed while its guild is planted. */
export type SeedNeed = "required" | "recommended" | "optional";

/**
 * How long a seed stays planted.
 *
 *   lasting       until its guild is composted.
 *   until-launch  composted at launch by default and planted again on demand,
 *                 when a change needs it. The DNS root is this.
 *   setup         exists only to plant another seed (`consumedBy`). The
 *                 platform composts it as soon as that seed is established,
 *                 without being asked.
 */
export type SeedLifespan = "lasting" | "until-launch" | "setup";

/**
 * Where a seed's value lands. The value itself never comes back to the game,
 * the browser or the agent: they see the handle, never the secret.
 *
 *   village-secret  a slot in the village's sealed secrets store
 *                   (`SECRET_KEYS`, `server/lib/secrets.ts`).
 *   env             a variable on the hosting service, documented in
 *                   `.env.example`.
 *   dns             a record at the village's DNS host. `record` names it in
 *                   words because the provider supplies the exact value.
 *   module-config   a key in a module's structural config
 *                   (`module_settings`), which is not secret.
 *   slot-to-build   a slot the flow that plants this seed adds when it is
 *                   built, and that does not exist yet. Saying so is the point.
 */
export type SeedHandle =
  | { store: "village-secret"; slot: string }
  | { store: "env"; name: string }
  | { store: "dns"; record: string }
  | { store: "module-config"; module: string; key: string }
  | { store: "slot-to-build"; name: string };

/**
 * The bee: what proves a seed is alive.
 *
 *   launch-check   a resolver in `server/lib/launch.ts`, keyed by a launch
 *                  requirement's `checkKey`. A `manual:` key is a person
 *                  confirming, which is strength `confirmed` at best.
 *   driver-health  a module's `health` driver method (contract clause 2).
 *                  No such interface exists yet, so the validator reports a
 *                  seed relying on it as not yet callable.
 *   probe          a named probe. `how` says exactly what it calls and what
 *                  answer counts as alive. `builtAt` names the code that runs
 *                  it, where it exists; a probe without one is still to build.
 *
 * `strength` keeps green honest. `present` means a value is set and says
 * nothing about whether it works; `confirmed` means a person said it is done;
 * `alive` means a real call to the real service succeeded. Only `alive` is
 * ever healthy.
 */
export type SeedLiveCheck =
  | { via: "launch-check"; checkKey: string; strength: "present" | "confirmed" | "alive"; proves: string }
  | { via: "driver-health"; module: string; strength: "alive"; proves: string }
  | { via: "probe"; probe: string; how: string; strength: "present" | "alive"; proves: string; builtAt?: string };

/** True only for a check that, when it passes, means the seed is alive. */
export function isLiveCheck(check: SeedLiveCheck): boolean {
  return check.strength === "alive";
}

/** Who must hold the account behind the seed. */
export type SeedHolder =
  | { who: "any-founder" }
  | { who: "account-owner"; account: string };

/**
 * How often the seed is replanted. Yearly is the default; `never` must say why
 * in words, because some values (a sealing key, a DNS record) break things
 * when they change.
 */
export type SeedRotation = { every: "year" } | { never: string };

/** The two master roots a seed can be planted through. */
export type SeedRoot = "railway-root" | "dns-root";

export interface GuildSeed {
  id: string;
  kind: SeedKind;
  /** One short title, as the seed packet shows it. */
  title: string;
  /**
   * Where the founder acts. `url` is the exact page, never a bare product
   * name. Null only where the page differs per village (a DNS host, a hub
   * address set in a game variable), and then `certainty` is unverified and
   * `open` says why.
   */
  provider: { name: string; url: string | null };
  /** The scopes or permissions requested, minimal. Empty where the provider offers none. */
  scopes: string[];
  /** Where the value lands. Empty only for a seed that plants an account or a decision. */
  handles: SeedHandle[];
  need: SeedNeed;
  /**
   * Plant this only while a game variable holds a value. A village that never
   * set it has nothing to plant here. `why` says it in words.
   */
  onlyWhen?: { setting: string; why: string };
  risk: SeedRisk;
  lifespan: SeedLifespan;
  /** For a `setup` seed: the seed it exists to plant. */
  consumedBy?: string;
  /**
   * Must exist before the setup game can run at all, because the game runs
   * inside the deployed app. Planted by hand, or by a hosting template; never
   * through a root, since the root itself is stored by the running app.
   */
  bootstrap?: true;
  /** The root that plants this for the founder, when one is held. */
  plantedThrough?: SeedRoot;
  /**
   * How to plant it with no root, which is always possible and never a
   * failure. Required on every seed that lands in the hosting environment or
   * in DNS.
   */
  byHand?: { how: string };
  /** What changes in the world when this is planted, in the founder's terms. */
  consequence: string;
  /** How to take it back. */
  undo: string;
  /** What it costs, honestly, including saying when the figure is unknown. */
  cost: string;
  /** Seeds that must be established first. Orders the plan. */
  dependsOn: string[];
  /** The launch requirement this seed satisfies on the Journey to Launch page. */
  launchRequirement?: string;
  liveCheck: SeedLiveCheck;
  /** The test-mode variant, or null where the provider offers none (said out loud). */
  nursery: { how: string } | null;
  /**
   * How to revoke and delete it when its guild is composted. Never empty. On a
   * `setup` seed these are the steps the platform runs by itself.
   */
  compost: string[];
  rotation: SeedRotation;
  holder: SeedHolder;
  certainty: SeedCertainty;
  /** What is unconfirmed. Required when `certainty` is unverified. */
  open?: string[];
  /** Where in the repository or the provider's docs the claims were read. */
  source: string;
}

/** A platform layer every village plants, whatever modules it chooses. */
export interface PlatformGuild {
  id: string;
  /** The forest's word for the layer, for the game to draw. */
  layer: string;
  title: string;
  seeds: string[];
}

// ── The catalog ──────────────────────────────────────────────────────────────

const RAILWAY_VARIABLES = "https://railway.com/dashboard";
const FORK_INIT = "Generated by scripts/fork-init.mjs into a local .env, then pasted into Railway by a founder's own hand.";
const RAILWAY_BY_HAND = "Railway, the web service, Variables, New Variable. Paste the value alone, then deploy.";
const RESEND_API = "Resend API reference, read 2026-10-13";

export const SEEDS: readonly GuildSeed[] = [
  // ── Soil: hosting, database, domain ─────────────────────────────────────────
  {
    id: "railway-root",
    kind: "master-root",
    title: "One scoped Railway token",
    provider: { name: "Railway", url: "https://railway.com/dashboard" },
    scopes: ["one project", "one environment"],
    handles: [{ store: "village-secret", slot: "railway_project_token" }],
    need: "optional",
    risk: "keystone",
    lifespan: "lasting",
    consequence:
      "The platform can set and remove this village's variables on Railway, inside this one project and environment. Nobody can read the token back out, the village agent included, and it reaches no other project. Each change it makes restarts the service.",
    undo: "Delete the token on Railway and clear it under Integrations. Every variable it set stays where it is, and the rest are planted by hand.",
    cost: "Free. Railway bills the project for what it runs, whoever sets the variables.",
    dependsOn: ["village-secrets-key"],
    liveCheck: {
      via: "probe",
      probe: "railway-token-scope",
      how: "Ask Railway's API which projects and environments the token can reach. Alive means exactly this village's one.",
      strength: "alive",
      proves: "The token works and reaches no further than this project.",
    },
    nursery: { how: "Grant a token for a staging environment first and plant every variable there." },
    compost: [
      "Delete the token on Railway.",
      "Clear the Railway slot under Admin, Integrations, and keep the receipt.",
    ],
    rotation: { every: "year" },
    holder: { who: "account-owner", account: "the Railway account that owns the project" },
    certainty: "unverified",
    open: [
      "Whether Railway issues a token scoped to one project and one environment, and the exact page that issues it. Check Railway's own docs before promising the scope.",
      "The API call that lists what a token can reach.",
      "The probe is not built.",
    ],
    source:
      "Ruling of 2026-10-13: one root cellar, narrowest scope, the Railway root stays for upkeep and is keystone. Slot: server/lib/secrets.ts railway_project_token, no environment fallback.",
  },
  {
    id: "database-url",
    kind: "hosting-var",
    title: "Connect the database",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "DATABASE_URL" }],
    need: "required",
    risk: "keystone",
    lifespan: "lasting",
    bootstrap: true,
    byHand: { how: "Connect the app service to the MySQL service so Railway fills it in as a reference. Nobody types it." },
    consequence: "The server reads and writes the village's own database. Without it the server refuses to start.",
    undo: "Remove the service reference and the server stops. The database keeps every row until it is deleted on purpose.",
    cost: "Railway bills the MySQL service for what it uses. This repository records no figure.",
    dependsOn: [],
    liveCheck: {
      via: "probe",
      probe: "health",
      how: "GET /health on the deployment. Alive means it answers ok with a real build SHA.",
      strength: "alive",
      proves: "The server started, which it refuses to do without a database.",
    },
    nursery: { how: "A staging environment with its own MySQL service." },
    compost: [
      "Save seeds first: export the database.",
      "Remove DATABASE_URL from the app service.",
      "Delete the MySQL service only once the export has been restored somewhere and read back.",
    ],
    rotation: { never: "Railway fills it in from the MySQL service reference, so nobody types it or rotates it by hand." },
    holder: { who: "account-owner", account: "the Railway account that owns the project" },
    certainty: "verified",
    source: "goLivePlan.ts GO_LIVE_ENV and step 2; docs/PROVISIONING.md step 2.",
  },
  {
    id: "auth-token-secret",
    kind: "hosting-var",
    title: "A stable session secret",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "AUTH_TOKEN_SECRET" }],
    need: "required",
    risk: "keystone",
    lifespan: "lasting",
    bootstrap: true,
    byHand: { how: RAILWAY_BY_HAND },
    consequence: "Members stay signed in across restarts and deploys.",
    undo: "Remove it and the server invents a new one on every start, which signs every member out each time.",
    cost: "Free.",
    dependsOn: [],
    launchRequirement: "session-secret",
    liveCheck: {
      via: "launch-check",
      checkKey: "session-secret",
      strength: "present",
      proves: "A secret is set. Signing members in with it is what proves it works.",
    },
    nursery: { how: "Its own value in a staging environment." },
    compost: ["Delete AUTH_TOKEN_SECRET from Railway. Every member is signed out."],
    rotation: { every: "year" },
    holder: { who: "any-founder" },
    certainty: "verified",
    source: FORK_INIT + " shared/launchRequirements.ts session-secret.",
  },
  {
    id: "admin-password",
    kind: "hosting-var",
    title: "The one-time founder password",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "ADMIN_PASSWORD" }],
    need: "required",
    risk: "keystone",
    lifespan: "lasting",
    bootstrap: true,
    byHand: { how: RAILWAY_BY_HAND },
    consequence:
      "Whoever holds it can claim the village's founder account once. After the first claim it works only for the break-glass address.",
    undo: "Change it in Railway. An account already claimed keeps its own password.",
    cost: "Free.",
    dependsOn: ["database-url"],
    launchRequirement: "admin-identities",
    liveCheck: {
      via: "launch-check",
      checkKey: "admin-identities",
      strength: "confirmed",
      proves: "A founder has claimed an account of their own.",
    },
    nursery: { how: "Claim a staging village first with its own password." },
    compost: ["Delete ADMIN_PASSWORD from Railway once nobody needs the break-glass path."],
    rotation: { never: "It is used once to claim the village, and after that only by the break-glass address." },
    holder: { who: "any-founder" },
    certainty: "verified",
    source: FORK_INIT + " goLivePlan.ts step 8.",
  },
  {
    id: "frontend-url",
    kind: "hosting-var",
    title: "The village's own address",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "FRONTEND_URL" }],
    need: "required",
    risk: "keystone",
    lifespan: "lasting",
    plantedThrough: "railway-root",
    byHand: { how: RAILWAY_BY_HAND },
    consequence: "Every email link, the Google sign-in callback and every browser request are built from this address.",
    undo: "Change it back. Links already sent keep pointing at the old address.",
    cost: "Free.",
    dependsOn: ["custom-domain-cname"],
    liveCheck: {
      via: "probe",
      probe: "health-at-frontend-url",
      how: "GET <FRONTEND_URL>/health. Alive means it answers ok.",
      strength: "alive",
      proves: "The address reaches this deployment.",
    },
    nursery: { how: "The address Railway gives the staging service." },
    compost: ["Delete FRONTEND_URL from Railway."],
    rotation: { never: "It is an address, and it changes only when the village moves." },
    holder: { who: "any-founder" },
    certainty: "verified",
    source: "goLivePlan.ts GO_LIVE_ENV and step 6.",
  },
  {
    id: "break-glass-email",
    kind: "hosting-var",
    title: "A way back in",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "BREAK_GLASS_ADMIN_EMAIL" }],
    need: "recommended",
    risk: "keystone",
    lifespan: "lasting",
    plantedThrough: "railway-root",
    byHand: { how: RAILWAY_BY_HAND },
    consequence: "This address can still claim the village with the founder password if every admin is locked out.",
    undo: "Clear it, and a village that loses every admin has no way back in.",
    cost: "Free.",
    dependsOn: ["admin-password"],
    liveCheck: {
      via: "probe",
      probe: "env-present",
      how: "The setup game asks the server whether the variable is set. It never reads the value.",
      strength: "present",
      proves: "An address is set. Only a real lockout drill proves the way back works.",
    },
    nursery: null,
    compost: ["Delete BREAK_GLASS_ADMIN_EMAIL from Railway."],
    rotation: { never: "It changes when the person holding it changes." },
    holder: { who: "any-founder" },
    certainty: "unverified",
    open: ["No server route reports this variable's presence today; the env-present probe has to be built."],
    source: FORK_INIT + " goLivePlan.ts step 8.",
  },
  {
    id: "member-secrets-key",
    kind: "hosting-var",
    title: "The members' sealing key",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "MEMBER_SECRETS_KEY" }],
    need: "recommended",
    risk: "keystone",
    lifespan: "lasting",
    plantedThrough: "railway-root",
    byHand: { how: RAILWAY_BY_HAND },
    consequence: "Members can store their own AI key and agent-inbox secret, sealed under this key.",
    undo: "Removing it makes every stored member key unreadable. There is no undo for that.",
    cost: "Free.",
    dependsOn: [],
    liveCheck: {
      via: "probe",
      probe: "env-present",
      how: "The setup game asks the server whether the key is set and well formed. It never reads the value.",
      strength: "present",
      proves: "A usable key is set.",
    },
    nursery: { how: "A different key in staging. Never copy production's." },
    compost: ["Delete MEMBER_SECRETS_KEY from Railway only when the village itself is composted. Every stored member key becomes unreadable."],
    rotation: { never: "Rotating it makes every member key already stored under it unreadable." },
    holder: { who: "any-founder" },
    certainty: "verified",
    source: FORK_INIT + " goLivePlan.ts step 3 and GO_LIVE_ENV.",
  },
  {
    id: "village-secrets-key",
    kind: "hosting-var",
    title: "The secrets store's sealing key",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "VILLAGE_SECRETS_KEY" }],
    need: "required",
    risk: "keystone",
    lifespan: "lasting",
    bootstrap: true,
    byHand: { how: RAILWAY_BY_HAND + " It is exactly 64 characters of 0 to 9 and a to f." },
    consequence:
      "Every key the setup game plants, the roots included, is sealed with it. Until it is set, the secrets store refuses to save one.",
    undo: "Removing it makes every key saved in the store unreadable. Keys set in Railway keep working.",
    cost: "Free.",
    dependsOn: [],
    launchRequirement: "village-secrets-key",
    liveCheck: {
      via: "launch-check",
      checkKey: "village-secrets-key",
      strength: "present",
      proves: "A key of the right shape is set. Saving and reading back one key is what proves it seals.",
    },
    nursery: { how: "A different key in staging. Never copy production's." },
    compost: ["Delete VILLAGE_SECRETS_KEY from Railway only when the village itself is composted."],
    rotation: { never: "Rotating it makes everything already sealed under it unreadable." },
    holder: { who: "any-founder" },
    certainty: "verified",
    source: "server/lib/secrets.ts header; shared/launchRequirements.ts village-secrets-key.",
  },
  {
    id: "backup-export-token",
    kind: "hosting-var",
    title: "The uploads backup token",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "BACKUP_EXPORT_TOKEN" }],
    need: "recommended",
    risk: "ordinary",
    lifespan: "lasting",
    plantedThrough: "railway-root",
    byHand: { how: RAILWAY_BY_HAND },
    consequence: "The scheduled backup can fetch member uploads as well as the database.",
    undo: "Clear it and the uploads half of the backup answers 503 while the database half still looks green.",
    cost: "Free.",
    dependsOn: [],
    launchRequirement: "backups-drilled",
    liveCheck: {
      via: "launch-check",
      checkKey: "manual:backups-drilled",
      strength: "confirmed",
      proves: "A founder took one backup and restored it once.",
    },
    nursery: null,
    compost: ["Delete BACKUP_EXPORT_TOKEN from Railway and from the backup job's own secrets."],
    rotation: { every: "year" },
    holder: { who: "any-founder" },
    certainty: "verified",
    source: FORK_INIT + " goLivePlan.ts GO_LIVE_ENV.",
  },
  {
    id: "trusted-proxy-hops",
    kind: "hosting-var",
    title: "Rate limits see the real address",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "TRUSTED_PROXY_HOPS" }],
    need: "recommended",
    risk: "ordinary",
    lifespan: "lasting",
    plantedThrough: "railway-root",
    byHand: { how: RAILWAY_BY_HAND },
    consequence: "Rate limits count each visitor by their own address. 1 is correct on Railway.",
    undo: "Clear it and rate limits key on the wrong address.",
    cost: "Free.",
    dependsOn: [],
    liveCheck: {
      via: "probe",
      probe: "env-present",
      how: "The setup game asks the server whether the variable is set.",
      strength: "present",
      proves: "A value is set.",
    },
    nursery: { how: "The same value in staging." },
    compost: ["Delete TRUSTED_PROXY_HOPS from Railway."],
    rotation: { never: "It describes the hosting, and changes only when the hosting does." },
    holder: { who: "any-founder" },
    certainty: "unverified",
    open: ["No server route reports this variable's presence today; the env-present probe has to be built."],
    source: "goLivePlan.ts GO_LIVE_ENV.",
  },
  {
    id: "error-webhook-url",
    kind: "hosting-var",
    title: "Crash alerts to an outside channel",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "ERROR_WEBHOOK_URL" }],
    need: "optional",
    risk: "ordinary",
    lifespan: "lasting",
    plantedThrough: "railway-root",
    byHand: { how: RAILWAY_BY_HAND },
    consequence: "Crashes are posted to a channel outside the app as well as to admins inside it.",
    undo: "Clear it. Admins still see crashes in the app.",
    cost: "Free here. The receiving channel may charge on its own terms.",
    dependsOn: [],
    liveCheck: {
      via: "probe",
      probe: "env-present",
      how: "The setup game asks the server whether the variable is set.",
      strength: "present",
      proves: "An address is set. A test alert reaching the channel is what proves it.",
    },
    nursery: { how: "Point it at a test channel first." },
    compost: ["Delete ERROR_WEBHOOK_URL from Railway.", "Delete the incoming webhook at the receiving channel."],
    rotation: { every: "year" },
    holder: { who: "any-founder" },
    certainty: "unverified",
    open: ["Which channel shapes the server can post to; read server/lib/errors.ts before relying on one."],
    source: "goLivePlan.ts GO_LIVE_ENV.",
  },
  {
    id: "dns-root",
    kind: "master-root",
    title: "One scoped DNS token",
    provider: { name: "The village's DNS host", url: null },
    scopes: ["edit records in one zone"],
    handles: [{ store: "village-secret", slot: "dns_zone_token" }],
    need: "optional",
    risk: "keystone",
    lifespan: "until-launch",
    consequence:
      "The platform can add and remove records in this one domain's zone, for the address and for email. It cannot transfer the domain or touch any other zone. It is removed at launch and planted again when a record has to change.",
    undo: "Delete the token at the DNS host and clear it under Integrations. Records it added stay until removed, and the rest are planted by hand.",
    cost: "Free wherever the records already live.",
    dependsOn: ["village-secrets-key"],
    liveCheck: {
      via: "probe",
      probe: "dns-token-scope",
      how: "Ask the DNS host's API which zones the token can edit. Alive means exactly this village's.",
      strength: "alive",
      proves: "The token works and reaches no further than one zone.",
    },
    nursery: null,
    compost: [
      "At launch, unless a founder keeps it on purpose: delete the token at the DNS host.",
      "Clear the DNS slot under Admin, Integrations, and keep the receipt.",
    ],
    rotation: { never: "It is composted at launch and planted fresh when it is needed again." },
    holder: { who: "account-owner", account: "the account at the DNS host that holds the domain" },
    certainty: "unverified",
    open: [
      "Which DNS hosts issue a token scoped to one zone, and the exact page for each. Check each host's docs before promising the scope.",
      "The probe is not built, and differs per DNS host.",
    ],
    source:
      "Ruling of 2026-10-13: one root cellar, one zone, composted after launch and replanted on demand, optional because DNS by hand is first class. Slot: server/lib/secrets.ts dns_zone_token, no environment fallback.",
  },
  {
    id: "custom-domain-cname",
    kind: "dns-record",
    title: "Point the domain at the village",
    provider: { name: "Railway", url: "https://docs.railway.com/guides/public-networking#custom-domains" },
    scopes: [],
    handles: [{ store: "dns", record: "the CNAME Railway gives for the custom domain" }],
    need: "recommended",
    risk: "keystone",
    lifespan: "lasting",
    plantedThrough: "dns-root",
    byHand: {
      how: "A copy card with the record's type, name and value, one field at a time, to paste at the DNS host. A village with no domain yet keeps Railway's own address and comes back later.",
    },
    consequence: "Members reach the village at its own address.",
    undo: "Remove the record and the village answers only at Railway's own address.",
    cost: "A yearly fee for the domain, set by whoever sells it. This repository records no figure.",
    dependsOn: [],
    launchRequirement: "custom-domain",
    liveCheck: {
      via: "launch-check",
      checkKey: "manual:custom-domain",
      strength: "confirmed",
      proves: "A founder confirmed the domain resolves. The address probe on FRONTEND_URL is what proves it.",
    },
    nursery: null,
    compost: ["Remove the CNAME at the DNS host.", "Remove the custom domain from the Railway service."],
    rotation: { never: "It is an address, and it changes only when the village moves." },
    holder: { who: "account-owner", account: "the account at the DNS host that holds the domain" },
    certainty: "verified",
    source: "goLivePlan.ts step 6; shared/launchRequirements.ts custom-domain.",
  },

  // ── Water: email, through Resend (the pilot) ────────────────────────────────
  //
  // THE SETUP KEY PATTERN (ruling of 2026-10-13). The founder pastes ONE
  // temporary full-access Resend key. From it the platform adds the domain,
  // reads its records, plants them (through the DNS root, or on copy cards),
  // asks Resend to verify, mints a send-only key restricted to that domain,
  // stores it, and deletes the setup key. The founder plants one seed and the
  // village keeps only the narrowest key Resend offers. The flow is modelled
  // here and NOT built yet; each step names the Resend endpoint it uses.
  {
    id: "resend-account",
    kind: "hand-carried",
    title: "A Resend account under a role address",
    provider: { name: "Resend", url: "https://resend.com/signup" },
    scopes: [],
    handles: [],
    need: "recommended",
    risk: "ordinary",
    lifespan: "lasting",
    consequence:
      "The village has its own email sending account. Open it under a shared address like ops@ so it never belongs to one person's inbox.",
    undo: "Delete the account in Resend's settings. Nothing in the village changes until the key below is removed.",
    cost: "Resend's free tier is enough to start. Paid plans are Resend's own pricing.",
    dependsOn: [],
    liveCheck: {
      via: "probe",
      probe: "comms-test-delivered",
      how: "The post office's own test email, sent and then reported delivered. The same check as the key's.",
      strength: "alive",
      proves: "The account exists and can send.",
      builtAt: "server/lib/comms/setup.ts",
    },
    nursery: null,
    compost: ["Delete the Resend account once its keys are revoked and its domain removed."],
    rotation: { never: "It is an account. Its keys rotate." },
    holder: { who: "account-owner", account: "a role address such as ops@, with a second founder able to reach it" },
    certainty: "verified",
    source: "goLivePlan.ts GO_LIVE_PREREQS resend; Resend's signup page.",
  },
  {
    id: "resend-setup-key",
    kind: "hand-carried",
    title: "One temporary Resend key, for setup",
    provider: { name: "Resend", url: "https://resend.com/api-keys" },
    scopes: ["permission: full_access"],
    handles: [{ store: "slot-to-build", name: "resend_setup_key" }],
    need: "recommended",
    risk: "keystone",
    lifespan: "setup",
    consumedBy: "resend-api-key",
    consequence:
      "For a few minutes the platform holds full control of the village's Resend account. It uses it to add the domain, read the records, mint a send-only key, and then deletes this key.",
    undo: "Delete it at resend.com/api-keys at any time. The setup stops where it is and nothing has been sent.",
    cost: "Free.",
    dependsOn: ["resend-account", "village-secrets-key"],
    liveCheck: {
      via: "probe",
      probe: "resend-domain-create",
      how: "POST https://api.resend.com/domains with the village's domain. Alive means Resend answers with a domain id and its records.",
      strength: "alive",
      proves: "The key is real and allowed to manage domains.",
    },
    nursery: null,
    compost: [
      "The platform finds the key's id with GET https://api.resend.com/api-keys, by the name the game asked the founder to give it.",
      "The platform deletes it with DELETE https://api.resend.com/api-keys/{id} once the send-only key is stored.",
      "The platform clears its slot and writes a receipt. If the delete fails, the game asks the founder to delete it by hand and does not mark the seed composted.",
    ],
    rotation: { never: "It lives only for the setup and is deleted when the setup ends." },
    holder: { who: "account-owner", account: "the Resend account's role address" },
    certainty: "unverified",
    open: [
      "The setup flow, its slot and every probe here are not built.",
      "How the platform learns the setup key's own id. GET /api-keys lists ids and names and never a token, so it matches the name the game told the founder to use. Confirm the list response before relying on it.",
      "Whether a key may delete itself. The setup key has to, because the send-only key can delete nothing. Resend's page does not say. If it may not, the founder deletes it at resend.com/api-keys, and the game cannot confirm that it is gone.",
      "Which permission POST /domains needs. Resend's page does not say; full_access is assumed.",
    ],
    source:
      RESEND_API + ": POST /domains returns an id and a records array; POST /api-keys takes name, permission and domain_id; DELETE /api-keys/{api_key_id} answers deleted true.",
  },
  {
    id: "resend-sending-domain",
    kind: "dns-record",
    title: "Prove the village owns its sending domain",
    provider: { name: "Resend", url: "https://resend.com/domains" },
    scopes: [],
    handles: [{ store: "dns", record: "every record in the records array Resend returns for the domain" }],
    need: "recommended",
    risk: "keystone",
    lifespan: "lasting",
    plantedThrough: "dns-root",
    byHand: {
      how: "One copy card per record Resend returned, with its type, name, value, TTL and priority as separate fields, to paste at the DNS host. Weather shows while the records propagate.",
    },
    consequence:
      "Mail from the village's domain reaches inboxes. The platform asks Resend for the exact records and plants them, or shows them one at a time to plant by hand.",
    undo: "Remove the records and mail from this domain stops arriving, without any error.",
    cost: "Free.",
    dependsOn: ["resend-setup-key"],
    launchRequirement: "email-domain",
    liveCheck: {
      via: "launch-check",
      // Comms Settings' own check (server/lib/comms/setup.ts): Resend's answer
      // about the domain when the key may ask, a founder's tick when it may not.
      checkKey: "comms:domain",
      strength: "confirmed",
      proves: "Resend reports the domain as verified, or a founder confirmed it does where the key cannot ask.",
    },
    nursery: {
      how: "Plant the records on a subdomain first, such as mail.<domain>, so a mistake never touches the main domain's mail.",
    },
    compost: ["Remove the domain at resend.com/domains.", "Remove its records at the DNS host."],
    rotation: { never: "DNS records stay put. The key that sends through them rotates." },
    holder: { who: "account-owner", account: "the account at the DNS host that holds the domain" },
    certainty: "unverified",
    open: [
      "The exact record names and types. Resend generates them per domain, so the game shows what Resend shows.",
      "A sending-only key cannot read the domain's status, so with one the check is a founder's confirmation in Comms Settings. A key with full access reads it from Resend.",
      "The full list of domain status values. Resend links them from a separate page; only not_started appears in the examples read.",
      "Verification is asynchronous and Resend reports the result by webhook; polling GET /domains/{id} is assumed to show the same status.",
    ],
    source:
      RESEND_API + ": POST /domains/{domain_id}/verify starts an asynchronous check and marks the domain pending; GET /domains/{domain_id} returns status and a records array with a status per record. " +
      "goLivePlan.ts step 7: Resend answers HTTP 200 for an unverified domain and delivers nothing.",
  },
  {
    id: "resend-api-key",
    kind: "minted",
    title: "A send-only Resend key, for this domain only",
    provider: { name: "Resend", url: "https://resend.com/api-keys" },
    scopes: ["permission: sending_access", "domain_id: the village's verified sending domain"],
    handles: [
      { store: "village-secret", slot: "resend_api_key" },
      { store: "env", name: "RESEND_API_KEY" },
    ],
    need: "recommended",
    risk: "keystone",
    lifespan: "lasting",
    consequence:
      "The village sends email in its own name: claim links, welcomes, receipts, digests. The key can only send, and only from the village's own domain.",
    undo: "Delete the key in Resend and clear it under Integrations. Email stops at once and nothing else breaks.",
    cost: "Free within Resend's free tier.",
    dependsOn: ["resend-setup-key", "resend-sending-domain", "village-secrets-key"],
    launchRequirement: "resend-key",
    liveCheck: {
      via: "probe",
      probe: "comms-test-delivered",
      how:
        "Send me a test, in Comms Settings, posts a comms.test email to the signed-in admin's own address through the post office and onto the ledger. Alive means the latest comms.test row is reported delivered: item 13 of the comms setup checklist (testEmailDelivered). The launch row resend-key reads the same answer (server/lib/comms/keyHealth.ts).",
      strength: "alive",
      proves: "The key authenticates, may send, and may send from this domain and this sender.",
      builtAt: "server/lib/comms/setup.ts",
    },
    nursery: {
      how: "Send only to Resend's test recipient delivered@resend.dev, which simulates a delivery and reaches no person.",
    },
    compost: [
      "Delete the key at resend.com/api-keys. A send-only key cannot delete itself, so this is a founder's step.",
      "Clear the Resend slot under Admin, Integrations.",
      "Delete RESEND_API_KEY from Railway if it was set there.",
    ],
    rotation: { every: "year" },
    holder: { who: "account-owner", account: "the Resend account's role address" },
    certainty: "verified",
    source:
      RESEND_API + ": POST /api-keys with permission sending_access and domain_id restricts a key to sending from one domain, and returns its id and token. " +
      "Test recipients: Resend's send-test-emails page. Slot: server/lib/secrets.ts. Live check: the post office's own test email (POST /api/admin/comms/settings/test, origin comms.test), read by testEmailDelivered in server/lib/comms/setup.ts (Rye, 2026-10-13: reuse it).",
  },
  {
    id: "resend-webhook-secret",
    kind: "hand-carried",
    title: "Let Resend tell the village what became of each email",
    provider: { name: "Resend", url: "https://resend.com/webhooks" },
    scopes: ["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained"],
    handles: [
      { store: "village-secret", slot: "resend_webhook_secret" },
      { store: "env", name: "RESEND_WEBHOOK_SECRET" },
    ],
    need: "recommended",
    risk: "ordinary",
    lifespan: "lasting",
    consequence:
      "Resend calls /api/comms/webhooks/resend when an email is delivered, bounces or is marked as spam, so a dead address stops being written to and Sent mail says what became of each email.",
    undo: "Delete the webhook in Resend and clear the secret in Comms Settings. Email still goes out; the village just stops hearing what became of it.",
    cost: "Free.",
    dependsOn: ["resend-api-key", "frontend-url"],
    launchRequirement: "email-delivery-reports",
    liveCheck: {
      via: "launch-check",
      checkKey: "comms:delivery-reports",
      strength: "present",
      proves: "A signing secret is set. Comms Settings says when a signed report last arrived, which is what proves it.",
    },
    nursery: { how: "Connect it while the module is in rehearsal: reports for the test sends arrive before anyone else is written to." },
    compost: [
      "Delete the webhook at resend.com/webhooks.",
      "Clear the delivery reports secret in Comms Settings.",
      "Delete RESEND_WEBHOOK_SECRET from Railway if it was set there.",
    ],
    rotation: { every: "year" },
    holder: { who: "account-owner", account: "the Resend account's role address" },
    certainty: "verified",
    source:
      "server/routes/commsWebhook.ts (the endpoint, Svix-signed), server/lib/comms/resendAdmin.ts DELIVERY_REPORT_EVENTS, " +
      "server/lib/comms/setup.ts the delivery reports item. Slot: server/lib/secrets.ts. Launch row: email-delivery-reports.",
  },
  {
    id: "email-from",
    kind: "hosting-var",
    title: "The address mail comes from",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "EMAIL_FROM" }],
    need: "recommended",
    risk: "keystone",
    lifespan: "lasting",
    plantedThrough: "railway-root",
    byHand: { how: RAILWAY_BY_HAND + " Admin, Email config can also hold the sender, and it wins over EMAIL_FROM." },
    consequence: "Every email the village sends shows this sender.",
    undo: "Clear it and no sender is configured, so email stops until one is set.",
    cost: "Free.",
    dependsOn: ["resend-sending-domain"],
    liveCheck: {
      via: "probe",
      probe: "comms-test-delivered",
      how: "The same test email as the key. Resend refuses a sender outside the key's domain, so a delivered test proves the sender too.",
      strength: "alive",
      proves: "The sender sits on the verified domain.",
      builtAt: "server/lib/comms/setup.ts",
    },
    nursery: { how: "A sender on the staging subdomain." },
    compost: ["Delete EMAIL_FROM from Railway."],
    rotation: { never: "It is an address, and changes only when the village wants a new sender." },
    holder: { who: "any-founder" },
    certainty: "verified",
    source: "server/index.ts resolvedEmailSender: Admin email config, then EMAIL_FROM, and no fallback beyond them. goLivePlan.ts step 7.",
  },

  // ── Canopy: sign-in ─────────────────────────────────────────────────────────
  {
    id: "google-oauth-client",
    kind: "hand-carried",
    title: "Sign in with Google",
    provider: { name: "Google Cloud", url: "https://console.cloud.google.com/apis/credentials" },
    scopes: ["openid", "email", "profile"],
    handles: [
      { store: "env", name: "GOOGLE_CLIENT_ID" },
      { store: "env", name: "GOOGLE_CLIENT_SECRET" },
    ],
    need: "optional",
    risk: "keystone",
    lifespan: "lasting",
    plantedThrough: "railway-root",
    byHand: { how: RAILWAY_BY_HAND + " Both variables, together." },
    consequence:
      "Members can sign in with their Google account. Google tells the village their name and email address and nothing else.",
    undo: "Delete the OAuth client in Google Cloud and clear both variables. Email and password sign-in keep working.",
    cost: "Free.",
    dependsOn: ["frontend-url"],
    liveCheck: {
      via: "probe",
      probe: "google-sign-in",
      how: "A founder signs in once with Google. Alive means the callback returns them signed in.",
      strength: "alive",
      proves: "The client, the secret and the callback address all agree.",
    },
    nursery: { how: "Keep the OAuth consent screen in testing, with only the founders listed as test users." },
    compost: [
      "Delete the OAuth client in Google Cloud, Credentials.",
      "Delete GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from Railway.",
    ],
    rotation: { every: "year" },
    holder: { who: "account-owner", account: "the Google Cloud project owner" },
    certainty: "verified",
    source: "server/lib/oauthGoogle.ts requests scope openid email profile; docs/GOOGLE_SIGN_IN.md.",
  },
  {
    id: "founder-emails",
    kind: "hosting-var",
    title: "Founders keep their role through Google",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "FOUNDER_EMAILS" }],
    need: "optional",
    risk: "keystone",
    lifespan: "lasting",
    plantedThrough: "railway-root",
    byHand: { how: RAILWAY_BY_HAND },
    consequence: "A Google sign-in from a listed, verified address gives that existing account the founder role back.",
    undo: "Remove an address from the list and that account keeps whatever role it holds today.",
    cost: "Free.",
    dependsOn: ["google-oauth-client"],
    liveCheck: {
      via: "probe",
      probe: "google-sign-in",
      how: "A listed founder signs in with Google and lands with the founder role.",
      strength: "alive",
      proves: "The list matches the founder's Google address.",
    },
    nursery: null,
    compost: ["Delete FOUNDER_EMAILS from Railway."],
    rotation: { never: "It changes when the founders change." },
    holder: { who: "any-founder" },
    certainty: "verified",
    source: "goLivePlan.ts step 8 and GO_LIVE_ENV.",
  },

  // ── The AI guide ────────────────────────────────────────────────────────────
  {
    id: "anthropic-api-key",
    kind: "hand-carried",
    title: "The AI guide's own key",
    provider: { name: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
    scopes: [],
    handles: [
      { store: "village-secret", slot: "assistant_api_key" },
      { store: "env", name: "ANTHROPIC_API_KEY" },
    ],
    need: "optional",
    risk: "keystone",
    lifespan: "lasting",
    consequence: "The village's guide answers on the village's own account, and the village pays for what it uses.",
    undo: "Delete the key in Anthropic's console and clear it under Integrations. The guide hides and every form keeps working.",
    cost: "Anthropic's own usage pricing. Set a monthly spend limit in the console before planting.",
    dependsOn: ["village-secrets-key"],
    launchRequirement: "assistant-key",
    liveCheck: {
      via: "launch-check",
      checkKey: "assistant-key",
      strength: "present",
      proves: "A key is set. One answer from the guide is what proves it works.",
    },
    nursery: null,
    compost: [
      "Delete the key in Anthropic's console.",
      "Clear the Anthropic slot under Admin, Integrations.",
      "Delete ANTHROPIC_API_KEY from Railway if it was set there.",
    ],
    rotation: { every: "year" },
    holder: { who: "account-owner", account: "the Anthropic organisation owner" },
    certainty: "unverified",
    open: [
      "Anthropic keys carry no narrower permission; a workspace with its own spend limit is the nearest boundary. Confirm before promising it.",
      "The exact console page for keys.",
    ],
    source: "server/lib/secrets.ts assistant_api_key; shared/launchRequirements.ts assistant-key.",
  },

  // ── Money: card payments through Stripe ─────────────────────────────────────
  {
    id: "stripe-secret-key",
    kind: "hand-carried",
    title: "Take card payments",
    provider: { name: "Stripe", url: "https://dashboard.stripe.com/apikeys" },
    scopes: [],
    handles: [
      { store: "village-secret", slot: "stripe_secret_key" },
      { store: "env", name: "STRIPE_SECRET_KEY" },
    ],
    need: "required",
    risk: "keystone",
    lifespan: "lasting",
    consequence: "Members can pay the village by card. Money lands in the village's own Stripe account, never in a shared pool.",
    undo: "Roll or delete the key in Stripe and clear it under Integrations. Card checkout answers an honest 503 and manual payment still works.",
    cost: "Stripe's own per-transaction fee. This repository records no figure.",
    dependsOn: ["village-secrets-key"],
    launchRequirement: "stripe-keys",
    liveCheck: {
      via: "launch-check",
      checkKey: "stripe-keys",
      strength: "present",
      proves: "A key is set. A test checkout is what proves it works.",
    },
    nursery: { how: "A Stripe test-mode key and a test checkout before the live key is planted." },
    compost: [
      "Roll or delete the key at dashboard.stripe.com/apikeys.",
      "Clear the Stripe slot under Admin, Integrations.",
      "Delete STRIPE_SECRET_KEY from Railway if it was set there.",
    ],
    rotation: { every: "year" },
    holder: { who: "account-owner", account: "the Stripe account holder, who verified their own identity with Stripe" },
    certainty: "unverified",
    open: [
      "Whether the platform works with a Stripe restricted key, and which permissions it needs. Until confirmed, the seed asks for a standard secret key.",
      "Whether the platform accepts a test-mode key end to end.",
    ],
    source: "server/lib/payments.ts; goLivePlan.ts step 10; shared/launchRequirements.ts stripe-keys.",
  },
  {
    id: "stripe-webhook",
    kind: "hand-carried",
    title: "Let Stripe tell the village a payment settled",
    provider: { name: "Stripe", url: "https://dashboard.stripe.com/webhooks" },
    scopes: [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "invoice.paid",
      "charge.refunded",
      "charge.dispute.created",
    ],
    handles: [
      { store: "village-secret", slot: "stripe_webhook_secret" },
      { store: "env", name: "STRIPE_WEBHOOK_SECRET" },
    ],
    need: "required",
    risk: "keystone",
    lifespan: "lasting",
    consequence:
      "Stripe calls /api/webhooks/stripe when a payment settles, refunds or is disputed, and members receive what they paid for.",
    undo: "Delete the endpoint in Stripe and clear the secret. Cards would still charge and nothing would credit, so turn card checkout off first.",
    cost: "Free.",
    dependsOn: ["stripe-secret-key", "frontend-url"],
    launchRequirement: "stripe-webhook",
    liveCheck: {
      via: "launch-check",
      checkKey: "stripe-webhook",
      strength: "present",
      proves: "A signing secret is set. A test event from Stripe arriving signed is what proves it.",
    },
    nursery: { how: "A test-mode endpoint, then a test event sent from Stripe's dashboard." },
    compost: [
      "Delete the endpoint at dashboard.stripe.com/webhooks.",
      "Clear the webhook slot under Admin, Integrations.",
      "Delete STRIPE_WEBHOOK_SECRET from Railway if it was set there.",
    ],
    rotation: { every: "year" },
    holder: { who: "account-owner", account: "the Stripe account holder" },
    certainty: "verified",
    source: "goLivePlan.ts step 10 names the endpoint and all five events; server/index.ts /api/webhooks/stripe.",
  },

  // ── Vines: the governance crossings ─────────────────────────────────────────
  {
    id: "governance-hub-secret",
    kind: "hand-carried",
    title: "Hear back from the governance hub",
    provider: { name: "The governance hub this fork registers with", url: null },
    scopes: [],
    handles: [{ store: "village-secret", slot: "governance_hub_secret" }],
    need: "optional",
    onlyWhen: {
      setting: "governance.hub_url",
      why: "The secret signs traffic to and from the hub, so a village that names no hub has nothing to sign.",
    },
    risk: "ordinary",
    lifespan: "lasting",
    consequence: "A Hypha vote's executed outcome comes home to the village signed. Until it is set, outcomes are reported by hand.",
    undo: "Clear it and outcomes go back to being reported by the proposer and applied by an admin.",
    cost: "Free.",
    dependsOn: ["village-secrets-key"],
    liveCheck: {
      via: "probe",
      probe: "secret-present",
      how: "The Hypha status route reports hubSecretConfigured.",
      strength: "present",
      proves: "A secret is set. One signed delivery from the hub is what proves it.",
    },
    nursery: null,
    compost: ["Ask the hub to retire this fork's registration.", "Clear the hub slot under Admin, Integrations."],
    rotation: { every: "year" },
    holder: { who: "any-founder" },
    certainty: "unverified",
    open: ["The hub's address is a game variable, governance.hub_url, so the page differs per fork."],
    source:
      "Platform level, not the hypha module's: its readers are the ungated /api/webhooks/mechanics-governance receiver and proposal linking in server/index.ts, and the mechanics loop ships with or without the hypha module (shared/modules.ts).",
  },
  {
    id: "hypha-voice-webhook-secret",
    kind: "hosting-var",
    title: "Receive voice claims from Hypha",
    provider: { name: "Railway", url: RAILWAY_VARIABLES },
    scopes: [],
    handles: [{ store: "env", name: "HYPHA_VOICE_WEBHOOK_SECRET" }],
    need: "required",
    onlyWhen: {
      setting: "economy.hypha_space",
      why: "The claim receiver only opens once a village names its Hypha space. Before that there is nothing to receive.",
    },
    risk: "ordinary",
    lifespan: "lasting",
    plantedThrough: "railway-root",
    byHand: { how: RAILWAY_BY_HAND + " At least 32 characters, and never a value any other secret uses." },
    consequence: "Signed voice claims from the village's Hypha space are accepted.",
    undo: "Clear it and the claim receiver answers 503.",
    cost: "Free.",
    dependsOn: [],
    liveCheck: {
      via: "probe",
      probe: "env-present",
      how: "The setup game asks the server whether the variable is set and long enough. Boot already refuses a short or borrowed one.",
      strength: "present",
      proves: "A usable secret is set.",
    },
    nursery: null,
    compost: ["Delete HYPHA_VOICE_WEBHOOK_SECRET from Railway and from the sender's side."],
    rotation: { every: "year" },
    holder: { who: "any-founder" },
    certainty: "verified",
    source:
      "server/lib/voiceClaim.ts checkVoiceSecret and the receiver in server/index.ts, both gated on economy.hypha_space. " +
      "ENVIRONMENT ONLY ON PURPOSE: boot refuses to start on a short or borrowed value (assertVoiceSecret). A value typed into the secrets store at runtime would skip that check until the next restart, and then a weak one would stop the village from booting at all.",
  },
  {
    id: "basescan-api-key",
    kind: "hand-carried",
    title: "Look up token contracts on Base",
    provider: { name: "Etherscan", url: "https://etherscan.io/myapikey" },
    scopes: [],
    handles: [{ store: "village-secret", slot: "basescan_api_key" }],
    need: "optional",
    risk: "ordinary",
    lifespan: "lasting",
    consequence: "The Hypha bridge can list the token contracts the founder's account holds on Base.",
    undo: "Clear it. The lookup answers 409 and addresses can still be pasted by hand.",
    cost: "One free key serves Base.",
    dependsOn: ["village-secrets-key"],
    liveCheck: {
      via: "probe",
      probe: "secret-present",
      how: "The integrations status reports the slot as configured. One lookup returning is what proves it.",
      strength: "present",
      proves: "A key is set.",
    },
    nursery: null,
    compost: ["Delete the key at Etherscan.", "Clear the Basescan slot under Admin, Integrations."],
    rotation: { every: "year" },
    holder: { who: "any-founder" },
    certainty: "unverified",
    open: ["The exact Etherscan page for API keys."],
    source: "server/lib/hypha/discovery.ts; server/index.ts integration card.",
  },
  {
    id: "base-rpc-url",
    kind: "hand-carried",
    title: "Read Base through your own endpoint",
    provider: { name: "Alchemy, or any Base provider", url: "https://dashboard.alchemy.com" },
    scopes: [],
    handles: [{ store: "village-secret", slot: "base_rpc_url" }],
    need: "optional",
    risk: "ordinary",
    lifespan: "lasting",
    consequence:
      "Token balances and the Hypha bridge read Base through an endpoint this village pays for. An Alchemy endpoint also lets the bridge list the founder's token contracts with no Basescan key.",
    undo: "Clear it. Reads go back to the free public Base node, which is enough to start.",
    cost: "A free tier serves a small village; a listener needs a paid plan.",
    dependsOn: ["village-secrets-key"],
    liveCheck: {
      via: "probe",
      probe: "secret-present",
      how: "The integrations status reports the slot as configured. A balance read that returns is what proves it.",
      strength: "present",
      proves: "An endpoint is set.",
    },
    nursery: null,
    compost: ["Delete the key at the provider.", "Clear the Base RPC endpoint under Admin, Integrations."],
    rotation: { every: "year" },
    holder: { who: "any-founder" },
    certainty: "unverified",
    open: ["The exact Alchemy page that shows a Base Mainnet endpoint."],
    source:
      "server/lib/secrets.ts (the base_rpc_url slot, and the boot move out of the old tokens.base_rpc_url variable); " +
      "server/lib/base-reads.ts baseRpcUrl; server/index.ts integration card.",
  },

  // ── Module seeds ────────────────────────────────────────────────────────────
  {
    id: "riverside-webhook-secret",
    kind: "hand-carried",
    title: "Receive call recordings",
    provider: { name: "Riverside", url: null },
    scopes: [],
    handles: [{ store: "village-secret", slot: "riverside_webhook_secret" }],
    need: "required",
    risk: "ordinary",
    lifespan: "lasting",
    consequence:
      "Riverside can deliver call recordings to this village. The village chooses the value and Riverside sends it back with each delivery.",
    undo: "Clear it and every delivery is discarded with an inert 200.",
    cost: "Free here. Riverside bills on its own terms.",
    dependsOn: ["village-secrets-key"],
    liveCheck: {
      via: "probe",
      probe: "secret-present",
      how: "The integrations status reports the slot as configured. One real delivery arriving is what proves it.",
      strength: "present",
      proves: "A secret is set.",
    },
    nursery: null,
    compost: ["Remove the webhook in Riverside's settings.", "Clear the Riverside slot under Admin, Integrations."],
    rotation: { every: "year" },
    holder: { who: "account-owner", account: "the Riverside account owner" },
    certainty: "unverified",
    open: ["The exact Riverside page for webhook settings.", "Whether Riverside offers a test delivery."],
    source: "server/index.ts /api/webhooks/riverside and the integration card copy; the route discards deliveries while the automation module is off.",
  },
  {
    id: "saberra-api-secret",
    kind: "hand-carried",
    title: "Connect organisational memory",
    provider: { name: "Saberra", url: "https://saberra.com" },
    scopes: [],
    handles: [
      { store: "village-secret", slot: "sera_api_secret" },
      { store: "module-config", module: "saberra", key: "apiUrl" },
      { store: "module-config", module: "saberra", key: "dashboardUrl" },
    ],
    need: "required",
    risk: "ordinary",
    lifespan: "lasting",
    consequence:
      "The service reads the village's records it is sent and suggests changes to circles and roles. Every suggestion waits for review.",
    undo: "Clear the key under Integrations and the module answers 503. Suggestions already reviewed stay as decided.",
    cost: "Billed by the vendor directly. See the module's own listing.",
    dependsOn: ["village-secrets-key"],
    launchRequirement: "listing-credential-saberra",
    liveCheck: {
      via: "launch-check",
      checkKey: "listing-credential:saberra",
      strength: "present",
      proves: "A key is set. A sync returning is what proves it.",
    },
    nursery: null,
    compost: ["Ask the vendor to revoke the token.", "Clear the slot under Admin, Integrations.", "Clear both addresses on the module's card."],
    rotation: { every: "year" },
    holder: { who: "account-owner", account: "the village's account with the vendor" },
    certainty: "unverified",
    open: ["The vendor page where a token is issued and revoked.", "Whether the vendor offers a test tenant."],
    source: "shared/modules.ts saberra vendor record and defaultConfig.",
  },
];

/** The platform's always-planted layers, whatever modules a village chooses. */
export const PLATFORM_GUILDS: readonly PlatformGuild[] = [
  {
    id: "soil",
    layer: "rhizosphere",
    title: "Hosting, database and domain",
    seeds: [
      "database-url",
      "auth-token-secret",
      "admin-password",
      "village-secrets-key",
      "railway-root",
      "frontend-url",
      "break-glass-email",
      "member-secrets-key",
      "backup-export-token",
      "trusted-proxy-hops",
      "error-webhook-url",
      "dns-root",
      "custom-domain-cname",
    ],
  },
  {
    id: "email",
    layer: "water",
    title: "Email",
    seeds: ["resend-account", "resend-setup-key", "resend-sending-domain", "resend-api-key", "email-from"],
  },
  {
    id: "sign-in",
    layer: "canopy",
    title: "Sign-in",
    seeds: ["google-oauth-client", "founder-emails"],
  },
  {
    id: "guide",
    layer: "mycelium",
    title: "The AI guide",
    seeds: ["anthropic-api-key"],
  },
  {
    id: "crossings",
    layer: "vines",
    title: "The governance crossings",
    seeds: ["governance-hub-secret", "hypha-voice-webhook-secret"],
  },
];

export const SEEDS_BY_ID: Readonly<Record<string, GuildSeed>> = Object.fromEntries(SEEDS.map((s) => [s.id, s]));

/**
 * Every seed whose strongest check cannot make it green: a check of strength
 * `present` or `confirmed`. Under the ruling that a plant is unhealthy until a
 * live check passes, each of these stays unhealthy however it is planted, until
 * somebody builds it a live check. Module intake prints this list.
 */
export function seedsNotYetAlive(seeds: readonly GuildSeed[] = SEEDS): GuildSeed[] {
  return seeds.filter((s) => !isLiveCheck(s.liveCheck));
}

// ── The rules, in one place ─────────────────────────────────────────────────

const HTTPS = /^https:\/\/[^\s]+$/;
const SEED_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LIFESPANS: readonly SeedLifespan[] = ["lasting", "until-launch", "setup"];

/** What `guildProblems` needs from a module. Structural, so this file imports nothing. */
export interface GuildModule {
  id: string;
  guild?: readonly string[];
  vendor?: { secretKeys: readonly string[] };
}

/**
 * Every problem with the catalog and the modules' guilds, as plain sentences.
 * Empty means sound. ONE function owns the rules: module intake
 * (`scripts/validate-module.mjs`) and `shared/guilds.test.ts` both call it,
 * so there is never a second opinion about what a valid guild is.
 *
 * `launchIds` and `launchCheckKeys` come from `shared/launchRequirements.ts`;
 * they are passed in so this file stays free of imports and loads on its own.
 */
export function guildProblems(
  modules: readonly GuildModule[],
  launchIds: readonly string[],
  launchCheckKeys: readonly string[],
  seeds: readonly GuildSeed[] = SEEDS,
  platform: readonly PlatformGuild[] = PLATFORM_GUILDS,
): string[] {
  const out: string[] = [];
  const byId = new Map<string, GuildSeed>();
  const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";

  for (const s of seeds) {
    const at = `seed "${s.id}"`;
    if (!SEED_ID.test(s.id)) out.push(`${at}: id must be lowercase words joined by hyphens`);
    if (byId.has(s.id)) out.push(`${at}: declared twice`);
    byId.set(s.id, s);
    if (blank(s.title)) out.push(`${at}: has no title`);
    if (blank(s.provider?.name)) out.push(`${at}: names no provider`);
    if (s.provider?.url === null) {
      if (s.certainty !== "unverified") out.push(`${at}: has no provider url, so it must be marked unverified`);
    } else if (!HTTPS.test(String(s.provider?.url ?? ""))) {
      out.push(`${at}: provider url must be an exact https page, or null with the seed marked unverified`);
    }
    if (blank(s.consequence)) out.push(`${at}: has no consequence line`);
    if (blank(s.undo)) out.push(`${at}: has no undo line`);
    if (blank(s.cost)) out.push(`${at}: has no cost note`);
    if (!Array.isArray(s.compost) || s.compost.length === 0 || s.compost.some(blank)) {
      out.push(`${at}: has no compost steps`);
    }
    const lc = s.liveCheck;
    if (!lc || blank(lc.proves)) {
      out.push(`${at}: has no live check`);
    } else if (lc.via === "launch-check" && !launchCheckKeys.includes(lc.checkKey)) {
      out.push(`${at}: live check names launch checkKey "${lc.checkKey}", which no launch requirement carries`);
    } else if (lc.via === "probe" && (blank(lc.probe) || blank(lc.how))) {
      out.push(`${at}: a probe live check must name the probe and say how it runs`);
    } else if (lc.via === "driver-health" && blank(lc.module)) {
      out.push(`${at}: a driver-health live check must name its module`);
    }
    if (s.nursery === undefined) out.push(`${at}: must say whether a test mode exists, with { how } or null`);
    else if (s.nursery !== null && blank(s.nursery.how)) out.push(`${at}: nursery says nothing about how`);
    if (!s.rotation || ("never" in s.rotation && blank(s.rotation.never))) {
      out.push(`${at}: must rotate yearly or say why it never does`);
    }
    if (!s.holder) out.push(`${at}: names nobody who must hold it`);
    else if (s.holder.who === "account-owner" && blank(s.holder.account)) out.push(`${at}: names no account owner`);
    if (s.certainty === "unverified" && !(s.open?.length)) out.push(`${at}: is unverified and does not say what is open`);
    if (blank(s.source)) out.push(`${at}: does not say where its claims were read`);
    if (s.launchRequirement !== undefined && !launchIds.includes(s.launchRequirement)) {
      out.push(`${at}: names launch requirement "${s.launchRequirement}", which does not exist`);
    }
    if (s.kind !== "hand-carried" && s.handles.length === 0) {
      out.push(`${at}: plants nothing. Only a hand-carried seed (an account) may have no handle`);
    }
    if (!LIFESPANS.includes(s.lifespan)) out.push(`${at}: must say its lifespan: lasting, until-launch or setup`);
    if (s.lifespan === "setup" && blank(s.consumedBy)) out.push(`${at}: is a setup seed and names no seed it plants`);
    if (s.lifespan !== "setup" && s.consumedBy !== undefined) out.push(`${at}: names consumedBy but is not a setup seed`);
    if (s.onlyWhen && (blank(s.onlyWhen.setting) || blank(s.onlyWhen.why))) {
      out.push(`${at}: a condition must name its setting and say why`);
    }
    // DNS by hand and hosting by hand are first class: anything that lands in
    // the environment or in DNS must say how to plant it with no root at all.
    // A seed with a store slot is planted in the store, and its env variable
    // is only the fallback the store already reads, so it is not counted.
    const landsOutside =
      !s.handles.some((h) => h.store === "village-secret") &&
      s.handles.some((h) => h.store === "env" || h.store === "dns");
    if (landsOutside && blank(s.byHand?.how)) {
      out.push(`${at}: lands in the hosting environment or DNS and does not say how to plant it by hand`);
    }
    if (s.bootstrap && s.plantedThrough) {
      out.push(`${at}: must exist before the setup game runs, so it cannot be planted through a root`);
    }
    if (s.plantedThrough && !s.bootstrap) {
      const wants = s.plantedThrough === "railway-root" ? "env" : "dns";
      if (!s.handles.some((h) => h.store === wants)) {
        out.push(`${at}: is planted through ${s.plantedThrough} but lands nowhere that root can write`);
      }
    }
    if (s.kind === "minted" && !s.dependsOn.some((d) => seeds.some((x) => x.id === d && x.lifespan === "setup"))) {
      out.push(`${at}: is minted and depends on no setup seed to mint it with`);
    }
  }

  for (const s of seeds) {
    for (const d of s.dependsOn) {
      if (!byId.has(d)) out.push(`seed "${s.id}": depends on unknown seed "${d}"`);
      if (d === s.id) out.push(`seed "${s.id}": depends on itself`);
    }
    if (s.lifespan === "setup" && s.consumedBy) {
      const target = byId.get(s.consumedBy);
      if (!target) out.push(`seed "${s.id}": plants unknown seed "${s.consumedBy}"`);
      else if (!target.dependsOn.includes(s.id)) {
        out.push(`seed "${s.id}": plants "${s.consumedBy}", which does not depend on it`);
      }
    }
    if (s.plantedThrough && !byId.has(s.plantedThrough)) {
      out.push(`seed "${s.id}": is planted through "${s.plantedThrough}", which the catalog does not hold`);
    }
    if (s.bootstrap) {
      for (const d of s.dependsOn) {
        if (byId.has(d) && !byId.get(d)!.bootstrap) {
          out.push(`seed "${s.id}": must exist before the setup game runs, and depends on "${d}", which does not`);
        }
      }
    }
  }
  // A cycle would leave the plan with no first seed to plant.
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      out.push(`seeds depend on each other in a circle: ${[...path, id].join(" -> ")}`);
      return;
    }
    state.set(id, 1);
    for (const d of byId.get(id)?.dependsOn ?? []) if (byId.has(d)) visit(d, [...path, id]);
    state.set(id, 2);
  };
  for (const s of seeds) visit(s.id, []);

  const planted = new Set<string>();
  for (const g of platform) {
    for (const id of g.seeds) {
      if (!byId.has(id)) out.push(`platform guild "${g.id}": names unknown seed "${id}"`);
      planted.add(id);
    }
  }

  for (const m of modules) {
    if (!Array.isArray(m.guild)) {
      out.push(`module "${m.id}" declares no guild. A module with nothing to plant says so with guild: []`);
      continue;
    }
    const own = new Set<string>();
    for (const id of m.guild) {
      if (!byId.has(id)) out.push(`module "${m.id}": guild names unknown seed "${id}"`);
      if (own.has(id)) out.push(`module "${m.id}": guild names seed "${id}" twice`);
      own.add(id);
      planted.add(id);
    }
    // Every secret slot a listing contributes is planted by its own guild.
    for (const slot of m.vendor?.secretKeys ?? []) {
      const fills = m.guild.some((id) =>
        byId.get(id)?.handles.some((h) => h.store === "village-secret" && h.slot === slot),
      );
      if (!fills) out.push(`module "${m.id}": secret slot "${slot}" is planted by no seed in its guild`);
    }
    for (const id of m.guild) {
      for (const h of byId.get(id)?.handles ?? []) {
        if (h.store === "module-config" && h.module !== m.id) {
          out.push(`module "${m.id}": seed "${id}" writes another module's config ("${h.module}")`);
        }
      }
    }
  }

  for (const s of seeds) {
    if (!planted.has(s.id)) out.push(`seed "${s.id}": belongs to no guild, so nothing would ever plant it`);
  }
  return out;
}

/**
 * The seeds a village plants for the modules it chose, platform layers first,
 * each one after everything it depends on. Pure, so the setup game, a test and
 * a founder's checklist all read the same order.
 *
 * `settingIsSet` answers a seed's `onlyWhen`. Left out, every conditional seed
 * is included, which is the right answer for a checklist that has not read
 * the village's settings yet.
 */
export function plantingOrder(
  chosen: readonly GuildModule[],
  seeds: readonly GuildSeed[] = SEEDS,
  platform: readonly PlatformGuild[] = PLATFORM_GUILDS,
  settingIsSet: (key: string) => boolean = () => true,
): GuildSeed[] {
  const byId = new Map(seeds.map((s) => [s.id, s]));
  const wanted: string[] = [];
  for (const g of platform) wanted.push(...g.seeds);
  for (const m of chosen) wanted.push(...(m.guild ?? []));
  const done = new Set<string>();
  const order: GuildSeed[] = [];
  const place = (id: string, seen: Set<string>): void => {
    if (done.has(id) || seen.has(id)) return;
    const s = byId.get(id);
    if (!s) return;
    if (s.onlyWhen && !settingIsSet(s.onlyWhen.setting)) return;
    seen.add(id);
    for (const d of s.dependsOn) place(d, seen);
    done.add(id);
    order.push(s);
  };
  for (const id of wanted) place(id, new Set());
  return order;
}
