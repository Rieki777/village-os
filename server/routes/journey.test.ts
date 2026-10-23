/**
 * THE COMMAND CENTRE'S PLAN AND OWNERS, OVER REAL HTTP.
 *
 * The real `register()` on a real Express, with the `journey-state` document
 * held in memory the way `dbDocument` holds it (a fallback object until the
 * first write, then the written one). The port is bound at 0, so this file
 * allocates no window and cannot collide with an e2e suite.
 *
 * What it holds, in the order the page depends on it:
 *
 *   - every route refuses anybody `isAdmin` refuses, and writes nothing;
 *   - a document with no plan reads as today's plan, ids and all, so the
 *     ticks and answers already stored keep matching;
 *   - a save replaces the plan whole, but never drops an item (removing
 *     hides), never lands on a newer plan it did not see, and never parks a
 *     field the page does not read;
 *   - owner choices live on the server, and the one-time import of a
 *     browser's old choices fills gaps without overwriting anything.
 */
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { register } from "./journey";
import { DEFAULT_COMMAND_CENTRE_PLAN } from "../lib/commandCentrePlanDefault";
import {
  PLAN_LIMITS,
  planIds,
  planProblems,
  VILLAGE_OWNED,
  type CommandCentrePlan,
} from "../../shared/commandCentrePlan";

const FALLBACK = {
  checkboxes: {},
  copy: {},
  kanban: {},
  decisions: {},
  resources: [],
};

let stored: Record<string, any> | null = null;
let writes = 0;
let adminAnswer = true;
let server: http.Server;
let base = "";

const journeyRepo = {
  load: async () => {},
  get: () => stored ?? FALLBACK,
  exists: () => stored !== null,
  put: async (doc: any) => {
    writes += 1;
    stored = JSON.parse(JSON.stringify(doc));
    return doc;
  },
};

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  register(app, { isAdmin: async () => adminAnswer, journeyRepo } as any);
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string")
    throw new Error("the test server did not report a port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  stored = null;
  writes = 0;
  adminAnswer = true;
});

async function call(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => undefined) };
}

/** The plan as the page would send it back: a copy, minus the revision. */
function editable(
  plan: CommandCentrePlan
): Omit<CommandCentrePlan, "revision"> {
  const { revision: _revision, ...rest } = JSON.parse(JSON.stringify(plan));
  return rest;
}

describe("the default plan is today's plan", () => {
  it("fits every limit the editor and the route enforce", () => {
    expect(planProblems(DEFAULT_COMMAND_CENTRE_PLAN)).toEqual([]);
  });

  it("carries the six weeks, 71 tasks and ten decisions with the ids stored state is keyed by", () => {
    const plan = DEFAULT_COMMAND_CENTRE_PLAN;
    expect(plan.weeks.map(w => w.id)).toEqual([
      "w1",
      "w2",
      "w3",
      "w4",
      "w5",
      "w6",
    ]);
    expect(plan.weeks.reduce((n, w) => n + w.tasks.length, 0)).toBe(71);
    expect(plan.decisions).toHaveLength(10);
    // A sample across every prefix the old compiled ids used.
    const ids = planIds(plan);
    for (const id of [
      "w1-1",
      "w2-17",
      "wt-1",
      "am-3",
      "w4-12",
      "w5-12",
      "w6-8",
      "dec-token-name",
      "dec-land-agreement",
      "dec-retainer",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(plan.partnerName).toBe("ReGen");
    expect(plan.intro).toContain("the six weeks that made this site");
  });

  it("names the village with {village}, never a village's own name", () => {
    const text = JSON.stringify(DEFAULT_COMMAND_CENTRE_PLAN);
    expect(text).toContain("{village} Game Guide");
    expect(text).not.toContain("${");
  });
});

describe("every journey route refuses a non-admin and writes nothing", () => {
  const writesTo: Array<[string, unknown]> = [
    [
      "/api/journey/plan",
      { plan: editable(DEFAULT_COMMAND_CENTRE_PLAN), revision: 0 },
    ],
    ["/api/journey/owner", { id: "w1-1", status: "collab" }],
    ["/api/journey/owners/import", { owners: { "w1-1": "collab" } }],
    ["/api/journey/checkbox", { id: "w1-1", state: 1 }],
    ["/api/journey/kanban", { id: "w1-1", column: "actioning", assignee: "" }],
    ["/api/journey/copy", { sectionId: "note-w1-1", content: "x" }],
    [
      "/api/journey/decision",
      { id: "dec-retainer", status: "open", chosen: "", notes: "" },
    ],
    ["/api/journey/resources", { resources: [] }],
  ];

  it("refuses the read", async () => {
    adminAnswer = false;
    const res = await call("GET", "/api/journey/state");
    expect(res.status).toBe(401);
    expect(
      res.json?.plan,
      "no plan text reaches a refused reader"
    ).toBeUndefined();
  });

  it.each(writesTo)("refuses %s", async (path, body) => {
    adminAnswer = false;
    const res = await call("POST", path, body);
    expect(res.status).toBe(401);
    expect(writes, "a refused write must not reach the document").toBe(0);
    expect(stored).toBeNull();
  });
});

describe("GET /api/journey/state", () => {
  it("resolves a document with no plan to today's plan, with no owner choices", async () => {
    stored = {
      checkboxes: { "w1-1": 2 },
      copy: {},
      kanban: {},
      decisions: {},
      resources: [],
    };
    const res = await call("GET", "/api/journey/state");
    expect(res.status).toBe(200);
    expect(res.json.plan).toEqual(DEFAULT_COMMAND_CENTRE_PLAN);
    expect(res.json.owners).toEqual({});
    expect(res.json.checkboxes, "the stored ticks come back beside it").toEqual(
      { "w1-1": 2 }
    );
  });

  it("drops a stored owner choice that no longer reads as an owner", async () => {
    stored = { ...FALLBACK, owners: { "w1-1": "collab", "w1-2": "everyone" } };
    const res = await call("GET", "/api/journey/state");
    expect(res.json.owners).toEqual({ "w1-1": "collab" });
  });
});

describe("POST /api/journey/plan", () => {
  it("saves an edited plan whole, bumps the revision, and leaves every other mark alone", async () => {
    stored = {
      ...FALLBACK,
      checkboxes: { "w1-1": 2 },
      decisions: {
        "dec-retainer": { status: "decided", chosen: "Yes", notes: "" },
      },
    };
    const plan = editable(DEFAULT_COMMAND_CENTRE_PLAN);
    plan.intro = "Our {village} plan.";
    plan.partnerName = "Builders Co";
    plan.weeks[0].label = "Week one";
    plan.weeks[0].tasks.push({
      id: "task-new001",
      text: "A new task",
      status: "pending",
    });
    plan.weeks.reverse();
    plan.decisions[1].hidden = true;

    const res = await call("POST", "/api/journey/plan", { plan, revision: 0 });
    expect(res.status).toBe(200);
    expect(res.json.plan.revision).toBe(1);

    const back = (await call("GET", "/api/journey/state")).json;
    expect(back.plan.intro).toBe("Our {village} plan.");
    expect(back.plan.partnerName).toBe("Builders Co");
    expect(back.plan.weeks[0].id, "the order is the one that was saved").toBe(
      "w6"
    );
    expect(back.plan.weeks[5].label).toBe("Week one");
    expect(back.plan.weeks[5].tasks.at(-1)).toEqual({
      id: "task-new001",
      text: "A new task",
      status: "pending",
    });
    expect(back.plan.decisions[1].hidden).toBe(true);
    expect(back.checkboxes).toEqual({ "w1-1": 2 });
    expect(
      back.decisions["dec-retainer"].chosen,
      "a hidden decision keeps its answer"
    ).toBe("Yes");
  });

  it("refuses a plan saved over a newer one, and says what to do", async () => {
    const plan = editable(DEFAULT_COMMAND_CENTRE_PLAN);
    expect(
      (await call("POST", "/api/journey/plan", { plan, revision: 0 })).status
    ).toBe(200);
    const stale = await call("POST", "/api/journey/plan", {
      plan: { ...plan, intro: "Mine." },
      revision: 0,
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatch(/Reload/);
    expect(stored?.plan.intro, "the newer plan is untouched").toBe(
      DEFAULT_COMMAND_CENTRE_PLAN.intro
    );
  });

  it("refuses a plan that drops an item: removing hides it", async () => {
    const plan = editable(DEFAULT_COMMAND_CENTRE_PLAN);
    plan.weeks[0].tasks = plan.weeks[0].tasks.filter(t => t.id !== "w1-2");
    const res = await call("POST", "/api/journey/plan", { plan, revision: 0 });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain("w1-2");
    expect(res.json.error).toMatch(/hidden/);
    expect(writes).toBe(0);
  });

  it("refuses text over its limit, naming where and the limit", async () => {
    const plan = editable(DEFAULT_COMMAND_CENTRE_PLAN);
    plan.weeks[1].tasks[2].text = "x".repeat(PLAN_LIMITS.taskText + 1);
    const res = await call("POST", "/api/journey/plan", { plan, revision: 0 });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe(
      `Week 2, task 3 is ${PLAN_LIMITS.taskText + 1} characters; the most it holds is ${PLAN_LIMITS.taskText}.`
    );
  });

  it("refuses a repeated id, a blank partner name and a decision linked to no task", async () => {
    const repeated = editable(DEFAULT_COMMAND_CENTRE_PLAN);
    repeated.weeks[2].tasks.push({
      id: "w1-1",
      text: "Twin",
      status: "pending",
    });
    expect(
      (await call("POST", "/api/journey/plan", { plan: repeated, revision: 0 }))
        .json.error
    ).toContain("repeats the id w1-1");

    const blank = {
      ...editable(DEFAULT_COMMAND_CENTRE_PLAN),
      partnerName: "  ",
    };
    expect(
      (await call("POST", "/api/journey/plan", { plan: blank, revision: 0 }))
        .status
    ).toBe(400);

    const dangling = editable(DEFAULT_COMMAND_CENTRE_PLAN);
    dangling.decisions[0].linkedItem = "no-such-task";
    const res = await call("POST", "/api/journey/plan", {
      plan: dangling,
      revision: 0,
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/links to a task the plan does not hold/);
    expect(writes).toBe(0);
  });

  it("stores only the fields the page reads", async () => {
    const plan: any = editable(DEFAULT_COMMAND_CENTRE_PLAN);
    plan.extra = "<script>";
    plan.weeks[0].tasks[0].html = "<b>";
    plan.weeks[0].tasks[0].text = "  Landing page, trimmed  ";
    expect(
      (await call("POST", "/api/journey/plan", { plan, revision: 0 })).status
    ).toBe(200);
    expect(stored?.plan.extra).toBeUndefined();
    expect(stored?.plan.weeks[0].tasks[0]).toEqual({
      id: "w1-1",
      text: "Landing page, trimmed",
      status: "done",
    });
  });
});

describe("owners live on the server", () => {
  it("POST /api/journey/owner saves one choice beside the rest of the state", async () => {
    stored = { ...FALLBACK, checkboxes: { "w1-1": 1 } };
    const res = await call("POST", "/api/journey/owner", {
      id: "w2-2",
      status: VILLAGE_OWNED,
    });
    expect(res.status).toBe(200);
    expect(stored?.owners).toEqual({ "w2-2": VILLAGE_OWNED });
    expect(stored?.checkboxes).toEqual({ "w1-1": 1 });
    const back = (await call("GET", "/api/journey/state")).json;
    expect(back.owners).toEqual({ "w2-2": VILLAGE_OWNED });
  });

  it("refuses an owner the page does not know", async () => {
    const res = await call("POST", "/api/journey/owner", {
      id: "w2-2",
      status: "nobody",
    });
    expect(res.status).toBe(400);
    expect(writes).toBe(0);
  });

  it("the one-time import fills gaps and never overwrites what the server holds", async () => {
    stored = { ...FALLBACK, owners: { "w1-1": "collab" } };
    const res = await call("POST", "/api/journey/owners/import", {
      owners: { "w1-1": "pending", "w2-2": VILLAGE_OWNED },
    });
    expect(res.status).toBe(200);
    expect(res.json.imported).toEqual(["w2-2"]);
    expect(stored?.owners).toEqual({ "w1-1": "collab", "w2-2": VILLAGE_OWNED });
  });

  it("an import with nothing new writes nothing, and a bad one is refused whole", async () => {
    stored = { ...FALLBACK, owners: { "w1-1": "collab" } };
    expect(
      (
        await call("POST", "/api/journey/owners/import", {
          owners: { "w1-1": "done" },
        })
      ).status
    ).toBe(200);
    expect(writes).toBe(0);
    const bad = await call("POST", "/api/journey/owners/import", {
      owners: { "w2-2": "done", "w2-3": "whoever" },
    });
    expect(bad.status).toBe(400);
    expect(stored?.owners).toEqual({ "w1-1": "collab" });
  });
});
