/**
 * GOVERNANCE WINDOWS: the arithmetic, the strictest element, and the refusals.
 *
 * Every rule in section 19E and 20.11's windows bullet gets a test here, and
 * every one of them was red before `governanceWindows.ts` existed.
 *
 * No database. The clock, the season and the settings are all injected, so
 * these tests say what the arithmetic does and never what one village happens
 * to have configured.
 */
import { describe, expect, it } from "vitest";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import {
  DEFAULT_CYCLE_WINDOW_DAYS,
  DEFAULT_GRACE_DAYS,
  DEFAULT_SEASON_WINDOW_DAYS,
  SUPERSEDE_RELATIONS,
  WINDOW_KINDS,
  WINDOW_SHAPE_CHOICES,
  cappedVetoHours,
  cycleHoursAt,
  formatWindowShape,
  kindForItemKind,
  kindForSubject,
  nextWindowFor,
  openingRefusal,
  parseWindowShape,
  relationProblem,
  vetoHoursProblem,
  windowFor,
  windowSettingProblem,
  windowShapeProblem,
  windowShapeSyntaxProblem,
  type WindowDeps,
} from "./governanceWindows";

const DAY = 86_400_000;

/** A November instant well inside the checked-in lunar table. */
const AT = new Date("2026-11-10T00:00:00Z");

function deps(over: Partial<WindowDeps> = {}): WindowDeps {
  return {
    clock: LUNAR_CLOCK,
    season: null,
    voteDays: 7,
    graceDays: DEFAULT_GRACE_DAYS,
    shapeOf: () => ({ kind: "always_open" }),
    ...over,
  };
}

/** The window the last-N-days-of-cycle shape draws around `at`. */
function cycleWindow(at: Date, days: number) {
  const b = LUNAR_CLOCK.boundsFor(at);
  return { opensAt: new Date(b.endsAt.getTime() - days * DAY), closesAt: b.endsAt };
}

describe("window shapes", () => {
  it("parses the four shapes and refuses anything else", () => {
    expect(parseWindowShape("always_open")).toEqual({ kind: "always_open" });
    expect(parseWindowShape("last_days_of_cycle:7")).toEqual({ kind: "last_days_of_cycle", days: 7 });
    expect(parseWindowShape("last_days_of_season:14")).toEqual({ kind: "last_days_of_season", days: 14 });
    expect(parseWindowShape("custom:1-3")).toEqual({ kind: "custom", fromDay: 1, toDay: 3 });
    expect(parseWindowShape("last_week")).toBeNull();
    expect(parseWindowShape("last_days_of_cycle:0")).toBeNull();
    expect(parseWindowShape("custom:5-2")).toBeNull();
  });

  it("says each shape in the words a member reads", () => {
    expect(formatWindowShape({ kind: "always_open" })).toContain("any day");
    expect(formatWindowShape({ kind: "last_days_of_cycle", days: 7 })).toContain("last 7 days of every cycle");
    expect(formatWindowShape({ kind: "last_days_of_season", days: 14 })).toContain("last 14 days of every season");
    expect(formatWindowShape({ kind: "custom", fromDay: 1, toDay: 3 })).toContain("day 1");
  });

  it("refuses a shape the registry cannot store, naming the four it can", () => {
    expect(windowShapeSyntaxProblem("always_open")).toBeNull();
    const problem = windowShapeSyntaxProblem("last week of the month");
    expect(problem).toContain("always_open");
    expect(problem).toContain("last_days_of_cycle");
  });

  it("offers the two guided shapes as choices with copy", () => {
    const values = WINDOW_SHAPE_CHOICES.map((c) => c.value);
    expect(values).toContain("always_open");
    expect(values).toContain(`last_days_of_cycle:${DEFAULT_CYCLE_WINDOW_DAYS}`);
    expect(values).toContain(`last_days_of_season:${DEFAULT_SEASON_WINDOW_DAYS}`);
    for (const c of WINDOW_SHAPE_CHOICES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect((c.hint ?? "").length).toBeGreaterThan(10);
    }
  });
});

describe("the settings", () => {
  it("gives every windowed kind a Governance setting that ships always open", () => {
    for (const kind of Object.values(WINDOW_KINDS)) {
      const def = VARIABLES_BY_KEY[kind.key];
      expect(def, `${kind.key} is missing from the registry`).toBeTruthy();
      expect(def.category).toBe("Governance");
      expect(def.default).toBe("always_open");
    }
    expect(VARIABLES_BY_KEY["governance.window_grace_days"].default).toBe(String(DEFAULT_GRACE_DAYS));
  });

  it("routes a subject and a change-set element to their own kind", () => {
    expect(kindForSubject("mechanics")).toBe("changeset");
    expect(kindForSubject("mint_rule")).toBe("mint_rule");
    expect(kindForSubject("role_seat")).toBe("role_seat");
    // The Birthing and an advisory vote are never windowed. Absence is the
    // safe direction, the same way `ballotSubjects` treats a subject it has
    // never heard of.
    expect(kindForSubject("village_launch")).toBeNull();
    expect(kindForSubject("advisory")).toBeNull();
    expect(kindForItemKind("mode_switch")).toBe("governance_mode");
    expect(kindForItemKind("brand_field")).toBe("changeset");
  });
});

describe("nextWindowFor", () => {
  it("is open on any day when the shape is always open", () => {
    const v = nextWindowFor("role_seat", AT, deps());
    expect(v.open).toBe(true);
    expect(v.closesAt).toBeNull();
  });

  it("opens the last seven days of the cycle under the active clock", () => {
    const shape = { kind: "last_days_of_cycle", days: 7 } as const;
    const span = cycleWindow(AT, 7);
    const inside = new Date(span.opensAt.getTime() + DAY);
    const before = new Date(span.opensAt.getTime() - 2 * DAY);
    const open = nextWindowFor("role_seat", inside, deps({ shapeOf: () => shape }));
    expect(open.open).toBe(true);
    expect(open.opensAt?.toISOString()).toBe(span.opensAt.toISOString());
    expect(open.closesAt?.toISOString()).toBe(span.closesAt.toISOString());
    const shut = nextWindowFor("role_seat", before, deps({ shapeOf: () => shape }));
    expect(shut.open).toBe(false);
    expect(shut.opensAt?.toISOString()).toBe(span.opensAt.toISOString());
  });

  it("rolls to the next cycle once a custom window has passed", () => {
    const shape = { kind: "custom", fromDay: 1, toDay: 3 } as const;
    const b = LUNAR_CLOCK.boundsFor(AT);
    const after = new Date(b.startsAt.getTime() + 10 * DAY);
    const v = nextWindowFor("role_seat", after, deps({ shapeOf: () => shape }));
    expect(v.open).toBe(false);
    expect(v.opensAt!.getTime()).toBeGreaterThanOrEqual(b.endsAt.getTime());
  });

  it("says no season is defined when the season shape has nothing to measure", () => {
    const shape = { kind: "last_days_of_season", days: 14 } as const;
    const v = nextWindowFor("role_seat", AT, deps({ shapeOf: () => shape, season: null }));
    expect(v.open).toBe(false);
    expect(v.problem).toContain("no season is defined");
    expect(v.problem).toContain("ask an operator");
  });

  it("draws the season window off the season's own end", () => {
    const endsAt = new Date(AT.getTime() + 5 * DAY);
    const shape = { kind: "last_days_of_season", days: 14 } as const;
    const v = nextWindowFor(
      "role_seat",
      AT,
      deps({ shapeOf: () => shape, season: { currentId: "rooting", endsAt, configuredCount: 1 } }),
    );
    expect(v.open).toBe(true);
    expect(v.closesAt?.toISOString()).toBe(endsAt.toISOString());
    expect(v.opensAt?.toISOString()).toBe(new Date(endsAt.getTime() - 14 * DAY).toISOString());
  });
});

describe("windowFor: evaluated per element, the strictest applies", () => {
  it("lets the narrowest element decide, and names it", () => {
    const shapeOf = (key: string) =>
      key === WINDOW_KINDS.governance_mode.key
        ? ({ kind: "last_days_of_cycle", days: 7 } as const)
        : ({ kind: "always_open" } as const);
    const before = new Date(cycleWindow(AT, 7).opensAt.getTime() - 2 * DAY);
    const v = windowFor(["brand_field", "mode_switch"], before, deps({ shapeOf }));
    expect(v.open).toBe(false);
    expect(v.narrowedBy).toBe(WINDOW_KINDS.governance_mode.key);
    expect(v.label).toBe(WINDOW_KINDS.governance_mode.label);
  });

  it("takes the earliest close when two elements are both open", () => {
    const shapeOf = (key: string) =>
      key === WINDOW_KINDS.governance_mode.key
        ? ({ kind: "custom", fromDay: 1, toDay: 3 } as const)
        : ({ kind: "last_days_of_cycle", days: 29 } as const);
    const b = LUNAR_CLOCK.boundsFor(AT);
    const inside = new Date(b.startsAt.getTime() + DAY);
    const v = windowFor(["brand_field", "mode_switch"], inside, deps({ shapeOf }));
    expect(v.open).toBe(true);
    expect(v.closesAt?.toISOString()).toBe(new Date(b.startsAt.getTime() + 3 * DAY).toISOString());
    expect(v.narrowedBy).toBe(WINDOW_KINDS.governance_mode.key);
  });
});

describe("the refusals", () => {
  const shape = { kind: "last_days_of_cycle", days: 14 } as const;

  it("names the element that narrowed the window and when it next opens", () => {
    const span = cycleWindow(AT, 14);
    const before = new Date(span.opensAt.getTime() - 3 * DAY);
    const refusal = openingRefusal(
      { subjectType: "mechanics", elements: ["brand_field", "mode_switch"], durationDays: 7, at: before },
      deps({
        shapeOf: (key) =>
          key === WINDOW_KINDS.governance_mode.key ? shape : ({ kind: "always_open" } as const),
      }),
    );
    expect(refusal).toContain("how votes are counted");
    expect(refusal).toContain(span.opensAt.toISOString().slice(0, 10));
    expect(refusal).toContain("tray");
  });

  it("refuses an opening whose vote would close after the window shuts", () => {
    const span = cycleWindow(AT, 14);
    const late = new Date(span.closesAt.getTime() - 2 * DAY);
    const refusal = openingRefusal(
      { subjectType: "role_seat", durationDays: 7, at: late },
      deps({ shapeOf: () => shape }),
    );
    expect(refusal).toContain(new Date(late.getTime() + 7 * DAY).toISOString().slice(0, 10));
    expect(refusal).toContain(span.closesAt.toISOString().slice(0, 10));
  });

  it("lets an opening through when the vote closes inside the window", () => {
    const span = cycleWindow(AT, 14);
    const early = new Date(span.opensAt.getTime() + 60_000);
    expect(
      openingRefusal({ subjectType: "role_seat", durationDays: 7, at: early }, deps({ shapeOf: () => shape })),
    ).toBeNull();
  });

  it("never gates a subject with no window setting", () => {
    expect(
      openingRefusal({ subjectType: "village_launch", durationDays: 7, at: AT }, deps({ shapeOf: () => shape })),
    ).toBeNull();
  });

  it("refuses when a season shape has no season, in the operator's words", () => {
    const refusal = openingRefusal(
      { subjectType: "role_seat", durationDays: 7, at: AT },
      deps({ shapeOf: () => ({ kind: "last_days_of_season", days: 14 }), season: null }),
    );
    expect(refusal).toContain("no season is defined");
    expect(refusal).toContain("ask an operator");
  });
});

describe("anything coming back", () => {
  const shape = { kind: "last_days_of_cycle", days: 14 } as const;
  const span = cycleWindow(AT, 14);
  const before = new Date(span.opensAt.getTime() - 3 * DAY);

  it("opens outside its window inside the grace", () => {
    const refusal = openingRefusal(
      {
        subjectType: "mechanics",
        durationDays: 7,
        at: before,
        comingBackFrom: new Date(before.getTime() - 2 * DAY),
        relation: "overrides",
      },
      deps({ shapeOf: () => shape }),
    );
    expect(refusal).toBeNull();
  });

  it("is held to the window again once the grace has run out", () => {
    const refusal = openingRefusal(
      {
        subjectType: "mechanics",
        durationDays: 7,
        at: before,
        comingBackFrom: new Date(before.getTime() - 30 * DAY),
        relation: "renews",
      },
      deps({ shapeOf: () => shape }),
    );
    expect(refusal).toContain("7 days");
    expect(refusal).toContain(span.opensAt.toISOString().slice(0, 10));
  });

  it("names the three relations and refuses any other", () => {
    expect(SUPERSEDE_RELATIONS).toEqual(["renews", "overrides", "replaces"]);
    expect(relationProblem("renews")).toBeNull();
    expect(relationProblem(null)).toBeNull();
    expect(relationProblem("supersedes")).toContain("renews, overrides, replaces");
  });
});

describe("the three clocks agree", () => {
  it("refuses a window shape no longer than the days a ballot stays open", () => {
    const key = WINDOW_KINDS.role_seat.key;
    expect(windowShapeProblem(key, "last_days_of_cycle:7", 7)).toContain("7 days");
    expect(windowShapeProblem(key, "last_days_of_cycle:6", 7)).toBeTruthy();
    expect(windowShapeProblem(key, "last_days_of_cycle:8", 7)).toBeNull();
    expect(windowShapeProblem(key, "always_open", 7)).toBeNull();
    expect(windowShapeProblem("governance.vote_days", "7", 7)).toBeNull();
  });

  it("caps the steward's window at one cycle of the active clock", () => {
    const cycleHours = Math.floor(
      (LUNAR_CLOCK.boundsFor(AT).endsAt.getTime() - LUNAR_CLOCK.boundsFor(AT).startsAt.getTime()) / 3_600_000,
    );
    expect(cappedVetoHours(720, AT, LUNAR_CLOCK)).toBe(cycleHours);
    expect(cappedVetoHours(96, AT, LUNAR_CLOCK)).toBe(96);
    expect(cappedVetoHours(1, AT, LUNAR_CLOCK)).toBe(72);
    const problem = vetoHoursProblem(720, AT, LUNAR_CLOCK);
    expect(problem).toContain(String(cycleHours));
    expect(vetoHoursProblem(96, AT, LUNAR_CLOCK)).toBeNull();
  });

  it("refuses both cross-clock settings through the one call the validator makes", () => {
    const cycleHours = cycleHoursAt(AT, LUNAR_CLOCK);
    expect(windowSettingProblem("governance.veto_hours", "720", 7, AT, LUNAR_CLOCK)).toContain(String(cycleHours));
    expect(windowSettingProblem("governance.veto_hours", "96", 7, AT, LUNAR_CLOCK)).toBeNull();
    expect(windowSettingProblem(WINDOW_KINDS.role_seat.key, "last_days_of_cycle:6", 7, AT, LUNAR_CLOCK)).toBeTruthy();
    expect(windowSettingProblem("governance.unity_pct", "90", 7, AT, LUNAR_CLOCK)).toBeNull();
  });
});
