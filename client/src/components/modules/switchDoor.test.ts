/**
 * The binding door that replaced the advisory ask. Two promises carried over
 * from the old door: a proposal already running is shown instead of a second
 * one, and nothing is offered on an answer that is not known yet.
 */
import { describe, expect, it } from "vitest";
import { askedModuleId, runningLine, switchDoor, type DoorModule } from "./switchDoor";
import type { LibraryViewer } from "@shared/moduleSwitch";

const mod = (over: Partial<DoorModule> = {}): DoorModule => ({ id: "tools", core: false, on: false, withdrawn: null, ...over });
const v = (over: Partial<LibraryViewer> = {}): LibraryViewer => ({
  mode: "member",
  launched: true,
  canSwitch: false,
  canPause: false,
  ...over,
});
const running = { id: "gmp-1", title: "Turn on Tools", status: "onsite_vote", ballotId: "b-1", closesAt: "2026-10-16T12:00:00Z", to: "members" };

describe("switchDoor", () => {
  it("offers nothing on a core module, one already on, a withdrawn one, or to a visitor", () => {
    expect(switchDoor({ module: mod({ core: true }), viewer: v(), openProposal: undefined }).kind).toBe("quiet");
    expect(switchDoor({ module: mod({ on: true }), viewer: v(), openProposal: undefined })).toEqual({ kind: "quiet", why: "already-on" });
    expect(switchDoor({ module: mod({ withdrawn: { since: "2026-01-01" } }), viewer: v(), openProposal: undefined })).toEqual({
      kind: "quiet",
      why: "withdrawn",
    });
    expect(switchDoor({ module: mod(), viewer: v({ mode: "visitor" }), openProposal: undefined })).toEqual({ kind: "quiet", why: "signed-out" });
  });

  it("before launch, tells a member the founders are choosing", () => {
    expect(switchDoor({ module: mod(), viewer: v({ launched: false }), openProposal: undefined })).toEqual({ kind: "founders-choose" });
  });

  it("before launch, gives a steward the switch", () => {
    expect(switchDoor({ module: mod(), viewer: v({ mode: "steward", launched: false, canSwitch: true }), openProposal: undefined })).toEqual({
      kind: "turn-on",
    });
  });

  it("after launch, shows a running proposal instead of a second one", () => {
    expect(switchDoor({ module: mod(), viewer: v(), openProposal: running })).toEqual({ kind: "running", proposal: running });
  });

  it("after launch, stays quiet while it is still finding out whether one is running", () => {
    expect(switchDoor({ module: mod(), viewer: v(), openProposal: null })).toEqual({ kind: "quiet", why: "loading" });
  });

  it("after launch, opens the proposal when nothing is running", () => {
    expect(switchDoor({ module: mod(), viewer: v(), openProposal: undefined })).toEqual({ kind: "turn-on" });
  });

  it("treats a preview as not on for a member, who cannot see it", () => {
    expect(switchDoor({ module: mod({ lifecycle: "preview" }), viewer: v(), openProposal: undefined }).kind).toBe("turn-on");
  });
});

describe("runningLine", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("names the day a vote closes", () => {
    expect(runningLine(running, now)).toBe("A vote to turn this on closes Friday.");
  });
  it("says a proposal is gathering support before its vote", () => {
    expect(runningLine({ ...running, status: "open", closesAt: null }, now)).toContain("gathering support");
  });
});

describe("askedModuleId", () => {
  it("reads the module an old ask link named", () => {
    expect(askedModuleId("?module=tools")).toBe("tools");
    expect(askedModuleId("?module=%20%20")).toBeNull();
    expect(askedModuleId("")).toBeNull();
  });
});
