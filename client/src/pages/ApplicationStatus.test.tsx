// @vitest-environment jsdom
/**
 * The applicant's page for a founding application (design G2, D-07): quiet while it waits, with no
 * gold act; what happens next folded into the steps themselves; and the adopted line in the lead's words.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModuleOn: () => true,
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));
vi.mock("wouter", async (orig) => ({
  ...(await orig<typeof import("wouter")>()),
  useParams: () => ({ ref: "op_status_1" }),
}));

let served: Record<string, unknown> = {};
vi.mock("@/lib/gameApi", () => ({
  gameFetch: async () => new Response(JSON.stringify({ status: served }), { status: 200, headers: { "content-type": "application/json" } }),
}));

import ApplicationStatus from "./ApplicationStatus";

const PATH = [
  { label: "Received", state: "done" },
  { label: "Our review", state: "now" },
  { label: "Invitation", state: "later" },
  { label: "Decision", state: "later" },
  { label: "First cycle", state: "later" },
] as const;

const WAITING = {
  step: "review",
  stepWords: "Our review",
  actsNext: "We read your application.",
  by: null,
  roles: ["Lead Finance Steward"],
  path: PATH,
  booking: null,
  mode: "block",
  outcome: null,
  replyDays: 7,
  referencesGiven: 1,
  reviewFirst: true,
};

/** Gold, the way the look draws it: a filled button or link in the notice colour. */
const goldActs = () => Array.from(document.querySelectorAll("a.bg-notice, button.bg-notice"));

afterEach(cleanup);

describe("a founding application's status page (D-07)", () => {
  it("while it waits there is no gold act: the role to read again, edged, and a quiet link to the events", async () => {
    served = WAITING;
    render(<ApplicationStatus />);
    await screen.findByRole("heading", { level: 1 });
    expect(goldActs()).toHaveLength(0);
    const wait = document.querySelector("[data-founding-wait]") as HTMLElement;
    expect(screen.getByRole("link", { name: "Read the role again" }).className).toContain("border");
    expect(wait.querySelectorAll("a")).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/Open the quests|take a quest/i);
  });

  it("what happens next is folded into the steps: one list, each step ahead carrying its own line", async () => {
    served = WAITING;
    render(<ApplicationStatus />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("heading", { name: "What happens next" })).toBeNull();
    const list = document.querySelector("ol[data-what-happens-next]") as HTMLElement;
    expect(Array.from(list.querySelectorAll("[data-applicant-step]")).map((e) => e.getAttribute("data-applicant-step"))).toEqual(["review", "invitation", "decision", "first_cycle"]);
    // A step already walked keeps only its name.
    expect(list.querySelector('[data-path-state="done"] [data-applicant-step]')).toBeNull();
    expect(list.textContent).toContain("Within 7 days");
  });

  it("adopted: the circle said yes, in the lead's words, and the old game line is gone", async () => {
    served = { ...WAITING, step: "consent", outcome: "adopted", path: PATH.map((p) => ({ ...p, state: "done" })) };
    render(<ApplicationStatus />);
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector("[data-adopted-line]")?.textContent).toBe("The circle said yes. We'd love you on the team. Your invitation to make your account is in your email.");
    expect(document.body.textContent).not.toMatch(/seed is whole/);
  });

  it("a game role's page keeps its doors and its one lit act", async () => {
    served = { ...WAITING, reviewFirst: false, step: "first_reply" };
    render(<ApplicationStatus />);
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector("[data-founding-wait]")).toBeNull();
    expect(document.querySelector("[data-while-you-wait]")).not.toBeNull();
  });
});
