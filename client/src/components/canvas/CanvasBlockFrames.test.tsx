// @vitest-environment jsdom
/**
 * ONE BLOCK'S FIVE FRAMES, RENDERED (Wave 3b, 2026-09-28).
 *
 * Driven from the Canvas view the way a person meets them: the baseline's
 * card, "Open this block", then each frame button. The server's answers are
 * the shapes docs/canvas-api.md promises, and every request the page makes is
 * answered here by method and path, so a request the page should not make
 * fails the test by name.
 *
 * The permission states are the point: a visitor never reaches the frames, a
 * member suggests and withdraws and is offered no Adopt, the pen adopts with
 * a public note, and what adopting does is said truthfully on both sides of
 * the Birthing. The lazy children that fetch for themselves (the conflict
 * agreement's editor and the platform's half of the Decision Matrix) are
 * stood in for, because their own suites cover them; this file asserts that
 * the Say frame mounts them on the right block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { CANVAS_BLOCK_IDS } from "@shared/governanceCanvas";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));
/** Whether the viewer is an administrator, for the See frame's links. Partial: the rest of the module is real. */
const auth = vi.hoisted(() => ({ admin: false }));
vi.mock("@/contexts/AuthContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/AuthContext")>()),
  useIsAdmin: () => auth.admin,
}));
vi.mock("./ConflictAgreementEditor", () => ({
  default: () => <div data-testid="agreement-editor">The conflict agreement editor</div>,
}));
vi.mock("./DecisionMatrix", () => ({
  default: () => <div data-testid="generated-matrix">The platform's half of the matrix</div>,
}));

import { CanvasBaseline } from "./CanvasBaseline";

const NOTE_IS_PUBLIC = "Everyone in the village can read what you write here.";

const reading = (over: Record<string, unknown> = {}) => ({
  id: 7,
  level: 1,
  word: "Absent",
  sentence: "We have not decided how decisions are made.",
  moment: "baseline",
  momentLabel: "Baseline",
  recordedBy: { id: "u1", name: "Ada" },
  recordedAt: "2026-10-03T10:00:00.000Z",
  ...over,
});

const canvas = (mayRecord: boolean) => ({
  mayRecord,
  blocks: CANVAS_BLOCK_IDS.map((id) =>
    id === "power"
      ? { id, latest: reading(), history: [reading(), reading({ id: 6, word: "Absent", sentence: "Nobody had asked who decides." })] }
      : { id, latest: null, history: [] },
  ),
});

const penView = (over: Record<string, unknown> = {}) => ({
  pen: "prose",
  how: "act",
  who: "the-gate",
  sentence: "Whoever holds the village's story adopts these words.",
  ballotBuilt: true,
  youMayAdopt: false,
  ...over,
});

/** A suggestion as the server lists it. */
const suggestion = (over: Record<string, unknown> = {}) => ({
  id: 41,
  blockId: "power",
  target: "words",
  sectionId: "decisions",
  door: null,
  change: null,
  body: "We decide by consent at the Saturday circle, and write each decision down the same day.",
  servesPurpose: "It keeps every voice in the room while we learn together how this village decides things.",
  source: "member",
  proposedBy: { id: "u5", name: "Sage" },
  createdAt: "2026-10-04T09:00:00.000Z",
  status: "open",
  pen: penView(),
  youProposedIt: false,
  ...over,
});

/** GET /api/canvas/blocks/power, for a member or for the pen, before or after the Birthing. */
const powerBlock = ({ pen = false, birthed = false, proposals = [suggestion()] }: { pen?: boolean; birthed?: boolean; proposals?: unknown[] } = {}) => ({
  block: { id: "power", number: 7, name: "Power", briefSections: ["decisions"] },
  answer: {
    sections: [{ id: "decisions", title: "Decisions", readable: true, status: "blank" }],
  },
  reading: reading(),
  observed: [
    { id: "default-method", text: "Village-wide ballots decide by this village's own dials.", href: "/game-mechanics", label: "How ballots decide" },
    { id: "birthing", text: "The Game has not started yet.", href: "/journey-to-launch", label: "The launch checklist" },
  ],
  proposals,
  doors: [
    { id: "dial:governance.default_method", label: "How village-wide ballots decide", href: "/game-mechanics", kind: "dial", wired: true },
    { id: "module:governance", label: "Governance switched on for members", href: "/admin?tab=modules&module=governance", kind: "module", wired: true },
  ],
  pens: {
    words: penView({ youMayAdopt: pen }),
    dial: penView({ pen: "dial", how: birthed ? "ballot" : "act", who: birthed ? "any-member" : "the-gate", sentence: "Whoever may turn the village's dials adopts this before the Game starts.", youMayAdopt: pen }),
    consequence: penView({ pen: "consequence", how: birthed ? "ballot" : "act", who: birthed ? "any-member" : "admins", sentence: "The founders adopt this before the Game starts.", ballotBuilt: !birthed, youMayAdopt: pen && !birthed }),
  },
  birthed,
  servesPurpose: { scoped: true, matrixScoped: true, requiredToday: true },
  notesArePublic: NOTE_IS_PUBLIC,
});

const conflictBlock = () => ({
  block: { id: "conflict", number: 8, name: "Conflict", briefSections: [], elsewhere: { note: "Conflict lives in its own agreement.", href: "/governance", label: "How we work together" } },
  answer: { sections: [] },
  reading: null,
  observed: [{ id: "reply-time", text: "A member who raises a conflict hears back within 48 hours.", href: "/exit-policy", label: "Leaving Well" }],
  proposals: [],
  doors: [{ id: "exit:restorative", label: "The restorative steps, the care role, its cover and the promised reply time", href: "/exit-policy", kind: "exit-policy", wired: true }],
  pens: { consequence: penView({ pen: "consequence", who: "admins", sentence: "The founders adopt this before the Game starts." }) },
  birthed: false,
  servesPurpose: { scoped: true, matrixScoped: false, requiredToday: true },
  notesArePublic: NOTE_IS_PUBLIC,
});

const rows = (pen: boolean, birthed = false) => ({
  rows: [
    {
      id: 3, subject: "Spending under a hundred", approval: "The treasurer", consultation: "Nobody yet", information: "The circle",
      method: "", riskTags: ["money"], updatedBy: { id: "u1", name: "Ada" }, updatedAt: "2026-10-02T09:00:00.000Z",
    },
  ],
  pen: penView({ pen: "consequence", how: birthed ? "ballot" : "act", who: birthed ? "any-member" : "admins", sentence: "The founders adopt this before the Game starts.", ballotBuilt: !birthed, youMayAdopt: pen && !birthed }),
  riskTagsAreInformation: "Risk tags are information. None of them changes who decides or how.",
});

/** One answer per request, in the order given; once they are used up, the last one answers again. */
type Answer = { status: number; body: unknown; used: boolean };
let calls: Array<{ key: string; init: any }>;
let answers: Map<string, Answer[]>;

const answer = (method: string, url: string, status: number, body: unknown) => {
  const key = `${method} ${url}`;
  answers.set(key, [...(answers.get(key) ?? []), { status, body, used: false }]);
};

beforeEach(() => {
  calls = [];
  answers = new Map();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any = {}) => {
      const key = `${init.method ?? "GET"} ${url}`;
      calls.push({ key, init });
      const queue = answers.get(key) ?? [];
      const next = queue.find((a) => !a.used) ?? queue[queue.length - 1];
      if (!next) throw new Error(`the page asked for ${key}, which this test does not answer`);
      next.used = true;
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
    }),
  );
});

afterEach(() => {
  auth.admin = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const draw = () =>
  render(
    <Router>
      <CanvasBaseline />
    </Router>,
  );

/** The Power card, opened, on the frame asked for. */
async function openPower(frame?: "See" | "Learn" | "Say" | "Adopt") {
  draw();
  const card = await screen.findByTestId("canvas-block-power");
  fireEvent.click(within(card).getByRole("button", { name: "Open this block: Power" }));
  const frames = await screen.findByTestId("canvas-frames-power");
  if (frame) fireEvent.click(within(frames).getByRole("button", { name: frame }));
  return within(frames);
}

const asked = (key: string) => calls.filter((c) => c.key === key);

describe("who reaches the frames", () => {
  it("a visitor never does: the canvas is refused and no block can be opened", async () => {
    answer("GET", "/api/canvas", 401, { error: "auth_required" });
    draw();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Sign in to read the canvas."));
    expect(screen.queryByRole("button", { name: /Open this block/ })).toBeNull();
    expect(screen.queryByTestId(/^canvas-frames-/)).toBeNull();
    expect(calls.map((c) => c.key)).toEqual(["GET /api/canvas"]);
  });

  it("an account the village has not admitted is told so in the server's words, with nothing to retry", async () => {
    const sentence = "The canvas and its season are for the village's members. They open to you once the village admits you.";
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 403, { error: sentence });
    const frames = await openPower("See");
    await waitFor(() => expect(frames.getByRole("alert").textContent).toBe(sentence));
    expect(frames.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(frames.queryByTestId("canvas-see-facts")).toBeNull();
  });

  it("a member opens a block on Sense, which asks the server for nothing more", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    const frames = await openPower();
    expect(frames.getByRole("button", { name: "Sense" }).getAttribute("aria-pressed")).toBe("true");
    expect(frames.getByText("Earlier readings")).toBeTruthy();
    expect(frames.getByText(/Nobody had asked who decides/)).toBeTruthy();
    expect(frames.queryByRole("button", { name: /record a reading/i })).toBeNull();
    expect(calls.map((c) => c.key)).toEqual(["GET /api/canvas"]);
    // Open, the card takes both columns; closed, it gives one back.
    const card = screen.getByTestId("canvas-block-power");
    expect(card.className).toContain("md:col-span-2");
    fireEvent.click(within(card).getByRole("button", { name: "Close this block: Power" }));
    expect(card.className).not.toContain("md:col-span-2");
    expect(screen.queryByTestId("canvas-frames-power")).toBeNull();
  });
});

describe("Sense, where the reading form moved", () => {
  it("the pen's Record a reading on the closed card opens the block on Sense with the form open", async () => {
    answer("GET", "/api/canvas", 200, canvas(true));
    draw();
    const legal = within(await screen.findByTestId("canvas-block-legal"));
    fireEvent.click(legal.getByRole("button", { name: /record a reading/i }));
    expect(await legal.findByRole("button", { name: /save this reading/i })).toBeTruthy();
    expect(legal.getByText("Nobody has read Legal yet.")).toBeTruthy();
    // The card's own shortcut steps aside while the block is open, so there is one way in.
    expect(legal.queryByRole("button", { name: /record a reading/i })).toBeNull();
  });
});

describe("See", () => {
  it("lists the server's facts with their controls, where the words and the settings part, and the settings behind the block", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock());
    const frames = await openPower("See");
    const facts = within(await frames.findByTestId("canvas-see-facts"));
    expect(facts.getByText(/Village-wide ballots decide by this village's own dials/)).toBeTruthy();
    expect(facts.getByRole("link", { name: "How ballots decide" }).getAttribute("href")).toBe("/game-mechanics");
    expect(asked("GET /api/canvas/blocks/power")[0].init.headers.Authorization).toBe("Bearer a-token");

    const gaps = frames.getByTestId("canvas-see-gaps").textContent ?? "";
    expect(gaps).toContain(
      "Nothing is written yet under Decisions, while the settings behind this block, listed below, already work as they are set today.",
    );
    // A door's name is never read out as a state: governance is off by default.
    expect(gaps).not.toMatch(/switched on/);
    const doors = within(frames.getByTestId("canvas-see-doors"));
    expect(doors.getByText(/How village-wide ballots decide\./)).toBeTruthy();
    // A member is not sent to an administrators' page, whose only button signs them out.
    expect(doors.getAllByRole("link", { name: "Where it is set" }).map((a) => a.getAttribute("href"))).toEqual(["/game-mechanics"]);
    expect(doors.getByText("Set on the administrators' pages.")).toBeTruthy();
    expect(frames.queryAllByRole("link").map((a) => a.getAttribute("href") ?? "").filter((h) => h.startsWith("/admin"))).toEqual([]);
  });

  it("gives an administrator the link to the administrators' page as well", async () => {
    auth.admin = true;
    answer("GET", "/api/canvas", 200, canvas(true));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ pen: true }));
    const frames = await openPower("See");
    const doors = within(await frames.findByTestId("canvas-see-doors"));
    expect(doors.getAllByRole("link", { name: "Where it is set" }).map((a) => a.getAttribute("href"))).toEqual([
      "/game-mechanics",
      "/admin?tab=modules&module=governance",
    ]);
    expect(doors.queryByText("Set on the administrators' pages.")).toBeNull();
  });
});

describe("Learn", () => {
  it("says plainly what is not built, offers no button that would do nothing, and links only to what exists", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    const frames = await openPower("Learn");
    expect(frames.getByTestId("canvas-learn-not-built").textContent).toBe(
      "Readings and tools picked for Power, and a way to ask a question about it, are not built yet.",
    );
    expect(frames.queryByRole("button", { name: /ask/i })).toBeNull();
    expect(frames.getByRole("link", { name: /Print the canvas workbook/ }).getAttribute("href")).toBe("/canvas/workbook");
    // Learn needs nothing from the server.
    expect(calls.map((c) => c.key)).toEqual(["GET /api/canvas"]);
  });
});

describe("Say: a member suggests", () => {
  it("says the note is public before the first field, checks with the route's validator, then sends with a token", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ proposals: [] }));
    answer("GET", "/api/canvas/decision-matrix/rows", 200, rows(false));
    const frames = await openPower("Say");
    const form = within(await frames.findByRole("form", { name: "Suggest a change to Power" }));

    // Public before typing: the sentence comes before every field in the form.
    const publicLine = form.getByTestId("canvas-notes-public");
    expect(publicLine.textContent).toContain(NOTE_IS_PUBLIC);
    for (const box of form.getAllByRole("textbox")) {
      expect(publicLine.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    // The route's own validator refuses an empty suggestion, and nothing is sent.
    fireEvent.click(form.getByRole("button", { name: "Send this suggestion" }));
    expect(form.getByRole("alert").textContent).toBe("Write the suggestion in a sentence or more.");
    expect(asked("POST /api/canvas/proposals")).toHaveLength(0);

    // Power changes how the village works, so the purpose line is asked for once a statement exists.
    fireEvent.change(form.getByLabelText("The words you suggest for Decisions"), { target: { value: "We decide by consent at the Saturday circle." } });
    fireEvent.click(form.getByRole("button", { name: "Send this suggestion" }));
    expect(form.getByRole("alert").textContent).toMatch(/say in a line how it serves the governing purpose/);
    expect(asked("POST /api/canvas/proposals")).toHaveLength(0);

    fireEvent.change(form.getByLabelText(/How it serves the governing purpose/), {
      target: { value: "It keeps every voice in the room while we learn together how this village decides things." },
    });
    answer("POST", "/api/canvas/proposals", 201, { proposal: suggestion({ youProposedIt: true, proposedBy: { id: "u5", name: "Sage" } }) });
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ proposals: [suggestion({ youProposedIt: true })] }));
    fireEvent.click(form.getByRole("button", { name: "Send this suggestion" }));
    await waitFor(() => expect(asked("POST /api/canvas/proposals")).toHaveLength(1));
    const sent = asked("POST /api/canvas/proposals")[0];
    expect(sent.init.headers.Authorization).toBe("Bearer a-token");
    expect(JSON.parse(sent.init.body)).toEqual({
      blockId: "power",
      target: "words",
      sectionId: "decisions",
      body: "We decide by consent at the Saturday circle.",
      servesPurpose: "It keeps every voice in the room while we learn together how this village decides things.",
    });
    await waitFor(() => expect(frames.getByRole("status").textContent).toMatch(/Your suggestion is open\. It is listed under Adopt/));
    expect(asked("GET /api/canvas/blocks/power")).toHaveLength(2);
  });

  it("offers each setting behind the block, with what the dial reads today and the choices it takes", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ proposals: [] }));
    answer("GET", "/api/canvas/decision-matrix/rows", 200, rows(false));
    answer("GET", "/api/game/mechanics", 200, {
      variables: [
        {
          key: "governance.default_method", label: "How village-wide ballots decide", type: "choice", unit: null, min: null, max: null, value: "custom",
          choices: [{ value: "custom", label: "This village's own dials" }, { value: "consent", label: "Consent" }],
        },
      ],
    });
    const frames = await openPower("Say");
    const form = within(await frames.findByRole("form", { name: "Suggest a change to Power" }));
    fireEvent.click(form.getByLabelText("A setting: how village-wide ballots decide"));
    expect(await form.findByText("Today: This village's own dials")).toBeTruthy();
    expect(form.getByText(/Who decides: Whoever may turn the village's dials/)).toBeTruthy();
    fireEvent.change(form.getByLabelText(/What it should be/), { target: { value: "consent" } });
    fireEvent.change(form.getByLabelText("Why this change, in a sentence or more"), { target: { value: "Consent suits how we already talk." } });
    fireEvent.change(form.getByLabelText(/How it serves the governing purpose/), {
      target: { value: "It keeps every voice in the room while we learn together how this village decides things." },
    });
    answer("POST", "/api/canvas/proposals", 201, { proposal: suggestion() });
    fireEvent.click(form.getByRole("button", { name: "Send this suggestion" }));
    await waitFor(() => expect(asked("POST /api/canvas/proposals")).toHaveLength(1));
    const body = JSON.parse(asked("POST /api/canvas/proposals")[0].init.body);
    expect(body).toMatchObject({ target: "setting", door: "dial:governance.default_method", change: { value: "consent" } });
  });

  it("prints the server's refusal when it says no after all", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ proposals: [] }));
    answer("GET", "/api/canvas/decision-matrix/rows", 200, rows(false));
    const frames = await openPower("Say");
    const form = within(await frames.findByRole("form", { name: "Suggest a change to Power" }));
    fireEvent.change(form.getByLabelText("The words you suggest for Decisions"), { target: { value: "Consent, always." } });
    fireEvent.change(form.getByLabelText(/How it serves the governing purpose/), {
      target: { value: "It keeps every voice in the room while we learn together how this village decides things." },
    });
    answer("POST", "/api/canvas/proposals", 429, { error: "You have 20 suggestions open already. Once some are adopted or declined you can add more." });
    fireEvent.click(form.getByRole("button", { name: "Send this suggestion" }));
    await waitFor(() => expect(form.getByRole("alert").textContent).toMatch(/suggestions open already/));
  });
});

describe("Adopt", () => {
  it("shows a member who suggested what and when, how it would be decided, and no button that is not theirs", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock());
    const frames = await openPower("Adopt");
    const card = within(await frames.findByTestId("canvas-proposal-41"));
    expect(card.getByText("Words for Decisions")).toBeTruthy();
    expect(card.getByText(/Suggested by Sage on/)).toBeTruthy();
    expect(card.getByText(/How it serves the purpose:/)).toBeTruthy();
    expect(card.getByTestId("canvas-proposal-effect-41").textContent).toBe("Adopting writes these words into Decisions as the village's adopted answer.");
    expect(card.getByText("Who decides: Whoever holds the village's story adopts these words.")).toBeTruthy();
    expect(card.queryByRole("button")).toBeNull();
    expect(card.queryByRole("textbox")).toBeNull();
  });

  it("lets the member who made a suggestion withdraw it", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ proposals: [suggestion({ youProposedIt: true })] }));
    const frames = await openPower("Adopt");
    const card = within(await frames.findByTestId("canvas-proposal-41"));
    expect(card.getByText(/Suggested by you on/)).toBeTruthy();
    expect(card.queryByRole("button", { name: "Adopt these words" })).toBeNull();
    expect(card.queryByRole("button", { name: "Decline" })).toBeNull();
    answer("POST", "/api/canvas/proposals/41/decline", 200, { proposal: { ...suggestion(), status: "declined" } });
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ proposals: [] }));
    fireEvent.click(card.getByRole("button", { name: "Withdraw my suggestion" }));
    await waitFor(() => expect(frames.getByRole("status").textContent).toMatch(/Your suggestion is withdrawn/));
    expect(JSON.parse(asked("POST /api/canvas/proposals/41/decline")[0].init.body)).toEqual({});
    expect(await frames.findByText("No suggestions are open on Power.")).toBeTruthy();
  });

  it("gives the pen Adopt and Decline, says the note is public before the box, and refuses a decline with no note before sending", async () => {
    answer("GET", "/api/canvas", 200, canvas(true));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ pen: true, proposals: [suggestion({ pen: penView({ youMayAdopt: true }) })] }));
    const frames = await openPower("Adopt");
    const card = within(await frames.findByTestId("canvas-proposal-41"));
    const note = card.getByLabelText(/Your note \(optional to adopt, needed to decline\)/);
    expect(note.closest("label")?.textContent).toContain(NOTE_IS_PUBLIC);

    fireEvent.click(card.getByRole("button", { name: "Decline" }));
    expect(card.getByRole("alert").textContent).toBe("Say in a sentence why this is declined. The note is public, like the suggestion.");
    expect(asked("POST /api/canvas/proposals/41/decline")).toHaveLength(0);

    fireEvent.change(note, { target: { value: "Agreed at the circle on Saturday." } });
    answer("POST", "/api/canvas/proposals/41/adopt", 200, {
      proposal: { ...suggestion(), status: "adopted" },
      outcome: { wrote: "brief-section", section: "decisions", revision: 1 },
      message: "Adopted. Decisions now reads as suggested.",
    });
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ pen: true, proposals: [] }));
    fireEvent.click(card.getByRole("button", { name: "Adopt these words" }));
    await waitFor(() => expect(frames.getByRole("status").textContent).toBe("Adopted. Decisions now reads as suggested."));
    // The decided card leaves the list, so the result takes the focus and is brought into view.
    expect(document.activeElement).toBe(frames.getByRole("status"));
    const sent = asked("POST /api/canvas/proposals/41/adopt")[0];
    expect(JSON.parse(sent.init.body)).toEqual({ note: "Agreed at the circle on Saturday." });
    expect(sent.init.headers.Authorization).toBe("Bearer a-token");
  });

  it("prints the setting's own refusal and leaves the suggestion where it was", async () => {
    const dial = suggestion({
      target: "setting", sectionId: null, door: "dial:governance.default_method", change: { value: "hypha" },
      pen: penView({ pen: "dial", youMayAdopt: true, sentence: "Whoever may turn the village's dials adopts this before the Game starts." }),
    });
    answer("GET", "/api/canvas", 200, canvas(true));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ pen: true, proposals: [dial] }));
    const frames = await openPower("Adopt");
    const card = within(await frames.findByTestId("canvas-proposal-41"));
    answer("POST", "/api/canvas/proposals/41/adopt", 409, { error: "restorative_in_agreement", message: "Nothing was adopted. The care door now comes from the village's conflict agreement." });
    fireEvent.click(card.getByRole("button", { name: "Adopt and change the setting" }));
    await waitFor(() => expect(card.getByRole("alert").textContent).toBe("Nothing was adopted. The care door now comes from the village's conflict agreement."));
    expect(asked("GET /api/canvas/blocks/power")).toHaveLength(1);
  });
});

describe("before the Birthing and after it", () => {
  const dial = (birthed: boolean) =>
    suggestion({
      target: "setting", sectionId: null, door: "dial:governance.default_method", change: { value: "consent" },
      pen: penView({ pen: "dial", how: birthed ? "ballot" : "act", who: birthed ? "any-member" : "the-gate", youMayAdopt: !birthed }),
    });

  it("before: adopting a setting writes it, and the frame says so", async () => {
    answer("GET", "/api/canvas", 200, canvas(true));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ pen: true, birthed: false, proposals: [dial(false)] }));
    const frames = await openPower("Adopt");
    expect((await frames.findByTestId("canvas-adopt-moment")).textContent).toMatch(/^The Game has not started, so adopting a suggestion that names a setting writes the setting straight away/);
    expect(frames.getByTestId("canvas-proposal-effect-41").textContent).toBe(
      "The Game has not started, so adopting sets how village-wide ballots decide to consent straight away.",
    );
    expect(frames.getByRole("button", { name: "Adopt and change the setting" })).toBeTruthy();
  });

  it("after: adopting a setting files a proposal in its author's name, and nobody else is offered the button", async () => {
    answer("GET", "/api/canvas", 200, canvas(true));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ pen: true, birthed: true, proposals: [dial(true)] }));
    const frames = await openPower("Adopt");
    expect((await frames.findByTestId("canvas-adopt-moment")).textContent).toBe(
      "The Game has started, so what adopting does now depends on the suggestion. Each one below says what adopting it would do, and who decides.",
    );
    expect(frames.getByTestId("canvas-proposal-effect-41").textContent).toBe(
      "The Game has started, so adopting files this as a proposal to change the Game's rules, in Sage's name, and the village votes on it. Only the member who suggested it can file it.",
    );
    expect(frames.queryByRole("button", { name: "File it as a proposal" })).toBeNull();
    expect(frames.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("after: the author is offered the filing, in their own name", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ birthed: true, proposals: [{ ...dial(true), youProposedIt: true, pen: penView({ pen: "dial", how: "ballot", who: "any-member", youMayAdopt: true }) }] }));
    const frames = await openPower("Adopt");
    expect(await frames.findByRole("button", { name: "File it as a proposal" })).toBeTruthy();
    expect(frames.getByTestId("canvas-proposal-effect-41").textContent).toContain("in your name");
  });
});

describe("the blocks that host an editor", () => {
  it("Power shows the platform's half of the matrix and the village's rows; the pen adds a row, checked first", async () => {
    answer("GET", "/api/canvas", 200, canvas(true));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ pen: true, proposals: [] }));
    answer("GET", "/api/canvas/decision-matrix/rows", 200, rows(true));
    const frames = await openPower("Say");
    expect(await frames.findByTestId("generated-matrix")).toBeTruthy();
    const human = within(await frames.findByTestId("matrix-human-rows"));
    expect(await human.findByText("Spending under a hundred")).toBeTruthy();
    expect(human.getByText("Risk tags are information. None of them changes who decides or how.")).toBeTruthy();

    fireEvent.click(human.getByRole("button", { name: "Add a row" }));
    const form = within(human.getByRole("form", { name: "Add a row" }));
    expect(form.getByText(new RegExp(NOTE_IS_PUBLIC))).toBeTruthy();
    fireEvent.click(form.getByRole("button", { name: "Add this row" }));
    expect(form.getByRole("alert").textContent).toBe("Name the kind of decision this row is about.");
    expect(asked("POST /api/canvas/decision-matrix/rows")).toHaveLength(0);

    fireEvent.change(form.getByLabelText("The kind of decision"), { target: { value: "Who speaks to the press" } });
    fireEvent.change(form.getByLabelText("Who approves it"), { target: { value: "The circle" } });
    fireEvent.change(form.getByLabelText("Who is asked first"), { target: { value: "The steward" } });
    fireEvent.change(form.getByLabelText("Who is told"), { target: { value: "Everyone" } });
    answer("POST", "/api/canvas/decision-matrix/rows", 201, { row: { ...rows(true).rows[0], id: 4, subject: "Who speaks to the press" } });
    fireEvent.click(form.getByRole("button", { name: "Add this row" }));
    await waitFor(() => expect(asked("POST /api/canvas/decision-matrix/rows")).toHaveLength(1));
    expect(JSON.parse(asked("POST /api/canvas/decision-matrix/rows")[0].init.body)).toEqual({
      subject: "Who speaks to the press",
      approval: "The circle",
      consultation: "The steward",
      information: "Everyone",
      method: "",
      riskTags: [],
    });
    await waitFor(() => expect(human.getByText("The row is added to the Decision Matrix.")).toBeTruthy());
  });

  it("Power's rows are read-only to a member, who is sent to the suggestion box", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ proposals: [] }));
    answer("GET", "/api/canvas/decision-matrix/rows", 200, rows(false));
    const frames = await openPower("Say");
    const human = within(await frames.findByTestId("matrix-human-rows"));
    expect((await human.findByTestId("matrix-human-rows-pen")).textContent).toBe(
      "The founders adopt this before the Game starts. To add or change a row, suggest it below.",
    );
    expect(human.queryByRole("button", { name: "Add a row" })).toBeNull();
    expect(human.queryByRole("button", { name: "Change this row" })).toBeNull();
  });

  it("after the Birthing the rows say their vote is not built, and offer no write", async () => {
    answer("GET", "/api/canvas", 200, canvas(true));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ pen: true, birthed: true, proposals: [] }));
    answer("GET", "/api/canvas/decision-matrix/rows", 200, rows(true, true));
    const frames = await openPower("Say");
    const human = within(await frames.findByTestId("matrix-human-rows"));
    expect((await human.findByTestId("matrix-human-rows-pen")).textContent).toMatch(/^The Game has started, so these rows change by a vote of the whole village, which is not built yet/);
    expect(human.queryByRole("button", { name: "Add a row" })).toBeNull();
  });

  it("Conflict mounts the conflict agreement, and still offers every member the care door as a suggestion", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/conflict", 200, conflictBlock());
    answer("GET", "/api/roles", 200, [{ id: "practitioners", name: "Trained Practitioners" }]);
    draw();
    const card = await screen.findByTestId("canvas-block-conflict");
    fireEvent.click(within(card).getByRole("button", { name: "Open this block: Conflict" }));
    const frames = within(await screen.findByTestId("canvas-frames-conflict"));
    fireEvent.click(frames.getByRole("button", { name: "Say" }));
    expect(await frames.findByTestId("agreement-editor")).toBeTruthy();
    expect(frames.queryByTestId("generated-matrix")).toBeNull();
    const form = within(frames.getByRole("form", { name: "Suggest a change to Conflict" }));
    expect(form.getByText(/It would change:/).closest("p")?.textContent).toContain(
      "A setting: the restorative steps, the care role, its cover and the promised reply time",
    );
    // The care roles are read only once the care door is on screen, and offered by name.
    await waitFor(() => expect(asked("GET /api/roles")).toHaveLength(1));
    expect(await form.findAllByRole("option", { name: "Trained Practitioners" })).toHaveLength(2);
  });
});

describe("what somebody typed stays while they look at another frame", () => {
  it("a member's half-written suggestion under Say survives a look at See", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ proposals: [] }));
    answer("GET", "/api/canvas/decision-matrix/rows", 200, rows(false));
    const frames = await openPower("Say");
    const words = "We decide by consent at the circle, and anybody may ask for a second round.";
    fireEvent.change(await frames.findByLabelText("The words you suggest for Decisions"), { target: { value: words } });
    fireEvent.click(frames.getByRole("button", { name: "See" }));
    expect(await frames.findByTestId("canvas-see-facts")).toBeTruthy();
    expect(frames.queryByRole("form", { name: "Suggest a change to Power" })).toBeNull();
    fireEvent.click(frames.getByRole("button", { name: "Say" }));
    const box = frames.getByLabelText("The words you suggest for Decisions") as HTMLTextAreaElement;
    expect(box.value).toBe(words);
    // The block was read once, and the frame was not built again.
    expect(asked("GET /api/canvas/blocks/power")).toHaveLength(1);
  });

  it("the pen's half-recorded reading under Sense survives a look at See", async () => {
    answer("GET", "/api/canvas", 200, canvas(true));
    answer("GET", "/api/canvas/blocks/legal", 200, {
      block: { id: "legal", number: 3, name: "Legal", briefSections: [] },
      answer: { sections: [] },
      reading: null,
      observed: [],
      proposals: [],
      doors: [],
      pens: {},
      birthed: false,
      servesPurpose: { scoped: false, matrixScoped: false, requiredToday: false },
      notesArePublic: NOTE_IS_PUBLIC,
    });
    draw();
    const legal = within(await screen.findByTestId("canvas-block-legal"));
    fireEvent.click(legal.getByRole("button", { name: /record a reading/i }));
    const sentence = await legal.findByLabelText("Why, in one sentence");
    fireEvent.change(sentence, { target: { value: "We have a draft of our articles and no lawyer has read it." } });
    const frames = within(screen.getByTestId("canvas-frames-legal"));
    fireEvent.click(frames.getByRole("button", { name: "See" }));
    expect(await frames.findByText("Nothing the village runs speaks to Legal yet.")).toBeTruthy();
    fireEvent.click(frames.getByRole("button", { name: "Sense" }));
    expect((frames.getByLabelText("Why, in one sentence") as HTMLTextAreaElement).value).toBe(
      "We have a draft of our articles and no lawyer has read it.",
    );
    expect(frames.getByRole("button", { name: /save this reading/i })).toBeTruthy();
  });

  it("the village's rows are read again after the pen adopts a row under Adopt", async () => {
    const row = suggestion({
      target: "matrix", sectionId: null,
      change: { subject: "Who speaks to the press", approval: "The circle", consultation: "The steward", information: "Everyone", method: "", riskTags: [] },
      pen: penView({ pen: "consequence", who: "admins", sentence: "The founders adopt this before the Game starts.", youMayAdopt: true }),
    });
    answer("GET", "/api/canvas", 200, canvas(true));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ pen: true, proposals: [row] }));
    answer("GET", "/api/canvas/decision-matrix/rows", 200, rows(true));
    const frames = await openPower("Say");
    expect(await frames.findByText("Spending under a hundred")).toBeTruthy();
    await waitFor(() => expect(asked("GET /api/canvas/decision-matrix/rows")).toHaveLength(1));
    fireEvent.click(frames.getByRole("button", { name: "Adopt" }));
    answer("POST", "/api/canvas/proposals/41/adopt", 200, { proposal: { ...row, status: "adopted" }, message: "Adopted. The row is in the Decision Matrix." });
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ pen: true, proposals: [] }));
    fireEvent.click(within(await frames.findByTestId("canvas-proposal-41")).getByRole("button", { name: "Adopt this row" }));
    await waitFor(() => expect(asked("GET /api/canvas/decision-matrix/rows")).toHaveLength(2));
  });
});

describe("the suggestion box says, before anybody writes, where a suggestion cannot be carried", () => {
  it("after the Birthing, a matrix row's vote is not built", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/power", 200, powerBlock({ birthed: true, proposals: [] }));
    answer("GET", "/api/canvas/decision-matrix/rows", 200, rows(false, true));
    const frames = await openPower("Say");
    const form = within(await frames.findByRole("form", { name: "Suggest a change to Power" }));
    expect(form.queryByTestId("canvas-suggestion-fate")).toBeNull();
    fireEvent.click(form.getByLabelText("A row of the Decision Matrix"));
    expect(form.getByTestId("canvas-suggestion-fate").textContent).toBe("That vote is not built yet, so a suggestion here stays open until it is.");
  });

  it("after the Birthing, the care door goes to the conflict agreement's own vote", async () => {
    answer("GET", "/api/canvas", 200, canvas(false));
    answer("GET", "/api/canvas/blocks/conflict", 200, {
      ...conflictBlock(),
      birthed: true,
      pens: { consequence: penView({ pen: "consequence", how: "ballot", who: "any-member", sentence: "The Game has started, so adopting this goes to a vote of the whole village.", ballotBuilt: false }) },
    });
    answer("GET", "/api/roles", 200, []);
    draw();
    fireEvent.click(within(await screen.findByTestId("canvas-block-conflict")).getByRole("button", { name: "Open this block: Conflict" }));
    const frames = within(await screen.findByTestId("canvas-frames-conflict"));
    fireEvent.click(frames.getByRole("button", { name: "Say" }));
    const form = within(await frames.findByRole("form", { name: "Suggest a change to Conflict" }));
    const fate = form.getByTestId("canvas-suggestion-fate").textContent ?? "";
    expect(fate).toMatch(/^The Game has started, so the care door changes only by a vote on the whole conflict agreement/);
    expect(fate).toContain("cannot be adopted from the canvas");
  });
});
