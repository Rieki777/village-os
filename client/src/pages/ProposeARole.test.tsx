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
import { CARD_WORDS } from "@shared/openProposalCard";
import { ATTACHMENT_WORDS } from "@shared/proposalAttachments";

// fillGoals is audit B1's helper: one goal on every picked role's card. The path's walk is the test kit's.
import { fillGoals, pressNext, sendNow, stoneNow, walk } from "@/test/proposeStones";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const auth = vi.hoisted(() => ({ user: null as null | { name: string; email: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: auth.user }) }));

import ProposeARole, { ConfirmProposal, firstUnanswered } from "./ProposeARole";

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
/** How each post went: its files, and the headers set by hand. */
let sentAs: Array<{ files: File[]; headers: RequestInit["headers"] }> = [];

function serve(form: unknown, answer: { status: number; body: unknown } = { status: 200, body: { sent: true, message: "The server's own English words, never shown." } }) {
  posted = [];
  sentAs = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        // With files the proposal is one field of a multipart post (Rye, 10 Nov 2026).
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

/** Everything the form asks before it will send, for a test that is about something else. */
const completeTheRest = async () => {
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "The gate is always shut." } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Rowan" } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "rowan@example.test" } });
  fireEvent.click(await screen.findByLabelText(LETTER.intent));
  fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
  fillGoals();
};

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
    fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Rowan Field" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "rowan@example.test" } });
    // The two agreements are required (Rye, 9 Nov). The membership letter is aligned with HERE, by
    // the version the form drew (Rye's answer 8); the confidentiality agreement once approved.
    fireEvent.click(await screen.findByLabelText(LETTER.intent));
    fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
    // About you: no references, so the background-check consent is ticked (joining lane PR 2).
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    fillGoals();
    sendNow();

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByText(OPEN_WORDS.sent("rowan@example.test"))).toBeTruthy();
    // Our own words in the reader's language, whatever the server said (final verification).
    expect(screen.queryByText(/server's own English/)).toBeNull();
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("/api/open-proposals");
    expect(posted[0].body.card.terms).toEqual({ answers: {} });
    expect(posted[0].body.card.commitmentPct).toBe(50);
    expect(posted[0].body.card).not.toHaveProperty("hours");
    expect(posted[0].body).toMatchObject({
      name: "Rowan Field",
      email: "rowan@example.test",
      why: "The gate is always shut.",
      hp: "",
      roles: [
        { roleId: "r-gate", note: "I open gates for a living." },
        { roleId: "r-host", note: "" },
      ],
      card: { roles: [{ roleId: "r-gate", moves: [], firstMoon: [{ quest: "Open the gate each dawn", doneWhen: "the gate is open by sunrise" }] }, { roleId: "r-host", moves: [], firstMoon: [{ quest: "Open the gate each dawn", doneWhen: "the gate is open by sunrise" }] }], serves: [], commitmentPct: 50, agreed: { nda: true } },
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
    const aboutLetter = screen.getAllByRole("checkbox", { hidden: true }).filter((c) => /Love Letter|membership/i.test(c.closest("label")?.textContent ?? ""));
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

  it("links and files: a link is sent with its label, a file goes as multipart, and the data promise is on the form (Rye, 10 Nov 2026)", async () => {
    serve(FORM);
    render(<ProposeARole />);
    fireEvent.click(within((await screen.findByText("Gate Keeper")).closest("[data-role]") as HTMLElement).getByRole("checkbox"));
    expect(document.querySelector("[data-attachments-promise]")?.textContent).toBe(ATTACHMENT_WORDS.promise);
    fireEvent.change(screen.getByLabelText("Link 1: what it is"), { target: { value: "Gates I built" } });
    fireEvent.change(screen.getByLabelText("Link 1: web address"), { target: { value: "http://gates.example.org" } });
    // Said at once: an address that is not https.
    expect(screen.getByRole("alert", { hidden: true }).textContent).toBe(ATTACHMENT_WORDS.linkNotHttps);
    fireEvent.change(screen.getByLabelText("Link 1: web address"), { target: { value: "https://gates.example.org/rowan" } });
    expect(screen.queryByRole("alert", { hidden: true })).toBeNull();
    const pdf = new File(["%PDF-1.7"], "portfolio.pdf", { type: "application/pdf" });
    fireEvent.change(document.querySelector('[data-attachments] input[type="file"]') as HTMLInputElement, { target: { files: [pdf] } });
    expect(document.querySelector('[data-file-row="0"]')?.textContent).toContain("portfolio.pdf");
    fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    await completeTheRest();
    sendNow();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body.links).toEqual([{ label: "Gates I built", url: "https://gates.example.org/rowan" }]);
    expect(sentAs[0].files.map((f) => f.name)).toEqual(["portfolio.pdf"]);
    // The browser writes the multipart boundary itself: no content type is set by hand.
    expect(sentAs[0].headers).toBeUndefined();
  });

  it("without files the proposal goes as JSON, and blank link rows are not sent", async () => {
    serve(FORM);
    render(<ProposeARole />);
    fireEvent.click(within((await screen.findByText("Gate Keeper")).closest("[data-role]") as HTMLElement).getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    await completeTheRest();
    sendNow();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(sentAs[0]).toEqual({ files: [], headers: { "Content-Type": "application/json" } });
    expect(posted[0].body).not.toHaveProperty("links");
  });

  it("a refusal says why and marks its field, and nothing is lost", async () => {
    serve(FORM, { status: 400, body: { error: OPEN_WORDS.needWhy, field: "why" } });
    render(<ProposeARole />);
    fireEvent.click(within((await screen.findByText("Gate Keeper")).closest("[data-role]") as HTMLElement).getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Rowan" } });
    fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    await completeTheRest();
    sendNow();
    expect((await screen.findByRole("alert")).textContent).toContain(OPEN_WORDS.needWhy);
    expect(screen.getByLabelText(OPEN_WORDS.whyLabel).getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByLabelText(OPEN_WORDS.nameLabel) as HTMLInputElement).value).toBe("Rowan");
  });

  it("M1, per stone: Next with gaps posts nothing, lists every gap on that stone at once, shows each beside its field, and moves focus to the first", async () => {
    serve(FORM);
    render(<ProposeARole />);
    fireEvent.click(within((await screen.findByText("Gate Keeper")).closest("[data-role]") as HTMLElement).getByRole("checkbox"));
    pressNext();
    expect(stoneNow()).toBe("moon");
    pressNext();
    // Held on "Your moon": its two gaps, and only its own.
    expect(stoneNow()).toBe("moon");
    const list = (await screen.findByText(/things to look at before the next stone/)).closest("[data-problems]") as HTMLElement;
    for (const words of [OPEN_WORDS.needAim, "Add at least one goal for your first moon."]) expect(list.textContent).toContain(words);
    for (const words of [OPEN_WORDS.needWhy, OPEN_WORDS.needName, OPEN_WORDS.needEmail, CARD_WORDS.agreed]) expect(list.textContent).not.toContain(words);
    expect(posted).toHaveLength(0);
    expect(document.querySelector("#propose-problem-aim")?.textContent).toBe(OPEN_WORDS.needAim);
    await waitFor(() => expect(document.activeElement?.id).toBe("propose-aim"));
    expect(screen.getByLabelText(OPEN_WORDS.aimLabel).getAttribute("aria-invalid")).toBe("true");
  });

  it("a missing goal puts the cursor on the goal's own field, never the first box on the card (final verification, 11 Nov)", async () => {
    serve(FORM);
    render(<ProposeARole />);
    fireEvent.click(within((await screen.findByText("Gate Keeper")).closest("[data-role]") as HTMLElement).getByRole("checkbox"));
    pressNext();
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "Keep the gate open for every visitor." } });
    pressNext();
    expect(stoneNow()).toBe("moon");
    const goals = document.querySelector('[data-role-card="r-gate"] [data-goals-list]') as HTMLElement;
    const title = goals.querySelector<HTMLInputElement>('input[id$="-title"]');
    // An empty goal row is answered on its title; with no row yet, "Add a goal" takes the cursor.
    const want = title ?? goals.querySelector<HTMLElement>('button[id$="-add"]');
    await waitFor(() => expect(document.activeElement).toBe(want));
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
    box.insertAdjacentHTML("afterbegin", `<input type="radio" name="b" id="open">`);
    expect(firstUnanswered(box)?.id).toBe("open");
  });

  it("M1, the final review: Send lists every gap on the whole path at once, in walking order, and each takes you to its stone and field", async () => {
    serve(FORM);
    render(<ProposeARole />);
    fireEvent.click(within((await screen.findByText("Gate Keeper")).closest("[data-role]") as HTMLElement).getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "The gate is always shut." } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
    fillGoals();
    walk();
    expect(stoneNow()).toBe("send");
    // Walked back to "Why you" and emptied it, then straight back to Send along the trail.
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    const list = (await screen.findByText(/things to fix before we can send this/)).closest("[data-problems]") as HTMLElement;
    for (const words of [OPEN_WORDS.needWhy, OPEN_WORDS.needName, OPEN_WORDS.needEmail, CARD_WORDS.agreed]) expect(list.textContent).toContain(words);
    expect(posted).toHaveLength(0);
    // In walking order: Why you (stone 3) comes before the name (stone 6), and names its stone.
    const items = Array.from(list.querySelectorAll("li")).map((li) => li.textContent ?? "");
    expect(items[0]).toBe(`Why you: ${OPEN_WORDS.needWhy}`);
    expect(document.querySelector("#propose-problem-email")?.textContent).toBe(OPEN_WORDS.needEmail);
    // The gap is behind us, so the cursor goes to the list; its line takes you there.
    await waitFor(() => expect(document.activeElement?.id).toBe("propose-problems"));
    fireEvent.click(within(list).getByRole("button", { name: `Why you: ${OPEN_WORDS.needWhy}` }));
    expect(stoneNow()).toBe("why");
    await waitFor(() => expect(document.activeElement?.id).toBe("propose-why"));
    expect(screen.getByLabelText(OPEN_WORDS.whyLabel).getAttribute("aria-invalid")).toBe("true");
  });

  it("the form holds the floating compass back, and a trail names its six stones", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    expect(document.querySelector("form[data-hides-fab]")).toBeTruthy();
    const stones = within(document.querySelector("[data-form-trail]") as HTMLElement).getAllByRole("button");
    expect(stones.map((b) => b.textContent)).toEqual(["1Your role", "2Your moon", "3Why you", "4Your energy", "5About you", "6Send"]);
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
    await waitFor(() => expect(document.querySelector('[data-role="r-host"]')).toBeTruthy());
    const ticked = (id: string) => (within(document.querySelector(`[data-role="${id}"]`) as HTMLElement).getByRole("checkbox") as HTMLInputElement).checked;
    expect(ticked("r-host")).toBe(true);
    expect(ticked("r-gate")).toBe(false);
    cleanup();
    window.history.pushState({}, "", "/propose-a-role?role=r-gone");
    serve(FORM);
    render(<ProposeARole />);
    await waitFor(() => expect(document.querySelector('[data-role="r-host"]')).toBeTruthy());
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
    expect(await screen.findByRole("heading", { name: "Confirmed" })).toBeTruthy();
    expect(screen.getByText(/Your proposal is with the village now/)).toBeTruthy();
    // Said once: the server's own "Confirmed." does not repeat under the heading (lane 1's finding).
    expect(document.body.textContent?.match(/Confirmed/g)).toHaveLength(1);
    // You and the village meet.
    await waitFor(() => expect(document.querySelector('[data-met="true"]')).toBeTruthy());
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
    await screen.findByRole("heading", { name: "Confirmed" });
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
  it("asks for the role's outcomes with targets, first-moon goals, the season's goals and the agreements, and sends them as the card", async () => {
    window.history.pushState({}, "", "/propose-a-role?role=r-lfs");
    serve({
      ...FORM,
      goals: [{ id: "g-investor", text: "Investor ready" }],
      roles: [{ id: "r-lfs", name: "Lead Financial Steward", circle: "Anchor Circle", aim: "Money kept true.", terms: { words: { term: "We renew together each moon." }, commitmentPct: 100 }, accountabilities: ["One living model", "A cash view every Monday"] }],
    });
    render(<ProposeARole />);
    await screen.findByText("What this role asks");
    expect(screen.getAllByText("Commitment: 100%").length).toBeGreaterThan(0);
    expect(screen.getByText("We renew together each moon.")).toBeTruthy();
    expect(document.querySelector("[data-no-season-goals]")).toBeNull();
    fireEvent.click(screen.getByLabelText("A cash view every Monday"));
    fireEvent.change(screen.getByLabelText("Your target for: A cash view every Monday"), { target: { value: "13 of 13 Mondays" } });
    fireEvent.change(screen.getByLabelText("The goal"), { target: { value: "Publish the first cash view" } });
    fireEvent.change(screen.getByLabelText("Done when"), { target: { value: "every circle lead has it" } });
    fireEvent.click(screen.getByLabelText("Investor ready"));
    fireEvent.change(screen.getByLabelText("How your work in Lead Financial Steward serves: Investor ready"), { target: { value: "One set of numbers" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "I keep books." } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
    fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
    // Each setting the role has written is answered: Term and Clocks (it asks a commitment).
    for (const box of screen.getAllByLabelText("I accept")) fireEvent.click(box);
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Juno Reed" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "juno@example.test" } });
    fireEvent.click(await screen.findByLabelText(LETTER.intent));
    fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
    // About you: no references, so the background-check consent is ticked (joining lane PR 2).
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    fillGoals();
    sendNow();
    await screen.findByRole("heading", { name: "Check your email" });
    expect(posted[0].body.card).toMatchObject({
      roles: [{ roleId: "r-lfs", moves: [{ text: "A cash view every Monday", target: "13 of 13 Mondays" }], firstMoon: [{ quest: "Publish the first cash view", doneWhen: "every circle lead has it" }] }],
      serves: [{ goalId: "g-investor", how: "One set of numbers", roleId: "r-lfs" }],
      commitmentPct: 50,
      agreed: { nda: true },
      terms: { answers: { term: { choice: "accept", note: "" }, clocks: { choice: "accept", note: "" } } },
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
          terms: { words: { term: "We renew together each moon." } },
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
    fireEvent.click(screen.getByLabelText("Let's talk"));
    fireEvent.change(screen.getByLabelText("What you would like to talk about: Term"), { target: { value: "A shorter trial" } });
    fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "I keep books." } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "Money kept true." } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Juno Reed" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "juno@example.test" } });
    fireEvent.click(await screen.findByLabelText(LETTER.intent));
    fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
    // About you: no references, so the background-check consent is ticked (joining lane PR 2).
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    fillGoals();
    sendNow();
    await screen.findByRole("heading", { name: "Check your email" });
    expect(posted[0].body.card.terms).toEqual({ answers: { term: { choice: "talk", note: "A shorter trial" } } });
    expect(posted[0].body.card.commitmentPct).toBe(80);
    const steps = document.querySelector("[data-next-for-roles]") as HTMLElement;
    const items = Array.from(steps.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual(["60 minutes with Visionary Channel", "20 minutes with Technical Operations Steward", "20 minutes with Anchor Circle Steward, the final approval"]);
    expect(steps.textContent).toContain("We'll write to you to find a time.");
  });
});

/*
 * THE FIREFLY PATH (game feel wave 2, lane 1 option B): six stones, one
 * question each. Next judges its own stone; the trail opens a stone once
 * walked to; a desk walks with Enter and the arrows, a phone with a swipe.
 */
describe("the six stones", () => {
  const pick = async (id = "r-gate") => {
    await waitFor(() => expect(document.querySelector(`[data-role="${id}"]`)).toBeTruthy());
    fireEvent.click(within(document.querySelector(`[data-role="${id}"]`) as HTMLElement).getByRole("checkbox"));
  };
  const shown = () => Array.from(document.querySelectorAll<HTMLElement>("[data-stone]")).filter((s) => !s.hidden).map((s) => s.getAttribute("data-stone"));

  it("shows one stone at a time, and Next on the first stone with no role holds you there and says so", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    expect(shown()).toEqual(["role"]);
    // A stone ahead is not open yet.
    const trail = within(document.querySelector("[data-form-trail]") as HTMLElement).getAllByRole("button") as HTMLButtonElement[];
    expect(trail.map((b) => b.disabled)).toEqual([false, true, true, true, true, true]);
    pressNext();
    expect(stoneNow()).toBe("role");
    expect((await screen.findByRole("alert")).textContent).toContain(OPEN_WORDS.needRole);
    await pick();
    pressNext();
    expect(stoneNow()).toBe("moon");
    expect(shown()).toEqual(["moon"]);
    // The problem list belonged to the stone left behind.
    expect(screen.queryByRole("alert")).toBeNull();
    // The heading of the new stone has the cursor.
    await waitFor(() => expect(document.activeElement?.id).toBe("stone-1-h"));
  });

  it("walks back without losing a word, and the trail returns to any stone already reached", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await pick();
    pressNext();
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
    fillGoals();
    pressNext();
    expect(stoneNow()).toBe("why");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(stoneNow()).toBe("moon");
    expect((screen.getByLabelText(OPEN_WORDS.aimLabel) as HTMLInputElement).value).toBe("The gate opens at dawn.");
    const trail = within(document.querySelector("[data-form-trail]") as HTMLElement).getAllByRole("button") as HTMLButtonElement[];
    expect(trail[2].disabled).toBe(false);
    fireEvent.click(trail[2]);
    expect(stoneNow()).toBe("why");
    // Only stones stood on are ticked done.
    expect(trail[0].getAttribute("data-state")).toBe("done");
  });

  it("a desk: Enter in a field moves on, the arrows walk when the caret is not in a field, and leave a field's own keys alone", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await pick();
    const form = document.querySelector("[data-open-proposal]") as HTMLFormElement;
    // ArrowRight on the form itself walks on, as Next does (with its check).
    fireEvent.keyDown(form, { key: "ArrowRight" });
    expect(stoneNow()).toBe("moon");
    // In the aim field, the arrows move the caret and nothing else.
    const aimBox = screen.getByLabelText(OPEN_WORDS.aimLabel);
    fireEvent.keyDown(aimBox, { key: "ArrowLeft" });
    expect(stoneNow()).toBe("moon");
    fireEvent.change(aimBox, { target: { value: "The gate opens at dawn." } });
    fillGoals();
    // Enter in a one-line field is Next. A browser submits on Enter only when the form has a submit
    // button, and before Send it has none, so the path answers the key itself.
    fireEvent.keyDown(aimBox, { key: "Enter" });
    expect(stoneNow()).toBe("why");
    // Enter in a long answer is a new line.
    fireEvent.keyDown(screen.getByLabelText(OPEN_WORDS.whyLabel), { key: "Enter" });
    expect(stoneNow()).toBe("why");
    expect(posted).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(stoneNow()).toBe("moon");
    // A submit (on the way to Send it is Next) never posts early.
    fireEvent.submit(form);
    expect(stoneNow()).toBe("why");
    expect(posted).toHaveLength(0);
    fireEvent.keyDown(form, { key: "ArrowLeft" });
    expect(stoneNow()).toBe("moon");
    // Ctrl+Enter moves on even from a long answer.
    fireEvent.keyDown(aimBox, { key: "Enter", ctrlKey: true });
    expect(stoneNow()).toBe("why");
  });

  it("a phone: a swipe left walks on, right walks back, and a swipe that starts in a field is the field's", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await pick();
    const form = document.querySelector("[data-open-proposal]") as HTMLFormElement;
    const swipe = (on: Element, dx: number, dy = 0) => {
      fireEvent.touchStart(on, { touches: [{ clientX: 200, clientY: 300 }] });
      fireEvent.touchEnd(on, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
    };
    swipe(form, -120);
    expect(stoneNow()).toBe("moon");
    swipe(screen.getByLabelText(OPEN_WORDS.aimLabel), 120);
    expect(stoneNow()).toBe("moon");
    // Mostly up and down is a scroll.
    swipe(form, 80, 200);
    expect(stoneNow()).toBe("moon");
    swipe(form, 120);
    expect(stoneNow()).toBe("role");
  });

  it("each stone has its companion line, and Why you offers starter phrases that begin the answer", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await pick();
    expect(document.querySelector("[data-companion]")?.textContent).toMatch(/Start with the role that calls you/);
    pressNext();
    expect(document.querySelector("[data-companion]")?.textContent).toMatch(/your first moon/);
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
    fillGoals();
    pressNext();
    expect(document.querySelector("[data-companion]")?.textContent).toMatch(/why you, and why now/);
    fireEvent.click(screen.getByRole("button", { name: "What I have tended before:" }));
    fireEvent.click(screen.getByRole("button", { name: "What I want to learn:" }));
    expect((screen.getByLabelText(OPEN_WORDS.whyLabel) as HTMLTextAreaElement).value).toBe("What I have tended before:\n\nWhat I want to learn: ");
  });

  it("the role card sits beside the stone, and on Send a review names each stone with a way back", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await pick();
    expect(document.querySelector("[data-role-beside]")?.textContent).toContain("Gate Keeper");
    fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "The gate is always shut." } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
    fillGoals();
    walk();
    expect(stoneNow()).toBe("send");
    const review = document.querySelector("[data-review]") as HTMLElement;
    expect(review.textContent).toContain("Gate Keeper");
    expect(review.textContent).toContain("Commitment: 50%");
    expect(review.textContent).toContain("1 goal for your first moon");
    fireEvent.click(within(review).getAllByRole("button", { name: "Change" })[2]);
    expect(stoneNow()).toBe("why");
  });

  it("a refusal for too many tries stays on Send in the server's own words, and nothing is lost", async () => {
    serve(FORM, { status: 429, body: { error: OPEN_WORDS.tooMany } });
    render(<ProposeARole />);
    await pick();
    fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    await completeTheRest();
    sendNow();
    expect((await screen.findByRole("alert")).textContent).toContain(OPEN_WORDS.tooMany);
    expect(stoneNow()).toBe("send");
    expect((screen.getByLabelText(OPEN_WORDS.nameLabel) as HTMLInputElement).value).toBe("Rowan");
  });
});

describe("the sent threshold", () => {
  const sendAs = async (address: string, replyDays?: number) => {
    serve(FORM, { status: 200, body: { sent: true, message: OPEN_WORDS.sent(address), ...(replyDays ? { replyDays } : {}) } });
    render(<ProposeARole />);
    await waitFor(() => expect(document.querySelector('[data-role="r-gate"]')).toBeTruthy());
    fireEvent.click(within(document.querySelector('[data-role="r-gate"]') as HTMLElement).getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    await completeTheRest();
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: address } });
    sendNow();
    await screen.findByRole("heading", { name: "Check your email" });
  };

  it("offers the inbox for a provider we know, dated next steps, and the doors to walk while you wait", async () => {
    await sendAs("rowan@gmail.com", 7);
    const inbox = screen.getByRole("link", { name: "Open Gmail" });
    expect(inbox.getAttribute("href")).toBe("https://mail.google.com/");
    const steps = document.querySelector("[data-dated-steps]") as HTMLElement;
    expect(steps.querySelectorAll("li")).toHaveLength(2);
    expect(steps.textContent).toMatch(/Open the link in that email by /);
    expect(steps.textContent).toMatch(/we write to you by /);
    const doors = within(document.querySelector("[data-wait-doors]") as HTMLElement).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(doors).toEqual(["/quests", "/roles", "/love-letter"]);
    // The drawing: two circles that touch, not met yet.
    expect(document.querySelector('[data-threshold="sent"] [data-met="false"]')).toBeTruthy();
  });

  it("no inbox button for a domain we do not know, and Fix the address goes back to the address with every answer kept", async () => {
    await sendAs("rowan@example.test");
    expect(document.querySelector("[data-inbox-link]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not rowan@example.test? Fix the address" }));
    expect(stoneNow()).toBe("send");
    await waitFor(() => expect(document.activeElement?.id).toBe("propose-email"));
    expect((screen.getByLabelText(OPEN_WORDS.whyLabel) as HTMLTextAreaElement).value).toBe("The gate is always shut.");
  });
});

describe("a member who is signed in (B7)", () => {
  it("is not told they need no account", async () => {
    auth.user = { name: "Gil Moss", email: "gil@example.test" };
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    expect(document.body.textContent).not.toContain("You don't need an account");
    expect(document.body.textContent).toContain("Your name and email come from your account.");
  });
});
