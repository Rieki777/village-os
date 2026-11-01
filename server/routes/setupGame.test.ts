import { describe, expect, it } from "vitest";
import { PLATFORM_GUILDS, SEEDS_BY_ID } from "../../shared/guilds";
import { MODULES } from "../../shared/modules";
import { seedState, setupGameMap, type HandleReader } from "./setupGame";

/** A store holding one sentinel value, so a leak would be visible in the JSON. */
const SENTINEL = "re_SENTINEL_VALUE_never_leaves_9f3a";
const reader = (planted: Record<string, boolean>, env: Record<string, boolean> = {}): HandleReader => ({
  secret: (slot) =>
    slot in planted
      ? { configured: planted[slot], source: planted[slot] ? "admin" : "none", last4: planted[slot] ? SENTINEL.slice(-4) : null }
      : null,
  env: (name) => !!env[name],
});

describe("the setup game's map", () => {
  it("carries every seed a platform layer or a module's guild names", () => {
    const map = setupGameMap("A village", "before-launch", reader({}), () => "off");
    for (const g of PLATFORM_GUILDS) for (const id of g.seeds) expect(map.seeds[id], id).toBeDefined();
    for (const m of MODULES) for (const id of m.guild ?? []) expect(map.seeds[id], `${m.id}:${id}`).toBeDefined();
    expect(map.layers.map((l) => l.id)).toEqual(PLATFORM_GUILDS.map((g) => g.id));
    expect(map.modules.length).toBe(MODULES.length);
  });

  it("never carries a secret's value, only whether it is planted and its last four", () => {
    const slots: Record<string, boolean> = {};
    for (const s of Object.values(SEEDS_BY_ID)) for (const h of s.handles) if (h.store === "village-secret") slots[h.slot] = true;
    const json = JSON.stringify(setupGameMap("A village", "before-launch", reader(slots), () => "members"));
    expect(json).not.toContain(SENTINEL);
    expect(json).toContain(SENTINEL.slice(-4));
    expect(json).not.toMatch(/"value"\s*:/);
  });

  it("rolls the handles up honestly: all, some, none, or not knowable here", () => {
    const key = SEEDS_BY_ID["resend-api-key"];
    const slot = key.handles.find((h) => h.store === "village-secret");
    expect(slot, "the Resend key lands in a village secret").toBeDefined();
    const name = slot && slot.store === "village-secret" ? slot.slot : "";
    expect(seedState(key, reader({ [name]: true }), "before-launch").planted).toBe("yes");
    expect(seedState(key, reader({ [name]: false }), "before-launch").planted).toBe("no");
    const dnsOnly = Object.values(SEEDS_BY_ID).find((s) => s.handles.length > 0 && s.handles.every((h) => h.store === "dns"));
    if (dnsOnly) expect(seedState(dnsOnly, reader({}), "before-launch").planted).toBe("unknown");
  });

  it("asks one founder before launch and a co-sign after, with a read pause on every keystone", () => {
    const keystone = Object.values(SEEDS_BY_ID).find((s) => s.risk === "keystone");
    const ordinary = Object.values(SEEDS_BY_ID).find((s) => s.risk === "ordinary");
    expect(keystone && ordinary).toBeTruthy();
    if (!keystone || !ordinary) return;
    const before = seedState(keystone, reader({}), "before-launch");
    const after = seedState(keystone, reader({}), "after-launch");
    expect(before.readPause).toBe(true);
    expect(before.approval).toBe("one-founder");
    expect(after.approval).toBe("co-sign-or-cooling-off");
    expect(seedState(ordinary, reader({}), "after-launch").readPause).toBe(false);
  });

  it("says an env variable is set without ever reading what it holds", () => {
    const envSeed = Object.values(SEEDS_BY_ID).find((s) => s.handles.some((h) => h.store === "env"));
    expect(envSeed).toBeDefined();
    if (!envSeed) return;
    const names = envSeed.handles.flatMap((h) => (h.store === "env" ? [h.name] : []));
    const set = seedState(envSeed, reader({}, Object.fromEntries(names.map((n) => [n, true]))), "before-launch");
    expect(set.handles.filter((h) => h.store === "env").every((h) => h.planted === true)).toBe(true);
    expect(set.handles.some((h) => "last4" in h && h.store === "env")).toBe(false);
  });
});
