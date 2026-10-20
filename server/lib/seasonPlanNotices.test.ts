/**
 * The two season-plan notices (server/lib/seasonPlanNotices.ts).
 *
 * Pinned: "Plan your season" goes to every present member once, however many
 * sweeps run; the reminder SKIPS members who have filed, with a control that
 * reminds the same member while unfiled; a sweep that missed halfway sends
 * only the three-day mark; nothing goes before the window opens or after it
 * closes; and every key fits `notifications.dedupe_key`.
 */
import { describe, expect, it } from "vitest";
import { CALENDAR_CLOCK } from "../../shared/cycleClock";
import { planWindowFor, type PlanTarget } from "../../shared/seasonPlans";
import { planDueKey, planOpenKey, runSeasonPlanNotices } from "./seasonPlanNotices";

const season = { id: "s-2", name: "Second Season", startsOn: "2027-03-01", endsOn: "2027-06-01" };
const target: PlanTarget = { season, window: planWindowFor(season, null, CALENDAR_CLOCK, "UTC")! }; // 2027-02-01 to 2027-04-01

const people = [
  { id: "u-ana", name: "Ana Quillfeather" },
  { id: "u-hal", name: "Hal Keeper" },
  { id: "u-demo", name: "Example Person", isExample: true },
];
const isPresent = (m: any) => !!m && !m.isExample;

/** The notifications table in miniature: one row per dedupe key. */
function memoryNotify() {
  const rows = new Map<string, { userId: string; type: string; title: string; body?: string | null; link?: string | null }>();
  return {
    rows,
    notify: async (n: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }) => {
      if (rows.has(n.dedupeKey)) return { fresh: false };
      rows.set(n.dedupeKey, n);
      return { fresh: true };
    },
  };
}

const sweep = (mem: ReturnType<typeof memoryNotify>, now: string, filed: string[] = []) =>
  runSeasonPlanNotices({ target, now: new Date(now), members: people, isPresent, filed: async () => new Set(filed), notify: mem.notify });

describe("planning opens", () => {
  it("tells every present member once, with the season, the close and their own page", async () => {
    const mem = memoryNotify();
    const first = await sweep(mem, "2027-02-02T00:00:00Z");
    expect(first.opened).toBe(2);
    expect((await sweep(mem, "2027-02-02T12:00:00Z")).opened).toBe(0);
    const ana = mem.rows.get(planOpenKey("s-2", "u-ana"))!;
    expect(ana).toMatchObject({
      type: "season_plan_open",
      title: "Plan your season: Second Season",
      body: "Choose your seats and what you will do. Open until 31 March 2027.",
      link: "/season-plans/mine",
    });
    expect(Array.from(mem.rows.values()).some((r) => r.userId === "u-demo")).toBe(false);
  });

  it("sends nothing before the window opens or after it closes", async () => {
    const mem = memoryNotify();
    expect(await sweep(mem, "2027-01-31T00:00:00Z")).toMatchObject({ opened: 0, reminded: 0 });
    expect(await sweep(mem, "2027-04-02T00:00:00Z")).toMatchObject({ opened: 0, reminded: 0 });
    expect(await runSeasonPlanNotices({ target: null, now: new Date(), members: people, isPresent, filed: async () => new Set(), notify: mem.notify })).toMatchObject({ opened: 0 });
    expect(mem.rows.size).toBe(0);
  });
});

describe("the reminders", () => {
  it("SKIP a member who has filed, and remind the one who has not", async () => {
    const mem = memoryNotify();
    const r = await sweep(mem, "2027-03-03T00:00:00Z", ["u-ana"]);
    expect(r.mark).toBe("halfway");
    expect(r.reminded).toBe(1);
    expect(mem.rows.has(planDueKey("s-2", "halfway", "u-ana"))).toBe(false);
    expect(mem.rows.get(planDueKey("s-2", "halfway", "u-hal"))).toMatchObject({ type: "season_plan_reminder", title: "Your season is not filed yet", link: "/season-plans/mine" });
  });

  it("CONTROL: the same member, unfiled, is reminded", async () => {
    const mem = memoryNotify();
    await sweep(mem, "2027-03-03T00:00:00Z", []);
    expect(mem.rows.has(planDueKey("s-2", "halfway", "u-ana"))).toBe(true);
  });

  it("catch-up sends only the latest mark, once", async () => {
    const mem = memoryNotify();
    const r = await sweep(mem, "2027-03-30T00:00:00Z");
    expect(r.mark).toBe("three-days");
    expect(mem.rows.has(planDueKey("s-2", "halfway", "u-hal"))).toBe(false);
    expect(mem.rows.get(planDueKey("s-2", "three-days", "u-hal"))?.body).toBe("2 days left.");
    expect((await sweep(mem, "2027-03-30T12:00:00Z")).reminded).toBe(0);
  });

  it("keeps every key inside varchar(191), however long the season id", () => {
    const long = "s".repeat(300);
    expect(planOpenKey(long, "u-ana").length).toBeLessThanOrEqual(191);
    expect(planDueKey(long, "three-days", "u-ana").length).toBeLessThanOrEqual(191);
    expect(planDueKey("s-2", "halfway", "u-ana")).toBe("season-plan-due:s-2:halfway:u-ana");
    expect(planOpenKey("s-2", "u-ana")).toBe("season-plan-open:s-2:u-ana");
  });
});
