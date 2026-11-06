/**
 * The AI help seam, wired by the role guide: configured exactly when a guide
 * can answer (GET /api/guide), under that guide's name, and a document brought
 * in reaches only the panel on its own step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiHelpStatus, NOT_CONFIGURED, onBroughtIn } from "./aiHelp";

const answers = (body: unknown, status = 200) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));

afterEach(() => vi.unstubAllGlobals());

describe("AI help", () => {
  it.each([["words" as const], ["season" as const]])("is not configured on the %s step when no guide can answer", async (step) => {
    answers({ choice: null, options: [{ id: "village", name: "Maia", available: false }], answering: null, note: null, canChoose: false });
    expect(await aiHelpStatus(step)).toEqual(NOT_CONFIGURED);
    expect(NOT_CONFIGURED).toEqual({ configured: false, reason: "not configured" });
  });

  it("is not configured when the guide door fails", async () => {
    answers({ error: "nope" }, 500);
    expect(await aiHelpStatus("words")).toEqual(NOT_CONFIGURED);
  });

  it("is configured under the answering guide's name", async () => {
    answers({ choice: "saberra", options: [{ id: "village", name: "Maia", available: true }, { id: "saberra", name: "Sera", available: false }], answering: "village", note: "x", canChoose: false });
    const s = await aiHelpStatus("words");
    expect(s.configured && s.guide).toBe("Maia");
  });

  it("gives an unnamed guide's name as it opens a sentence, for the upload's line", async () => {
    answers({ choice: null, options: [{ id: "village", name: "the village guide", named: false, available: true }], answering: "village", note: null, canChoose: false });
    const s = await aiHelpStatus("words");
    expect(s.configured && s.guide).toBe("The village guide");
  });

  it("hands a document to the panel on its own step only", async () => {
    answers({ choice: null, options: [{ id: "village", name: "Maia", available: true }], answering: "village", note: null, canChoose: false });
    const words: string[] = [];
    const season: string[] = [];
    const offWords = onBroughtIn("words", (t) => words.push(t));
    const offSeason = onBroughtIn("season", (t) => season.push(t));
    const s = await aiHelpStatus("words");
    if (s.configured) s.bringIn("I look after the seed bank.");
    expect(words).toEqual(["I look after the seed bank."]);
    expect(season).toEqual([]);
    offWords();
    if (s.configured) s.bringIn("again");
    expect(words).toHaveLength(1);
    offSeason();
  });
});
