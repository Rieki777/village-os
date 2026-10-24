// @vitest-environment jsdom
/**
 * Bringing a description of your role in, the own-AI prompt, and "Download
 * my card as text", drawn inside the real proposal editor over a fake of the
 * routes (role card format, Rye 2026-10-24).
 *
 *   - the panel says the village reads the document and does not keep it;
 *   - a pasted card is read by the server, listed line by line with a tick
 *     each, and only the ticked lines go through the PUT, after which the
 *     words step draws them in gold;
 *   - a line a problem blocks cannot be ticked, and a new role whose circle
 *     the card did not match gets a pick that frees it;
 *   - a file goes up as a form, and is never read on the page;
 *   - words that are not a card get the fallback while no AI is connected,
 *     and go to the AI half when one is, whose card is read the same way;
 *   - the prompt copies word for word, starting from the draft as it stands;
 *   - the share step and the profile download the card as role-card.txt.
 *
 * The server's answers are the real reader's (shared/roleCardText.ts), run
 * here over the fixture's village. Every name is made up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { changesOf } from "@shared/roleCardApply";
import { readRoleCard, writeRoleCard, type RoleCardContext } from "@shared/roleCardText";
import { roleCardPrompt } from "@shared/roleCardPrompt";
import type { ProposalBody } from "@shared/roleProposals";
import { CIRCLES, fakeServer, ORG, POSTED, PROPOSAL_ID, proposalWith, WORDS_CTX, type DraftBody } from "@/test/roleProposalFixture";

vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  authToken: () => "t",
  useGameConfig: () => ({ project: { name: "Riverbend" } }),
}));
vi.mock("@/components/governance/pickSources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/governance/pickSources")>()),
  loadOrg: async () => ORG,
}));
vi.mock("@/lib/seatPresetsRead", () => ({ useVillagePresets: () => [] }));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));
const ai = vi.hoisted(() => ({ status: null as null | ((step?: string) => Promise<any>) }));
vi.mock("./aiHelp", async (importOriginal) => {
  const real = await importOriginal<typeof import("./aiHelp")>();
  return { ...real, aiHelpStatus: (step: any) => (ai.status ? ai.status(step) : real.aiHelpStatus(step)) };
});

import ProposalEditor from "./ProposalEditor";
import ProposeRolesEntry from "./ProposeRolesEntry";
import { guideFor } from "./BringInRole";
import { AUTOSAVE } from "./useAutosave";
import { RC_WORDS } from "./roleCardWords";

const BASE = `/api/governance/role-proposals/${PROPOSAL_ID}`;

/** The draft body as the server holds it, from the fixture's draft. */
const bodyOf = (d: DraftBody): ProposalBody => ({
  roles: d.roles.map((r) => ({ roleId: r.roleId, words: r.words ?? {}, reviewOn: r.reviewOn ?? null })),
  newRoles: (d.newRoles ?? []).map((r) => ({ id: r.id, circleId: r.circleId, seats: r.seats ?? 1, words: r.words, reviewOn: r.reviewOn ?? null })),
  settings: d.settings ?? { v: 1 },
  season: d.season ?? { aim: null, seasonalGoals: [], servesGoals: [] },
});

/** The import route, answered by the real reader over the fixture's village. */
function importAnswer(text: string, current: ProposalBody) {
  const ctx: RoleCardContext = {
    words: WORDS_CTX,
    roles: Object.entries(POSTED).map(([id, posted]) => ({ id, name: String(posted.name), circleId: CIRCLES[id]?.id ?? null, posted })),
    circles: ORG.circles,
    orgGoals: ["Feed everyone", "Grow the orchard"],
    people: [{ name: "Ines Varga", roles: [] }],
    current,
  };
  const read = readRoleCard(text, ctx);
  if (!read.isCard) return { source: "text", kind: "txt", isCard: false, text };
  return { source: "text", kind: "txt", isCard: true, text, read, changes: changesOf(read.proposalBody, current, (id) => String(POSTED[id]?.name ?? id)), current };
}

let server: ReturnType<typeof fakeServer>;
let asked: Array<{ url: string; method: string; body: any }>;

function draw(body: DraftBody, step = "words") {
  server = fakeServer(body);
  asked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      asked.push({ url, method: init?.method ?? "GET", body: init?.body });
      if (url === `${BASE}/import`) {
        if (init.body instanceof FormData) return new Response(JSON.stringify(importAnswer("Riverbend role card v1\n## Role title\nGate keeper\n### Time\nMornings", bodyOf(server.stored()))), { status: 200 });
        return new Response(JSON.stringify(importAnswer(JSON.parse(init.body).text, bodyOf(server.stored()))), { status: 200 });
      }
      if (url === `${BASE}/text`) return new Response("Riverbend role card v1\n", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      return server.fetch(url, init);
    }),
  );
  window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}?step=${step}`);
  return render(
    <Router>
      <ProposalEditor initial={proposalWith(body)} me="u-me" />
    </Router>,
  );
}

const panel = () => document.querySelector("[data-bring-in]") as HTMLElement;
const paste = async (text: string, until: RegExp = /What this card fills|Riverbend reads the role card format directly/) => {
  fireEvent.click(within(panel()).getByRole("button", { name: RC_WORDS.fromPaste }));
  fireEvent.change(within(panel()).getByLabelText(RC_WORDS.pasteLabel), { target: { value: text } });
  fireEvent.click(within(panel()).getByRole("button", { name: RC_WORDS.read }));
  await screen.findByText(until);
};

const CARD = [
  "Riverbend role card v1",
  "",
  "## Role title",
  "Kitchen keeper",
  "Role id: r1",
  "",
  "### Bring me",
  "- Food allergies",
  "- Recipes",
  "",
  "### Time",
  "Mornings and Saturdays",
  "",
  "## Role title",
  "Bee keeper",
  "",
  "### Circle",
  "Sky circle",
  "",
  "### Purpose",
  "Bees thrive.",
].join("\n");

beforeEach(() => {
  AUTOSAVE.delayMs = 0;
  ai.status = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bring in a description of your role", () => {
  it("says the village reads the document and does not keep it, and opens when the draft has no roles", async () => {
    draw({ roles: [] });
    await screen.findByText(RC_WORDS.bringIn);
    expect(panel().hasAttribute("open")).toBe(true);
    expect(within(panel()).getByText("Riverbend reads your document and does not keep it.")).toBeTruthy();
    for (const name of [RC_WORDS.fromFile, RC_WORDS.fromPaste, RC_WORDS.fromLink]) expect(within(panel()).getByRole("button", { name })).toBeTruthy();
  });

  it("lists what a pasted card fills, sends only the ticked lines through the PUT, and the words step draws them in gold", async () => {
    draw({ roles: [{ roleId: "r1" }] });
    await screen.findByLabelText("Purpose");
    await paste(CARD);
    expect(asked.find((a) => a.url === `${BASE}/import`)!.body).toBe(JSON.stringify({ text: CARD }));
    const preview = document.querySelector("[data-card-preview]") as HTMLElement;
    expect(Array.from(preview.querySelectorAll("[data-change]")).map((li) => li.getAttribute("data-change"))).toEqual(["roles.0.words.bringMe", "roles.0.words.timeCommitment", "newRoles.0"]);
    // Nothing is saved by reading.
    expect(server.puts()).toEqual([]);

    // The member keeps the Bring me line only.
    fireEvent.click(within(preview).getByLabelText(RC_WORDS.keep("Kitchen keeper: Time")));
    fireEvent.click(within(preview).getByRole("button", { name: RC_WORDS.fill }));
    await waitFor(() => expect(server.puts()).toEqual([{ roles: [{ roleId: "r1", words: { bringMe: ["Food allergies", "Recipes"] }, reviewOn: null }], newRoles: [] }]));
    expect(await screen.findByText(RC_WORDS.filled)).toBeTruthy();
    expect((document.querySelector('[data-field="bringMe"]') as HTMLElement).getAttribute("data-changed")).toBe("true");
    expect((document.querySelector('[data-field="timeCommitment"]') as HTMLElement).getAttribute("data-changed")).toBe("false");
    expect((screen.getByLabelText("Bring me") as HTMLTextAreaElement).value).toBe("Food allergies\nRecipes");
  });

  it("stays open once the draft it filled holds a role, so the member reads that it is filled", async () => {
    draw({ roles: [] });
    await screen.findByText(RC_WORDS.bringIn);
    expect(panel().hasAttribute("open")).toBe(true);
    await paste("Riverbend role card v1\n## Role title\nBee keeper\n### Circle\nLand circle\n### Purpose\nBees thrive.");
    fireEvent.click(screen.getByRole("button", { name: RC_WORDS.fill }));
    expect(await screen.findByText(RC_WORDS.filled)).toBeTruthy();
    await waitFor(() => expect(server.puts()).toHaveLength(1));
    expect(panel().hasAttribute("open")).toBe(true);
  });

  it("holds back a new role whose circle the card did not match until a circle is picked", async () => {
    draw({ roles: [{ roleId: "r1" }] });
    await screen.findByLabelText("Purpose");
    await paste(CARD);
    const bee = document.querySelector('[data-change="newRoles.0"]') as HTMLElement;
    const box = within(bee).getByRole("checkbox") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(bee.getAttribute("data-ticked")).toBe("false");
    expect(within(bee).getByText(/No circle in this village is called "Sky circle"\. Pick its circle: Food circle, Land circle\./)).toBeTruthy();
    fireEvent.change(within(bee).getByLabelText(RC_WORDS.pickCircle), { target: { value: "c-land" } });
    expect(box.disabled).toBe(false);
    expect(bee.getAttribute("data-ticked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: RC_WORDS.fill }));
    await waitFor(() => expect(server.puts()[0].newRoles).toEqual([{ circleId: "c-land", seats: 1, words: { name: "Bee keeper", aim: "Bees thrive." }, reviewOn: null }]));
  });

  it("a line over a limit cannot be ticked, and says the server's sentence and to fix it in the card", async () => {
    draw({ roles: [{ roleId: "r1" }] });
    await screen.findByLabelText("Purpose");
    await paste(`Riverbend role card v1\n## Role title\nKitchen keeper\n### Time\n${"x".repeat(81)}`);
    const time = document.querySelector('[data-change="roles.0.words.timeCommitment"]') as HTMLElement;
    expect((within(time).getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(within(time).getByText(`Keep it to 80 characters. ${RC_WORDS.fix}`)).toBeTruthy();
    expect((screen.getByRole("button", { name: RC_WORDS.fill }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends a file as a form, and reads nothing of it on the page", async () => {
    draw({ roles: [] });
    await screen.findByText(RC_WORDS.bringIn);
    const input = document.querySelector("[data-role-file]") as HTMLInputElement;
    expect(input.getAttribute("accept")).toContain(".docx,.pdf,.md,.txt");
    const file = new File(["%PDF-1.4"], "my role.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText(RC_WORDS.whatFills);
    const sent = asked.find((a) => a.url === `${BASE}/import`)!;
    expect(sent.body).toBeInstanceOf(FormData);
    expect((sent.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("says to use the prompt while no AI is connected, and copies the prompt with the member's words", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    draw({ roles: [] });
    await screen.findByText(RC_WORDS.bringIn);
    await paste("I keep the bees and teach honey days.");
    const fallback = document.querySelector("[data-ai-fallback]") as HTMLElement;
    expect(fallback.textContent).toContain("Riverbend reads the role card format directly. Paste your description into your own AI with the prompt below, then bring back what it gives you.");
    fireEvent.click(within(fallback).getByRole("button", { name: RC_WORDS.copyBoth }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(copied.startsWith("Role card prompt, version 1, for Riverbend.")).toBe(true);
    expect(copied.endsWith("\n\n---\n\nI keep the bees and teach honey days.")).toBe(true);
  });

  it("hands words that are not a card to the guide from the words step, as a plain string, and says who reads them", async () => {
    const bringIn = vi.fn();
    const steps: string[] = [];
    ai.status = async (step?: string) => {
      steps.push(String(step));
      return { configured: true, guide: "Maia", bringIn };
    };
    draw({ roles: [] });
    await screen.findByText(RC_WORDS.bringIn);
    await paste("I keep the bees.", /will read it/);
    expect(screen.getByText("Maia will read it, and suggest what to fill.")).toBeTruthy();
    expect(bringIn).toHaveBeenCalledWith("I keep the bees.");
    expect(steps).toEqual(["words"]);
    expect(document.querySelector("[data-ai-fallback]")).toBeNull();
  });

  it("reads the older shape, or a guide with no bringIn, as no guide connected", async () => {
    for (const status of [{ configured: true, suggest: async () => [] }, { configured: false, reason: "not configured" }, null]) {
      ai.status = async () => status;
      expect(await guideFor("words")).toBeNull();
    }
    ai.status = async () => {
      throw new Error("bridge down");
    };
    expect(await guideFor("words")).toBeNull();
  });
});

describe("design my role with my own AI", () => {
  it("copies the prompt word for word, starting from the draft as it stands", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const body: DraftBody = { roles: [{ roleId: "r1" }] };
    draw(body);
    const own = (await screen.findByText(RC_WORDS.ownAi)).closest("[data-own-ai]") as HTMLElement;
    fireEvent.click(within(own).getByRole("button", { name: RC_WORDS.copyPrompt }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const p = proposalWith(body);
    const known = writeRoleCard({
      village: "Riverbend",
      roles: [{ title: "Kitchen keeper", id: "r1", circle: "Food circle", words: { aim: "Feed the village well.", domain: "The kitchen and its stores.", accountabilities: ["Meals on time", "A clean kitchen", "Stores counted"], bringMe: ["Food allergies"], timeCommitment: "30 hours a week" } }],
      measures: [],
      season: null,
    });
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toBe(roleCardPrompt({ village: "Riverbend", circles: ["Food circle", "Land circle"], orgGoals: p.orgGoals, knownCard: known, maxRoles: 5 }));
    expect(await within(own).findByText(RC_WORDS.copied)).toBeTruthy();
  });
});

describe("download my card as text", () => {
  const saving = () => {
    const created = vi.fn(() => "blob:card");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    return clicks;
  };

  it("on the share step, saves the draft as role-card.txt", async () => {
    const clicks = saving();
    draw({ roles: [{ roleId: "r1" }] }, "share");
    fireEvent.click(await screen.findByRole("button", { name: RC_WORDS.download }));
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(asked.some((a) => a.url === `${BASE}/text` && a.method === "GET")).toBe(true);
    expect(clicks[0].download).toBe("role-card.txt");
  });

  it("on the profile, saves the member's card from /mine/text", async () => {
    const clicks = saving();
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(url);
        if (url.endsWith("/mine/text")) return new Response("Riverbend role card v1\n", { status: 200 });
        return new Response(JSON.stringify({ nextSeason: null, nextSeasonWords: null, draftId: null, proposals: [] }), { status: 200 });
      }),
    );
    render(
      <Router>
        <ProposeRolesEntry />
      </Router>,
    );
    fireEvent.click(await screen.findByRole("button", { name: RC_WORDS.download }));
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(seen).toContain("/api/governance/role-proposals/mine/text");
  });
});
