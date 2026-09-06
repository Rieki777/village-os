import { describe, expect, it } from "vitest";
import { navGroups } from "./adminNavGroups";
import { TAB_MODULE, filterNavByModules } from "@/lib/adminNav";

/**
 * The tab registry, tested against the real thing for the first time.
 *
 * client/src/lib/adminNav.test.ts already covers `filterNavByModules`, but it
 * has to do it against a HAND-WRITTEN fixture list of groups, because
 * `navGroups` was locked inside an 11,000-line page component and nothing could
 * import it. So the filter was proven correct against a copy of the nav, and
 * nothing checked the copy still matched. That is the whole cost of a monolith
 * in one sentence.
 *
 * Now that navGroups is a module, these run against the registry a founder
 * actually sees. The invariants below are the ones that break quietly: a
 * duplicate key means two tabs fight over one panel and the loser is
 * unreachable, and a TAB_MODULE entry naming a tab that does not exist means a
 * module ships with a mapping to nowhere.
 */
const allKeys = (setupComplete: boolean) =>
  navGroups(setupComplete).flatMap((g) => g.items.map((i) => i.key));

describe("navGroups", () => {
  it("gives every tab a key of its own, so no two tabs fight over one panel", () => {
    for (const setupComplete of [true, false]) {
      const keys = allKeys(setupComplete);
      const seen = new Set<string>();
      const duplicates = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
      expect(duplicates, `setupComplete=${setupComplete}`).toEqual([]);
    }
  });

  it("gives every tab a label and an icon, so no row renders blank", () => {
    for (const group of navGroups(true)) {
      expect(group.title.trim()).not.toBe("");
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.label.trim(), item.key).not.toBe("");
        expect(item.icon, item.key).toBeTruthy();
      }
    }
  });

  it("every module-to-tab mapping names a tab that exists", () => {
    const keys = new Set(allKeys(true));
    const danglers = Object.keys(TAB_MODULE).filter((k) => !keys.has(k));
    expect(danglers).toEqual([]);
  });

  it("moves the setup tab from a front door to an ordinary settings row", () => {
    const before = navGroups(false);
    expect(before[0].title).toBe("Start here");
    expect(before[0].items.map((i) => i.key)).toEqual(["setup"]);

    const after = navGroups(true);
    expect(after.map((g) => g.title)).not.toContain("Start here");
    const settings = after.find((g) => g.title === "Settings");
    expect(settings?.items.map((i) => i.key)).toEqual(["setup"]);
    // The key does not change with the group, so a deep link to /admin?tab=setup
    // keeps working either side of setup being finished.
    expect(allKeys(true).filter((k) => k === "setup")).toEqual(["setup"]);
  });

  it("survives the real filter with a catalog that has never loaded", () => {
    // The delta-off rule from adminNav.ts, now exercised on the real registry
    // rather than on a fixture that resembles it.
    expect(filterNavByModules(navGroups(true), null)).toEqual(navGroups(true));
  });

  it("keeps the platform tabs when every module is off", () => {
    const off = Object.fromEntries(
      Object.values(TAB_MODULE).map((m) => [m, "off" as const]),
    );
    const kept = new Set(
      filterNavByModules(navGroups(true), off).flatMap((g) => g.items.map((i) => i.key)),
    );
    // Nothing that is mapped survives, and the unmapped ones all do.
    for (const key of Object.keys(TAB_MODULE)) expect(kept.has(key), key).toBe(false);
    for (const key of allKeys(true)) {
      if (!TAB_MODULE[key]) expect(kept.has(key), key).toBe(true);
    }
  });

  /**
   * THE RAIL READS TOP TO BOTTOM AS THE ORDER A VILLAGE IS SET UP IN.
   *
   * Rye, on finding Integrations filed under a group called Notifications:
   * "Audit these and where they're placed and think about the order they would
   * best go in for setting up a village so that it makes sense to work from
   * top to bottom to fill it all out."
   *
   * The product already shipped a canonical setup order and nothing wired the
   * nav to it: shared/launchRequirements.ts declares the seventeen items the
   * Journey to Launch banner counts. Read against it, the old rail opened on
   * day-two operations (Submissions), buried the two BLOCKING items that come
   * first on the journey at position four of a twenty-eight item bucket, and
   * put the tab SEVEN of the seventeen requirements point at, Integrations,
   * in second place under a group named after email.
   *
   * Pinned as an exact sequence rather than as a set of rules, because the
   * order IS the feature here. A rule-shaped test ("integrations comes before
   * email-settings") passes on a rail that has been quietly scrambled around
   * the rule.
   */
  const ORDER: Array<[string, string[]]> = [
    ["Start here", ["setup"]],
    ["Who runs this village", ["players", "game-roles", "org-chart", "handover", "governance-weights"]],
    ["Make it yours", ["team", "legal", "covenant", "work-with-us", "faqs", "milestones", "visit-config", "investor-summary"]],
    ["Connections", ["integrations", "email-settings"]],
    ["What your village runs", [
      "modules", "variables", "season", "seasons-patterns", "circles-map", "housing",
      "events-admin", "quests-admin", "tools-admin", "library-admin", "badges-admin",
      "stays-admin", "exchange-admin", "crowdpool-admin", "calls-admin", "intents-admin",
      "health-admin",
    ]],
    ["Money and agreements", ["tokens", "ledger", "cycles", "products", "resources-admin", "exits-admin", "settings"]],
    ["Day to day", ["submissions", "feedback", "quest-claims", "forum-moderation", "message-reports", "drafts", "brain"]],
    ["Library and files", ["training-modules", "investor-vault", "uploaded-files"]],
  ];

  it("reads top to bottom as the order a founder sets a village up in", () => {
    const groups = navGroups(false);
    expect(groups.map((g) => g.title)).toEqual(ORDER.map(([t]) => t));
    for (const [title, keys] of ORDER) {
      expect(groups.find((g) => g.title === title)!.items.map((i) => i.key), title).toEqual(keys);
    }
  });

  it("moved every tab and lost none of them", () => {
    /*
     * The reorder is a PERMUTATION. Every key the rail carried before is
     * still on it, and nothing new appeared. A tab dropped here is a panel a
     * founder can still deep-link to and can no longer find, which is the
     * failure a reorder makes easy and silent.
     */
    const before = [
      "setup", "submissions", "feedback", "forum-moderation", "message-reports", "products",
      "team", "legal", "covenant", "email-settings", "integrations", "brain", "drafts",
      "investor-vault", "uploaded-files", "training-modules", "modules", "quests-admin",
      "quest-claims", "players", "game-roles", "handover", "org-chart", "governance-weights",
      "seasons-patterns", "circles-map", "housing", "events-admin", "tools-admin",
      "crowdpool-admin", "stays-admin", "exchange-admin", "badges-admin", "library-admin",
      "health-admin", "resources-admin", "exits-admin", "calls-admin", "intents-admin",
      "tokens", "ledger", "cycles", "variables", "season", "settings", "work-with-us",
      "faqs", "milestones", "visit-config", "investor-summary",
    ];
    for (const setupComplete of [true, false]) {
      expect(new Set(allKeys(setupComplete)), `setupComplete=${setupComplete}`).toEqual(new Set(before));
    }
  });

  it("puts Integrations first in its own group, not second under email", () => {
    // The specific thing Rye asked about, asserted on its own so a failure
    // names it rather than pointing at a fifty-key sequence.
    const groups = navGroups(true);
    const home = groups.find((g) => g.items.some((i) => i.key === "integrations"))!;
    expect(home.title).not.toBe("Notifications");
    expect(home.items[0].key).toBe("integrations");
  });
});

