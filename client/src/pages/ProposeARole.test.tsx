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
import { OPEN_WORDS } from "@shared/openProposals";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

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
      return new Response(JSON.stringify(form), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Rowan Field" } });
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "rowan@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByText(OPEN_WORDS.sent("rowan@example.test"))).toBeTruthy();
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("/api/open-proposals");
    expect(posted[0].body).toMatchObject({
      name: "Rowan Field",
      email: "rowan@example.test",
      why: "The gate is always shut.",
      hp: "",
      roles: [
        { roleId: "r-gate", note: "I open gates for a living." },
        { roleId: "r-host", note: "" },
      ],
    });
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

  it("the honeypot is there, hidden from people and from screen readers", async () => {
    serve(FORM);
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    const hp = document.querySelector('input[name="hp"]') as HTMLInputElement;
    expect(hp.tabIndex).toBe(-1);
    expect(hp.closest('[aria-hidden="true"]')).toBeTruthy();
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

  it("a link that ran out says so, and offers to start again", async () => {
    window.history.pushState({}, "", "/propose-a-role/confirm?token=old");
    serve({}, { status: 410, body: { error: OPEN_WORDS.confirmGone } });
    render(<ConfirmProposal />);
    expect(await screen.findByText(OPEN_WORDS.confirmGone)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Propose again" }).getAttribute("href")).toBe("/propose-a-role");
  });
});
