import { describe, expect, it } from "vitest";
import { allLazyInBoot, bootChunks, bootIntrudersMessage, lazyModulesInBoot, shortId, type BootChunkFacts } from "./bootSet";

const ROOT = "/repo";
const chunk = (fileName: string, o: Partial<BootChunkFacts> = {}): BootChunkFacts => ({ fileName, imports: [], isEntry: false, moduleIds: [], ...o });

/** The shape of the real incident: a boot chunk that rollup grew with two modules only lazy pages import. */
const graph: BootChunkFacts[] = [
  chunk("index.js", { isEntry: true, imports: ["shared-boot.js"], moduleIds: ["/repo/client/src/main.tsx", "/repo/client/src/components/alignment/AlignButton.tsx"] }),
  chunk("shared-boot.js", { moduleIds: ["/repo/client/src/components/journey/look.ts", "/repo/shared/termsWords.ts", "/repo/shared/seatSettings.ts", "\0vite/preload-helper"] }),
  chunk("Propose.js", { moduleIds: ["/repo/client/src/pages/Propose.tsx"] }),
];
const eager = new Set(["/repo/client/src/main.tsx", "/repo/client/src/components/alignment/AlignButton.tsx", "/repo/client/src/components/journey/look.ts"]);

describe("the boot set guard", () => {
  it("counts the entry and everything it imports statically, and no lazy chunk", () => {
    expect(bootChunks(graph).map((c) => c.fileName).sort()).toEqual(["index.js", "shared-boot.js"]);
  });

  it("names the lazy-only modules that joined a boot chunk, and the chunk they joined", () => {
    expect(lazyModulesInBoot(graph, eager)).toEqual([{ chunk: "shared-boot.js", modules: ["/repo/shared/termsWords.ts", "/repo/shared/seatSettings.ts"] }]);
  });

  it("control: the same graph with those two modules in a lazy chunk passes", () => {
    const fixed = graph.map((c) => (c.fileName === "shared-boot.js" ? { ...c, moduleIds: c.moduleIds.filter((m) => !/termsWords|seatSettings/.test(m)) } : c));
    expect(lazyModulesInBoot(fixed, eager)).toEqual([]);
  });

  it("control: a module in the entry's own static closure is never an intruder, whichever chunk holds it", () => {
    const all = new Set([...eager, "/repo/shared/termsWords.ts", "/repo/shared/seatSettings.ts"]);
    expect(lazyModulesInBoot(graph, all)).toEqual([]);
  });

  it("never names rollup's own helpers", () => {
    expect(allLazyInBoot(graph, eager, (id) => shortId(id, ROOT)).some((m) => m.includes("preload-helper"))).toBe(false);
  });

  it("lets the known list through and names only what is new (a ratchet that can shrink, never grow)", () => {
    const known = new Set(["shared/termsWords.ts"]);
    const found = lazyModulesInBoot(graph, eager, known, (id) => shortId(id, ROOT));
    expect(found).toEqual([{ chunk: "shared-boot.js", modules: ["/repo/shared/seatSettings.ts"] }]);
  });

  it("says what to do and which files, as paths a person can open", () => {
    const text = bootIntrudersMessage(lazyModulesInBoot(graph, eager), ROOT);
    expect(text).toContain("2 module(s)");
    expect(text).toContain("shared-boot.js");
    expect(text).toContain("shared/termsWords.ts");
    expect(text).toContain("shared/seatSettings.ts");
    expect(text).not.toContain("/repo/");
  });

  it("shortens a pnpm package path to node_modules/<package>", () => {
    expect(shortId("/repo/node_modules/.pnpm/foo@1.0.0/node_modules/foo/index.js?x=1", ROOT)).toBe("node_modules/foo/index.js");
  });
});
