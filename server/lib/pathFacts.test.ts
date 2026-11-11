import { afterEach, describe, expect, it, vi } from "vitest";

const ownSeatings = vi.fn();
const openExitOf = vi.fn();
const recapEverSent = vi.fn();
const adoptedUnseatedSeats = vi.fn();
vi.mock("../repos/pathFacts", () => ({ ownSeatings: (...a: unknown[]) => ownSeatings(...a), openExitOf: (...a: unknown[]) => openExitOf(...a), recapEverSent: (...a: unknown[]) => recapEverSent(...a) }));
vi.mock("../repos/seatRenewals", () => ({ adoptedUnseatedSeats: (...a: unknown[]) => adoptedUnseatedSeats(...a) }));

import { clearPathFactReaders, milestoneDates, pathFor, providePathFacts, seatingFact, type PathEnv } from "./pathFacts";
import { nextActionOf } from "./nextAction";
import { clockFor } from "../../shared/cycleClock";

const NOW = new Date("2026-11-11T18:00:00Z");
const clock = clockFor("lunar");
const env = (over: Partial<PathEnv> = {}): PathEnv => ({
  pool: {} as never,
  now: NOW,
  timeZone: "America/Costa_Rica",
  clock,
  role: "user",
  founderPowerStands: false,
  member: { trained: false, joining: "unsigned", claims: [], budget: { remaining: 100, total: 100 } },
  commitment: "Love Letter",
  ...over,
});

afterEach(() => {
  clearPathFactReaders();
  vi.clearAllMocks();
});

describe("pathFor", () => {
  it("puts an adopted holder's agreement above the training, and serves it as nextAction too (STATE_MAP C1)", async () => {
    ownSeatings.mockResolvedValue([]);
    openExitOf.mockResolvedValue(null);
    providePathFacts("applications", async () => ({ applications: [{ id: "a1", roles: ["Land Steward"], status: "adopted", steps: [{ step: "membership", href: "/love-letter" }], firstDay: "2026-12-21" }] }));
    const path = await pathFor(env(), "u1");
    expect(path.state).toBe("agreements");
    expect(path.said).toEqual({ step: "Align with the membership letter", after: "Your role as Land Steward starts on 21 December.", whose: "Your move" });
    expect(path.fresh).toBe(true);
    expect(path.today).toBe("2026-11-11");
    expect(path.also.map((a) => a.state)).toContain("training");
    expect(nextActionOf(path)).toEqual({ id: "agreements", label: "Align with the membership letter", href: "/love-letter" });
  });

  it("with no role journey it answers as the old rules did, under the old ids", async () => {
    ownSeatings.mockResolvedValue([]);
    openExitOf.mockResolvedValue(null);
    expect(nextActionOf(await pathFor(env(), "u1"))).toEqual({ id: "training", label: "Finish your community training", href: "/training" });
    const thanks = await pathFor(env({ member: { trained: true, joining: null, claims: [{ status: "approved" }], budget: { remaining: 5, total: 100 } } }), "u1");
    expect(nextActionOf(thanks)).toEqual({ id: "send-gratitude", label: "Thank someone this cycle", href: "/gratitude" });
  });

  it("a seated holder hears about the moon, and only while seated", async () => {
    ownSeatings.mockResolvedValue([{ roleId: "r1", role: "Land Steward", startedAt: new Date("2026-11-10T15:00:00Z"), termEndsAt: null }]);
    openExitOf.mockResolvedValue(null);
    recapEverSent.mockResolvedValue(false);
    adoptedUnseatedSeats.mockResolvedValue(new Set());
    providePathFacts("moon", async () => ({ moon: { today: "2026-11-11", walkthroughDay: "2026-12-04", sendBy: "2026-12-07", recap: "none", returnedNote: false } }));
    const path = await pathFor(env(), "u1");
    expect(path.state).toBe("holder-moon");
    expect(path.fresh).toBe(true);
    expect(path.dates).toEqual({ seated: "2026-11-10", first_recap: "2026-12-07" });
    ownSeatings.mockResolvedValue([]);
    expect((await pathFor(env(), "u1")).state).toBe("training");
  });

  it("a reader that throws costs its own fact and nothing else", async () => {
    ownSeatings.mockRejectedValue(new Error("down"));
    openExitOf.mockResolvedValue("open");
    providePathFacts("onboarding", async () => {
      throw new Error("also down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const path = await pathFor(env(), "u1");
    expect(path.state).toBe("leaving");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("seatingFact", () => {
  it("reads the days in village time and marks a term that ran out", () => {
    const s = seatingFact({ roleId: "r", role: "R", startedAt: new Date("2026-11-11T03:00:00Z"), termEndsAt: new Date("2026-11-10T06:00:00Z") }, { now: NOW, timeZone: "America/Costa_Rica", clock }, false);
    expect(s.startedOn).toBe("2026-11-10");
    expect(s.lapsed).toBe(true);
    expect(s.warningOpen).toBe(false);
    const live = seatingFact({ roleId: "r", role: "R", startedAt: new Date("2026-06-21T12:00:00Z"), termEndsAt: new Date("2026-11-12T06:00:00Z") }, { now: NOW, timeZone: "America/Costa_Rica", clock }, true);
    expect(live).toMatchObject({ lapsed: false, warningOpen: true, renewing: true, termEndsOn: "2026-11-12" });
  });

  it("names only the days the village holds", () => {
    expect(milestoneDates({ seatings: [], applications: [{ id: "a", roles: [], status: "adopted", steps: [], firstDay: "2026-12-21" }], onboarding: null, moon: null } as never)).toEqual({ seated: "2026-12-21" });
  });
});
