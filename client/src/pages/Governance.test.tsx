// @vitest-environment jsdom
/**
 * "HOW WE WORK TOGETHER" (/governance), renamed on 2026-09-28, and what a
 * visitor and a member each read there: every block's public line under the
 * canvas's question, the words kept for members (members only), the Decision
 * Matrix from its PUBLIC door, and never a reading or the radar. Those cases
 * are in the describe named for the page, at the end.
 *
 * The page's conflict section prints THE VILLAGE'S OWN steps.
 *
 * It used to print three compiled paragraphs every fork published as its own
 * practice, ending "No one is removed from the community without a circle
 * consent vote", while removing a member is an admin act in the server. The
 * section now reads the restorative steps of the published exit policy from
 * `GET /api/exit-policy`, and the server says in `platformWording` whether
 * those steps are still the platform's starting words.
 *
 * Every case asserts what DID render as well as what did not, because a page
 * that renders nothing at all would pass an absence check on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

let adminViewer = false;
let viewer: { id: string; name: string; role: string } | null = null;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// The live-votes band has its own suite and reaches for the module registry.
vi.mock("@/components/governance/LiveDecisionsBand", () => ({ default: () => null }));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/contexts/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/contexts/AuthContext")>("@/contexts/AuthContext");
  return { ...actual, useIsAdmin: () => adminViewer, useAuth: () => ({ user: viewer }) };
});

import Governance from "./Governance";
import { readConflictSteps, WRITE_STEPS_HREF } from "@/components/governance/VillageConflictSteps";
import { CANVAS_BLOCK_IDS } from "@shared/governanceCanvas";
import { CANVAS_BLOCK_TEXT, CANVAS_CREDIT } from "@shared/governanceCanvasText";
import { CANVAS_PUBLIC_MATRIX_PATH, CANVAS_PUBLIC_PATH } from "@shared/canvasPublicLines";

/** The platform's starting restorative steps, as `DEFAULT_EXIT_POLICY` ships them. */
const PLATFORM_STEPS = [
  "Private intake with the contact role, never a public thread",
  "A facilitated repair conversation",
  "A written agreement with a review date; only the agreement and its status enter the record",
];

/** Steps a village wrote in its own words. */
const VILLAGE_STEPS = [
  "Talk it through over tea within the week",
  "Ask a listener from the Hearth Circle to sit with you both",
  "Write down what you agreed and check in after one moon",
];

/** Sentences from the compiled copy this section used to print. None may come back. */
const COMPILED = [
  /No one is removed from the community without a circle consent vote/,
  /it goes through three stages/,
  /the relevant circle holds a mediation/,
  /A trained member from a different circle/,
];

const fetchMock = vi.fn();

/**
 * What the server answers, by "METHOD path". Anything the page asks for that
 * is not here throws, so a new request the page makes is a failing test and
 * never a silent pass.
 */
type Answer = { status?: number; body: unknown };
let routes: Record<string, (init?: RequestInit) => Answer> = {};

function serve() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch ${key}`);
    const { status = 200, body } = handler(init);
    return { ok: status < 400, status, json: async () => body };
  });
}

/** Twelve blocks with no public line, as a fresh village answers. */
const noLines = () => ({ blocks: CANVAS_BLOCK_IDS.map((id) => ({ id, line: null, withheld: false })) });

function answerWith(body: unknown, ok = true) {
  routes["GET /api/exit-policy"] = () => ({ status: ok ? 200 : 500, body });
}

const fetched = (key: string) =>
  fetchMock.mock.calls.some(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${url}` === key);

function policy(steps: string[], opts: { placeholder?: boolean; platformWording?: unknown } = {}) {
  return {
    policy: { placeholder: opts.placeholder ?? false, restorative: { intakeContactRole: "", steps } },
    configured: true,
    platformWording: opts.platformWording ?? [],
  };
}

const renderPage = () =>
  render(
    <Router>
      <Governance />
    </Router>,
  );

const noCompiledCopy = () => {
  for (const sentence of COMPILED) expect(screen.queryByText(sentence)).toBeNull();
};

beforeEach(() => {
  adminViewer = false;
  viewer = null;
  fetchMock.mockReset();
  routes = { [`GET ${CANVAS_PUBLIC_PATH}`]: () => ({ body: noLines() }) };
  answerWith(policy(VILLAGE_STEPS));
  serve();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Governance page's conflict section", () => {
  it("prints the steps the village wrote, in order, from the published exit policy", async () => {
    answerWith(policy(VILLAGE_STEPS));
    renderPage();

    const first = await screen.findByText(VILLAGE_STEPS[0]);
    const list = first.closest("ol");
    expect(list).not.toBeNull();
    expect(Array.from(list!.querySelectorAll("li")).map((li) => li.textContent)).toEqual(VILLAGE_STEPS);
    expect(screen.getByText(/these are the steps this village wrote for it/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Read the village's exit policy/ }).getAttribute("href")).toBe("/exit-policy");
    expect(fetchMock).toHaveBeenCalledWith("/api/exit-policy");
    // Adopted terms carry no draft note.
    expect(screen.queryByText(/still a draft/)).toBeNull();
    noCompiledCopy();
  });

  it("says the village has not written its steps while they are still the platform's words", async () => {
    answerWith(policy(PLATFORM_STEPS, { placeholder: true, platformWording: ["restorativeSteps", "unwindSteps"] }));
    renderPage();

    expect(await screen.findByText("This village has not written its conflict steps yet.")).toBeTruthy();
    // The platform's starting steps are never printed as the village's own.
    for (const step of PLATFORM_STEPS) expect(screen.queryByText(step)).toBeNull();
    // A member is not handed an admin door.
    expect(screen.queryByRole("link", { name: /Write them in Admin/ })).toBeNull();
    noCompiledCopy();
  });

  it("hands an admin the door to write them", async () => {
    adminViewer = true;
    answerWith(policy(PLATFORM_STEPS, { placeholder: true, platformWording: ["restorativeSteps"] }));
    renderPage();

    const door = await screen.findByRole("link", { name: /Write them in Admin, under Departures/ });
    expect(door.getAttribute("href")).toBe(WRITE_STEPS_HREF);
    expect(WRITE_STEPS_HREF).toBe("/admin?tab=exits-admin");
    expect(screen.getByText("This village has not written its conflict steps yet.")).toBeTruthy();
  });

  it("prints the village's own steps as a draft while the policy still carries its draft flag", async () => {
    answerWith(policy(VILLAGE_STEPS, { placeholder: true, platformWording: ["valuationMethod"] }));
    renderPage();

    expect(await screen.findByText(VILLAGE_STEPS[1])).toBeTruthy();
    expect(screen.getByText(/These steps are still a draft/)).toBeTruthy();
    noCompiledCopy();
  });

  it("says the steps could not be loaded when the read fails, and prints nothing compiled in their place", async () => {
    answerWith({ error: "boom" }, false);
    renderPage();

    expect(await screen.findByText(/could not be loaded just now/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Read the village's exit policy/ })).toBeTruthy();
    noCompiledCopy();
  });
});

describe("readConflictSteps, the rule under the section", () => {
  it("treats an answer with no platformWording list as unwritten, so unvouched words are never the village's", () => {
    expect(readConflictSteps({ policy: { restorative: { steps: VILLAGE_STEPS } } })).toEqual({ state: "unwritten" });
  });

  it("treats an empty or blank step list as unwritten", () => {
    expect(readConflictSteps(policy([]))).toEqual({ state: "unwritten" });
    expect(readConflictSteps(policy(["  ", ""]))).toEqual({ state: "unwritten" });
  });

  it("keeps the village's words and drops blank lines", () => {
    expect(readConflictSteps(policy(["One", " ", "Two"]))).toEqual({ state: "written", steps: ["One", "Two"], draft: false });
  });
});

/** A signed-in member's answer from GET /api/canvas: words for members, and a reading the page must never show. */
function memberCanvas(mayRecord: boolean) {
  return {
    mayRecord,
    blocks: CANVAS_BLOCK_IDS.map((id) => ({
      id,
      latest:
        id === "power"
          ? {
              id: 1,
              level: 2,
              word: "Forming",
              sentence: "A reading the public page must never print.",
              moment: "baseline",
              momentLabel: "Baseline",
              recordedBy: { id: "u-wren", name: "Wren" },
              recordedAt: "2026-09-20T10:00:00.000Z",
            }
          : null,
      history: [],
      memberAnswers:
        id === "power" ? [{ section: "decisions", title: "How we decide", body: "The circle decides by consent." }] : [],
    })),
  };
}

describe("How we work together", () => {
  it("is the page's heading, on the same route", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "How we work together" })).toBeTruthy();
    // The old heading is gone.
    expect(screen.queryByText("Power Belongs to the Circle, Not the Person")).toBeNull();
    await screen.findByTestId("public-line-purpose");
  });

  it("shows a visitor every block in canvas order, each under the canvas's own question, with the credit", async () => {
    routes[`GET ${CANVAS_PUBLIC_PATH}`] = () => ({
      body: {
        blocks: CANVAS_BLOCK_IDS.map((id) => ({
          id,
          line: id === "conflict" ? "Our care holder answers within two days." : null,
          withheld: id === "roles",
        })),
      },
    });
    renderPage();

    await screen.findByText("Our care holder answers within two days.");
    const list = screen.getByTestId("canvas-public-lines").querySelector("ol")!;
    expect(Array.from(list.children).map((c) => c.getAttribute("data-testid"))).toEqual(
      CANVAS_BLOCK_IDS.map((id) => `public-line-${id}`),
    );
    for (const id of CANVAS_BLOCK_IDS) {
      expect(within(screen.getByTestId(`public-line-${id}`)).getByText(CANVAS_BLOCK_TEXT[id].question)).toBeTruthy();
    }
    expect(within(screen.getByTestId("public-line-purpose")).getByText("Not written yet.")).toBeTruthy();
    // A held-back line says so, and never how or why, to a visitor.
    expect(within(screen.getByTestId("public-line-roles")).getByText(/hidden for now/)).toBeTruthy();
    expect(screen.queryByTestId("public-line-withheld-roles")).toBeNull();
    const credit = screen.getByTestId("canvas-public-credit");
    const link = within(credit).getByRole("link");
    expect(link.getAttribute("href")).toBe(CANVAS_CREDIT.url);
    expect(link.textContent).toContain(CANVAS_CREDIT.text);
  });

  it("never asks the members' door for a visitor, so no reading, no member words and no radar can reach the page", async () => {
    renderPage();
    await screen.findByTestId("public-line-power");
    expect(fetched(`GET ${CANVAS_PUBLIC_PATH}`)).toBe(true);
    expect(fetched("GET /api/canvas")).toBe(false);
    expect(document.querySelector('[data-testid="canvas-radar"]')).toBeNull();
    expect(screen.queryByTestId("member-answers-power")).toBeNull();
    expect(screen.queryByTestId("canvas-member-note")).toBeNull();
    expect(screen.queryByRole("button", { name: /public line/ })).toBeNull();
  });

  it("shows a signed-in member the words kept for members, and still no reading and no radar", async () => {
    viewer = { id: "u-ash", name: "Ash Brook", role: "member" };
    routes["GET /api/canvas"] = () => ({ body: memberCanvas(false) });
    renderPage();

    const answers = await screen.findByTestId("member-answers-power");
    expect(within(answers).getByText("The circle decides by consent.")).toBeTruthy();
    expect(within(answers).getByText("How we decide")).toBeTruthy();
    expect(screen.getByTestId("canvas-member-note")).toBeTruthy();
    // The same answer carried a reading; this page prints none of it.
    expect(screen.queryByText("A reading the public page must never print.")).toBeNull();
    expect(screen.queryByText("Forming")).toBeNull();
    expect(document.querySelector('[data-testid="canvas-radar"]')).toBeNull();
    // A member without the pen is offered no way to write.
    expect(screen.queryByRole("button", { name: /public line/ })).toBeNull();
    // Blocks with nothing for members open nothing.
    expect(screen.queryByTestId("member-answers-purpose")).toBeNull();
  });

  it("shows a signed-in account the members' door refuses the public lines only", async () => {
    viewer = { id: "u-rook", name: "Rook Talbot", role: "member" };
    routes["GET /api/canvas"] = () => ({ status: 403, body: { error: "for members" } });
    renderPage();
    await screen.findByTestId("public-line-power");
    await waitFor(() => expect(fetched("GET /api/canvas")).toBe(true));
    expect(screen.queryByTestId("member-answers-power")).toBeNull();
    expect(screen.queryByTestId("canvas-member-note")).toBeNull();
  });

  it("lets the pen write a line, shows the server's refusal in its words, and shows the saved line", async () => {
    viewer = { id: "u-wren", name: "Wren Halloway", role: "member" };
    routes["GET /api/canvas"] = () => ({ body: memberCanvas(true) });
    const sent: unknown[] = [];
    let refuse = true;
    routes[`PUT ${CANVAS_PUBLIC_PATH}/conflict`] = (init) => {
      sent.push(JSON.parse(String(init?.body)));
      return refuse
        ? { status: 400, body: { error: '"Ash" is the name of someone in this village, and a public line names nobody.' } }
        : { body: { block: { id: "conflict", line: "Our care holder answers within two days.", withheld: false } } };
    };
    renderPage();

    expect(await screen.findByTestId("canvas-pen-note")).toBeTruthy();
    const card = screen.getByTestId("public-line-conflict");
    fireEvent.click(await within(card).findByRole("button", { name: "Write the public line" }));
    const input = within(card).getByLabelText("The public line for Conflict");
    expect(within(card).getByText(/Anyone can read this line, signed in or not/)).toBeTruthy();

    fireEvent.change(input, { target: { value: "Ash answers within two days." } });
    fireEvent.click(within(card).getByRole("button", { name: "Save the line" }));
    expect((await within(card).findByRole("alert")).textContent).toContain('"Ash" is the name of someone in this village');
    expect(within(card).queryByTestId("public-line-text-conflict")).toBeNull();

    refuse = false;
    fireEvent.change(input, { target: { value: "  Our care holder answers within two days. " } });
    fireEvent.click(within(card).getByRole("button", { name: "Save the line" }));
    expect((await within(card).findByTestId("public-line-text-conflict")).textContent).toBe(
      "Our care holder answers within two days.",
    );
    expect(sent).toEqual([{ line: "Ash answers within two days." }, { line: "Our care holder answers within two days." }]);
  });

  it("tells the pen why a line is hidden, and the visitor nothing more", async () => {
    viewer = { id: "u-wren", name: "Wren Halloway", role: "member" };
    routes["GET /api/canvas"] = () => ({ body: memberCanvas(true) });
    routes[`GET ${CANVAS_PUBLIC_PATH}`] = () => ({
      body: { blocks: CANVAS_BLOCK_IDS.map((id) => ({ id, line: null, withheld: id === "roles" })) },
    });
    renderPage();
    expect((await screen.findByTestId("public-line-withheld-roles")).textContent).toMatch(/holds the name of someone/);
    expect(within(screen.getByTestId("public-line-roles")).getByRole("button", { name: "Change the public line" })).toBeTruthy();
  });

  it("reads the Decision Matrix from its PUBLIC door, and only when a reader opens it", async () => {
    routes[`GET ${CANVAS_PUBLIC_MATRIX_PATH}`] = () => ({
      body: {
        groups: [
          {
            id: "votes",
            title: "Votes the village holds",
            intro: "Each is a ballot.",
            rows: [
              {
                key: "vote:x",
                decision: "Changing a dial",
                detail: null,
                riskTags: [],
                approval: { who: "roll", text: "The members on the roll" },
                consultation: [],
                information: ["Every member"],
                method: { lines: ["Consent"] },
              },
            ],
          },
        ],
        notes: [],
        vetoOverrideAvailable: false,
      },
    });
    renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Who Decides What" })).toBeTruthy();
    expect(fetched(`GET ${CANVAS_PUBLIC_MATRIX_PATH}`)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show who decides what" }));
    expect(await screen.findByText("Changing a dial")).toBeTruthy();
    expect(fetched(`GET ${CANVAS_PUBLIC_MATRIX_PATH}`)).toBe(true);
    expect(fetched("GET /api/canvas/decision-matrix")).toBe(false);
  });

  it("keeps a marked slot for the conflict agreement's public view, holding the village's steps until it lands", async () => {
    renderPage();
    const slot = screen.getByTestId("conflict-agreement-slot");
    expect(await within(slot).findByText(VILLAGE_STEPS[0])).toBeTruthy();
  });
});
