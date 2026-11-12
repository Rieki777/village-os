// @vitest-environment jsdom
/**
 * APPLY FOR A ROLE, WITHOUT AN ACCOUNT: the founding-team application (Phase A,
 * lane A1, 11 Nov 2026). The server's answers are canned here;
 * server/routes/openProposals.test.ts proves them.
 *
 *   - one role per application: named by the card's Apply link, or chosen from
 *     the open roles, never more than one
 *   - six steps with "Step N of 6", one primary act each worded as what comes
 *     next, Back keeps every word, and a draft survives leaving (never the
 *     references or files)
 *   - every check the Firefly Path made still runs: per step on Continue, all
 *     at once on Send, each gap named with the cursor taken to its field
 *   - the compensation shape is the village's data, "N%" where it set nothing,
 *     with the plain word on risk beside the footer
 *   - the sent and confirmed thresholds follow, as before
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OPEN_AI_DRAFTS, OPEN_WORDS } from "@shared/openProposals";
import { ATTACHMENT_WORDS } from "@shared/proposalAttachments";
import { draftKey } from "@/components/fireflyPath/applyDraft";

import { SETUP, fillValue, pressNext, sendNow, stoneNow, walk } from "@/test/proposeStones";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const auth = vi.hoisted(() => ({ user: null as null | { name: string; email: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: auth.user }) }));

import ProposeARole, { ConfirmProposal, firstUnanswered } from "./ProposeARole";

const GOALS = [
  { id: "g-team", text: "Build the team that can build the village" },
  { id: "g-water", text: "Water" },
];
const FORM = {
  open: true,
  village: "Test Village",
  season: { id: "s-next", name: "Season of Roots", startsOn: "2099-01-01" },
  goals: GOALS,
  roles: [
    { id: "r-gate", name: "Gate Keeper", circle: "Anchor Circle", aim: "Open the gate at dawn." },
    { id: "r-host", name: "Welcome Host", circle: "Anchor Circle", aim: "Meet every newcomer." },
  ],
  founding: SETUP,
};

/** The membership letter the form shows and aligns with (Rye's answer 8). */
const LETTER = { version: "lv-0123456789abcdef", title: "Membership agreement", body: "Dear friend, welcome home.", intent: "I align with the Membership agreement.", parts: {} };

let posted: any[] = [];
/** How each post went: its files, and the headers set by hand. */
let sentAs: Array<{ files: File[]; headers: RequestInit["headers"] }> = [];

function serve(form: unknown, answer: { status: number; body: unknown } = { status: 200, body: { sent: true, message: "The server's own English words, never shown." } }) {
  posted = [];
  sentAs = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const multipart = init.body instanceof FormData ? init.body : null;
        posted.push({ url, body: JSON.parse(String(multipart ? multipart.get("proposal") : init.body)) });
        sentAs.push({ files: multipart ? (multipart.getAll("files") as File[]) : [], headers: init.headers });
        return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
      }
      if (String(url).startsWith("/api/membership-letter")) return new Response(JSON.stringify(LETTER), { status: 200, headers: { "content-type": "application/json" } });
      if (String(url).startsWith("/api/profile/alignments")) return new Response(JSON.stringify({ alignments: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(form), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

/** Open the application as a role card's Apply link does. */
const applyFor = async (id = "r-gate", form: unknown = FORM, answer?: { status: number; body: unknown }) => {
  window.history.pushState({}, "", `/propose-a-role?role=${id}`);
  serve(form, answer);
  render(<ProposeARole />);
  await screen.findByRole("heading", { level: 1, name: /^Apply: / });
};

/** About you, as the step asks it. */
const fillAbout = () => {
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Rowan" } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "rowan@example.test" } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "The gate is always shut." } });
  fireEvent.click(screen.getByLabelText(/agree to the background check/i));
};
/** Everything the application asks before it will send. */
const completeAll = async () => {
  fillAbout();
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
  fillValue();
  fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
  fireEvent.click(await screen.findByLabelText(LETTER.intent));
  fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
};
const shown = () => Array.from(document.querySelectorAll<HTMLElement>("[data-stone]")).filter((s) => !s.hidden).map((s) => s.getAttribute("data-stone"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.user = null;
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
});

describe("one role per application", () => {
  it("the card's Apply link opens \"Apply: [role]\" with that role chosen, and nothing to tick for a second one", async () => {
    await applyFor("r-host");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(OPEN_WORDS.heading("Welcome Host"));
    expect(document.querySelector("[data-role-beside]")?.textContent).toContain("Welcome Host");
    expect(document.querySelectorAll('[data-role] input[type="checkbox"]')).toHaveLength(0);
    expect(document.querySelector("[data-role-choice]")).toBeNull();
  });

  it("with no role named, shows the open roles as one door each, and choosing one opens its application and names it in the address", async () => {
    window.history.pushState({}, "", "/propose-a-role");
    serve(FORM);
    render(<ProposeARole />);
    expect(await screen.findByRole("heading", { level: 1, name: OPEN_WORDS.chooseHeading })).toBeTruthy();
    const doors = within(document.querySelector("[data-role-choice]") as HTMLElement).getAllByRole("button");
    expect(doors.map((d) => d.getAttribute("data-role"))).toEqual(["r-gate", "r-host"]);
    expect(document.querySelector("[data-open-proposal]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Apply: Gate Keeper/ }));
    expect(await screen.findByRole("heading", { level: 1, name: OPEN_WORDS.heading("Gate Keeper") })).toBeTruthy();
    expect(window.location.search).toBe("?role=r-gate");
    // A way back to choose a different one, which never adds a second.
    fireEvent.click(screen.getByRole("button", { name: "Apply for a different role" }));
    expect(await screen.findByRole("heading", { level: 1, name: OPEN_WORDS.chooseHeading })).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("a link naming several roles applies for the first one still offered; one no longer offered says so and offers the rest", async () => {
    window.history.pushState({}, "", "/propose-a-role?role=r-gone&role=r-host&role=r-gate");
    serve(FORM);
    render(<ProposeARole />);
    expect(await screen.findByRole("heading", { level: 1, name: OPEN_WORDS.heading("Welcome Host") })).toBeTruthy();
    cleanup();
    window.history.pushState({}, "", "/propose-a-role?role=r-gone");
    serve(FORM);
    render(<ProposeARole />);
    expect(await screen.findByRole("heading", { level: 1, name: OPEN_WORDS.chooseHeading })).toBeTruthy();
    expect(document.querySelector("[data-role-gone]")?.textContent).toMatch(/not open any more/);
  });

  it("sends exactly one role, the value items as the card's goals, their season goals, the ticks, the ramp-up and the commitment", async () => {
    await applyFor();
    fireEvent.click(screen.getByLabelText("Visit the land"));
    await completeAll();
    fireEvent.click(document.querySelector("[data-add-value]") as HTMLElement);
    fireEvent.change(document.getElementById("value-r-gate-1-title") as HTMLInputElement, { target: { value: "Find water" } });
    fireEvent.change(document.getElementById("value-r-gate-1-done") as HTMLInputElement, { target: { value: "the well test is back" } });
    fireEvent.change(document.getElementById("value-r-gate-1-serves") as HTMLSelectElement, { target: { value: "g-water" } });
    fireEvent.click(screen.getByLabelText(/I would like a ramp-up/));
    sendNow();
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByText("Check rowan@example.test. We sent a link to confirm it's you. Your application reaches us once you open it.")).toBeTruthy();
    expect(screen.queryByText(/server's own English/)).toBeNull();
    expect(posted).toHaveLength(1);
    const body = posted[0].body;
    expect(body.roles).toEqual([{ roleId: "r-gate", note: "" }]);
    expect(body.knowUs).toEqual(["Visit the land"]);
    expect(body.rampUp).toBe(true);
    expect(body.card).toMatchObject({
      roles: [
        {
          roleId: "r-gate",
          moves: [],
          firstMoon: [
            { quest: "Open the gate each dawn", doneWhen: "the gate is open by sunrise", serves: "g-team" },
            { quest: "Find water", doneWhen: "the well test is back", serves: "g-water" },
          ],
        },
      ],
      serves: [
        { goalId: "g-team", how: "Open the gate each dawn", roleId: "r-gate" },
        { goalId: "g-water", how: "Find water", roleId: "r-gate" },
      ],
      commitmentPct: 50,
      agreed: { nda: true },
      terms: { answers: {} },
    });
    expect(body.membership).toEqual({ letterVersion: LETTER.version });
    // No payment anywhere on the application: nothing posted names money.
    expect(JSON.stringify(body)).not.toMatch(/contribution|amount|payment|dues/i);
  });
});

describe("the six steps", () => {
  it("shows one step at a time under \"Step N of 6\", with one primary act worded as what comes next", async () => {
    await applyFor();
    expect(shown()).toEqual(["know"]);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Step 1 of 6 · Get to know us");
    const bar = document.querySelector("[data-stone-bar]") as HTMLElement;
    expect(within(bar).getByRole("button", { name: "Continue to About you" })).toBeTruthy();
    // One firefly cluster on the page, on that one act.
    expect(document.querySelectorAll("[data-open-proposal] .jw-btn.bg-notice")).toHaveLength(1);
    // The six steps in the brief's order, on the gold rule.
    const mark = document.querySelector("[data-step-mark]") as HTMLElement;
    expect(Array.from(mark.querySelectorAll("li")).map((li) => li.querySelector("[aria-label]")?.getAttribute("aria-label"))).toEqual([
      "Step 1: Get to know us",
      "Step 2: About you",
      "Step 3: Your value",
      "Step 4: The terms",
      "Step 5: Your first day",
      "Step 6: Review & submit",
    ]);
    // Nothing of the game register on this page.
    expect(document.body.textContent).not.toMatch(/\bquest|stone|moss|\bmoon\b/i);
  });

  it("Get to know us never locks: the note shows while a way is open, and Continue moves on with nothing ticked", async () => {
    await applyFor();
    expect(document.querySelector("[data-know-note]")?.textContent).toBe(SETUP.knowUsNote);
    for (const w of SETUP.knowUs) fireEvent.click(screen.getByLabelText(w));
    expect(document.querySelector("[data-know-note]")).toBeNull();
    fireEvent.click(screen.getByLabelText("Visit the land"));
    expect(document.querySelector("[data-know-note]")).toBeTruthy();
    pressNext();
    expect(stoneNow()).toBe("about");
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(document.activeElement?.id).toBe("stone-1-h"));
  });

  it("per step (M1): Continue with gaps posts nothing, lists only this step's gaps at once, shows each beside its field, and moves the cursor to the first", async () => {
    await applyFor();
    pressNext();
    pressNext();
    expect(stoneNow()).toBe("about");
    const list = (await screen.findByText(/things to look at before you continue/)).closest("[data-problems]") as HTMLElement;
    for (const words of [OPEN_WORDS.needName, OPEN_WORDS.needEmail, OPEN_WORDS.needWhy]) expect(list.textContent).toContain(words);
    for (const words of [OPEN_WORDS.needAim, "Tick that you will align"]) expect(list.textContent).not.toContain(words);
    expect(posted).toHaveLength(0);
    expect(document.querySelector("#propose-problem-name")?.textContent).toBe(OPEN_WORDS.needName);
    await waitFor(() => expect(document.activeElement?.id).toBe("propose-name"));
    expect(screen.getByLabelText(OPEN_WORDS.nameLabel).getAttribute("aria-invalid")).toBe("true");
  });

  it("Your value: items can be added and removed, each must say how we will know it is done, and each is tagged to a season goal shown right there", async () => {
    await applyFor();
    pressNext();
    fillAbout();
    pressNext();
    expect(stoneNow()).toBe("value");
    const goalsShown = document.querySelector("[data-season-goals]") as HTMLElement;
    for (const g of GOALS) expect(within(goalsShown).getByText(g.text)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
    fireEvent.change(document.getElementById("value-r-gate-0-title") as HTMLInputElement, { target: { value: "Open the gate" } });
    pressNext();
    const list = (await screen.findByText(/things to look at before you continue/)).closest("[data-problems]") as HTMLElement;
    expect(list.textContent).toContain("Say how we will know value 1 is done.");
    expect(list.textContent).toContain("Choose the season goal value 1 serves.");
    await waitFor(() => expect(document.activeElement?.id).toBe("value-r-gate-0-done"));
    fireEvent.change(document.getElementById("value-r-gate-0-done") as HTMLInputElement, { target: { value: "at sunrise" } });
    pressNext();
    await waitFor(() => expect(document.activeElement?.id).toBe("value-r-gate-0-serves"));
    fireEvent.change(document.getElementById("value-r-gate-0-serves") as HTMLSelectElement, { target: { value: "g-team" } });
    fireEvent.click(screen.getByRole("button", { name: "Add another value item" }));
    expect(document.querySelectorAll("[data-value-item]")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove value 2" }));
    expect(document.querySelectorAll("[data-value-item]")).toHaveLength(1);
    pressNext();
    expect(stoneNow()).toBe("terms");
  });

  it("the final review: Send lists every gap at once in walking order, each naming its step, and each takes you to its step and field", async () => {
    await applyFor();
    await completeAll();
    walk();
    expect(stoneNow()).toBe("review");
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    const list = (await screen.findByText(/things to fix before we can send this/)).closest("[data-problems]") as HTMLElement;
    const items = Array.from(list.querySelectorAll("li")).map((li) => li.textContent ?? "");
    expect(items[0]).toBe(`About you: ${OPEN_WORDS.needWhy}`);
    expect(items[1]).toBe(`Your value: ${OPEN_WORDS.needAim}`);
    expect(items[2]).toMatch(/^Tick that you will align/);
    expect(posted).toHaveLength(0);
    await waitFor(() => expect(document.activeElement?.id).toBe("propose-problems"));
    fireEvent.click(within(list).getByRole("button", { name: `About you: ${OPEN_WORDS.needWhy}` }));
    expect(stoneNow()).toBe("about");
    await waitFor(() => expect(document.activeElement?.id).toBe("propose-why"));
    expect(screen.getByLabelText(OPEN_WORDS.whyLabel).getAttribute("aria-invalid")).toBe("true");
  });

  it("Back keeps every word, and the step circles return to any step already reached", async () => {
    await applyFor();
    pressNext();
    fillAbout();
    pressNext();
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(stoneNow()).toBe("about");
    expect((screen.getByLabelText(OPEN_WORDS.whyLabel) as HTMLTextAreaElement).value).toBe("The gate is always shut.");
    fireEvent.click(screen.getByRole("button", { name: "Step 3: Your value" }));
    expect(stoneNow()).toBe("value");
    expect((screen.getByLabelText(OPEN_WORDS.aimLabel) as HTMLInputElement).value).toBe("The gate opens at dawn.");
    // A step not reached yet is no button.
    expect(screen.queryByRole("button", { name: "Step 5: Your first day" })).toBeNull();
  });

  it("a desk: Enter in a one-line field moves on, the arrows walk when the caret is not in a field, and a field keeps its own keys", async () => {
    await applyFor();
    const form = document.querySelector("[data-open-proposal]") as HTMLFormElement;
    fireEvent.keyDown(form, { key: "ArrowRight" });
    expect(stoneNow()).toBe("about");
    const nameBox = screen.getByLabelText(OPEN_WORDS.nameLabel);
    fireEvent.keyDown(nameBox, { key: "ArrowLeft" });
    expect(stoneNow()).toBe("about");
    fillAbout();
    fireEvent.keyDown(screen.getByLabelText(OPEN_WORDS.whyLabel), { key: "Enter" });
    expect(stoneNow()).toBe("about");
    fireEvent.keyDown(nameBox, { key: "Enter" });
    expect(stoneNow()).toBe("value");
    fireEvent.keyDown(form, { key: "ArrowLeft" });
    expect(stoneNow()).toBe("about");
    fireEvent.submit(form);
    expect(stoneNow()).toBe("value");
    fireEvent.keyDown(form, { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByLabelText(OPEN_WORDS.whyLabel), { key: "Enter", ctrlKey: true });
    expect(stoneNow()).toBe("value");
    expect(posted).toHaveLength(0);
  });

  it("a phone: a swipe left walks on, right walks back, and a swipe that starts in a field is the field's", async () => {
    await applyFor();
    const form = document.querySelector("[data-open-proposal]") as HTMLFormElement;
    const swipe = (on: Element, dx: number, dy = 0) => {
      fireEvent.touchStart(on, { touches: [{ clientX: 200, clientY: 300 }] });
      fireEvent.touchEnd(on, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
    };
    swipe(form, -120);
    expect(stoneNow()).toBe("about");
    swipe(screen.getByLabelText(OPEN_WORDS.nameLabel), 120);
    expect(stoneNow()).toBe("about");
    swipe(form, 80, 200);
    expect(stoneNow()).toBe("about");
    swipe(form, 120);
    expect(stoneNow()).toBe("know");
  });

  it("About you offers starter phrases that begin the answer, and no example text in the field", async () => {
    await applyFor();
    pressNext();
    const why = screen.getByLabelText(OPEN_WORDS.whyLabel) as HTMLTextAreaElement;
    expect(why.placeholder).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "What I have built before:" }));
    fireEvent.click(screen.getByRole("button", { name: "Why now:" }));
    expect(why.value).toBe("What I have built before:\n\nWhy now: ");
  });

  it("Review & submit reads every step back with a way to change it", async () => {
    await applyFor();
    fireEvent.click(screen.getByLabelText("Visit the land"));
    await completeAll();
    walk();
    const review = document.querySelector("[data-review]") as HTMLElement;
    expect(review.textContent).toContain("1 of 3 done");
    expect(review.textContent).toContain("Rowan · The gate is always shut.");
    expect(review.textContent).toContain("1 value item. Aim: The gate opens at dawn.");
    expect(review.textContent).toContain("Commitment: 50%");
    fireEvent.click(within(review).getAllByRole("button", { name: "Change" })[2]);
    expect(stoneNow()).toBe("value");
  });
});

describe("the terms", () => {
  it("shows the village's pay shape as the role cards do: shares only, the onboarding line, the plain word on risk beside the footer, and the ramp-up option", async () => {
    await applyFor();
    const shape = document.querySelector("[data-comp-shape]") as HTMLElement;
    expect(Array.from(shape.querySelectorAll("[data-share-pct]")).map((d) => d.textContent)).toEqual(["40%", "55%", "5%"]);
    expect(shape.querySelector("[data-comp-onboarding]")?.textContent).toBe("To be decided in the onboarding process.");
    expect(shape.querySelector("[data-at-risk]")?.textContent).toBe(SETUP.atRisk);
    expect(shape.querySelector("[data-comp-footer]")?.textContent).toBe(SETUP.footer);
    // The risk sits right beside the footer.
    expect(shape.querySelector("[data-at-risk]")?.nextElementSibling).toBe(shape.querySelector("[data-comp-footer]"));
    // Never a range, a minimum or a budget figure on this step.
    expect((document.querySelector('[data-stone="terms"]') as HTMLElement).textContent).not.toMatch(/\$|USD|per month|a month|minimum|budget/i);
    expect(screen.getByLabelText(/I would like a ramp-up/)).toBeTruthy();
  });

  it("with no shape written the village sees the placeholder at N%, and no line it has not written", async () => {
    await applyFor("r-gate", { ...FORM, founding: { ...SETUP, shares: [], atRisk: "", footer: "" } });
    const shape = document.querySelector("[data-comp-shape]") as HTMLElement;
    expect(Array.from(shape.querySelectorAll("dt")).map((d) => d.textContent)).toEqual(["Cash", "Equity", "Credits"]);
    expect(Array.from(shape.querySelectorAll("[data-share-pct]")).map((d) => d.textContent)).toEqual(["N%", "N%", "N%"]);
    expect(shape.querySelector("[data-at-risk]")).toBeNull();
    expect(shape.querySelector("[data-comp-footer]")).toBeNull();
  });

  it("each setting the role has written is answered, and the answers travel with the card", async () => {
    await applyFor("r-lfs", { ...FORM, roles: [{ id: "r-lfs", name: "Lead Finance Steward", circle: "Anchor Circle", aim: "Money kept true.", terms: { words: { term: "We renew together each cycle." }, commitmentPct: 100 } }] });
    expect(screen.getByText("We renew together each cycle.")).toBeTruthy();
    expect(document.querySelector("[data-role-beside]")?.textContent).toContain("The role asks 100% of your commitment");
    await completeAll();
    for (const box of screen.getAllByLabelText("I accept")) fireEvent.click(box);
    sendNow();
    await screen.findByRole("heading", { name: "Check your email" });
    expect(posted[0].body.card.terms).toEqual({ answers: { term: { choice: "accept", note: "" }, clocks: { choice: "accept", note: "" } } });
  });
});

describe("your first day", () => {
  it("says what the first cycle looks like, the first conversations, and asks the time zone from the browser and the earliest start", async () => {
    await applyFor();
    const step = document.querySelector('[data-stone="first"]') as HTMLElement;
    expect(step.querySelector("[data-first-cycle]")?.textContent).toContain(SETUP.firstCycle);
    expect(step.querySelector("[data-first-conversations]")?.textContent).toContain("Technical Operations: your accounts and tools");
    expect((within(step).getByLabelText("Your time zone") as HTMLInputElement).value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(within(step).getByLabelText(/earliest you could start/)).toBeTruthy();
    expect(step.querySelector("[data-first-booking]"), "control: a role with no conversations names no first one").toBeNull();
  });

  it("names the first interviewer from the role's own list, and says its booking link comes with the invitation", async () => {
    const conversations = [{ role: "Operations Role", minutes: 60 }, { role: "Hiring Role", minutes: 20 }];
    await applyFor("r-gate", { ...FORM, roles: [{ ...(FORM as any).roles[0], conversations }] });
    const step = document.querySelector('[data-stone="first"]') as HTMLElement;
    const said = step.querySelector("[data-first-booking]")?.textContent ?? "";
    expect(said).toContain("With Operations Role.");
    expect(said).toContain("through the booking link in your invitation, or we'll write to you with times");
    expect(said).not.toContain("Hiring Role");
  });
});

describe("the saved draft", () => {
  it("keeps the words and the step across leaving and coming back, never the references, and is cleared once sent", async () => {
    await applyFor();
    pressNext();
    fillAbout();
    fireEvent.change(screen.getByLabelText("Reference 1: name"), { target: { value: "Ines Vargas" } });
    fireEvent.change(screen.getByLabelText("Reference 1: how you know them"), { target: { value: "We built a fence" } });
    fireEvent.change(screen.getByLabelText("Reference 1: email or phone"), { target: { value: "ines@example.org" } });
    pressNext();
    expect(stoneNow()).toBe("value");
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
    const stored = window.localStorage.getItem(draftKey("r-gate", "")) ?? "";
    expect(stored).toContain("The gate is always shut.");
    expect(stored).not.toContain("Ines Vargas");
    expect(stored).not.toContain("ines@example.org");
    expect(stored).not.toMatch(/consent|references|files/);
    cleanup();

    await applyFor();
    expect(await screen.findByText(/We kept your answers from last time/)).toBeTruthy();
    expect(stoneNow()).toBe("value");
    expect((screen.getByLabelText(OPEN_WORDS.aimLabel) as HTMLInputElement).value).toBe("The gate opens at dawn.");
    expect((screen.getByLabelText(OPEN_WORDS.whyLabel) as HTMLTextAreaElement).value).toBe("The gate is always shut.");
    expect((screen.getByLabelText("Reference 1: name") as HTMLInputElement).value).toBe("");

    await completeAll();
    sendNow();
    await screen.findByRole("heading", { name: "Check your email" });
    expect(window.localStorage.getItem(draftKey("r-gate", ""))).toBeNull();
  });

  it("a draft for one role never fills another role's application", async () => {
    await applyFor("r-gate");
    pressNext();
    fillAbout();
    cleanup();
    await applyFor("r-host");
    expect((screen.getByLabelText(OPEN_WORDS.whyLabel) as HTMLTextAreaElement).value).toBe("");
    expect(stoneNow()).toBe("know");
  });
});

describe("what the form kept from the Firefly Path", () => {
  it("membership at application: the letter is there to read, aligning sends its version, and a signed-in member already aligned is asked nothing", async () => {
    await applyFor();
    const ask = await waitFor(() => {
      const el = document.querySelector('[data-membership="ask"]');
      if (!el) throw new Error("no membership block yet");
      return el as HTMLElement;
    });
    expect(within(ask).getByText(/Read the Membership agreement/)).toBeTruthy();
    expect(within(ask).getByText(/No payment is asked/)).toBeTruthy();
    expect(screen.queryByLabelText(/Love Letter/)).toBeNull();
    cleanup();

    auth.user = { name: "Gil Moss", email: "gil@example.test" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
        if (String(url).startsWith("/api/membership-letter")) return json(LETTER);
        if (String(url).startsWith("/api/profile/alignments")) return json({ alignments: [{ kind: "membership", state: "in-force" }] });
        return json(FORM);
      }),
    );
    render(<ProposeARole />);
    expect(await screen.findByText(/already aligned with the village's membership letter/)).toBeTruthy();
    expect(screen.queryByLabelText(LETTER.intent)).toBeNull();
  });

  it("links and files: a link is sent with its label, a file goes as multipart, and the data promise is on the form", async () => {
    await applyFor();
    expect(document.querySelector("[data-attachments-promise]")?.textContent).toBe(ATTACHMENT_WORDS.promise);
    fireEvent.change(screen.getByLabelText("Link 1: what it is"), { target: { value: "Gates I built" } });
    fireEvent.change(screen.getByLabelText("Link 1: web address"), { target: { value: "https://gates.example.org/rowan" } });
    const pdf = new File(["%PDF-1.7"], "portfolio.pdf", { type: "application/pdf" });
    fireEvent.change(document.querySelector('[data-attachments] input[type="file"]') as HTMLInputElement, { target: { files: [pdf] } });
    await completeAll();
    sendNow();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body.links).toEqual([{ label: "Gates I built", url: "https://gates.example.org/rowan" }]);
    expect(sentAs[0].files.map((f) => f.name)).toEqual(["portfolio.pdf"]);
    expect(sentAs[0].headers).toBeUndefined();
  });

  it("without files the application goes as JSON, and blank link rows are not sent", async () => {
    await applyFor();
    await completeAll();
    sendNow();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(sentAs[0]).toEqual({ files: [], headers: { "Content-Type": "application/json" } });
    expect(posted[0].body).not.toHaveProperty("links");
  });

  it("a server refusal on a field lands on that field's step, marks it, and nothing is lost", async () => {
    await applyFor("r-gate", FORM, { status: 400, body: { error: OPEN_WORDS.needWhy, field: "why" } });
    await completeAll();
    sendNow();
    expect((await screen.findByRole("alert")).textContent).toContain(OPEN_WORDS.needWhy);
    expect(stoneNow()).toBe("about");
    expect(screen.getByLabelText(OPEN_WORDS.whyLabel).getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText(OPEN_WORDS.nameLabel) as HTMLInputElement).value).toBe("Rowan");
  });

  it("a refusal for too many tries stays on Review & submit in the server's own words, and nothing is lost", async () => {
    await applyFor("r-gate", FORM, { status: 429, body: { error: OPEN_WORDS.tooMany } });
    await completeAll();
    sendNow();
    expect((await screen.findByRole("alert")).textContent).toContain(OPEN_WORDS.tooMany);
    expect(stoneNow()).toBe("review");
    expect((screen.getByLabelText(OPEN_WORDS.nameLabel) as HTMLInputElement).value).toBe("Rowan");
  });

  it("the first unanswered field: an unpicked choice, an empty line or list, and an optional note passed over", () => {
    const box = document.createElement("div");
    box.innerHTML = `
      <input type="radio" name="a" checked><input type="radio" name="a">
      <textarea id="note"></textarea>
      <input type="checkbox" id="tick">
      <input id="filled" value="here">
      <select id="pick"><option value="">Choose</option><option value="10">10%</option></select>
      <input id="later">`;
    expect(firstUnanswered(box)?.id).toBe("pick");
    (box.querySelector("#pick") as HTMLSelectElement).value = "10";
    expect(firstUnanswered(box)?.id).toBe("later");
  });

  it("holds the floating compass back, says an AI may draft replies in the confirmation email's words, and hides the honeypot", async () => {
    await applyFor();
    expect(document.querySelector("form[data-hides-fab]")).toBeTruthy();
    expect(document.querySelector("[data-ai-drafts]")?.textContent).toBe(OPEN_AI_DRAFTS);
    const hp = document.querySelector('input[name="hp"]') as HTMLInputElement;
    expect(hp.tabIndex).toBe(-1);
    expect(hp.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it("a guest who is signed in finds their name and address filled in, and is not told they need no account", async () => {
    auth.user = { name: "Gil Moss", email: "gil@example.test" };
    await applyFor();
    const name = screen.getByLabelText(OPEN_WORDS.nameLabel) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe("Gil Moss"));
    expect((screen.getByLabelText(OPEN_WORDS.emailLabel) as HTMLInputElement).value).toBe("gil@example.test");
    expect(document.body.textContent).not.toContain("no account needed");
    expect(document.body.textContent).toContain("Your name and email come from your account");
  });

  it("QA2-05: names no internal cycle under the title, even when the village's applications run by the moon", async () => {
    await applyFor("r-gate", { ...FORM, season: { id: "s-now", name: "Season of Seeds", startsOn: "2000-01-01" }, term: { kind: "moon", startsOn: "2026-11-09", endsOn: "2026-12-08" } });
    expect(document.querySelector("[data-term-days]")).toBeNull();
    expect(document.querySelector("header")?.textContent).not.toMatch(/9 November 2026|8 December 2026|This application is for the cycle/);
  });

  it("QA2-14: the village's note shows under the title while it is set, and nothing shows while it is empty", async () => {
    await applyFor("r-gate", { ...FORM, founding: { ...SETUP, updatedNote: "We updated this application on 14 November. Your saved answers are still here." } });
    const note = document.querySelector("[data-updated-note]");
    expect(note?.textContent).toBe("We updated this application on 14 November. Your saved answers are still here.");
    // Under the title: the note sits in the page header with the heading.
    expect(note?.closest("header")?.querySelector("h1")).toBeTruthy();
    cleanup();
    await applyFor("r-gate");
    expect(document.querySelector("[data-updated-note]")).toBeNull();
  });

  it("closed: says so, and shows no form", async () => {
    serve({ open: false, message: OPEN_WORDS.closed });
    render(<ProposeARole />);
    expect(await screen.findByText(OPEN_WORDS.closed)).toBeTruthy();
    expect(document.querySelector("[data-open-proposal]")).toBeNull();
  });

  it("no next season: says so, and shows no form", async () => {
    await applyFor("r-gate", { ...FORM, season: null });
    expect(screen.getByText(OPEN_WORDS.noSeason)).toBeTruthy();
    expect(document.querySelector("[data-open-proposal]")).toBeNull();
  });
});

describe("the sent threshold", () => {
  const sendAs = async (address: string, replyDays?: number, form: unknown = FORM) => {
    await applyFor("r-gate", form, { status: 200, body: { sent: true, message: OPEN_WORDS.sent(address), ...(replyDays ? { replyDays } : {}) } });
    await completeAll();
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: address } });
    sendNow();
    await screen.findByRole("heading", { name: "Check your email" });
  };

  it("offers the inbox for a provider we know, dated next steps, and quiet doors while you wait (no game words)", async () => {
    await sendAs("rowan@gmail.com", 7);
    expect(screen.getByRole("link", { name: "Open Gmail" }).getAttribute("href")).toBe("https://mail.google.com/");
    const steps = document.querySelector("[data-dated-steps]") as HTMLElement;
    expect(steps.querySelectorAll("li")).toHaveLength(2);
    expect(steps.textContent).toMatch(/Open the link in that email by /);
    expect(steps.textContent).toMatch(/Our review: we read every application, and write to you by /);
    const doors = within(document.querySelector("[data-wait-doors]") as HTMLElement).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(doors).toEqual(["/roles", "/love-letter"]);
    expect(document.querySelector('[data-threshold="sent"] [data-met="false"]')).toBeTruthy();
  });

  it("names the role's conversations in order after sending", async () => {
    const conversations = [
      { role: "Operations Steward", minutes: 60 },
      { role: "CRM & Hiring Coordination Steward", minutes: 30 },
      { role: "Visionary Channel", minutes: 30, finalApproval: true },
    ];
    await sendAs("rowan@example.test", undefined, { ...FORM, roles: [{ ...FORM.roles[0], conversations }] });
    const items = Array.from((document.querySelector("[data-next-for-roles]") as HTMLElement).querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual(["60 minutes with Operations Steward", "30 minutes with CRM & Hiring Coordination Steward", "30 minutes with Visionary Channel, the final approval"]);
  });

  it("no inbox button for a domain we do not know, and Fix the address goes back to the address with every answer kept", async () => {
    await sendAs("rowan@example.test");
    expect(document.querySelector("[data-inbox-link]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not rowan@example.test? Fix the address" }));
    expect(stoneNow()).toBe("about");
    await waitFor(() => expect(document.activeElement?.id).toBe("propose-email"));
    expect((screen.getByLabelText(OPEN_WORDS.whyLabel) as HTMLTextAreaElement).value).toBe("The gate is always shut.");
  });
});

describe("the confirmation link", () => {
  it("confirms, and says it is with us", async () => {
    window.history.pushState({}, "", "/propose-a-role/confirm?token=abc");
    serve({}, { status: 200, body: { confirmed: true, message: OPEN_WORDS.confirmed } });
    render(<ConfirmProposal />);
    expect(await screen.findByRole("heading", { name: "Confirmed" })).toBeTruthy();
    expect(screen.getByText(/Your application is with us now/)).toBeTruthy();
    expect(document.body.textContent?.match(/Confirmed/g)).toHaveLength(1);
    await waitFor(() => expect(document.querySelector('[data-met="true"]')).toBeTruthy());
    await waitFor(() => expect(posted[0]).toEqual({ url: "/api/open-proposals/confirm", body: { token: "abc" } }));
  });

  it("shows the private status link the confirmation hands back, and only a status address", async () => {
    window.history.pushState({}, "", "/propose-a-role/confirm?token=abc");
    serve({}, { status: 200, body: { confirmed: true, message: OPEN_WORDS.confirmed, statusPath: "/application-status/op-1?token=s3cret" } });
    render(<ConfirmProposal />);
    const link = await screen.findByRole("link", { name: "Follow your application" });
    expect(link.getAttribute("href")).toBe("/application-status/op-1?token=s3cret");
    cleanup();
    serve({}, { status: 200, body: { confirmed: true, message: OPEN_WORDS.confirmed, statusPath: "https://elsewhere.example/x" } });
    render(<ConfirmProposal />);
    await screen.findByRole("heading", { name: "Confirmed" });
    expect(screen.queryByRole("link", { name: "Follow your application" })).toBeNull();
  });

  it("draws the steps after submit when the confirm route carries them (lane A2's one list), in order", async () => {
    window.history.pushState({}, "", "/propose-a-role/confirm?token=abc");
    const steps = [
      { key: "received", name: "Received", when: "Today" },
      { key: "review", name: "Our review", when: "Within 7 days" },
    ];
    serve({}, { status: 200, body: { confirmed: true, message: OPEN_WORDS.confirmed, steps } });
    render(<ConfirmProposal />);
    await screen.findByRole("heading", { name: "Confirmed" });
    const items = Array.from(document.querySelectorAll("[data-step-after]")).map((li) => li.getAttribute("data-step-after"));
    expect(items).toEqual(["received", "review"]);
    expect(document.querySelector('[data-step-after="review"]')?.textContent).toBe("Our review Within 7 days");
  });

  it("a link that ran out says so, and offers to apply again", async () => {
    window.history.pushState({}, "", "/propose-a-role/confirm?token=old");
    serve({}, { status: 410, body: { error: OPEN_WORDS.confirmGone } });
    render(<ConfirmProposal />);
    expect(await screen.findByText(OPEN_WORDS.confirmGone)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Apply again" }).getAttribute("href")).toBe("/propose-a-role");
  });
});

describe("on a phone with the keyboard up (M2, batch 158)", () => {
  it("keeps one bar at the bottom: the tab bar steps out while the application is open", async () => {
    await applyFor();
    expect(document.querySelector("form[data-open-proposal]")?.hasAttribute("data-hides-tabbar-phone")).toBe(true);
  });

  it("lifts the step bar above the keyboard, and lets it down when the keyboard closes", async () => {
    class FakeViewport extends EventTarget {
      height = 800;
      offsetTop = 0;
    }
    const vv = new FakeViewport();
    vi.stubGlobal("visualViewport", vv);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    await applyFor();
    const bar = document.querySelector("[data-stone-bar]") as HTMLElement;
    expect(bar.getAttribute("data-keyboard")).toBeNull();
    expect(bar.className).toContain("bottom-[calc(var(--stone-kb,0px)");
    vv.height = 460;
    vv.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(bar.getAttribute("data-keyboard")).toBe("open"));
    expect(bar.style.getPropertyValue("--stone-kb")).toBe("340px");
    vv.height = 800;
    vv.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(bar.getAttribute("data-keyboard")).toBeNull());
  });
});

describe("the review step's words (batch 158)", () => {
  it("no longer says the line the lead deleted: \"Aligning is the village's way of signing\"", async () => {
    await applyFor();
    await completeAll();
    walk();
    expect(stoneNow()).toBe("review");
    await screen.findByLabelText(LETTER.intent);
    expect(document.body.textContent).toContain("It takes effect once you confirm your address");
    expect(document.body.textContent).not.toMatch(/way of signing/);
  });
});
