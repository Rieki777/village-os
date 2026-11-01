// @vitest-environment jsdom
/**
 * The role guide's panel (Rye, 2026-10-24).
 *
 * What is pinned: it draws nothing when no guide can answer; it always says
 * who is answering, with the other guide one tap away when both can; every
 * suggestion is marked Suggested and shows the sentence it came from, and goes
 * into a field only on Use this; Leave it drops one; a suggestion the card
 * cannot take has no working Use this; the page says the document is not kept;
 * the guide's one question is answered in a box that asks the next turn, with
 * the conversation; a document brought in is sent once, with that turn only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => "t" }));

import RoleGuidePanel from "./RoleGuidePanel";
import { GUIDE_WORDS, type GuideState } from "@shared/guideChoice";
import { ROLE_GUIDE_WORDS, type GuideAnswer, type GuideSuggestion } from "@shared/roleGuide";

const MAIA_ONLY: GuideState = {
  choice: null,
  options: [
    { id: "village", name: "Maia", named: true, available: true },
    { id: "saberra", name: "Sera", named: true, available: false },
  ],
  answering: "village",
  note: null,
  canChoose: false,
};
const BOTH: GuideState = { ...MAIA_ONLY, options: MAIA_ONLY.options.map((o) => ({ ...o, available: true })), answering: "saberra", canChoose: true };
const NOBODY: GuideState = { ...MAIA_ONLY, options: MAIA_ONLY.options.map((o) => ({ ...o, available: false })), answering: null };

const DOMAIN: GuideSuggestion = {
  path: "roles.0.words.domain",
  role: "Kitchen keeper",
  roleId: "r1",
  field: "domain",
  words: "The kitchen's weekly menu",
  source: "I plan the kitchen's weekly menu.",
  problem: null,
};
const TOO_FEW: GuideSuggestion = { ...DOMAIN, path: "roles.0.words.accountabilities", field: "accountabilities", words: ["One thing"], source: null, problem: "A role answers for 3 to 6 things." };
const OTHER_ROLE: GuideSuggestion = { ...DOMAIN, path: "roles.1.words.domain", role: "Land Steward", roleId: "r2" };

const answer = (over: Partial<GuideAnswer> = {}): GuideAnswer => ({
  guide: { id: "village", name: "Maia" },
  note: null,
  suggestions: [DOMAIN, TOO_FEW, OTHER_ROLE],
  question: "How many hours a week does this role take?",
  flags: [{ kind: "load", hours: 50, sentence: "Together these roles ask for about 50 hours a week." }],
  ...over,
});

function serve(guide: GuideState, turns: GuideAnswer[] = [answer()]) {
  const asks: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url === "/api/guide" && (init?.method ?? "GET") === "GET") return json(guide);
      if (url === "/api/guide") return json({ ...guide, choice: "village", answering: "village" });
      if (url.endsWith("/guide")) {
        asks.push(JSON.parse(init?.body ?? "{}"));
        return json(turns[Math.min(asks.length - 1, turns.length - 1)]);
      }
      return json({});
    }),
  );
  return asks;
}

const draw = (over: { document?: string | null; onAccept?: (s: GuideSuggestion) => void } = {}) =>
  render(
    <RoleGuidePanel
      proposalId="rp-1"
      step="words"
      villageName="the village"
      document={over.document ?? null}
      accepts={(s) => s.roleId === "r1"}
      onAccept={over.onAccept ?? (() => {})}
    />,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the role guide panel", () => {
  it("draws nothing when no guide can answer", async () => {
    serve(NOBODY);
    const { container } = draw();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-role-guide]")).toBeNull();
    expect(screen.queryByRole("button", { name: ROLE_GUIDE_WORDS.open })).toBeNull();
  });

  it("says who is answering, that the document is not kept, and offers the other guide when both can", async () => {
    serve(BOTH);
    draw();
    expect(await screen.findByText(GUIDE_WORDS.answering("Sera"))).toBeTruthy();
    expect(screen.getByText(new RegExp(ROLE_GUIDE_WORDS.kept("the village").replace(/[.]/g, "\\.")))).toBeTruthy();
    expect(screen.getByRole("button", { name: GUIDE_WORDS.switchTo("Maia") })).toBeTruthy();
  });

  it("opens sentences with an unnamed guide's name in capitals, and does not repeat that it is the village's guide", async () => {
    const UNNAMED: GuideState = { ...MAIA_ONLY, options: [{ id: "village", name: "the village guide", named: false, available: true }, MAIA_ONLY.options[1]] };
    serve(UNNAMED, [answer({ guide: { id: "village", name: "the village guide" } })]);
    draw();
    expect(await screen.findByText(GUIDE_WORDS.answering("the village guide"))).toBeTruthy();
    expect(screen.getByText("The village guide is answering.")).toBeTruthy();
    expect(screen.queryByText(/is this village's own guide/)).toBeNull();
    expect(screen.getByText(/^The village guide reads it here to suggest your card\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ROLE_GUIDE_WORDS.open }));
    expect(await screen.findByText("The village guide: How many hours a week does this role take?")).toBeTruthy();
  });

  it("offers no switch while only one guide can answer", async () => {
    serve(MAIA_ONLY);
    draw();
    expect(await screen.findByText(GUIDE_WORDS.answering("Maia"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: GUIDE_WORDS.switchTo("Sera") })).toBeNull();
  });

  it("marks each suggestion Suggested with its source, for this role only, and puts it in only on Use this", async () => {
    serve(MAIA_ONLY);
    const accepted: GuideSuggestion[] = [];
    draw({ onAccept: (s) => accepted.push(s) });
    fireEvent.click(await screen.findByRole("button", { name: ROLE_GUIDE_WORDS.open }));
    const item = (await screen.findByText("The kitchen's weekly menu")).closest("[data-suggestion]") as HTMLElement;
    expect(within(item).getByText(ROLE_GUIDE_WORDS.suggested)).toBeTruthy();
    expect(within(item).getByText("I plan the kitchen's weekly menu.")).toBeTruthy();
    expect(document.querySelector('[data-suggestion="roles.1.words.domain"]')).toBeNull();
    expect(accepted).toEqual([]);
    fireEvent.click(within(item).getByRole("button", { name: ROLE_GUIDE_WORDS.accept }));
    expect(accepted).toEqual([DOMAIN]);
    expect(document.querySelector('[data-suggestion="roles.0.words.domain"]')).toBeNull();
  });

  it("drops a suggestion on Leave it, and gives one the card cannot take no working Use this", async () => {
    serve(MAIA_ONLY);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: ROLE_GUIDE_WORDS.open }));
    const bad = (await screen.findByText("A role answers for 3 to 6 things.")).closest("[data-suggestion]") as HTMLElement;
    expect((within(bad).getByRole("button", { name: ROLE_GUIDE_WORDS.accept }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(bad).getByText(ROLE_GUIDE_WORDS.fromKnown)).toBeTruthy();
    fireEvent.click(within(bad).getByRole("button", { name: ROLE_GUIDE_WORDS.leave }));
    expect(document.querySelector('[data-suggestion="roles.0.words.accountabilities"]')).toBeNull();
  });

  it("asks one question, and an answer asks the next turn with the conversation", async () => {
    const asks = serve(MAIA_ONLY, [answer(), answer({ suggestions: [], question: null })]);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: ROLE_GUIDE_WORDS.open }));
    await screen.findByText(/How many hours a week does this role take\?/);
    expect(screen.getByText("Together these roles ask for about 50 hours a week.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(ROLE_GUIDE_WORDS.answer), { target: { value: "About ten hours a week." } });
    fireEvent.click(screen.getByRole("button", { name: ROLE_GUIDE_WORDS.send }));
    await waitFor(() => expect(asks).toHaveLength(2));
    expect(asks[1]).toEqual({
      step: "words",
      document: null,
      conversation: [
        { from: "guide", text: "How many hours a week does this role take?" },
        { from: "member", text: "About ten hours a week." },
      ],
    });
    expect(await screen.findByText(ROLE_GUIDE_WORDS.nothingMissing)).toBeTruthy();
  });

  it("sends a document brought in once, with that turn only", async () => {
    const asks = serve(MAIA_ONLY);
    draw({ document: "I plan the kitchen's weekly menu." });
    await waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0].document).toBe("I plan the kitchen's weekly menu.");
    fireEvent.change(await screen.findByLabelText(ROLE_GUIDE_WORDS.answer), { target: { value: "Ten hours." } });
    fireEvent.click(screen.getByRole("button", { name: ROLE_GUIDE_WORDS.send }));
    await waitFor(() => expect(asks).toHaveLength(2));
    expect(asks[1].document).toBeNull();
  });
});
