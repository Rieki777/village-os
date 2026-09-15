/**
 * Two things the handover tab now reads from this file, pinned without a
 * server (Rye's walk of the live admin panel, 2026-09-14).
 *
 * 1. `liveHolderCount`, the number behind "Nobody holds Steward Circle yet".
 *    It has to agree with the capability gate, which gives a member a role's
 *    powers only while their term has not lapsed. A raw row count would say a
 *    role is held on the day its only holder's term ran out, which is the one
 *    day the warning matters.
 *
 * 2. The escalation refusal's sentence. It ended "Tick the ones you mean and
 *    send them back", and the only client showed it in an OK/Cancel box. A
 *    refusal body is read by whichever client sent the request, so it states
 *    the fact and names no control.
 */
import { describe, expect, it } from "vitest";
import { decideRoleCapabilities, liveHolderCount } from "./roleGrants";

const NOW = new Date("2026-09-14T12:00:00Z");

describe("liveHolderCount", () => {
  it("is zero for a role nobody holds", () => {
    expect(liveHolderCount([{ roleId: "other", termEndsAt: null }], "steward-circle", NOW)).toBe(0);
    expect(liveHolderCount([], "steward-circle", NOW)).toBe(0);
  });

  it("counts this role's holders and nobody else's", () => {
    const holders = [
      { roleId: "steward-circle", termEndsAt: null },
      { roleId: "steward-circle", termEndsAt: "2026-12-01T00:00:00.000Z" },
      { roleId: "library", termEndsAt: null },
    ];
    expect(liveHolderCount(holders, "steward-circle", NOW)).toBe(2);
  });

  it("does not count a seat whose term has lapsed, exactly as the gate does not", () => {
    const holders = [
      { roleId: "steward-circle", termEndsAt: "2026-07-01T00:00:00.000Z" },
      { roleId: "steward-circle", termEndsAt: new Date("2026-09-01T00:00:00Z") },
    ];
    expect(liveHolderCount(holders, "steward-circle", NOW)).toBe(0);
  });
});

describe("the escalation refusal", () => {
  const ask = () =>
    decideRoleCapabilities({
      role: { id: "steward-circle", capabilities: [] },
      everyRole: [{ id: "steward-circle", capabilities: [] }],
      requested: ["intake.moderate"],
      answered: false,
    });

  it("asks before a role becomes the first to carry a power, and changes nothing", () => {
    const d = ask();
    expect(d.refusal?.status).toBe(409);
    expect(d.refusal?.body.requiresConfirmation).toBe(true);
    expect(d.granted).toEqual([]);
  });

  it("states the fact and names no control a client may not have", () => {
    const error = String(ask().refusal?.body.error);
    expect(error).toContain("first role in the village to carry a power nothing else grants");
    expect(error).toContain("nothing has changed yet");
    expect(error).not.toMatch(/\btick\b/i);
  });
});
