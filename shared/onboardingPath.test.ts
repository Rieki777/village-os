import { describe, expect, it } from "vitest";
import {
  DEFAULT_PHASES, cardItems, checkinDays, checkinsDue, dayOfPath, lastDayOf, mayFileCheckin, mayReadCheckins, mayTick, mergePath, openItems, ownerRoleNames, pathEnabled,
  readCheckin, readVillageDoc, visibleItems,
} from "./onboardingPath";

const village = {
  enabled: true,
  title: "Your first 14 days",
  phases: [
    { name: "Arrive", fromDay: 1, toDay: 3, items: [{ key: "welcome", title: "Read the welcome pack", owner: "onboarding" }] },
    { name: "Set up", fromDay: 4, toDay: 7, items: [{ key: "companion", kind: "companion", title: "Get started with the companion", dueDay: 6 }] },
    { name: "Play", fromDay: 8, toDay: 14, items: [{ key: "week", title: "Your first full week" }] },
  ],
  circles: { "c-hearth": [{ key: "gathering", title: "Join the gathering", owner: "buddy", phase: "set-up" }, { key: "late", title: "A late one" }] },
  owners: { onboarding: "Welcomers", access: "Keys", memory: " ", bogus: "Nope" },
  checkins: [30, 7, 7, 0, "x"],
};

describe("the merged path", () => {
  it("takes the village's phases, then the circle's steps in the phase they name, then the card", () => {
    const items = mergePath({ village, circleId: "c-hearth", first90: "- Map the grants\n2. Meet each circle lead\n\n" });
    expect(items.map((i) => `${i.phase}:${i.key}`)).toEqual([
      "Arrive:welcome", "Set up:companion", "Play:week", "Set up:gathering", "Play:late", "Play:card-1", "Play:card-2",
    ]);
    expect(items.find((i) => i.key === "companion")).toMatchObject({ dueDay: 6, phaseFrom: 4, phaseTo: 7, source: "village" });
    expect(items.find((i) => i.key === "welcome")?.dueDay).toBe(3); // defaults to its phase's last day
    expect(items.find((i) => i.key === "card-1")).toMatchObject({ source: "card", dueDay: 14 });
  });
  it("no quest item exists anywhere in the platform default", () => {
    const keys = mergePath({ village: null, circleId: null, first90: null }).map((i) => i.key + i.kind);
    expect(keys.some((k) => /quest/i.test(k))).toBe(false);
  });
  it("control: with no village phases the neutral default stands, and another circle's steps do not leak in", () => {
    expect(mergePath({ village: null, circleId: "c-hearth", first90: null }).map((i) => i.key)).toEqual(DEFAULT_PHASES[0].items.map((i) => i.key));
    expect(mergePath({ village, circleId: "c-other", first90: null }).some((i) => i.key === "gathering")).toBe(false);
  });
  it("drops steps that cannot stand and bad owners fall back to the holder", () => {
    const items = mergePath({ village: { phases: [{ name: "P", items: [null, { title: "" }, { key: "x", title: "Fine", owner: "king" }] }] }, circleId: null, first90: null });
    expect(items).toHaveLength(1);
    expect(items[0].owner).toBe("holder");
  });
  it("reads owner roles by key, ignoring blanks and unknown keys", () => {
    expect(ownerRoleNames(village)).toEqual({ onboarding: "Welcomers", access: "Keys" });
  });
  it("caps the card's lines and finds the path's last day", () => {
    const where = { phase: "P", phaseFrom: 1, phaseTo: 14 };
    expect(cardItems(Array.from({ length: 30 }, (_, i) => `Line ${i}`).join("\n"), where)).toHaveLength(12);
    expect(lastDayOf(mergePath({ village, circleId: null, first90: null }))).toBe(14);
  });
});

describe("the switch", () => {
  it("is off unless the village says true", () => {
    expect(pathEnabled(null)).toBe(false);
    expect(pathEnabled({})).toBe(false);
    expect(pathEnabled({ enabled: "yes" })).toBe(false);
    expect(pathEnabled(village)).toBe(true); // control
  });
});

describe("the companion item", () => {
  const items = mergePath({ village, circleId: null, first90: null });
  it("is hidden without consent", () => {
    expect(visibleItems(items, false).some((i) => i.kind === "companion")).toBe(false);
  });
  it("control: shown with consent", () => {
    expect(visibleItems(items, true).some((i) => i.kind === "companion")).toBe(true);
  });
});

describe("days and check-ins", () => {
  it("counts day 1 as the day it opened", () => {
    expect(dayOfPath("2026-11-01", "2026-11-01")).toBe(1);
    expect(dayOfPath("2026-11-01", "2026-12-01")).toBe(31);
  });
  it("a village has no check-ins unless it sets days; they are sorted and deduplicated", () => {
    expect(checkinDays({})).toEqual([]);
    expect(checkinDays(village)).toEqual([7, 30]);
  });
  it("a check-in opens on its day", () => {
    expect(checkinsDue("2026-11-01", "2026-11-06", [7, 30])).toEqual([]);
    expect(checkinsDue("2026-11-01", "2026-11-07", [7, 30])).toEqual([7]);
    expect(checkinsDue("2026-11-01", "2026-12-30", [])).toEqual([]);
  });
  it("needs both scores", () => {
    expect(readCheckin({ clarity: 4 }).ok).toBe(false);
    expect(readCheckin({ clarity: 6, overall: 3 }).ok).toBe(false);
    expect(readCheckin({ clarity: 4, overall: 3, oneThing: "More time" })).toMatchObject({ ok: true });
  });
});

describe("who sees a check-in", () => {
  const path = { holderUserId: "u-holder", buddyUserId: "u-buddy" };
  it("the holder, the buddy and the onboarding role", () => {
    expect(mayReadCheckins("u-holder", path, false)).toBe(true);
    expect(mayReadCheckins("u-buddy", path, false)).toBe(true);
    expect(mayReadCheckins("u-ops", path, true)).toBe(true);
  });
  it("control: nobody else, and an empty viewer is nobody", () => {
    expect(mayReadCheckins("u-admin", path, false)).toBe(false);
    expect(mayReadCheckins("", path, true)).toBe(false);
    expect(mayReadCheckins("u-buddy", { holderUserId: "u-holder", buddyUserId: null }, false)).toBe(false);
  });
  it("only the holder files", () => {
    expect(mayFileCheckin("u-holder", path)).toBe(true);
    expect(mayFileCheckin("u-buddy", path)).toBe(false);
  });
});

describe("who ticks a step", () => {
  const path = { holderUserId: "u-holder", buddyUserId: "u-buddy" };
  it("each owner ticks their own", () => {
    expect(mayTick("u-holder", path, "holder", false)).toBe(true);
    expect(mayTick("u-buddy", path, "buddy", false)).toBe(true);
    expect(mayTick("u-keys", path, "access", true)).toBe(true);
  });
  it("control: the holder cannot tick the buddy's or the access role's step, and a role holder cannot tick the holder's", () => {
    expect(mayTick("u-holder", path, "buddy", false)).toBe(false);
    expect(mayTick("u-holder", path, "access", false)).toBe(false);
    expect(mayTick("u-keys", path, "holder", true)).toBe(false);
  });
  it("counts open steps", () => {
    expect(openItems([{ doneAt: null }, { doneAt: "2026-11-02" }])).toBe(1);
  });
});

describe("saving the village's document", () => {
  it("keeps good rows, the switch as given, and cleans owners", () => {
    const r = readVillageDoc(village);
    expect(r).toMatchObject({ ok: true, doc: { enabled: true, title: "Your first 14 days", owners: { access: "Keys" }, checkins: [7, 30] } });
  });
  it("control: a missing switch saves as off", () => {
    expect(readVillageDoc({ phases: [] })).toMatchObject({ ok: true, doc: { enabled: false } });
  });
  it("control: a phase with no name and a step with no title are refused by place, not dropped", () => {
    expect(readVillageDoc({ phases: [{ name: "A", items: [{ title: "Fine" }, { owner: "buddy" }] }] })).toEqual({ ok: false, error: "Phase 1, step 2, needs a title." });
    expect(readVillageDoc({ phases: [{ items: [] }] })).toEqual({ ok: false, error: "Phase 1 needs a name." });
    expect(readVillageDoc("nope").ok).toBe(false);
  });
});
