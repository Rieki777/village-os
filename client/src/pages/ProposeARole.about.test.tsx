// @vitest-environment jsdom
/**
 * THE APPLICATION'S "ABOUT YOU" STEP (joining lane PR 2; step 2 of 6 since
 * Phase A): where it sits, what it holds, what it asks and when the consent
 * tick is required.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OPEN_WORDS } from "@shared/openProposals";
import { CHECK_WORDS, checkConsentVersion } from "@shared/proposalAbout";

// fillGoals is audit B1's helper; the walk along the six steps is the test kit's.
import { SETUP, fillGoals, sendNow, stoneNow } from "@/test/proposeStones";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const auth = vi.hoisted(() => ({ user: null as null | { name: string; email: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: auth.user }) }));

import ProposeARole from "./ProposeARole";

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
  founding: SETUP,
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
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
});

/** Open the application for one role, as its card's Apply link does. */
const applyFor = async (id: string) => {
  window.history.pushState({}, "", `/propose-a-role?role=${id}`);
  serve(FORM);
  render(<ProposeARole />);
  await screen.findByRole("heading", { level: 1 });
};
const fillRest = async () => {
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "The gate is always shut." } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "The gate opens at dawn." } });
  fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
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
  it("is step 2, after Get to know us and before Your value, and holds who you are, why, links, files, references and Human Design (each once)", async () => {
    await applyFor("r-gate");
    const section = document.querySelector('[data-stone="about"]') as HTMLElement;
    expect(section).toBeTruthy();
    for (const label of [OPEN_WORDS.nameLabel, OPEN_WORDS.emailLabel, OPEN_WORDS.whyLabel, "Reference 1: name", /Human Design or Gene Keys/]) expect(within(section).getByLabelText(label)).toBeTruthy();
    expect(section.querySelector("[data-attachments]")).toBeTruthy();
    // The time zone and the start date belong to Your first day now, once.
    expect(within(section).queryByLabelText("Your time zone")).toBeNull();
    expect(within(document.querySelector('[data-stone="first"]') as HTMLElement).getByLabelText("Your time zone")).toBeTruthy();
    expect(document.querySelectorAll("[data-attachments]")).toHaveLength(1);
    expect(document.querySelectorAll('input[id="card-tz"]')).toHaveLength(1);
    const form = document.querySelector("[data-open-proposal]") as HTMLElement;
    const order = (sel: string) => Array.from(form.querySelectorAll("*")).indexOf(form.querySelector(sel) as Element);
    // The brief's order (Phase A): Get to know us, About you, Your value, The terms, Your first day, Review & submit.
    expect(order("[data-know-us]")).toBeLessThan(order("[data-about-you-section]"));
    expect(order("[data-about-you-section]")).toBeLessThan(order("[data-goals-list]"));
    expect(order("[data-goals-list]")).toBeLessThan(order("[data-commitment]"));
  });

  it("Human Design or Gene Keys is optional, says the deciders never see it, and goes with the application on its own", async () => {
    await applyFor("r-gate");
    expect(screen.getByText(/The people who decide never see it/)).toBeTruthy();
    await fillRest();
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    fireEvent.change(screen.getByLabelText(/Human Design or Gene Keys/), { target: { value: "Projector, 4/6" } });
    fillGoals();
    sendNow();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body.selfKnowledge).toBe("Projector, 4/6");
    // Never inside what the deciders' "about" block carries.
    expect(JSON.stringify(posted[0].body.about ?? {})).not.toContain("Projector");
  });

  it("says the lead's words beside the references and who sees them", async () => {
    await applyFor("r-gate");
    const words = (await screen.findByText(CHECK_WORDS.lines[0])).closest("[data-check-words]") as HTMLElement;
    for (const line of [...CHECK_WORDS.lines, CHECK_WORDS.contactLine]) expect(within(words).getByText(line)).toBeTruthy();
    expect(words.textContent).toMatch(/No AI reads them/);
  });

  it("the tick is required with the references blank, and the form says so before anything is sent", async () => {
    await applyFor("r-gate");
    await fillRest();
    fillGoals();
    sendNow();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Tick the box/);
    expect(posted).toHaveLength(0);
  });

  it("with references given and no role always checked, the tick is not asked and the references go with the application", async () => {
    await applyFor("r-gate");
    await fillRest();
    ref(1, "Ines Vargas", "We built a fence together", "ines@example.org");
    expect(document.querySelector("[data-check-consent]")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Where you are based/), { target: { value: "Uvita" } });
    fillGoals();
    sendNow();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body.references).toEqual([{ name: "Ines Vargas", how: "We built a fence together", contact: "ines@example.org" }]);
    expect(posted[0].body.about).toEqual({ based: "Uvita" });
    expect(posted[0].body).not.toHaveProperty("checkConsent");
  });

  it("a half-filled reference is stopped with the shared rule's words", async () => {
    await applyFor("r-gate");
    await fillRest();
    fireEvent.change(screen.getByLabelText("Reference 1: name"), { target: { value: "Ines" } });
    fillGoals();
    sendNow();
    expect((await screen.findByRole("alert")).textContent).toMatch(/needs a name|Give each reference/i);
    expect(posted).toHaveLength(0);
  });

  it("an always-checked role says a check happens whatever the references say, and asks the tick even with references", async () => {
    await applyFor("r-bank");
    // On the role beside the step, and again beside the references.
    expect((await screen.findAllByText(/A background check happens for this role whatever the references say/)).length).toBeGreaterThan(0);
    expect(document.querySelector("[data-check-role]")).toBeTruthy();
    await fillRest();
    ref(1, "Ines Vargas", "We built a fence together", "ines@example.org");
    expect(document.querySelector("[data-check-consent]")).toBeTruthy();
    fillGoals();
    sendNow();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Tick the box/);
    expect(stoneNow()).toBe("about");
    // The cursor lands on the tick itself, never the first box at the top of the step (final verification).
    await waitFor(() => expect(document.activeElement?.id).toBe("propose-about-consent"));
    expect(posted).toHaveLength(0);
    fireEvent.click(screen.getByLabelText(/agree to the background check/i));
    fillGoals();
    sendNow();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body.checkConsent).toEqual({ given: true, version: checkConsentVersion() });
  });
});
