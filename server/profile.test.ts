/**
 * Tests for who may read which part of a character sheet.
 *
 * These are pure and DB-free on purpose. The privacy decision is a function of
 * a stored blob and nothing else, and a rule that can be proven without a
 * database is a rule that gets run on every commit.
 */
import { describe, expect, it } from "vitest";
import {
  moonsSince,
  PRIVACY_DEFAULTS,
  publicView,
  resolvePrivacy,
  type ProfileView,
} from "./lib/profile";

const full = (): ProfileView => ({
  handle: "riverwright",
  name: "A Member",
  title: "Water Steward",
  joinedAt: "2026-01-01T00:00:00.000Z",
  moonsOnTheLand: 7,
  primaryCharacterId: "pc-1",
  homeStructureKey: "pond-homes",
  standing: [{ token: "gratitude", name: "Hearts", balance: 42, decimals: 0 }],
  gratitude: { receivedThisSeason: 14, givenThisSeason: 9, lifetime: 108 },
});

describe("profile privacy", () => {
  it("fills a missing flag from the conservative default", () => {
    // The one that matters. Every row written before a flag existed has no
    // value for it, so if absent read as permissive, shipping a new flag would
    // opt in every member who has not touched their settings.
    const p = resolvePrivacy({});
    expect(p).toEqual(PRIVACY_DEFAULTS);
    expect(p.showHome).toBe(false);
    expect(p.showInventory).toBe(false);
    expect(p.showCalendar).toBe(false);
  });

  it("shows what was earned and hides what describes a life", () => {
    // Badges, roles and standing are things a member chose to earn. Where they
    // sleep, what they borrowed and where they will be on Thursday are not.
    expect(PRIVACY_DEFAULTS.showBadges).toBe(true);
    expect(PRIVACY_DEFAULTS.showRoles).toBe(true);
    expect(PRIVACY_DEFAULTS.showHearts).toBe(true);
    expect(PRIVACY_DEFAULTS.showHome).toBe(false);
  });

  it("ignores junk rather than coercing it", () => {
    // "false" is truthy, and 0 is falsy. Coercing either is how a member's
    // stated answer becomes its opposite.
    const p = resolvePrivacy({ showHome: "true", showBadges: 0, showRoles: null });
    expect(p.showHome).toBe(false);
    expect(p.showBadges).toBe(true);
    expect(p.showRoles).toBe(true);
  });

  it("survives a null, a string and an array in the column", () => {
    for (const junk of [null, undefined, "", "not json", 7, []]) {
      expect(resolvePrivacy(junk as unknown)).toEqual(PRIVACY_DEFAULTS);
    }
  });

  it("honours a real answer in both directions", () => {
    const p = resolvePrivacy({ showHome: true, showBadges: false });
    expect(p.showHome).toBe(true);
    expect(p.showBadges).toBe(false);
  });

  // ── What a stranger receives ─────────────────────────────────────────────

  it("keeps home off a stranger's screen by default", () => {
    const out = publicView(full(), PRIVACY_DEFAULTS);
    expect(out.homeStructureKey).toBeUndefined();
    expect(out.name).toBe("A Member");
  });

  it("shows home only when the member said so", () => {
    const out = publicView(full(), { ...PRIVACY_DEFAULTS, showHome: true });
    expect(out.homeStructureKey).toBe("pond-homes");
  });

  it("withholds standing and gratitude together when hearts are private", () => {
    const out = publicView(full(), { ...PRIVACY_DEFAULTS, showHearts: false });
    // Absent, not empty. An empty array reads as "this member has nothing",
    // which is a different and untrue statement about them.
    expect(out.standing).toBeUndefined();
    expect(out.gratitude).toBeUndefined();
  });

  it("builds the public view by adding, never by deleting", () => {
    // A field added to ProfileView later is a field nobody remembered to strip,
    // and deletion-based filtering ships it public. This proves the shape is
    // built from nothing: an unknown extra field on the full view does not
    // reach a stranger.
    const withSecret = { ...full(), inventory: ["a borrowed drill"] } as ProfileView & {
      inventory: string[];
    };
    const out = publicView(withSecret, PRIVACY_DEFAULTS) as unknown as Record<string, unknown>;
    expect(out.inventory).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(
      ["gratitude", "handle", "joinedAt", "moonsOnTheLand", "name", "primaryCharacterId", "standing", "title"].sort(),
    );
  });

  it("never leaks the privacy settings themselves", () => {
    // Which questions somebody answered no to is itself an answer.
    const out = publicView(full(), PRIVACY_DEFAULTS) as unknown as Record<string, unknown>;
    expect(out.privacy).toBeUndefined();
  });

  // ── Moons ────────────────────────────────────────────────────────────────

  it("counts moons on the land, and starts nobody at a negative", () => {
    const now = new Date("2026-08-10T00:00:00Z");
    expect(moonsSince("2026-08-09T00:00:00Z", now)).toBe(0);
    expect(moonsSince("2026-01-01T00:00:00Z", now)).toBeGreaterThan(6);
    // A future join date is a clock problem, never a negative on a profile.
    expect(moonsSince("2027-01-01T00:00:00Z", now)).toBe(0);
    expect(moonsSince(null, now)).toBe(0);
    expect(moonsSince("not a date", now)).toBe(0);
  });
});

describe("profile inventory", () => {
  const inventory = {
    loans: [{ id: "l1", item: "Pressure washer", status: "active" as const, dueOn: "2026-11-07" }],
    stays: [{ id: "s1", place: "Casita Two", status: "requested" as const, arriveOn: null }],
    lots: [{ id: "h1", homeType: "tiny-home", structureKey: "pond-homes", standing: "You have asked for this" }],
  };
  it("keeps it off a stranger's copy by default", () => {
    const out = publicView({ ...full(), inventory }, PRIVACY_DEFAULTS);
    expect(out.inventory).toBeUndefined();
    expect(PRIVACY_DEFAULTS.showInventory).toBe(false);
  });
  it("hands it over once the member turns showInventory on", () => {
    const out = publicView({ ...full(), inventory }, { ...PRIVACY_DEFAULTS, showInventory: true });
    expect(out.inventory).toEqual(inventory);
  });
  it("reads a stored blob without the flag as off, so nobody is opted in by the flag shipping", () => {
    expect(resolvePrivacy({ showHome: true }).showInventory).toBe(false);
    expect(resolvePrivacy({ showInventory: "true" }).showInventory).toBe(false);
  });
});
