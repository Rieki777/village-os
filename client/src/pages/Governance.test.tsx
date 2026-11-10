// @vitest-environment jsdom
/**
 * How We Govern renders from its spec (shared/pageContent/governance.ts).
 *
 * THE WIRING TEST: a distinct marker typed into every field and every list row
 * must reach the page, with Hypha configured and brochure pages on so every
 * section draws. Beside it, the two facts this conversion stopped typing:
 *   - the steward's veto window is the village's `governance.veto_hours`,
 *     read from /api/game/mechanics, where the page used to say "three days"
 *     whatever the village had set;
 *   - the Hypha section follows whether the village has a Hypha space, where
 *     it used to describe one to every village.
 * And the starter words: true of any village, so a new one is told no
 * governance method, no conflict practice and no circle it does not have.
 *
 * THE CANVAS SECTIONS, from the Governance Canvas build:
 *
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
 * Once the village saves a conflict agreement, the section prints the
 * agreement's public view instead (ConflictAgreementPublic, roles only), and
 * it falls back to the exit policy's steps while there is none or when the
 * agreement cannot be read. Those cases are in the describe named for it.
 *
 * Every case asserts what DID render as well as what did not, because a page
 * that renders nothing at all would pass an absence check on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { GOVERNANCE_PAGE } from "@shared/pageContent/governance";
import { markerDocument } from "@shared/pageContent/resolve";

let gameConfig: { project: Record<string, string>; currency: { name: string }; brochurePages?: boolean } | null;
let stored: Record<string, unknown>;
let hyphaConfigured: boolean;
let isAdmin: boolean;
/** The signed-in account the canvas sections read, or nobody. */
let viewer: { id: string; name: string; role: string } | null = null;
/** What /api/game/mechanics answers: a veto window in hours, or a failure. */
let mechanics: { vetoHours: number } | "down";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// The live ballots are the village's real votes, not page words.
vi.mock("@/components/governance/LiveDecisionsBand", () => ({ default: () => null }));
// The spread band's figures are the village's real ones; its two words are page fields, drawn as given.
vi.mock("@/components/governance/VoiceSpreadBand", () => ({
  default: ({ heading, intro }: { heading: string; intro: string }) => (
    <section>
      <h2>{heading}</h2>
      <p>{intro}</p>
    </section>
  ),
}));
vi.mock("@/components/governance/VillageAgreements", () => ({ default: () => null }));
// The real module but for the config, so the canvas sections' authToken reads an empty store.
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  useGameConfig: () => gameConfig,
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(stored[section] ?? null),
}));
/**
 * The canvas's two optional modules, both off by default (Rye's module ruling,
 * 2026-10-01). Every case here reads the page with both ON, as it was written
 * when the canvas was always there; the last describe turns them off.
 */
let modulesOn: Set<string>;
vi.mock("@/modules/ModuleProvider", () => ({
  useModuleOn: (id: string) => modulesOn.has(id),
  useHypha: () =>
    hyphaConfigured
      ? { configured: true, orgUrl: "https://dho.example.org/willowbrook", links: {} }
      : { configured: false, orgUrl: "", links: {} },
}));
vi.mock("@/contexts/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/contexts/AuthContext")>("@/contexts/AuthContext");
  return { ...actual, useIsAdmin: () => isAdmin, useAuth: () => ({ user: viewer }) };
});

import Governance from "./Governance";
import { readConflictSteps, WRITE_STEPS_HREF } from "@/components/governance/VillageConflictSteps";
import { CANVAS_BLOCK_IDS } from "@shared/governanceCanvas";
import { CANVAS_BLOCK_TEXT, CANVAS_CREDIT } from "@shared/governanceCanvasText";
import { CANVAS_PUBLIC_MATRIX_PATH, CANVAS_PUBLIC_PATH } from "@shared/canvasPublicLines";

/** The canvas sections are not page words, so hiding every section the words may hide leaves them. */
const CANVAS_SECTION_HEADINGS = ["Our Canvas, Block by Block", "Who Decides What", "The Governance Canvas, on Paper"];

const renderPage = () =>
  render(
    <Router>
      <Governance />
    </Router>,
  );
const headline = () => screen.findByRole("heading", { level: 1 });
/** A field's default, read off the spec, so a reworded default moves its test with it. */
const said = (sectionId: string, key = "heading") =>
  GOVERNANCE_PAGE.sections.find((s) => s.id === sectionId)!.fields.find((f) => f.key === key)!.default;
/** The steward section waits for the window, so it is found, never got. */
const stewardsHeading = () => screen.findByRole("heading", { name: said("stewards") });

beforeEach(() => {
  modulesOn = new Set(["canvas", "conflict-evolution"]);
  gameConfig = { project: { name: "Willowbrook", commitmentName: "Village Pledge" }, currency: { name: "Thanks" }, brochurePages: true };
  stored = {};
  hyphaConfigured = false;
  isAdmin = false;
  viewer = null;
  mechanics = { vetoHours: 72 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url) !== "/api/game/mechanics") return new Response("{}", { status: 404 });
      if (mechanics === "down") return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      return new Response(
        JSON.stringify({
          variables: [
            { key: "governance.steward_council", parsed: false, value: "false" },
            { key: "governance.veto_hours", parsed: mechanics.vetoHours, value: String(mechanics.vetoHours) },
          ],
        }),
        { status: 200 },
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("every field in the How We Govern spec reaches the page", () => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    hyphaConfigured = true;
    const doc = markerDocument(GOVERNANCE_PAGE);
    stored["page-governance"] = doc;
    renderPage();
    await headline();
    // The marker document's stewards heading replaces the default, so wait on its first paragraph.
    await screen.findByText((doc.stewards as Record<string, string>).first);

    const text = document.body.textContent ?? "";
    const missing: string[] = [];
    for (const [sectionId, section] of Object.entries(doc)) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        const values = Array.isArray(value)
          ? value.flatMap((row) => Object.entries(row as Record<string, string>).filter(([k]) => k !== "id").map(([, v]) => v))
          : [value as string];
        for (const v of values) if (!text.includes(v)) missing.push(`${sectionId}.${key} (${v})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("draws nothing of a section the village hid", async () => {
    hyphaConfigured = true;
    stored["page-governance"] = {
      principles: { hidden: true },
      circles: { hidden: true },
      conflict: { hidden: true },
      hypha: { hidden: true },
      cta: { hidden: true },
    };
    renderPage();
    await headline();
    await stewardsHeading();

    for (const hidden of ["principles", "circles", "conflict", "hypha", "cta"]) {
      expect(screen.queryByText(said(hidden)), hidden).toBeNull();
    }
    expect(screen.getByText(said("decision"))).toBeInTheDocument();
    expect(screen.getByText(said("rules"))).toBeInTheDocument();
  });

  it("draws the circle cards a village writes, and none until it does", async () => {
    renderPage();
    await headline();
    expect(screen.getByRole("link", { name: new RegExp(said("circles", "linkLabel")) })).toHaveAttribute("href", "/circles");
    expect(screen.queryByText(/General Coordinating Circle|Development Circle|Community Circle/)).toBeNull();

    stored["page-governance"] = { circles: { items: [{ name: "Water Circle", body: "Wells, tanks and the creek." }] } };
    renderPage();
    expect(await screen.findByText("Water Circle")).toBeInTheDocument();
    expect(screen.getByText("Wells, tanks and the creek.")).toBeInTheDocument();
  });
});

describe("the page with nothing saved", () => {
  it("says the starter words, filled with the village's own name and commitment", async () => {
    renderPage();

    expect(await headline()).toHaveTextContent("How Willowbrook Decides");
    expect(screen.getByText(/^Here is how a proposal becomes a decision in Willowbrook/)).toBeInTheDocument();
    expect(screen.getByText("Anyone can propose")).toBeInTheDocument();
    expect(screen.getByText("The village decides, in the way it agreed for that kind of decision.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign the Village Pledge" })).toHaveAttribute("href", "/love-letter");
  });

  it("states no governance method, conflict practice or circle as this village's fact", async () => {
    renderPage();
    await headline();
    await stewardsHeading();
    const text = document.body.textContent ?? "";

    for (const claim of [/sociocra/i, /nonviolent communication/i, /consent/i, /paramount objection/i, /mediation/i, /General Coordinating/, /Development Circle/, /\bfive circles\b/i]) {
      expect(text, String(claim)).not.toMatch(claim);
    }
  });

  it("goes without its closing invitation while brochure pages are off", async () => {
    gameConfig = { ...gameConfig!, brochurePages: false };
    renderPage();
    await headline();

    expect(screen.queryByText(said("cta"))).toBeNull();
    expect(screen.getByText(said("circles"))).toBeInTheDocument();
  });
});

describe("the steward's veto window follows governance.veto_hours", () => {
  it("says three days at the 72-hour floor, as the page always did", async () => {
    renderPage();
    await stewardsHeading();

    expect(screen.getByText(/a steward has three days to stop it before it takes effect\./)).toBeInTheDocument();
  });

  it("says the village's own longer window", async () => {
    mechanics = { vetoHours: 120 };
    renderPage();
    await stewardsHeading();

    expect(screen.getByText(/a steward has five days to stop it before it takes effect\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("three days");
  });

  it("counts a window that is not whole days in hours", async () => {
    mechanics = { vetoHours: 100 };
    renderPage();
    await stewardsHeading();

    expect(screen.getByText(/a steward has 100 hours to stop it/)).toBeInTheDocument();
  });

  // The setting refuses anything under 72 and the engine floors a stored one
  // there (`vetoHoursFrom`), so a row from before the floor still gets the
  // three days the engine actually gives. The page never promises less.
  for (const below of [0, 1, 24, 71]) {
    it(`says the 72-hour floor for a stored ${below}, as the engine enforces it`, async () => {
      mechanics = { vetoHours: below };
      renderPage();
      await stewardsHeading();

      expect(screen.getByText(/a steward has three days to stop it before it takes effect\./)).toBeInTheDocument();
    });
  }

  it("says a whole number of days past the floor in words, and 30 days in figures", async () => {
    for (const [hours, words] of [[96, "four days"], [720, "30 days"], [73, "73 hours"]] as const) {
      mechanics = { vetoHours: hours };
      const { unmount } = renderPage();
      await stewardsHeading();
      expect(screen.getByText(new RegExp(`a steward has ${words} to stop it`))).toBeInTheDocument();
      unmount();
    }
  });

  it("follows the setting inside words the village wrote itself", async () => {
    mechanics = { vetoHours: 168 };
    stored["page-governance"] = { stewards: { first: "Our stewards get {veto} to pause a passed change." } };
    renderPage();
    await stewardsHeading();

    expect(screen.getByText("Our stewards get seven days to pause a passed change.")).toBeInTheDocument();
  });

  it("claims only the floor when the setting cannot be read", async () => {
    mechanics = "down";
    renderPage();
    await stewardsHeading();

    expect(screen.getByText(/a steward has at least three days to stop it/)).toBeInTheDocument();
  });
});

describe("a village that hides every section it may", () => {
  it("keeps the top of the page and the canvas sections, and draws nothing else, the Hypha note included", async () => {
    hyphaConfigured = false;
    isAdmin = true;
    stored["page-governance"] = Object.fromEntries(
      GOVERNANCE_PAGE.sections.filter((s) => s.hideable).map((s) => [s.id, { hidden: true }]),
    );
    renderPage();
    await headline();
    // Let the veto window arrive, so a steward section held back only for it would show up here.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/game/mechanics"));
    await new Promise((r) => setTimeout(r, 0));

    // What is left is the canvas: its three headings and its own links, nothing the page words carry.
    expect(Array.from(document.querySelectorAll("h2")).map((h) => h.textContent)).toEqual(CANVAS_SECTION_HEADINGS);
    expect(document.querySelectorAll("h3")).toHaveLength(0);
    for (const a of Array.from(document.querySelectorAll("a"))) {
      expect([CANVAS_CREDIT.url, "/canvas/workbook"], a.getAttribute("href") ?? "").toContain(a.getAttribute("href"));
    }
    for (const s of GOVERNANCE_PAGE.sections.filter((x) => x.hideable)) {
      const heading = s.fields.find((f) => f.key === "heading")?.default;
      if (heading) expect(screen.queryByText(heading), s.id).toBeNull();
    }
    expect(screen.queryByText(/Only admins see this note/)).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("the Hypha section follows the village's Hypha space", () => {
  it("is not drawn while the village has no Hypha DHO link", async () => {
    renderPage();
    await headline();
    await stewardsHeading();

    expect(screen.queryByText(said("hypha"))).toBeNull();
    expect(screen.queryByText(/has a space on Hypha/)).toBeNull();
    expect(screen.queryByRole("link", { name: new RegExp(said("hypha", "linkLabel")) })).toBeNull();
  });

  it("is drawn, with its link to the guide, once the link is set", async () => {
    hyphaConfigured = true;
    renderPage();
    await headline();

    expect(screen.getByText(said("hypha"))).toBeInTheDocument();
    expect(screen.getByText("Willowbrook has a space on Hypha, an open-source platform for proposals and votes. What happens there can be read and traced.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(said("hypha", "linkLabel")) })).toHaveAttribute("href", "/co-creators-guide");
  });

  it("tells an admin, and only an admin, why it is missing", async () => {
    renderPage();
    await headline();
    expect(screen.queryByText(/Only admins see this note/)).toBeNull();

    isAdmin = true;
    renderPage();
    expect(await screen.findByText(/Only admins see this note/)).toHaveTextContent("Admin, Variables");
  });
});

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

/**
 * The conflict section asks for the village's conflict agreement first, and
 * prints the exit policy's steps while there is none, which is every case in
 * this file but the describe named for the agreement. `agreement` is what the
 * public agreement read answers.
 */
function answerWith(body: unknown, ok = true, agreement: unknown = { stored: false, agreement: null }) {
  routes["GET /api/exit-policy"] = () => ({ status: ok ? 200 : 500, body });
  routes["GET /api/conflict-agreement/public"] = () => ({ body: agreement });
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

const noCompiledCopy = () => {
  for (const sentence of COMPILED) expect(screen.queryByText(sentence)).toBeNull();
};

/*
 * The canvas cases answer every request by name and throw on any other, so a
 * new request the page makes fails a case here. The page's own words arrive
 * through the mocked village content, and its steward window from
 * /api/game/mechanics, answered here at the 72-hour floor.
 */
describe("the canvas sections", () => {
beforeEach(() => {
  fetchMock.mockReset();
  routes = {
    [`GET ${CANVAS_PUBLIC_PATH}`]: () => ({ body: noLines() }),
    "GET /api/game/mechanics": () => ({
      body: { variables: [{ key: "governance.veto_hours", parsed: 72, value: "72" }] },
    }),
  };
  answerWith(policy(VILLAGE_STEPS));
  serve();
  vi.stubGlobal("fetch", fetchMock);
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
    isAdmin = true;
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
  it("draws the canvas's public lines under the village's own heading, on the same route", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "How Willowbrook Decides" })).toBeTruthy();
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

  it("opens the pen's form on the held-back line and names the word that matched (W3a-withheld-line-hidden-from-pen)", async () => {
    viewer = { id: "u-wren", name: "Wren Halloway", role: "member" };
    routes["GET /api/canvas"] = () => ({ body: memberCanvas(true) });
    // The server sends `forPen` only to a signed-in pen (server/routes/canvasPublic.test.ts).
    routes[`GET ${CANVAS_PUBLIC_PATH}`] = () => ({
      body: {
        blocks: CANVAS_BLOCK_IDS.map((id) =>
          id === "roles"
            ? { id, line: null, withheld: true, forPen: { line: "Ash keeps the keys to the barn.", matched: "Ash" } }
            : { id, line: null, withheld: false },
        ),
      },
    });
    renderPage();
    const note = await screen.findByTestId("public-line-withheld-roles");
    await waitFor(() => expect(note.textContent).toContain('"Ash"'));
    const card = screen.getByTestId("public-line-roles");
    fireEvent.click(within(card).getByRole("button", { name: "Change the public line" }));
    expect((within(card).getByLabelText("The public line for Roles") as HTMLInputElement).value).toBe("Ash keeps the keys to the barn.");
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
    expect(await screen.findByRole("heading", { level: 2, name: "Who Decides What" })).toBeTruthy();
    expect(fetched(`GET ${CANVAS_PUBLIC_MATRIX_PATH}`)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show who decides what" }));
    expect(await screen.findByText("Changing a dial")).toBeTruthy();
    expect(fetched(`GET ${CANVAS_PUBLIC_MATRIX_PATH}`)).toBe(true);
    expect(fetched("GET /api/canvas/decision-matrix")).toBe(false);
  });

  it("mounts the conflict agreement's public view in the conflict section, holding the village's steps while there is none", async () => {
    renderPage();
    const slot = await screen.findByTestId("conflict-agreement-slot");
    expect(await within(slot).findByText(VILLAGE_STEPS[0])).toBeTruthy();
    expect(fetched("GET /api/conflict-agreement/public")).toBe(true);
  });
});

describe("the Governance page once the village has a conflict agreement", () => {
  const AGREEMENT = {
    steps: [
      { what: "Talk it through over tea within the week", whoInRoom: "the two of us" },
      { what: null, whoInRoom: null },
    ],
    careRole: { id: "care", name: "Hearth Keeper", heldToday: true },
    coverRole: { id: "cover", name: "Hearth Cover", heldToday: false },
    replyHours: 48,
    outsideContacts: [{ id: "oc-1", label: "Ombuds at Cohort Care" }],
    whenPowerInvolved: { role: "Stewards", outsideContact: "", words: "" },
    consequencesLadder: { rungs: [{ rung: 1, words: "We ask for a change." }], appeal: "" },
    practices: [],
    version: 2,
    adoptedHow: "founders",
    adoptedAt: "2026-09-20T10:00:00.000Z",
    reviewDate: "2027-01-15",
    withheld: true,
  };

  it("prints the agreement with roles, says what was held back, and never the exit policy's steps instead", async () => {
    answerWith(policy(VILLAGE_STEPS), true, { stored: true, agreement: AGREEMENT });
    renderPage();

    expect(await screen.findByText("Talk it through over tea within the week")).toBeTruthy();
    // Printed where the page mounts it, in the conflict section.
    expect(within(screen.getByTestId("conflict-agreement-slot")).getByText(/Hearth Keeper/)).toBeTruthy();
    expect(screen.getByText(/In the room: the two of us/)).toBeTruthy();
    expect(screen.getByText(/Hearth Keeper/)).toBeTruthy();
    expect(screen.getByText(/hears back within 48 hours/)).toBeTruthy();
    expect(screen.getByText(/Ombuds at Cohort Care/)).toBeTruthy();
    expect(screen.getAllByText("Names a person, so members only.")).toHaveLength(2);
    expect(screen.getByText(/Parts of this agreement name people/)).toBeTruthy();
    expect(screen.queryByText(VILLAGE_STEPS[1])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/exit-policy");
    noCompiledCopy();
  });

  it("falls back to the exit policy's steps when the agreement cannot be read", async () => {
    routes["GET /api/conflict-agreement/public"] = () => ({ status: 500, body: {} });
    renderPage();
    expect(await screen.findByText(VILLAGE_STEPS[0])).toBeTruthy();
  });
});

/*
 * THE FIRST VILLAGE'S STORY IS NOT EVERY VILLAGE'S (audit of Wave 4). This
 * page is served by every village whatever its modules. Its hero said the
 * village "uses sociocracy" and its Hypha section said governance "is logged
 * on Hypha"; the decision method is a dial and the Hypha bridge is an optional
 * module needing a DHO of the village's own. The hero is now the village's own
 * words and the Hypha section draws only while a Hypha space is set, so a
 * fresh village, brochure off, is told neither.
 */
describe("what a village without the brochure is told", () => {
  it("names no governance system and no Hypha log while the brochure is off", async () => {
    gameConfig = { ...gameConfig!, brochurePages: false };
    renderPage();
    await screen.findByTestId("public-line-purpose");
    expect(screen.queryByText(/sociocracy/i)).toBeNull();
    expect(screen.queryByText(/Hypha/)).toBeNull();
  });
});

/*
 * BOTH CANVAS MODULES OFF: the page is what it was before the canvas build.
 * No public lines, no matrix, no workbook card, none of their requests, and
 * the conflict section prints the exit policy's steps without asking for an
 * agreement, even where one is stored.
 */
describe("the Governance page with the canvas modules off", () => {
  it("draws no canvas section, asks no canvas door, and prints the exit policy's steps in the conflict section", async () => {
    modulesOn = new Set();
    answerWith(policy(VILLAGE_STEPS), true, { stored: true, agreement: { steps: [{ what: "An agreement step", whoInRoom: null }] } });
    renderPage();
    await headline();
    const slot = await screen.findByTestId("conflict-agreement-slot");
    expect(await within(slot).findByText(VILLAGE_STEPS[0])).toBeTruthy();
    await waitFor(() => expect(fetched("GET /api/game/mechanics")).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    const h2s = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent);
    expect(h2s.length, "the page's own sections still draw").toBeGreaterThan(0);
    for (const h of CANVAS_SECTION_HEADINGS) expect(h2s, h).not.toContain(h);
    expect(screen.queryByTestId("public-line-purpose")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show who decides what" })).toBeNull();
    expect(document.querySelector('a[href="/canvas/workbook"]')).toBeNull();
    expect(screen.queryByText("An agreement step")).toBeNull();
    expect(fetched(`GET ${CANVAS_PUBLIC_PATH}`)).toBe(false);
    expect(fetched(`GET ${CANVAS_PUBLIC_MATRIX_PATH}`)).toBe(false);
    expect(fetched("GET /api/conflict-agreement/public")).toBe(false);
    expect(fetched("GET /api/exit-policy")).toBe(true);
  });
});
});
