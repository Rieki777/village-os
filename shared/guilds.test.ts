import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GO_LIVE_ENV } from "../client/src/components/admin/goLivePlan";
import { SECRET_KEYS } from "../server/lib/secrets";
import {
  PLATFORM_GUILDS,
  SEEDS,
  SEEDS_BY_ID,
  guildProblems,
  plantingOrder,
  type GuildModule,
  type GuildSeed,
} from "./guilds";
import { LAUNCH_REQUIREMENTS } from "./launchRequirements";
import { MODULES } from "./modules";

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
    expect(problems(MODULES, withSeed({ provider: { name: "Resend", url: null } }))).toContain(
      'seed "resend-api-key": has no provider url, so it must be marked unverified',
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
