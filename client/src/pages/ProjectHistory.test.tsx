// @vitest-environment jsdom
/**
 * THE COMMAND CENTRE, EDITABLE IN PLACE (Rye, 2026-10-22).
 *
 * The plan this page tracks used to be compiled in, and the owner dropdown
 * saved only to the browser that used it while the page said everything was
 * synced to the server. This file holds the page to what it now says:
 *
 *   - it draws the plan the SERVER sends, with `{village}` filled, the build
 *     partner's own name on the pill, the legend and the dropdown;
 *   - an owner choice is a server write, and Kanban reads the same choice
 *     the timeline does;
 *   - a browser's old local owner choices go up once, fill only gaps, and
 *     are cleared when that lands;
 *   - an admin edits weeks, tasks and decisions in place, and the save sends
 *     the whole plan with removed items HIDDEN, never dropped;
 *   - a refused save costs nobody their draft.
 *
 * `Layout` is a passthrough and the auth hook answers as a founder. The
 * server is a stubbed `fetch` that records every call, so a test reads what
 * was SENT as well as what was drawn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import {
  VILLAGE_OWNED,
  type CommandCentrePlan,
} from "@shared/commandCentrePlan";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Founder", role: "founder" },
    loading: false,
  }),
}));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => "a-token",
  useCatalyst: () => ({ aName: "an admin" }),
  useGameConfig: () => ({
    project: { name: "Willowbrook", commitmentName: "village pact" },
    currency: { name: "Thanks" },
  }),
}));

import ProjectHistory from "./ProjectHistory";

const LOCAL_OWNERS_KEY = "amora-timeline-overrides"; // brand-ok: the key this page used to write, read once to import

const PLAN: CommandCentrePlan = {
  revision: 3,
  intro: "The plan that built {village}.",
  partnerName: "Builders Co",
  weeks: [
    {
      id: "w1",
      label: "Week 1 | Start",
      goal: "Get going",
      tasks: [
        { id: "t1", text: "Write the {village} guide", status: "pending" },
        { id: "t2", text: "Open the gate", status: "pending" },
      ],
    },
    {
      id: "w2",
      label: "Week 2 | Finish",
      goal: "Land it",
      tasks: [
        { id: "t3", text: "Hang the sign", status: "done" },
        { id: "t4", text: "Agree the dues", status: "collab" },
      ],
    },
  ],
  decisions: [
    {
      id: "d1",
      title: "Pick a name",
      description: "For the {village} token.",
      options: ["Seeds", "Roots"],
      linkedItem: "t4",
    },
    { id: "d2", title: "Pick a date", description: "", options: [] },
  ],
};

type Call = { method: string; url: string; body: any };
let calls: Call[];
let state: Record<string, unknown>;
/** Per-route answers for POSTs; anything unlisted answers 200 with `{ success: true }`. */
let answers: Record<string, (body: any) => { status: number; body: unknown }>;

beforeEach(() => {
  calls = [];
  answers = {};
  state = {
    checkboxes: {},
    copy: {},
    kanban: {},
    decisions: {},
    resources: [],
    plan: structuredCopy(PLAN),
    owners: {},
  };
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, url: String(url), body });
      if (method === "GET" && url === "/api/journey/state")
        return reply(200, state);
      const handler = answers[String(url)];
      const out = handler
        ? handler(body)
        : { status: 200, body: { success: true } };
      return reply(out.status, out.body);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const posts = (url: string) =>
  calls.filter(c => c.method === "POST" && c.url === url);

async function draw() {
  render(
    <Router>
      <ProjectHistory />
    </Router>
  );
  await screen.findByText("Write the Willowbrook guide");
}

/** The timeline row a task's text sits in. */
const rowOf = (text: string) =>
  screen.getByText(text).parentElement as HTMLElement;

describe("the plan comes from the server", () => {
  it("draws its tasks with {village} filled, and the build partner by name", async () => {
    await draw();
    expect(screen.getByText(/The plan that built Willowbrook\./)).toBeTruthy();
    expect(
      screen.queryByText(/ReGen/),
      "no partner name is compiled in"
    ).toBeNull();
    const row = rowOf("Write the Willowbrook guide");
    expect(within(row).getByText("Builders Co"), "the owner pill").toBeTruthy();
    expect(
      within(row).getByRole("option", { name: "Builders Co · to do" })
    ).toBeTruthy();
  });

  it("names the membership page by the village's commitment name", async () => {
    await draw();
    expect(
      screen.getByRole("link", { name: /Village pact/ }).getAttribute("href")
    ).toBe("/love-letter");
    expect(screen.queryByText("Love Letter")).toBeNull();
  });

  it("leaves a hidden item out of every view", async () => {
    (state.plan as CommandCentrePlan).weeks[0].tasks[1].hidden = true;
    (state.plan as CommandCentrePlan).decisions[1].hidden = true;
    await draw();
    expect(screen.queryByText("Open the gate")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    expect(screen.queryByText("Open the gate")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Decisions/ }));
    expect(screen.getByText("Pick a name")).toBeTruthy();
    expect(screen.queryByText("Pick a date")).toBeNull();
  });
});

describe("owners are saved to the server, and Kanban reads them", () => {
  it("sends the dropdown's choice and rolls nothing back when it lands", async () => {
    await draw();
    const select = rowOf("Write the Willowbrook guide").querySelector(
      "select"
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: VILLAGE_OWNED } });
    await waitFor(() => expect(posts("/api/journey/owner")).toHaveLength(1));
    expect(posts("/api/journey/owner")[0].body).toEqual({
      id: "t1",
      status: VILLAGE_OWNED,
    });

    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    const card = screen.getByText("Write the Willowbrook guide")
      .parentElement as HTMLElement;
    expect(
      within(card).getByText("Willowbrook"),
      "Kanban shows the choice the timeline made"
    ).toBeTruthy();
  });

  it("draws Kanban from the server's choice over the plan's default owner", async () => {
    state.owners = { t1: "collab" };
    await draw();
    fireEvent.click(screen.getByRole("button", { name: /Kanban/ }));
    const card = screen.getByText("Write the Willowbrook guide")
      .parentElement as HTMLElement;
    expect(within(card).getByText("Collab")).toBeTruthy();
  });

  it("puts the choice back when the server refuses it, and says so", async () => {
    answers["/api/journey/owner"] = () => ({
      status: 500,
      body: { error: "the database is away" },
    });
    await draw();
    const select = rowOf("Write the Willowbrook guide").querySelector(
      "select"
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "collab" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "the database is away"
    );
    await waitFor(() =>
      expect(
        (
          rowOf("Write the Willowbrook guide").querySelector(
            "select"
          ) as HTMLSelectElement
        ).value
      ).toBe("pending")
    );
  });
});

describe("the one-time import of this browser's owner choices", () => {
  it("sends only what the server lacks, then clears the local copy", async () => {
    state.owners = { t1: "done" };
    localStorage.setItem(
      LOCAL_OWNERS_KEY,
      JSON.stringify({ t1: "collab", t2: VILLAGE_OWNED, t3: "nobody" })
    );
    answers["/api/journey/owners/import"] = body => ({
      status: 200,
      body: {
        success: true,
        imported: Object.keys(body.owners),
        owners: { t1: "done", ...body.owners },
      },
    });
    await draw();
    await waitFor(() =>
      expect(posts("/api/journey/owners/import")).toHaveLength(1)
    );
    expect(posts("/api/journey/owners/import")[0].body).toEqual({
      owners: { t2: VILLAGE_OWNED },
    });
    await waitFor(() =>
      expect(localStorage.getItem(LOCAL_OWNERS_KEY)).toBeNull()
    );
    const row = rowOf("Open the gate");
    expect((row.querySelector("select") as HTMLSelectElement).value).toBe(
      VILLAGE_OWNED
    );
  });

  it("keeps the local copy for next time when the import is refused", async () => {
    localStorage.setItem(LOCAL_OWNERS_KEY, JSON.stringify({ t2: "collab" }));
    answers["/api/journey/owners/import"] = () => ({ status: 503, body: {} });
    await draw();
    await waitFor(() =>
      expect(posts("/api/journey/owners/import")).toHaveLength(1)
    );
    expect(localStorage.getItem(LOCAL_OWNERS_KEY)).not.toBeNull();
  });

  it("sends nothing when the browser holds nothing", async () => {
    await draw();
    await waitFor(() =>
      expect(calls.some(c => c.url === "/api/journey/state")).toBe(true)
    );
    expect(posts("/api/journey/owners/import")).toHaveLength(0);
  });
});

describe("editing the plan in place", () => {
  /** The server's answer to a save: the plan it was sent, one revision on. */
  const acceptPlan = () => {
    answers["/api/journey/plan"] = body => ({
      status: 200,
      body: {
        success: true,
        plan: { ...body.plan, revision: body.revision + 1 },
      },
    });
  };

  it("renames, adds, removes and reorders, then saves the whole plan with removals hidden", async () => {
    acceptPlan();
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Edit the plan" }));

    fireEvent.change(screen.getByLabelText("Intro line"), {
      target: { value: "Our plan for {village}." },
    });
    fireEvent.change(screen.getByLabelText("Build partner's name"), {
      target: { value: "Makers" },
    });
    fireEvent.change(screen.getByLabelText("Week 1, task 1"), {
      target: { value: "Write the {village} handbook" },
    });
    fireEvent.change(screen.getByLabelText("Week 2 goal"), {
      target: { value: "Land it well" },
    });
    fireEvent.click(
      within(screen.getByRole("region", { name: "Week 1" })).getByRole(
        "button",
        { name: "Add a task" }
      )
    );
    fireEvent.change(screen.getByLabelText("Week 1, task 3"), {
      target: { value: "Paint the door" },
    });
    fireEvent.click(
      within(screen.getByRole("region", { name: "Week 1" })).getAllByRole(
        "button",
        { name: "Remove this task" }
      )[1]
    );
    fireEvent.click(
      within(screen.getByRole("region", { name: "Week 2" })).getByRole(
        "button",
        { name: "Move this week up" }
      )
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Save plan" })[0]);
    await waitFor(() => expect(posts("/api/journey/plan")).toHaveLength(1));
    const sent = posts("/api/journey/plan")[0].body;

    expect(sent.revision, "the save names the plan it was made from").toBe(3);
    expect(sent.plan.intro).toBe("Our plan for {village}.");
    expect(sent.plan.partnerName).toBe("Makers");
    expect(sent.plan.weeks.map((w: any) => w.id)).toEqual(["w2", "w1"]);
    expect(sent.plan.weeks[0].goal).toBe("Land it well");
    const week1 = sent.plan.weeks[1];
    expect(week1.tasks.map((t: any) => t.id).slice(0, 2)).toEqual(["t1", "t2"]);
    expect(week1.tasks[0].text).toBe("Write the {village} handbook");
    expect(
      week1.tasks[1],
      "a removed task is hidden, not dropped"
    ).toMatchObject({ id: "t2", hidden: true });
    expect(week1.tasks[2].text).toBe("Paint the door");
    expect(week1.tasks[2].id, "a new task gets a new id").toMatch(
      /^task-[a-z0-9]{6}$/
    );

    expect(
      await screen.findByText("Write the Willowbrook handbook")
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Save plan" }),
      "the editor closes once the save lands"
    ).toBeNull();
    expect(screen.getByText(/Our plan for Willowbrook\./)).toBeTruthy();
    expect(screen.queryByText("Open the gate")).toBeNull();
  });

  it("edits the decisions in place: title, options, the task each settles, and removal", async () => {
    acceptPlan();
    await draw();
    fireEvent.click(screen.getByRole("button", { name: /Decisions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit the plan" }));

    fireEvent.change(screen.getByLabelText("Decision 1 title"), {
      target: { value: "Name the token" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the option Roots" })
    );
    fireEvent.change(screen.getByLabelText("Add an option to decision 1"), {
      target: { value: "Sparks" },
    });
    fireEvent.keyDown(screen.getByLabelText("Add an option to decision 1"), {
      key: "Enter",
    });
    const linked = within(
      screen.getByRole("region", { name: "Decision 1" })
    ).getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(linked, { target: { value: "t1" } });
    fireEvent.click(
      within(screen.getByRole("region", { name: "Decision 2" })).getByRole(
        "button",
        { name: "Remove this decision" }
      )
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Save plan" })[0]);
    await waitFor(() => expect(posts("/api/journey/plan")).toHaveLength(1));
    const decisions = posts("/api/journey/plan")[0].body.plan.decisions;
    expect(decisions[0]).toMatchObject({
      id: "d1",
      title: "Name the token",
      options: ["Seeds", "Sparks"],
      linkedItem: "t1",
    });
    expect(decisions[1]).toMatchObject({ id: "d2", hidden: true });

    expect(await screen.findByText("Name the token")).toBeTruthy();
    expect(screen.queryByText("Pick a date")).toBeNull();
  });

  it("restores a removed item before saving", async () => {
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Edit the plan" }));
    fireEvent.click(
      within(screen.getByRole("region", { name: "Week 2" })).getByRole(
        "button",
        { name: "Remove this week" }
      )
    );
    expect(screen.queryByRole("region", { name: "Week 2" })).toBeNull();
    fireEvent.click(screen.getByText("Removed (1)"));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByRole("region", { name: "Week 2" })).toBeTruthy();
  });

  it("drops a task added and left blank, and refuses a blank one the plan already holds", async () => {
    acceptPlan();
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Edit the plan" }));
    fireEvent.click(
      within(screen.getByRole("region", { name: "Week 1" })).getByRole(
        "button",
        { name: "Add a task" }
      )
    );
    fireEvent.change(screen.getByLabelText("Week 1, task 2"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save plan" })[0]);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Week 1, task 2 needs some words"
    );
    expect(
      posts("/api/journey/plan"),
      "nothing is sent while the check refuses"
    ).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Week 1, task 2"), {
      target: { value: "Open the gate" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save plan" })[0]);
    await waitFor(() => expect(posts("/api/journey/plan")).toHaveLength(1));
    const tasks = posts("/api/journey/plan")[0].body.plan.weeks[0].tasks;
    expect(
      tasks.map((t: any) => t.id),
      "the blank new task was never created"
    ).toEqual(["t1", "t2"]);
  });

  it("keeps the editor and the draft open when the server refuses the save", async () => {
    answers["/api/journey/plan"] = () => ({
      status: 409,
      body: {
        error:
          "Somebody saved the plan after you opened it. Reload the page to see their version, then make your change again.",
      },
    });
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Edit the plan" }));
    fireEvent.change(screen.getByLabelText("Week 1, task 1"), {
      target: { value: "My careful rewrite" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save plan" })[0]);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Somebody saved the plan after you opened it"
    );
    expect(
      (screen.getByLabelText("Week 1, task 1") as HTMLTextAreaElement).value
    ).toBe("My careful rewrite");
  });

  it("throws the draft away on Cancel and sends nothing", async () => {
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Edit the plan" }));
    fireEvent.change(screen.getByLabelText("Week 1, task 1"), {
      target: { value: "Something else" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(screen.getByText("Write the Willowbrook guide")).toBeTruthy();
    expect(posts("/api/journey/plan")).toHaveLength(0);
  });

  it("holds every field to its limit", async () => {
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Edit the plan" }));
    expect(
      (screen.getByLabelText("Build partner's name") as HTMLInputElement)
        .maxLength
    ).toBe(24);
    expect(
      (screen.getByLabelText("Week 1 label") as HTMLInputElement).maxLength
    ).toBe(40);
    expect(
      (screen.getByLabelText("Week 1 goal") as HTMLTextAreaElement).maxLength
    ).toBe(300);
    expect(
      (screen.getByLabelText("Week 1, task 1") as HTMLTextAreaElement).maxLength
    ).toBe(240);
    expect(
      (screen.getByLabelText("Intro line") as HTMLTextAreaElement).maxLength
    ).toBe(300);
  });
});
