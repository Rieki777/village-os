import { compileMessage } from "@lingui/message-utils/compileMessage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateLocale, drainInlineCopy, i18n, loadCopy } from "./i18n";

/**
 * The runtime side of moving long English out of the lazy chunks: a chunk
 * awaits its part, the part's English is registered, and English stays the
 * fallback under every language, because Lingui 6 has no fallback chain and a
 * message missing from the active catalog would otherwise render as its id.
 */

const part = (messages: Record<string, string>) => {
  const out: Record<string, unknown> = {};
  for (const [id, text] of Object.entries(messages)) out[id] = [compileMessage(text)].flat();
  return { messages: out };
};

afterEach(() => activateLocale("en", {}));

describe("loadCopy", () => {
  it("registers a part's English, so the id renders as its words", async () => {
    const fetchPart = vi.fn(async () => part({ cpyA01: "A long paragraph the page used to carry inline." }));
    await loadCopy("partAAAAAAAA", fetchPart);
    expect(i18n._({ id: "cpyA01" })).toBe("A long paragraph the page used to carry inline.");
    expect(fetchPart).toHaveBeenCalledWith("partAAAAAAAA");
  });

  it("resolves to the part's plain texts, which the chunk reads its long literals from", async () => {
    const body = { ...part({ cpyG01: "A message beside the plain texts of the same chunk." }), texts: ["First long literal of the chunk.", "Second one."] };
    expect(await loadCopy("partGGGGGGGG", async () => body)).toEqual(body.texts);
    expect(await loadCopy("partHHHHHHHH", async () => part({ cpyH01: "A part written before plain texts moved too." }))).toEqual([]);
  });

  it("fetches each part once, however many chunks await it", async () => {
    const fetchPart = vi.fn(async () => part({ cpyB01: "Shared words for two chunks, loaded only once." }));
    await Promise.all([loadCopy("partBBBBBBBB", fetchPart), loadCopy("partBBBBBBBB", fetchPart)]);
    expect(fetchPart).toHaveBeenCalledTimes(1);
  });

  it("retries once, then fails the import rather than showing an id", async () => {
    const fetchPart = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(loadCopy("partCCCCCCCC", fetchPart)).rejects.toThrow("offline");
    expect(fetchPart).toHaveBeenCalledTimes(2);
    // A later visit may try again: a failure is not remembered.
    const ok = vi.fn(async () => part({ cpyC01: "Back online, and the words arrive this time." }));
    await loadCopy("partCCCCCCCC", ok);
    expect(i18n._({ id: "cpyC01" })).toBe("Back online, and the words arrive this time.");
  });
});

describe("English under every language", () => {
  it("shows the English when the active catalog lacks a long message", async () => {
    activateLocale("es", part({ cpyD01: "Traducido" }).messages);
    await loadCopy("partDDDDDDDD", async () => part({ cpyD01: "Translated already, so Spanish wins here.", cpyD02: "Nobody has translated this long paragraph yet." }));
    expect(i18n._({ id: "cpyD01" })).toBe("Traducido");
    expect(i18n._({ id: "cpyD02" })).toBe("Nobody has translated this long paragraph yet.");
  });

  it("keeps the English underneath after a switch to another language", async () => {
    await loadCopy("partEEEEEEEE", async () => part({ cpyE01: "Loaded in English before the member switched." }));
    activateLocale("es", {});
    expect(i18n._({ id: "cpyE01" })).toBe("Loaded in English before the member switched.");
    activateLocale("es", part({ cpyE01: "Ya traducido" }).messages);
    expect(i18n._({ id: "cpyE01" })).toBe("Ya traducido");
  });
});

describe("drainInlineCopy", () => {
  it("registers what boot chunks pushed before the runtime loaded, and anything pushed after", () => {
    const g = globalThis as unknown as { __villageCopyInline: { push: (m: Record<string, unknown>) => unknown } };
    g.__villageCopyInline = [part({ cpyF01: "Pushed by a boot chunk before the runtime ran." }).messages];
    drainInlineCopy();
    expect(i18n._({ id: "cpyF01" })).toBe("Pushed by a boot chunk before the runtime ran.");
    g.__villageCopyInline.push(part({ cpyF02: "Pushed by a boot chunk after the runtime ran." }).messages);
    expect(i18n._({ id: "cpyF02" })).toBe("Pushed by a boot chunk after the runtime ran.");
  });
});
