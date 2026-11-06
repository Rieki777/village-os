import { describe, expect, it, vi } from "vitest";
import { modulesTurnedOn, tellSwitchHolders } from "./moduleSwitchNotice";

const onStays = [{ kind: "module_lifecycle", moduleId: "stays", to: "members" }];

describe("modulesTurnedOn", () => {
  it("counts only switches to members or everyone", () => {
    expect(
      modulesTurnedOn([
        { kind: "module_lifecycle", moduleId: "stays", to: "members" },
        { kind: "module_lifecycle", moduleId: "forum", to: "public" },
        { kind: "module_lifecycle", moduleId: "tools", to: "preview" },
        { kind: "module_lifecycle", moduleId: "library", to: "off" },
        { key: "gratitude.base_budget", to: "120" },
      ]),
    ).toEqual(["stays", "forum"]);
  });
});

describe("tellSwitchHolders", () => {
  it("tells every holder except the proposer, once each, keyed to the proposal", async () => {
    const notify = vi.fn();
    const sent = await tellSwitchHolders(
      { liveHoldersOf: async () => ["u-holder", "u-proposer"], notify },
      { proposalId: "gmp-1", proposerId: "u-proposer", proposerFirstName: "Wren", changes: onStays },
    );
    expect(sent).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const arg = notify.mock.calls[0]![0];
    expect(arg).toMatchObject({
      userId: "u-holder",
      type: "governance",
      link: "/modules/stays",
      actorUserId: "u-proposer",
      dedupeKey: "module-switch-proposal:gmp-1:u-holder",
    });
    expect(arg.title).toBe("Wren proposed turning on Stays");
  });

  it("says nothing when nobody holds the switch", async () => {
    const notify = vi.fn();
    await tellSwitchHolders(
      { liveHoldersOf: async () => [], notify },
      { proposalId: "gmp-2", proposerId: "u-a", proposerFirstName: "Ida", changes: onStays },
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("says nothing for a proposal that turns nothing on", async () => {
    const notify = vi.fn();
    const liveHoldersOf = vi.fn(async () => ["u-holder"]);
    await tellSwitchHolders(
      { liveHoldersOf, notify },
      { proposalId: "gmp-3", proposerId: "u-a", proposerFirstName: "Ida", changes: [{ key: "gratitude.base_budget", to: "120" }] },
    );
    expect(notify).not.toHaveBeenCalled();
    expect(liveHoldersOf).not.toHaveBeenCalled();
  });

  it("never throws when the holder read fails", async () => {
    const notify = vi.fn();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = await tellSwitchHolders(
      { liveHoldersOf: async () => { throw new Error("db down"); }, notify },
      { proposalId: "gmp-4", proposerId: "u-a", proposerFirstName: "Ida", changes: onStays },
    );
    expect(sent).toBe(0);
    err.mockRestore();
  });
});
