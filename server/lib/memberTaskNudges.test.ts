import { beforeEach, describe, expect, it, vi } from "vitest";

let due: { id: string; userId: string; title: string; dueOn: string }[] = [];
let asked: { id: string; userId: string; title: string; requestedBy: string }[] = [];
vi.mock("../repos/memberTasks", () => ({ dueSoonTasks: async () => due, askedForTasks: async () => asked }));
vi.mock("./variables", () => ({ numberVar: (k: string) => (k.endsWith("start_hour") ? 8 : 20) }));

import { dueWords, runListNudges } from "./memberTaskNudges";

const sent: any[] = [];
const base = { pool: {} as any, notify: async (n: any) => void sent.push(n), zone: "America/Costa_Rica", today: "2026-11-03" };
beforeEach(() => { sent.length = 0; due = []; asked = []; });

describe("Your list nudges", () => {
  it("names the day plainly", () => {
    expect(dueWords("2026-11-03", "2026-11-03")).toBe("today");
    expect(dueWords("2026-11-03", "2026-11-04")).toBe("tomorrow");
    expect(dueWords("2026-11-03", "2026-11-05")).toBe("on 2026-11-05");
  });
  it("sends one in-app note per task and date, with no body, inside the daytime window", async () => {
    due = [{ id: "t1", userId: "u1", title: "Fix the gate", dueOn: "2026-11-04" }];
    asked = [{ id: "t2", userId: "u1", title: "Bring chairs", requestedBy: "Ana" }];
    await runListNudges({ ...base, now: new Date("2026-11-03T16:00:00Z") });
    expect(sent).toEqual([
      { userId: "u1", type: "my_task_due", title: "Due tomorrow: Fix the gate", body: null, link: "/profile", dedupeKey: "my-task-due:t1:2026-11-04" },
      { userId: "u1", type: "my_task_asked", title: "Asked by Ana: Bring chairs", body: null, link: "/profile", dedupeKey: "my-task-asked:t2" },
    ]);
  });
  it("stays quiet at night", async () => {
    due = [{ id: "t1", userId: "u1", title: "x", dueOn: "2026-11-04" }];
    expect(await runListNudges({ ...base, now: new Date("2026-11-03T05:00:00Z") })).toMatch(/outside/);
    expect(sent).toEqual([]);
  });
});
