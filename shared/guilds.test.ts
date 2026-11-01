import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GO_LIVE_ENV } from "../client/src/components/admin/goLivePlan";
import { SECRET_KEYS, envNameFor } from "../server/lib/secrets";
import {
  PLATFORM_GUILDS,
  SEEDS,
  SEEDS_BY_ID,
  guildProblems,
  keystoneRule,
  plantingOrder,
  seedsNotYetAlive,
  type GuildModule,
  type GuildSeed,
} from "./guilds";
import { LAUNCH_REQUIREMENTS } from "./launchRequirements";
import { MODULES } from "./modules";
import { VARIABLES_BY_KEY } from "./gameVariables";

/**
 * The guild catalog is the setup game's only source of seeds and of consent
 * text, so these tests hold it to two things: it is internally sound, and it
 * POINTS at the homes that already hold each value instead of restating them.
 * A secrets-store slot, a Go live variable or a launch row that the catalog
 * cannot see is a requirement the setup game would never plant.
 */

const LAUNCH_IDS = LAUNCH_REQUIREMENTS.map((r) => r.id);
const CHECK_KEYS = LAUNCH_REQUIREMENTS.map((r) => r.checkKey);
const problems = (mods: readonly GuildModule[], seeds: readonly GuildSeed[] = SEEDS) =>
  guildProblems(mods, LAUNCH_IDS, CHECK_KEYS, seeds, PLATFORM_GUILDS);

const handles = (store: string) =>
  SEEDS.flatMap((s) => s.handles.filter((h) => h.store === store)) as Array<Record<string, string>>;

describe("the real catalog", () => {
  it("has no problems against the real registry", () => {
    expect(problems(MODULES)).toEqual([]);
  });

  it("every module declares a guild, even an empty one", () => {
    const missing = MODULES.filter((m) => !Array.isArray(m.guild)).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it("plants every slot the secrets store holds, and names no slot it does not", () => {
    const planted = new Set(handles("village-secret").map((h) => h.slot));
    expect(SECRET_KEYS.filter((k) => !planted.has(k))).toEqual([]);
    expect([...planted].filter((k) => !SECRET_KEYS.includes(k))).toEqual([]);
  });

  it("plants every variable on the Go live table", () => {
    const planted = new Set(handles("env").map((h) => h.name));
    expect(GO_LIVE_ENV.map((v) => v.name).filter((n) => !planted.has(n))).toEqual([]);
  });

  it("names only variables .env.example documents", () => {
    const example = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
    const documented = new Set(Array.from(example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm), (m) => m[1]));
    expect(handles("env").map((h) => h.name).filter((n) => !documented.has(n))).toEqual([]);
  });

  it("states what is open on every unverified seed", () => {
    for (const s of SEEDS.filter((x) => x.certainty === "unverified")) {
      expect(s.open?.length, s.id).toBeGreaterThan(0);
    }
  });
});

describe("the Resend pilot is fully specified", () => {
  const key = SEEDS_BY_ID["resend-api-key"]!;

  it("asks for a sending-only key restricted to the village's domain", () => {
    expect(key.certainty).toBe("verified");
    expect(key.scopes).toEqual(["permission: sending_access", "domain_id: the village's verified sending domain"]);
    expect(key.risk).toBe("keystone");
    expect(key.nursery).not.toBeNull();
    expect(key.liveCheck.strength).toBe("alive");
    expect(key.launchRequirement).toBe("resend-key");
  });

  it("plants in an order where every seed follows what it needs", () => {
    const ids = plantingOrder([]).map((s) => s.id);
    for (const s of plantingOrder([])) {
      for (const d of s.dependsOn) expect(ids.indexOf(d), `${d} before ${s.id}`).toBeLessThan(ids.indexOf(s.id));
    }
    const email = PLATFORM_GUILDS.find((g) => g.id === "email")!.seeds;
    expect(email.every((id) => ids.includes(id))).toBe(true);
    expect(ids.indexOf("resend-account")).toBeLessThan(ids.indexOf("resend-api-key"));
    expect(ids.indexOf("resend-sending-domain")).toBeLessThan(ids.indexOf("email-from"));
  });
});

describe("planting order", () => {
  it("plants only the platform layers and the guilds chosen", () => {
    const none = plantingOrder([]).map((s) => s.id);
    expect(none).not.toContain("stripe-secret-key");
    const stays = plantingOrder([MODULES.find((m) => m.id === "stays")!]).map((s) => s.id);
    expect(stays).toContain("stripe-webhook");
    expect(stays.indexOf("stripe-secret-key")).toBeLessThan(stays.indexOf("stripe-webhook"));
  });

  it("plants a seed two guilds share once", () => {
    const ids = plantingOrder(MODULES.filter((m) => ["stays", "exchange"].includes(m.id))).map((s) => s.id);
    expect(ids.filter((id) => id === "stripe-secret-key")).toHaveLength(1);
  });
});

describe("intake refuses", () => {
  const seed = SEEDS_BY_ID["resend-api-key"]!;
  const withSeed = (over: Partial<GuildSeed>) => [...SEEDS.filter((s) => s.id !== seed.id), { ...seed, ...over }];

  it("a module with no guild", () => {
    expect(problems([{ id: "fixture" }])).toContain(
      'module "fixture" declares no guild. A module with nothing to plant says so with guild: []',
    );
  });

  it("a seed missing its consequence line", () => {
    expect(problems(MODULES, withSeed({ consequence: " " }))).toContain('seed "resend-api-key": has no consequence line');
  });

  it("a seed missing its undo line", () => {
    expect(problems(MODULES, withSeed({ undo: "" }))).toContain('seed "resend-api-key": has no undo line');
  });

  it("a seed with no live check", () => {
    expect(problems(MODULES, withSeed({ liveCheck: undefined as never }))).toContain(
      'seed "resend-api-key": has no live check',
    );
  });

  it("a seed with no compost steps", () => {
    expect(problems(MODULES, withSeed({ compost: [] }))).toContain('seed "resend-api-key": has no compost steps');
  });

  it("a live check naming a launch check that does not exist", () => {
    const out = problems(
      MODULES,
      withSeed({ liveCheck: { via: "launch-check", checkKey: "nope", strength: "present", proves: "x" } }),
    );
    expect(out).toContain('seed "resend-api-key": live check names launch checkKey "nope", which no launch requirement carries');
  });

  it("an unverified seed that does not say what is open", () => {
    expect(problems(MODULES, withSeed({ certainty: "unverified", open: [] }))).toContain(
      'seed "resend-api-key": is unverified and does not say what is open',
    );
  });

  it("a guess presented as a page", () => {
    const verified = { ...SEEDS_BY_ID["stripe-webhook"]!, provider: { name: "Stripe", url: null } };
    expect(problems(MODULES, [...SEEDS.filter((x) => x.id !== verified.id), verified])).toContain(
      'seed "stripe-webhook": has no provider url, so it must be marked unverified',
    );
  });

  it("a guild naming a seed the catalog does not hold", () => {
    expect(problems([{ id: "fixture", guild: ["made-up"] }])).toContain('module "fixture": guild names unknown seed "made-up"');
  });

  it("a listing whose secret slot no seed in its guild plants", () => {
    expect(problems([{ id: "fixture", guild: [], vendor: { secretKeys: ["fixture_key"] } }])).toContain(
      'module "fixture": secret slot "fixture_key" is planted by no seed in its guild',
    );
  });

  it("seeds that depend on each other in a circle", () => {
    const a = { ...seed, id: "loop-a", dependsOn: ["loop-b"] };
    const b = { ...seed, id: "loop-b", dependsOn: ["loop-a"] };
    const out = problems([{ id: "fixture", guild: ["loop-a", "loop-b"] }], [...SEEDS, a, b]);
    expect(out.some((p) => p.startsWith("seeds depend on each other in a circle"))).toBe(true);
  });

  it("a seed no guild plants", () => {
    const stray = { ...seed, id: "stray" };
    expect(problems(MODULES, [...SEEDS, stray])).toContain('seed "stray": belongs to no guild, so nothing would ever plant it');
  });
});

describe("the rulings of 2026-10-13", () => {
  it("Q1: a keystone always pauses, and asks for a co-sign only after launch", () => {
    expect(keystoneRule("keystone", "before-launch")).toEqual({ readPause: true, approval: "one-founder", receiptToOthers: true });
    expect(keystoneRule("keystone", "after-launch")).toEqual({ readPause: true, approval: "co-sign-or-cooling-off", receiptToOthers: true });
    expect(keystoneRule("ordinary", "after-launch")).toEqual({ readPause: false, approval: "one-founder", receiptToOthers: false });
  });

  it("Q2: both master roots live in the one root cellar, with no environment fallback", () => {
    for (const [id, slot] of [["railway-root", "railway_project_token"], ["dns-root", "dns_zone_token"]] as const) {
      const seed = SEEDS_BY_ID[id]!;
      expect(seed.handles).toEqual([{ store: "village-secret", slot }]);
      expect(SECRET_KEYS).toContain(slot);
      expect(envNameFor(slot)).toBeNull();
      expect(seed.certainty).toBe("unverified");
    }
    expect(SEEDS_BY_ID["dns-root"]!.lifespan).toBe("until-launch");
    expect(SEEDS_BY_ID["railway-root"]!.lifespan).toBe("lasting");
    expect(SEEDS_BY_ID["railway-root"]!.risk).toBe("keystone");
  });

  it("Q2: Resend plants from one setup key that composts itself into a send-only key", () => {
    const setup = SEEDS_BY_ID["resend-setup-key"]!;
    const key = SEEDS_BY_ID["resend-api-key"]!;
    expect(setup.lifespan).toBe("setup");
    expect(setup.consumedBy).toBe("resend-api-key");
    expect(setup.scopes).toEqual(["permission: full_access"]);
    expect(setup.compost.join(" ")).toContain("DELETE https://api.resend.com/api-keys/{id}");
    expect(key.kind).toBe("minted");
    expect(key.dependsOn).toContain("resend-setup-key");
    const ids = plantingOrder([]).map((s) => s.id);
    expect(ids.indexOf("resend-setup-key")).toBeLessThan(ids.indexOf("resend-sending-domain"));
    expect(ids.indexOf("resend-sending-domain")).toBeLessThan(ids.indexOf("resend-api-key"));
  });

  it("Q2: everything that lands in DNS or the environment can be planted by hand", () => {
    const outside = (x: GuildSeed) =>
      !x.handles.some((h) => h.store === "village-secret") && x.handles.some((h) => h.store === "dns" || h.store === "env");
    for (const s of SEEDS.filter(outside)) {
      expect(s.byHand?.how, s.id).toBeTruthy();
    }
    expect(SEEDS_BY_ID["dns-root"]!.need).toBe("optional");
  });

  it("Q2: the seeds the setup game needs before it can run are planted by hand, never through a root", () => {
    const boot = SEEDS.filter((s) => s.bootstrap).map((s) => s.id).sort();
    expect(boot).toEqual(["admin-password", "auth-token-secret", "database-url", "village-secrets-key"]);
    expect(SEEDS_BY_ID["railway-root"]!.dependsOn).toContain("village-secrets-key");
  });

  it("Q3: every seed that cannot yet turn green is listed, and the Resend key is not among them", () => {
    const notAlive = seedsNotYetAlive().map((s) => s.id);
    for (const id of ["auth-token-secret", "village-secrets-key", "stripe-secret-key", "stripe-webhook", "anthropic-api-key"]) {
      expect(notAlive).toContain(id);
    }
    expect(notAlive).not.toContain("resend-api-key");
    const probe = SEEDS_BY_ID["resend-api-key"]!.liveCheck;
    // The post office's own test email, read by item 13's reader (Rye: reuse it).
    expect(probe.via === "probe" && probe.builtAt).toBe("server/lib/comms/setup.ts");
    expect(fs.readFileSync(path.join(__dirname, "..", "server", "lib", "comms", "setup.ts"), "utf8")).toContain("export function testEmailDelivered");
  });

  it("Q4: the governance crossings are platform seeds, and only hypha keeps Basescan", () => {
    const crossings = PLATFORM_GUILDS.find((g) => g.id === "crossings")!.seeds;
    expect(crossings).toEqual(["governance-hub-secret", "hypha-voice-webhook-secret"]);
    // And the Base RPC endpoint since it became a sealed slot: the bridge reads through it.
    expect(MODULES.find((m) => m.id === "hypha")!.guild).toEqual(["basescan-api-key", "base-rpc-url"]);
  });

  it("names only real settings in a condition, and skips a conditional seed whose setting is empty", () => {
    for (const s of SEEDS.filter((x) => x.onlyWhen)) {
      expect(VARIABLES_BY_KEY[s.onlyWhen!.setting], s.id).toBeTruthy();
    }
    const without = plantingOrder([], SEEDS, PLATFORM_GUILDS, () => false).map((s) => s.id);
    expect(without).not.toContain("hypha-voice-webhook-secret");
    expect(without).not.toContain("governance-hub-secret");
    const withSpace = plantingOrder([], SEEDS, PLATFORM_GUILDS, (k) => k === "economy.hypha_space").map((s) => s.id);
    expect(withSpace).toContain("hypha-voice-webhook-secret");
  });
});

describe("intake refuses the new shapes when they are wrong", () => {
  const seed = SEEDS_BY_ID["email-from"]!;
  const withSeed = (over: Partial<GuildSeed>) => [...SEEDS.filter((s) => s.id !== seed.id), { ...seed, ...over }];

  it("a seed landing in the environment with no way to plant it by hand", () => {
    expect(problems(MODULES, withSeed({ byHand: undefined }))).toContain(
      'seed "email-from": lands in the hosting environment or DNS and does not say how to plant it by hand',
    );
  });

  it("a bootstrap seed planted through a root", () => {
    expect(problems(MODULES, withSeed({ bootstrap: true }))).toContain(
      'seed "email-from": must exist before the setup game runs, so it cannot be planted through a root',
    );
  });

  it("a setup seed that plants nothing", () => {
    expect(problems(MODULES, withSeed({ lifespan: "setup", plantedThrough: undefined }))).toContain(
      'seed "email-from": is a setup seed and names no seed it plants',
    );
  });

  it("a minted seed with no setup seed to mint it from", () => {
    const minted = { ...SEEDS_BY_ID["resend-api-key"]!, dependsOn: ["resend-sending-domain"] };
    const out = problems(MODULES, [...SEEDS.filter((s) => s.id !== minted.id), minted]);
    expect(out).toContain('seed "resend-api-key": is minted and depends on no setup seed to mint it with');
  });
});
