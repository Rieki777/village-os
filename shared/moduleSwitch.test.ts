import { describe, expect, it } from "vitest";
import {
  AFTER_LAUNCH_ON,
  alsoNeedsLine,
  libraryViewer,
  switchVerdict,
  turnOnChangeSet,
  turnOnPlan,
  turnOnTitle,
  type PlanModule,
} from "./moduleSwitch";

const mod = (id: string, over: Partial<PlanModule> = {}): PlanModule => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  core: false,
  requires: [],
  lifecycle: "off",
  ...over,
});

describe("who sees the library how", () => {
  it("a visitor, a member and a steward before launch", () => {
    expect(libraryViewer({ signedIn: false, admin: false, holder: false, launched: false })).toEqual({
      mode: "visitor", launched: false, canSwitch: false, canPause: false,
    });
    expect(libraryViewer({ signedIn: true, admin: false, holder: false, launched: false }).mode).toBe("member");
    const steward = libraryViewer({ signedIn: true, admin: true, holder: false, launched: false });
    expect(steward).toEqual({ mode: "steward", launched: false, canSwitch: true, canPause: true });
  });

  it("after launch an admin may pause but not turn on, and a holder may do both", () => {
    const admin = libraryViewer({ signedIn: true, admin: true, holder: false, launched: true });
    expect(admin.canSwitch).toBe(false);
    expect(admin.canPause).toBe(true);
    const holder = libraryViewer({ signedIn: true, admin: false, holder: true, launched: true });
    expect(holder).toEqual({ mode: "member", launched: true, canSwitch: true, canPause: true });
  });

  it("holding the key means nothing before launch, where the founders decide", () => {
    expect(libraryViewer({ signedIn: true, admin: false, holder: true, launched: false }).canSwitch).toBe(false);
  });
});

describe("the switch verdict", () => {
  it("before launch an admin may move anything, quietly", () => {
    expect(switchVerdict({ launched: false, admin: true, holder: false, from: "off", to: "public" })).toEqual({
      ok: true, announce: false,
    });
    expect(switchVerdict({ launched: false, admin: false, holder: true, from: "off", to: "preview" }).ok).toBe(false);
  });

  it("after launch an admin who is not the holder is refused a turn on, and pointed at a proposal", () => {
    const v = switchVerdict({ launched: true, admin: true, holder: false, from: "off", to: "preview" });
    expect(v).toEqual({ ok: false, status: 403, error: AFTER_LAUNCH_ON, proposeInstead: true });
    // Widening an already-live module counts too.
    expect(switchVerdict({ launched: true, admin: true, holder: false, from: "members", to: "public" }).ok).toBe(false);
  });

  it("after launch an admin may still pause or turn off, and a live module's change is announced", () => {
    expect(switchVerdict({ launched: true, admin: true, holder: false, from: "public", to: "off" })).toEqual({
      ok: true, announce: true,
    });
    // A preview going off was never visible to members, so there is nothing to announce.
    expect(switchVerdict({ launched: true, admin: true, holder: false, from: "preview", to: "off" })).toEqual({
      ok: true, announce: false,
    });
  });

  it("after launch the holder turns on directly, and a member without the key is refused", () => {
    expect(switchVerdict({ launched: true, admin: false, holder: true, from: "off", to: "members" })).toEqual({
      ok: true, announce: true,
    });
    expect(switchVerdict({ launched: true, admin: false, holder: false, from: "public", to: "off" }).ok).toBe(false);
  });
});

describe("what turning one on takes with it", () => {
  const all = [
    mod("map"),
    mod("resources", { requires: ["map"] }),
    mod("forum", { lifecycle: "members" }),
    mod("feed", { requires: ["forum"] }),
    mod("quests", { core: true, lifecycle: "public" }),
    mod("deep", { requires: ["resources", "quests"] }),
  ];

  it("puts dependencies first, and leaves out what already stands wide enough", () => {
    expect(turnOnPlan(["resources"], "preview", all).map((m) => m.id)).toEqual(["map", "resources"]);
    expect(turnOnPlan(["feed"], "preview", all).map((m) => m.id)).toEqual(["feed"]);
    expect(turnOnPlan(["deep"], "preview", all).map((m) => m.id)).toEqual(["map", "resources", "deep"]);
  });

  it("widens a dependency that stands narrower than the target", () => {
    expect(turnOnPlan(["feed"], "public", all).map((m) => m.id)).toEqual(["forum", "feed"]);
  });

  it("names each module once however many ask for it, and never a core one", () => {
    expect(turnOnPlan(["resources", "map", "deep"], "preview", all).map((m) => m.id)).toEqual(["map", "resources", "deep"]);
    expect(turnOnPlan(["quests"], "public", all)).toEqual([]);
  });

  it("ends on a hand-made cycle", () => {
    const loop = [mod("a", { requires: ["b"] }), mod("b", { requires: ["a"] })];
    expect(turnOnPlan(["a"], "preview", loop).map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("says what else a module needs in a sentence", () => {
    const plan = turnOnPlan(["resources"], "preview", all);
    expect(alsoNeedsLine(all[1], plan)).toBe("Resources also needs Map");
    expect(alsoNeedsLine(all[3], turnOnPlan(["feed"], "preview", all))).toBeNull();
  });

  it("builds one change set and one title for the whole plan", () => {
    const plan = turnOnPlan(["deep"], "members", all);
    expect(turnOnChangeSet(plan, "members")).toEqual([
      { kind: "module_lifecycle", moduleId: "map", to: "members" },
      { kind: "module_lifecycle", moduleId: "resources", to: "members" },
      { kind: "module_lifecycle", moduleId: "deep", to: "members" },
    ]);
    expect(turnOnTitle(plan.map((m) => m.name))).toBe("Turn on Map, Resources and Deep");
  });
});
