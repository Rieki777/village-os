import { describe, expect, it } from "vitest";
import {
  PLATFORM_ITEMS, cardItems, checkinsDue, dayOfPath, mayFileCheckin, mayReadCheckins, mayTick, mergePath, openItems, ownerRoleNames, readCheckin, visibleItems,
} from "./onboardingPath";

const village = {
  items: [
    { key: "welcome", title: "Read the welcome pack", owner: "onboarding", dueDay: 3, doneWhen: "Sent" },
    { key: "quest", title: "Take a quest in your circle", owner: "holder", dueDay: 10, doneWhen: "Quest consented" },
  ],
  circles: { "c-hearth": [{ key: "gathering", title: "Join the gathering", owner: "buddy", dueDay: 7, doneWhen: "Added to the rhythm" }] },
  owners: { onboarding: "Welcomers", access: "Keys", memory: " ", bogus: "Nope" },
};

describe("the merged path", () => {
  it("lays platform, village, circle and card in that order", () => {
    const items = mergePath({ village, circleId: "c-hearth", first90: "- Map the grants\n2. Meet each circle lead\n\n" });
    expect(items.map((i) => i.key)).toEqual(["companion", "guide", "access", "quest", "welcome", "gathering", "card-1", "card-2"]);
    expect(items.find((i) => i.key === "quest")).toMatchObject({ source: "village", dueDay: 10 });
    expect(items.find((i) => i.key === "card-1")).toMatchObject({ title: "Map the grants", dueDay: 90, owner: "holder" });
  });
  it("control: with no village data and no card, only the platform items stand", () => {
    expect(mergePath({ village: null, circleId: "c-hearth", first90: null }).map((i) => i.key)).toEqual(PLATFORM_ITEMS.map((i) => i.key));
  });
  it("control: another circle's defaults do not leak in", () => {
    expect(mergePath({ village, circleId: "c-other", first90: null }).some((i) => i.key === "gathering")).toBe(false);
  });
  it("drops items that cannot stand and bad owners fall back to the holder", () => {
    const items = mergePath({ village: { items: [null, { title: "" }, { key: "x", title: "Fine", owner: "king" }] }, circleId: null, first90: null });
    expect(items.find((i) => i.key === "x")?.owner).toBe("holder");
    expect(items).toHaveLength(PLATFORM_ITEMS.length + 1);
  });
  it("reads the owner roles by key, ignoring blanks and unknown keys", () => {
    expect(ownerRoleNames(village)).toEqual({ onboarding: "Welcomers", access: "Keys" });
  });
  it("caps the card's lines", () => {
    expect(cardItems(Array.from({ length: 30 }, (_, i) => `Line ${i}`).join("\n"))).toHaveLength(12);
  });
});

describe("the companion item", () => {
  const items = PLATFORM_ITEMS;
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
  it("opens the check-ins on day 30, 60 and 90", () => {
    expect(checkinsDue("2026-11-01", "2026-11-29")).toEqual([]);
    expect(checkinsDue("2026-11-01", "2026-11-30")).toEqual([30]);
    expect(checkinsDue("2026-11-01", "2027-01-30")).toEqual([30, 60, 90]);
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

import { readVillageDoc } from "./onboardingPath";

describe("saving the village's document", () => {
  it("keeps good rows and cleans owners", () => {
    const r = readVillageDoc({ items: [{ title: "Hello", owner: "buddy" }], circles: { c1: [{ title: "Gather" }] }, owners: { access: "Keys", bogus: "x" } });
    expect(r).toMatchObject({ ok: true, doc: { owners: { access: "Keys" } } });
  });
  it("control: a row with no title is refused by name, not dropped", () => {
    expect(readVillageDoc({ items: [{ title: "Fine" }, { owner: "buddy" }] })).toEqual({ ok: false, error: "The village list, item 2, needs a title." });
    expect(readVillageDoc("nope").ok).toBe(false);
  });
});
