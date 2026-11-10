// @vitest-environment jsdom
/**
 * THE OPEN FORM'S "ABOUT YOU" SECTION (joining lane PR 2): where it sits, what
 * it holds, what it asks and when the consent tick is required.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OPEN_AI_DRAFTS, OPEN_WORDS } from "@shared/openProposals";
import { CHECK_WORDS, checkConsentVersion } from "@shared/proposalAbout";

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
    { id: "r-bank", name: "Money Keeper", circle: "Land Circle", aim: "Keep the books.", alwaysChecked: true },
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

function serve(form: unknown, answer: { status: number; body: unknown } = { status: 200, body: { sent: true, message: OPEN_WORDS.sent("rowan@example.test") } }) {
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.user = null;
  window.history.pushState({}, "", "/");
});


const box = (id: string) => within(document.querySelector(`[data-role="${id}"]`) as HTMLElement).getByRole("checkbox");
const fillRest = async () => {
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "The gate is always shut." } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
  fireEvent.click(screen.getByLabelText("I accept the terms on offer."));
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Rowan Field" } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "rowan@example.test" } });
  fireEvent.click(await screen.findByLabelText(LETTER.intent));
  fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
};
const ref = (n: number, name: string, how: string, contact: string) => {
  fireEvent.change(screen.getByLabelText(`Reference ${n}: name`), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(`Reference ${n}: how you know them`), { target: { value: how } });
  fireEvent.change(screen.getByLabelText(`Reference ${n}: email or phone`), { target: { value: contact } });
};

describe("About you, on the open form", () => {
  it("sits after the goals and before the terms, and holds the links, the files, the time zone and the earliest start (moved, not copied)", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    fireEvent.click(box("r-gate"));
    const section = (await screen.findByRole("heading", { name: "About you" })).closest("section") as HTMLElement;
    expect(within(section).getByLabelText("Your time zone")).toBeTruthy();
    expect(within(section).getByLabelText(/earliest you could start/)).toBeTruthy();
    expect(section.querySelector("[data-attachments]")).toBeTruthy();
    expect(within(section).getByLabelText("Reference 1: name")).toBeTruthy();
    // Moved, not duplicated.
    expect(document.querySelectorAll("[data-attachments]")).toHaveLength(1);
    expect(document.querySelectorAll('input[id="card-tz"]')).toHaveLength(1);
    const form = document.querySelector("[data-open-proposal]") as HTMLElement;
    const order = (sel: string) => Array.from(form.querySelectorAll("*")).indexOf(form.querySelector(sel) as Element);
    expect(order("[data-role-goals], [data-goals-list], [data-role]")).toBeLessThan(order("[data-about-you-section]"));
    expect(order("[data-about-you-section]")).toBeLessThan(order('input[name="card-terms"]'));
  });

  it("says the lead's words beside the references and who sees them", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    fireEvent.click(box("r-gate"));
    const words = (await screen.findByText(CHECK_WORDS.lines[0])).closest("[data-check-words]") as HTMLElement;
    for (const line of [...CHECK_WORDS.lines, CHECK_WORDS.contactLine]) expect(within(words).getByText(line)).toBeTruthy();
    expect(words.textContent).toMatch(/No AI reads them/);
  });

  it("the tick is required with the references blank, and the form says so before anything is sent", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    fireEvent.click(box("r-gate"));
    await fillRest();
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Tick the box/);
    expect(posted).toHaveLength(0);
  });

  it("with references given and no role always checked, the tick is not asked and the references go with the proposal", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    fireEvent.click(box("r-gate"));
    await fillRest();
    ref(1, "Ines Vargas", "We built a fence together", "ines@example.org");
    expect(document.querySelector("[data-check-consent]")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Where you are based/), { target: { value: "Uvita" } });
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body.references).toEqual([{ name: "Ines Vargas", how: "We built a fence together", contact: "ines@example.org" }]);
    expect(posted[0].body.about).toEqual({ based: "Uvita" });
    expect(posted[0].body).not.toHaveProperty("checkConsent");
  });

  it("a half-filled reference is stopped with the shared rule's words", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    fireEvent.click(box("r-gate"));
    await fillRest();
    fireEvent.change(screen.getByLabelText("Reference 1: name"), { target: { value: "Ines" } });
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/needs a name|Give each reference/i);
    expect(posted).toHaveLength(0);
  });

  it("an always-checked role says a check happens whatever the references say, and asks the tick even with references", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    fireEvent.click(box("r-bank"));
    expect(await screen.findByText(/A background check happens for this role whatever the references say/)).toBeTruthy();
    expect(document.querySelector("[data-check-role]")).toBeTruthy();
    await fillRest();
    ref(1, "Ines Vargas", "We built a fence together", "ines@example.org");
    expect(document.querySelector("[data-check-consent]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Tick the box/);
    expect(posted).toHaveLength(0);
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body.checkConsent).toEqual({ given: true, version: checkConsentVersion() });
  });
});
