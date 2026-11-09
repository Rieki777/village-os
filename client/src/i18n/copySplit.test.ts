import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileMessage } from "@lingui/message-utils/compileMessage";
import { describe, expect, it } from "vitest";
import { precompileMessages } from "./precompileEnglish";
import { bootChunks, CopyCollector, LONG_MESSAGE_CHARS, renderChunkCopy, writeCopyParts } from "./copySplit";

/**
 * Long English leaves the lazy chunks for a per-chunk part in dist/i18n
 * (dist headroom lane, spec "long copy out of the bundle"). These hold the
 * build side: what moves, what stays, and what each chunk is given instead.
 */

const LONG = "Every member of the village can propose a change to how it runs.";
const SHORT = "Sign in";

describe("precompileMessages with a split collector", () => {
  it("moves a long message out of its descriptor and keeps the id", () => {
    const seen: Array<[string, string]> = [];
    const out = precompileMessages(`t({ id: "Ab12Cd", message: "${LONG}" })`, (id, compiled) => seen.push([id, compiled]));
    expect(out).toBe(`t({ id: "Ab12Cd" })`);
    expect(seen).toEqual([["Ab12Cd", JSON.stringify(compileMessage(LONG))]]);
  });

  it("leaves a short message inline and compiled", () => {
    const seen: string[] = [];
    const out = precompileMessages(`t({ id: "Ab12Cd", message: "${SHORT}" })`, (id) => seen.push(id));
    expect(out).toContain(`message: ${JSON.stringify(compileMessage(SHORT))}`);
    expect(seen).toEqual([]);
  });

  it("keeps values and any field after the message", () => {
    const msg = `${LONG} Ask {name} first.`;
    const out = precompileMessages(`e.jsx(t,{id:"224D8v",values:{name:o},message:"${msg}",context:"x"})`, () => {});
    expect(out).toBe(`e.jsx(t,{id:"224D8v",values:{name:o},context:"x"})`);
  });

  it("measures the threshold on the English as written", () => {
    const exact = "x".repeat(LONG_MESSAGE_CHARS);
    const seen: string[] = [];
    precompileMessages(`t({id:"Ab12Cd",message:"${exact}"}); t({id:"Ef34Gh",message:"${exact.slice(1)}"})`, (id) => seen.push(id));
    expect(seen).toEqual(["Ab12Cd"]);
  });

  it("moves nothing without a collector, which is how tests and dev run", () => {
    expect(precompileMessages(`t({ id: "Ab12Cd", message: "${LONG}" })`)).toContain(`message: ${JSON.stringify(compileMessage(LONG))}`);
  });
});

/** A chunk graph the shape rollup hands renderChunk: file name -> facts. */
function graph() {
  return {
    "assets/index.js": { fileName: "assets/index.js", isEntry: true, imports: ["assets/boot.js"], moduleIds: ["/src/main.tsx"] },
    "assets/boot.js": { fileName: "assets/boot.js", isEntry: false, imports: [], moduleIds: ["/src/Layout.tsx"] },
    "assets/Page.js": { fileName: "assets/Page.js", isEntry: false, imports: ["assets/boot.js", "assets/shared.js"], moduleIds: ["/src/pages/Page.tsx"] },
    "assets/shared.js": { fileName: "assets/shared.js", isEntry: false, imports: [], moduleIds: ["/src/lib/words.ts"] },
  };
}

function collector() {
  const c = new CopyCollector();
  c.record("/src/Layout.tsx", "Lay0ut", JSON.stringify(["Layout words that are long enough to move out"]));
  c.record("/src/pages/Page.tsx", "Pag3_1", JSON.stringify(["The page's own long paragraph of prose, moved."]));
  c.record("/src/pages/Page.tsx", "Pag3_2", JSON.stringify(["A second long paragraph that the page renders."]));
  return c;
}

describe("bootChunks", () => {
  it("is the entry and everything it imports statically, transitively", () => {
    expect([...bootChunks(graph())].sort()).toEqual(["assets/boot.js", "assets/index.js"]);
  });
});

describe("renderChunkCopy", () => {
  it("gives a lazy chunk one awaited load of its own part, before any of its code runs", () => {
    const c = collector();
    const out = renderChunkCopy("export const x=1;", graph()["assets/Page.js"], graph(), c);
    expect(out).not.toBeNull();
    const part = [...c.parts.keys()][0];
    expect(part).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(out!.startsWith(`await globalThis.__villageCopyLoad("${part}");`)).toBe(true);
    expect(c.parts.get(part)).toEqual({
      messages: {
        Pag3_1: ["The page's own long paragraph of prose, moved."],
        Pag3_2: ["A second long paragraph that the page renders."],
      },
      texts: [],
    });
  });

  it("gives a boot chunk its English inline, so the first page never waits on a fetch", () => {
    const c = collector();
    const out = renderChunkCopy("export const y=2;", graph()["assets/boot.js"], graph(), c);
    expect(out).toContain(`.push({"Lay0ut":["Layout words that are long enough to move out"]})`);
    expect(out).not.toContain("await");
    expect(c.parts.size).toBe(0);
  });

  it("leaves a chunk with no moved message untouched", () => {
    expect(renderChunkCopy("export const z=3;", graph()["assets/shared.js"], graph(), collector())).toBeNull();
  });

  it("names a part by its content, so the same words always make the same file", () => {
    const a = collector();
    const b = collector();
    renderChunkCopy("", graph()["assets/Page.js"], graph(), a);
    renderChunkCopy("", graph()["assets/Page.js"], graph(), b);
    expect([...a.parts.keys()]).toEqual([...b.parts.keys()]);
  });
});

/**
 * Plain long strings (data files the server also reads, like shared/guilds.ts,
 * and any page copy not yet wrapped for translation) leave a lazy chunk the
 * same way, with no change to the source: the build swaps each literal for a
 * read from the part the chunk already awaits.
 */
describe("long string literals in a lazy chunk", () => {
  const PROSE = "Plant the key before the module can start working for the village.";
  const PROSE2 = "A founder reads this line on the consent screen before choosing.";
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

  /** Run a rendered chunk body the way the browser would, with the part served from the collector. */
  async function run(out: string, c: CopyCollector): Promise<unknown> {
    const g: Record<string, unknown> = {
      __villageCopyLoad: async (part: string) => c.parts.get(part)!.texts,
    };
    return new AsyncFunction("globalThis", `${out}\nreturn globalThis.__out;`)(g);
  }

  const lazy = () => graph()["assets/shared.js"];

  it("moves a long literal out and the chunk computes the same value", async () => {
    const code = `function f(e){switch(e){case"${PROSE2}":return"${PROSE}"}return e}globalThis.__out=[f("${PROSE2}"),"${PROSE}".length,{note:\`${PROSE2}\`}.note];`;
    const c = new CopyCollector();
    const out = renderChunkCopy(code, lazy(), graph(), c)!;
    expect(out).not.toContain(PROSE);
    expect(out).not.toContain(PROSE2);
    const [part] = [...c.parts.keys()];
    expect(part).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(out).toContain(`await globalThis.__villageCopyLoad("${part}")`);
    // Each distinct string is stored once, however often the chunk uses it.
    expect([...c.parts.get(part)!.texts].sort()).toEqual([PROSE2, PROSE].sort());
    expect(await run(out, c)).toEqual([PROSE, PROSE.length, PROSE2]);
  });

  it("keeps every literal a value read cannot replace", () => {
    const code = [
      `"use strict";`,
      `import a from "./${"x".repeat(50)} y.js";`,
      `export { a as "${PROSE} export" };`,
      `const o = { "${PROSE} key": 1, ["${PROSE} computed"]: 2 };`,
      `class K { "${PROSE} method"() {} }`,
      `const t = String.raw\`${PROSE} tagged\`;`,
      `const v = \`${PROSE} \${o} templated\`;`,
      `const p = "__VITE_PRELOAD__ ${PROSE}";`,
      `const n = "${"y".repeat(60)}";`,
      `const s = "Short words.";`,
    ].join("\n");
    const c = new CopyCollector();
    const out = renderChunkCopy(code, lazy(), graph(), c)!;
    for (const kept of [`${PROSE} export`, `${PROSE} key`, `${PROSE} method`, `${PROSE} tagged`, `${PROSE} \${o} templated`, "__VITE_PRELOAD__", "y".repeat(60), "Short words.", `"use strict"`]) {
      expect(out).toContain(kept);
    }
    // The computed key is an expression, so it moves like any other value.
    expect(out).not.toContain(`${PROSE} computed`);
    expect([...c.parts.values()][0].texts).toEqual([`${PROSE} computed`]);
  });

  it("never touches a boot chunk: the first paint waits on nothing", () => {
    const code = `globalThis.__out="${PROSE}";`;
    expect(renderChunkCopy(code, graph()["assets/boot.js"], graph(), new CopyCollector())).toBeNull();
  });

  it("picks a name the chunk does not already use", async () => {
    const code = `const __vC=1,__vC0=2;globalThis.__out=["${PROSE}",__vC+__vC0];`;
    const c = new CopyCollector();
    const out = renderChunkCopy(code, lazy(), graph(), c)!;
    expect(await run(out, c)).toEqual([PROSE, 3]);
  });

  it("keeps characters JSON and the source spell differently", async () => {
    const tricky = "Quotes \" and ' and a backslash \\ then an emoji 🌱 and a line\nbreak, all moved.";
    const code = `globalThis.__out=${JSON.stringify(tricky)};`;
    const c = new CopyCollector();
    const out = renderChunkCopy(code, lazy(), graph(), c)!;
    const parsed = JSON.parse(JSON.stringify(c.parts.get([...c.parts.keys()][0])));
    c.parts.set([...c.parts.keys()][0], parsed);
    expect(await run(out, c)).toBe(tricky);
  });

  it("leaves a chunk with nothing long in it untouched", () => {
    expect(renderChunkCopy(`globalThis.__out="Short.";`, lazy(), graph(), new CopyCollector())).toBeNull();
  });
});

describe("writeCopyParts", () => {
  it("writes each part as {messages}, and clears parts a previous build left", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copy-parts-"));
    fs.writeFileSync(path.join(dir, "stale0000000.json"), "{}");
    const c = collector();
    renderChunkCopy("", graph()["assets/Page.js"], graph(), c);
    writeCopyParts(c, dir);
    const files = fs.readdirSync(dir);
    expect(files).toEqual([`${[...c.parts.keys()][0]}.json`]);
    const body = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
    expect(Object.keys(body.messages).sort()).toEqual(["Pag3_1", "Pag3_2"]);
  });
});
