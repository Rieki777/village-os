// @vitest-environment jsdom
/**
 * The Governance page's conflict section prints THE VILLAGE'S OWN steps.
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
import { render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

let adminViewer = false;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// The live-votes band has its own suite and reaches for the module registry.
vi.mock("@/components/governance/LiveDecisionsBand", () => ({ default: () => null }));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/contexts/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/contexts/AuthContext")>("@/contexts/AuthContext");
  return { ...actual, useIsAdmin: () => adminViewer, useAuth: () => ({ user: null }) };
});

import Governance from "./Governance";
import { readConflictSteps, WRITE_STEPS_HREF } from "@/components/governance/VillageConflictSteps";

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

function answerWith(body: unknown, ok = true) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url !== "/api/exit-policy") throw new Error(`unexpected fetch ${url}`);
    return { ok, status: ok ? 200 : 500, json: async () => body };
  });
}

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
  fetchMock.mockReset();
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
