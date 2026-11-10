// @vitest-environment jsdom
/**
 * PROPOSE A ROLE, WITHOUT AN ACCOUNT: the page (sheet 19i). The server's
 * answers are canned here; server/routes/openProposals.test.ts proves them.
 *
 *   - next season's roles, grouped by circle, up to three picked, each with
 *     what the person brings, then why, name and address; sending says to
 *     check their email, because nothing reaches the village until they confirm
 *   - a refusal names its field; the page closed says so
 *   - the confirmation link confirms, or says it did not work and how to start again
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OPEN_AI_DRAFTS, OPEN_WORDS } from "@shared/openProposals";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const auth = vi.hoisted(() => ({ user: null as null | { name: string; email: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: auth.user }) }));

import ProposeARole, { ConfirmProposal } from "./ProposeARole";

const FORM = {
  open: true,
  village: "Test Village",
  season: { id: "s-next", name: "Season of Roots", startsOn: "2099-01-01" },
  roles: [
    { id: "r-gate", name: "Gate Keeper", circle: "Land Circle", aim: "Open the gate at dawn." },
    { id: "r-well", name: "Well Keeper", circle: "Land Circle", aim: null },
    { id: "r-host", name: "Welcome Host", circle: "People Circle", aim: "Meet every newcomer." },
    { id: "r-cook", name: "Cook", circle: "People Circle", aim: null },
  ],
};

/** The membership letter the form shows and aligns with (Rye's answer 8). */
const LETTER = { version: "lv-0123456789abcdef", title: "Membership agreement", body: "Dear friend, welcome home.", intent: "I align with the Membership agreement.", parts: {} };

let posted: any[] = [];

function serve(form: unknown, answer: { status: number; body: unknown } = { status: 200, body: { sent: true, message: OPEN_WORDS.sent("rowan@example.test") } }) {
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
      }
      if (String(url).startsWith("/api/membership-letter")) return new Response(JSON.stringify(LETTER), { status: 200, headers: { "content-type": "application/json" } });
      if (String(url).startsWith("/api/profile/alignments")) return new Response(JSON.stringify({ alignments: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(form), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.user = null;
  window.history.pushState({}, "", "/");
});

describe("the form", () => {
  it("offers next season's roles by circle, up to three, and sending says to check the email", async () => {
    serve(FORM);
    render(<ProposeARole />);
    expect(await screen.findByRole("heading", { name: OPEN_WORDS.heading("Test Village") })).toBeTruthy();
    expect(screen.getByText(OPEN_WORDS.lede("Season of Roots"))).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Land Circle" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "People Circle" })).toBeTruthy();

    const box = (name: string) => within(document.querySelector(`[data-role="${name}"]`) as HTMLElement).getByRole("checkbox");
    fireEvent.click(box("r-gate"));
    fireEvent.click(box("r-well"));
    fireEvent.click(box("r-host"));
    // A fourth cannot be ticked.
    expect((box("r-cook") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(box("r-well"));
    expect((box("r-cook") as HTMLInputElement).disabled).toBe(false);

    const gate = document.querySelector('[data-role="r-gate"]') as HTMLElement;
    fireEvent.change(within(gate).getByLabelText(/What you bring to this role/), { target: { value: "I open gates for a living." } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "The gate is always shut." } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
    fireEvent.click(screen.getByLabelText("I accept the terms on offer."));
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Rowan Field" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "rowan@example.test" } });
    // The two agreements are required (Rye, 9 Nov). The membership letter is aligned with HERE, by
    // the version the form drew (Rye's answer 8); the confidentiality agreement once approved.
    fireEvent.click(await screen.findByLabelText(LETTER.intent));
    fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByText(OPEN_WORDS.sent("rowan@example.test"))).toBeTruthy();
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("/api/open-proposals");
    expect(posted[0].body.card.terms).toEqual({ choice: "accept", note: "" });
    expect(posted[0].body).toMatchObject({
      name: "Rowan Field",
      email: "rowan@example.test",
      why: "The gate is always shut.",
      hp: "",
      roles: [
        { roleId: "r-gate", note: "I open gates for a living." },
        { roleId: "r-host", note: "" },
      ],
      card: { roles: [{ roleId: "r-gate", moves: [], firstMoon: [] }, { roleId: "r-host", moves: [], firstMoon: [] }], serves: [], hours: "", agreed: { nda: true } },
      membership: { letterVersion: LETTER.version },
    });
    // No payment anywhere on the path: nothing posted names money.
    expect(JSON.stringify(posted[0].body)).not.toMatch(/contribution|amount|payment|dues/i);
  });

  it("membership at application: the letter is there to read, aligning sends its version, and a signed-in member already aligned is asked nothing", async () => {
    serve(FORM);
    render(<ProposeARole />);
    const ask = await waitFor(() => {
      const el = document.querySelector('[data-membership="ask"]');
      if (!el) throw new Error("no membership block yet");
      return el as HTMLElement;
    });
    expect(within(ask).getByText(/Read the Membership agreement/)).toBeTruthy();
    expect(within(ask).getByText(/Aligning is the village's way of signing\./)).toBeTruthy();
    expect(within(ask).getByText(/No payment is asked/)).toBeTruthy();
    // Control: there is no Love Letter tick on the form at all; the alignment is the agreement.
    expect(screen.queryByLabelText(/Love Letter/)).toBeNull();
    // The one checkbox about the letter is the alignment itself, bound to the letter's own sentence.
    const aboutLetter = screen.getAllByRole("checkbox").filter((c) => /Love Letter|membership/i.test(c.closest("label")?.textContent ?? ""));
    expect(aboutLetter.map((c) => c.closest("label")?.textContent)).toEqual([LETTER.intent]);
    cleanup();

    auth.user = { name: "Gil Moss", email: "gil@example.test" };
    posted = [];
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

  it("a refusal says why and marks its field, and nothing is lost", async () => {
    serve(FORM, { status: 400, body: { error: OPEN_WORDS.needWhy, field: "why" } });
    render(<ProposeARole />);
    fireEvent.click(within((await screen.findByText("Gate Keeper")).closest("[data-role]") as HTMLElement).getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Rowan" } });
    fireEvent.submit(document.querySelector("[data-open-proposal]") as HTMLFormElement);
    expect((await screen.findByRole("alert")).textContent).toBe(OPEN_WORDS.needWhy);
    expect(screen.getByLabelText(OPEN_WORDS.whyLabel).getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText(OPEN_WORDS.nameLabel) as HTMLInputElement).value).toBe("Rowan");
  });

  it("the privacy note says an AI may draft replies, in the same words as the confirmation email", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    expect(document.querySelector("[data-ai-drafts]")?.textContent).toBe(OPEN_AI_DRAFTS);
  });

  it("the honeypot is there, hidden from people and from screen readers", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    const hp = document.querySelector('input[name="hp"]') as HTMLInputElement;
    expect(hp.tabIndex).toBe(-1);
    expect(hp.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it("a circle card's Apply link lands with its role ticked, and a role no longer offered ticks nothing", async () => {
    window.history.pushState({}, "", "/propose-a-role?role=r-host");
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Welcome Host");
    const ticked = (id: string) => (within(document.querySelector(`[data-role="${id}"]`) as HTMLElement).getByRole("checkbox") as HTMLInputElement).checked;
    expect(ticked("r-host")).toBe(true);
    expect(ticked("r-gate")).toBe(false);
    cleanup();
    window.history.pushState({}, "", "/propose-a-role?role=r-gone");
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Welcome Host");
    expect(["r-gate", "r-well", "r-host", "r-cook"].some(ticked)).toBe(false);
  });

  it("a guest who is signed in finds their name and address filled in, and can change them", async () => {
    auth.user = { name: "Gil Moss", email: "gil@example.test" };
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    const name = screen.getByLabelText(OPEN_WORDS.nameLabel) as HTMLInputElement;
    expect(name.value).toBe("Gil Moss");
    expect((screen.getByLabelText(OPEN_WORDS.emailLabel) as HTMLInputElement).value).toBe("gil@example.test");
    fireEvent.change(name, { target: { value: "Gil" } });
    expect(name.value).toBe("Gil");
  });

  it("closed: says so, and shows no form", async () => {
    serve({ open: false, message: OPEN_WORDS.closed });
    render(<ProposeARole />);
    expect(await screen.findByText(OPEN_WORDS.closed)).toBeTruthy();
    expect(document.querySelector("[data-open-proposal]")).toBeNull();
  });

  it("no next season: says so, and shows no form", async () => {
    serve({ ...FORM, season: null, roles: [] });
    render(<ProposeARole />);
    expect(await screen.findByText(OPEN_WORDS.noSeason)).toBeTruthy();
    expect(document.querySelector("[data-open-proposal]")).toBeNull();
  });
});

describe("the confirmation link", () => {
  it("confirms, and says it is with the village", async () => {
    window.history.pushState({}, "", "/propose-a-role/confirm?token=abc");
    serve({}, { status: 200, body: { confirmed: true, message: OPEN_WORDS.confirmed } });
    render(<ConfirmProposal />);
    expect(await screen.findByText(OPEN_WORDS.confirmed)).toBeTruthy();
    await waitFor(() => expect(posted[0]).toEqual({ url: "/api/open-proposals/confirm", body: { token: "abc" } }));
  });

  it("shows the private status link the confirmation hands back, and only a status address (role journey L5)", async () => {
    window.history.pushState({}, "", "/propose-a-role/confirm?token=abc");
    serve({}, { status: 200, body: { confirmed: true, message: OPEN_WORDS.confirmed, statusPath: "/application-status/op-1?token=s3cret" } });
    render(<ConfirmProposal />);
    const link = await screen.findByRole("link", { name: "Follow where your proposal is" });
    expect(link.getAttribute("href")).toBe("/application-status/op-1?token=s3cret");
    cleanup();
    // Anything else the server might hand back is not drawn as a link.
    serve({}, { status: 200, body: { confirmed: true, message: OPEN_WORDS.confirmed, statusPath: "https://elsewhere.example/x" } });
    render(<ConfirmProposal />);
    await screen.findByText(OPEN_WORDS.confirmed);
    expect(screen.queryByRole("link", { name: "Follow where your proposal is" })).toBeNull();
  });

  it("a link that ran out says so, and offers to start again", async () => {
    window.history.pushState({}, "", "/propose-a-role/confirm?token=old");
    serve({}, { status: 410, body: { error: OPEN_WORDS.confirmGone } });
    render(<ConfirmProposal />);
    expect(await screen.findByText(OPEN_WORDS.confirmGone)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Propose again" }).getAttribute("href")).toBe("/propose-a-role");
  });
});

/*
 * A DRAFT OF SEVERAL ROLES (role draft board, 9 Nov). The board sends every
 * drafted role as its own `role` parameter. Each one the village still offers
 * arrives ticked, up to the three a proposal may name; one it no longer
 * offers is said out loud rather than dropped in silence.
 */
describe("arriving with several roles", () => {
  const ticked = (id: string) => (within(document.querySelector(`[data-role="${id}"]`) as HTMLElement).getByRole("checkbox") as HTMLInputElement).checked;

  it("ticks every drafted role the village offers", async () => {
    window.history.pushState({}, "", "/propose-a-role?role=r-gate&role=r-host");
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByRole("heading", { name: OPEN_WORDS.heading("Test Village") });
    await waitFor(() => expect(ticked("r-gate")).toBe(true));
    expect(ticked("r-host")).toBe(true);
    expect(ticked("r-well")).toBe(false);
  });

  it("says when a drafted role is no longer offered, and ticks the rest", async () => {
    window.history.pushState({}, "", "/propose-a-role?role=r-gone&role=r-cook");
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByRole("heading", { name: OPEN_WORDS.heading("Test Village") });
    await waitFor(() => expect(ticked("r-cook")).toBe(true));
    expect(screen.getByText(/1 role you picked is not open any more/)).toBeTruthy();
  });

  it("ticks no more than three", async () => {
    window.history.pushState({}, "", "/propose-a-role?role=r-gate&role=r-well&role=r-host&role=r-cook");
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByRole("heading", { name: OPEN_WORDS.heading("Test Village") });
    await waitFor(() => expect(ticked("r-gate")).toBe(true));
    expect([ticked("r-well"), ticked("r-host"), ticked("r-cook")]).toEqual([true, true, false]);
  });
});

describe("a village whose proposals are for this moon (Rye, 9 Nov 2026)", () => {
  it("names the moon's days instead of next season", async () => {
    serve({ ...FORM, season: { id: "s-now", name: "Season of Seeds", startsOn: "2000-01-01" }, term: { kind: "moon", startsOn: "2026-11-09", endsOn: "2026-12-08" } });
    render(<ProposeARole />);
    expect(await screen.findByText(OPEN_WORDS.ledeMoon("9 November 2026", "8 December 2026"))).toBeTruthy();
  });
});

describe("the applicant's own card beside the open one (Rye, 9 Nov 2026)", () => {
  it("asks for the role's outcomes with targets, first-moon quests, the season's goals and the agreements, and sends them as the card", async () => {
    window.history.pushState({}, "", "/propose-a-role?role=r-lfs");
    serve({
      ...FORM,
      goals: [{ id: "g-investor", text: "Investor ready" }],
      roles: [{ id: "r-lfs", name: "Lead Financial Steward", circle: "Anchor Circle", aim: "Money kept true.", timeCommitment: "30 hours a week", accountabilities: ["One living model", "A cash view every Monday"] }],
    });
    render(<ProposeARole />);
    await screen.findByText("What this role asks");
    expect(screen.getByText("Time: roughly 30 hours a week")).toBeTruthy();
    expect(document.querySelector("[data-no-season-goals]")).toBeNull();
    fireEvent.click(screen.getByLabelText("A cash view every Monday"));
    fireEvent.change(screen.getByLabelText("Your target for: A cash view every Monday"), { target: { value: "13 of 13 Mondays" } });
    fireEvent.change(screen.getByLabelText("Quest 1 for Lead Financial Steward"), { target: { value: "Publish the first cash view" } });
    fireEvent.change(screen.getByLabelText("Done when, for quest 1 for Lead Financial Steward"), { target: { value: "every circle lead has it" } });
    fireEvent.click(screen.getByLabelText("Investor ready"));
    fireEvent.change(screen.getByLabelText("How your work serves: Investor ready"), { target: { value: "One set of numbers" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "I keep books." } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
    fireEvent.click(screen.getByLabelText("I accept the terms on offer."));
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Juno Reed" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "juno@example.test" } });
    fireEvent.click(await screen.findByLabelText(LETTER.intent));
    fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    await screen.findByRole("heading", { name: "Check your email" });
    expect(posted[0].body.card).toMatchObject({
      roles: [{ roleId: "r-lfs", moves: [{ text: "A cash view every Monday", target: "13 of 13 Mondays" }], firstMoon: [{ quest: "Publish the first cash view", doneWhen: "every circle lead has it" }] }],
      serves: [{ goalId: "g-investor", how: "One set of numbers" }],
      hours: "",
      agreed: { nda: true },
      terms: { choice: "accept", note: "" },
    });
  });
});

describe("form v2 (role journey brief v2, 5.4)", () => {
  it("takes the time zone from the browser, and shows each picked role's conversations in order after sending", async () => {
    window.history.pushState({}, "", "/propose-a-role?role=r-lfs");
    serve({
      ...FORM,
      roles: [
        {
          id: "r-lfs",
          name: "Lead Financial Steward",
          circle: "Anchor Circle",
          aim: null,
          conversations: [
            { role: "Visionary Channel", minutes: 60 },
            { role: "Technical Operations Steward", minutes: 20 },
            { role: "Anchor Circle Steward", minutes: 20, finalApproval: true },
          ],
        },
      ],
    });
    render(<ProposeARole />);
    const tz = (await screen.findByLabelText("Your time zone")) as HTMLInputElement;
    expect(tz.value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    // Brief v3: a season with no goals yet says so, and the application still goes (below).
    expect(document.querySelector("[data-no-season-goals]")?.textContent).toMatch(/not set its goals for this season yet/);
    fireEvent.click(screen.getByLabelText("I'd like to talk about the terms."));
    fireEvent.change(screen.getByLabelText("What you would like to talk about in the terms"), { target: { value: "The hours" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "I keep books." } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "Money kept true." } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Juno Reed" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "juno@example.test" } });
    fireEvent.click(await screen.findByLabelText(LETTER.intent));
    fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    await screen.findByRole("heading", { name: "Check your email" });
    expect(posted[0].body.card.terms).toEqual({ choice: "talk", note: "The hours" });
    const steps = document.querySelector("[data-next-for-roles]") as HTMLElement;
    const items = Array.from(steps.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual(["60 minutes with Visionary Channel", "20 minutes with Technical Operations Steward", "20 minutes with Anchor Circle Steward, the final approval"]);
    expect(steps.textContent).toContain("We'll write to you to find a time.");
  });
});
