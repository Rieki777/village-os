import { describe, expect, it } from "vitest";
import type { SettingsPayload } from "@/components/admin/comms/commsSettingsApi";
import type { LaunchItem, SeedState, SetupGameMap } from "./setupGameApi";
import { layerEstablished, nextYes, orderedLayers, seedLight } from "./journeyModel";

function seed(id: string, over: Partial<SeedState> = {}): SeedState {
  return {
    id,
    title: id,
    kind: "hosting-var",
    provider: "Railway",
    url: null,
    consequence: "",
    undo: "",
    cost: "",
    need: "required",
    keystone: false,
    readPause: false,
    approval: "one-founder",
    lifespan: "lasting",
    bootstrap: false,
    dependsOn: [],
    launchRequirement: null,
    liveStrength: "alive",
    proves: "",
    byHand: null,
    handles: [],
    planted: "unknown",
    ...over,
  };
}

const row = (id: string, state: LaunchItem["state"]): LaunchItem => ({ id, title: id, why: "", severity: "blocking", checkKey: id, fixAt: "/admin?tab=integrations", fixLabel: "Open Integrations", state, detail: "" });

describe("where a seed stands", () => {
  it("is never green for a value that is merely present", () => {
    const present = seed("session", { liveStrength: "present", launchRequirement: "session-secret" });
    expect(seedLight(present, new Map([["session-secret", row("session-secret", "ok")]]), null).light).toBe("planted");
    const plantedOnly = seed("token", { planted: "yes" });
    expect(seedLight(plantedOnly, new Map(), null).light).toBe("planted");
  });

  it("turns green when a live launch check passes, and points at its fix while open", () => {
    const live = seed("db", { launchRequirement: "database" });
    expect(seedLight(live, new Map([["database", row("database", "ok")]]), null).light).toBe("alive");
    const open = seedLight(live, new Map([["database", row("database", "missing")]]), null);
    expect(open.light).toBe("open");
    expect(open.fixAt).toBe("/admin?tab=integrations");
  });

  it("reads the email seeds off the comms checklist, alive only after a delivered test", () => {
    const comms = (done: string[]): SettingsPayload =>
      ({
        checklist: ["api-key", "domain", "sender", "delivery-reports", "postal-address", "test-email"].map((key, i) => ({ key, n: i + 1, label: key, done: done.includes(key), required: true, detail: "" })),
        settings: { domain: "village.example", domainStatus: "pending" },
        sender: { line: "A village <hello@village.example>", source: "admin", name: "A village", address: "hello@village.example" },
        webhook: { lastReportAt: null },
      }) as unknown as SettingsPayload;
    const key = seed("resend-api-key", { kind: "minted" });
    expect(seedLight(key, new Map(), comms([])).light).toBe("open");
    expect(seedLight(key, new Map(), comms(["api-key"])).light).toBe("planted");
    expect(seedLight(key, new Map(), comms(["api-key", "test-email"])).light).toBe("alive");
    expect(seedLight(key, new Map(), comms([])).spring).toBe(true);
  });
});

describe("the forest's order and its next yes", () => {
  const map: SetupGameMap = {
    village: "A village",
    phase: "before-launch",
    layers: [
      { id: "email", layer: "water", title: "Email", seeds: ["mail"] },
      { id: "soil", layer: "rhizosphere", title: "Soil", seeds: ["db", "extra"] },
    ],
    modules: [{ id: "stays", name: "Stays", group: null, setup: "required", lifecycle: "members", core: false, seeds: ["card"] }],
    seeds: {
      mail: seed("mail", { planted: "yes" }),
      db: seed("db", { planted: "yes" }),
      extra: seed("extra", { planted: "no", need: "optional" }),
      card: seed("card", { planted: "no" }),
    },
  };
  const light = (s: SeedState) => seedLight(s, new Map(), null);

  it("draws the soil first and the water after it", () => {
    expect(orderedLayers(map).map((l) => l.layer)).toEqual(["rhizosphere", "water"]);
  });

  it("establishes a layer when nothing it needs is open, ignoring optional seeds", () => {
    expect(layerEstablished(["db", "extra"], map, light)).toBe(true);
  });

  it("offers the first needed open seed, reaching into switched-on guilds", () => {
    expect(nextYes(map, light)?.id).toBe("card");
  });
});
