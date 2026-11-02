/**
 * THE WORD GRATITUDE BELONGS TO THE RECOGNITION TOKEN ALONE.
 *
 * Rye, 2026-11-01: "Gratitude ONLY for the recognition token and NOT for the
 * credit or earned equity tokens". So no token of another kind may carry the
 * word in its name, and no name a member can be shown for one may either.
 * The slug `gratitude`, the kind `recognition` and `HEARTS` in
 * server/lib/economy.ts are that one token.
 *
 * Three places hand a member a token's name, and each is read here from the
 * source that decides it, never from a list typed into this file:
 *
 *   1. The registry a village holds. `collectFacts` in
 *      scripts/generate-token-doc.mjs runs every token statement in `drizzle/`
 *      through the reader server/db/tokenDoc.test.ts holds to real MySQL, then
 *      adds every `ensure...Token` boot registration under server/. The
 *      standing examples' own tokens come from server/seeds/examples-seed.json,
 *      which is where a fresh village's example market reads them.
 *   2. The platform defaults in shared/gameConfig.ts and the `{words}` a page
 *      field falls back to (shared/pageContent/vars.ts).
 *   3. Every loading fallback the client paints for a token that is not the
 *      recognition token: the default of each name hook, and the literal every
 *      caller passes it.
 *
 * Each block asserts a floor first, so a reader that stopped finding anything
 * fails loudly and never passes by measuring nothing.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../shared/gameConfig";
import { pageVarsFrom } from "../shared/pageContent/vars";
import { HEARTS } from "./lib/economy";
// The generator is plain ESM with no types; it is imported for real, as
// server/db/tokenDoc.test.ts does, so this file reads the registry it documents.
// @ts-expect-error - scripts/ is untyped JavaScript, deliberately outside tsconfig
import { collectFacts } from "../scripts/generate-token-doc.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SAYS_GRATITUDE = /gratitude/i;
const RULING = "The word Gratitude belongs to the recognition token alone (Rye, 2026-11-01).";

interface NamedToken {
  slug: string;
  name: string;
  kind: string;
  from: string;
}

/** Every token a fresh village holds, real and example, with where each name comes from. */
function villageTokens(): NamedToken[] {
  const real = (collectFacts(ROOT).tokens as Array<{ slug: string; name: string; kind: string; arrivesIn: string }>).map(
    (t) => ({ slug: t.slug, name: String(t.name), kind: t.kind, from: t.arrivesIn }),
  );
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "seeds", "examples-seed.json"), "utf8"));
  const examples = ((seed.exchange?.tokens ?? []) as Array<{ slug: string; name: string; kind: string }>).map((t) => ({
    slug: t.slug,
    name: String(t.name),
    kind: t.kind,
    from: "server/seeds/examples-seed.json",
  }));
  return [...real, ...examples];
}

/** A token outside recognition whose name says Gratitude, in words that name the file. */
function gratitudeOutsideRecognition(tokens: readonly NamedToken[]): string[] {
  return tokens
    .filter((t) => t.kind !== "recognition" && SAYS_GRATITUDE.test(t.name))
    .map((t) => `${t.slug} (${t.kind}) is named "${t.name}" in ${t.from}`);
}

describe("the registry a village holds", () => {
  const tokens = villageTokens();

  it("reads the credit and equity tokens, so an empty read cannot pass", () => {
    const slugs = tokens.map((t) => t.slug);
    expect(slugs).toEqual(expect.arrayContaining([HEARTS, "credits", "earned-equity"]));
    expect(tokens.find((t) => t.slug === HEARTS)?.kind).toBe("recognition");
    expect(tokens.find((t) => t.slug === "credits")?.kind).toBe("credit");
    expect(tokens.find((t) => t.slug === "earned-equity")?.kind).toBe("equity");
    // The standing examples are read too: the example market lists them by name.
    expect(tokens.some((t) => t.from === "server/seeds/examples-seed.json")).toBe(true);
  });

  it("names no token outside recognition Gratitude", () => {
    expect(gratitudeOutsideRecognition(tokens), RULING).toEqual([]);
  });

  it("catches the name it guards against, and leaves the recognition token its own word", () => {
    const planted: NamedToken[] = [
      { slug: HEARTS, name: "Gratitude", kind: "recognition", from: "a planted row" },
      { slug: "credits", name: "Gratitude Credits", kind: "credit", from: "a planted row" },
      { slug: "earned-equity", name: "Earned gratitude", kind: "equity", from: "a planted row" },
      { slug: "village-voice", name: "Village Voice", kind: "voice", from: "a planted row" },
    ];
    expect(gratitudeOutsideRecognition(planted)).toEqual([
      'credits (credit) is named "Gratitude Credits" in a planted row',
      'earned-equity (equity) is named "Earned gratitude" in a planted row',
    ]);
  });
});

describe("the platform's default names", () => {
  it("keeps Gratitude on the recognition token and off the equity, voice and umbrella words", () => {
    const c = GAME_CONFIG.currency;
    // The recognition token's own default may say it; that is the one place it lives.
    expect(c.name).toBe("Gratitude");
    for (const [where, name] of [
      ["shared/gameConfig.ts currency.equity.name", c.equity.name],
      ["shared/gameConfig.ts currency.voice.name", c.voice.name],
      ["shared/gameConfig.ts currency.collectiveName (the umbrella word)", c.collectiveName],
    ] as const) {
      expect(String(name).length, where).toBeGreaterThan(0);
      expect(String(name), `${where}. ${RULING}`).not.toMatch(SAYS_GRATITUDE);
    }
  });

  it("gives a page field's value and umbrella words a fallback that is never Gratitude", () => {
    const words = pageVarsFrom({});
    for (const key of ["value", "tokens"] as const) {
      expect(words[key].length, key).toBeGreaterThan(0);
      expect(words[key], `{${key}} in shared/pageContent/vars.ts. ${RULING}`).not.toMatch(SAYS_GRATITUDE);
    }
  });
});

/** The client's name hooks for every token other than the recognition token. */
const OTHER_TOKEN_HOOKS = ["useValueTokenName", "useTokenNameFor", "useTokensWord"] as const;
const HOOK_FILES = ["client/src/hooks/useTokenNames.ts", "client/src/hooks/useTokenNameFor.ts"];

function parse(rel: string): ts.SourceFile {
  const abs = path.join(ROOT, rel);
  return ts.createSourceFile(abs, fs.readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function clientFiles(dir = "client/src", out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) clientFiles(rel, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(rel);
  }
  return out;
}

const literal = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

describe("the names the client paints while the config loads", () => {
  it("defaults no hook for another token to Gratitude", () => {
    const defaults: Array<{ hook: string; fallback: string }> = [];
    for (const rel of HOOK_FILES) {
      const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && node.name && (OTHER_TOKEN_HOOKS as readonly string[]).includes(node.name.text)) {
          const param = node.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === "fallback");
          const value = literal(param?.initializer);
          expect(value, `${node.name.text} in ${rel} has a fallback this guard cannot read`).not.toBeNull();
          defaults.push({ hook: node.name.text, fallback: String(value) });
        }
        ts.forEachChild(node, visit);
      };
      visit(parse(rel));
    }
    // Every hook found, or the read below is about nothing.
    expect(defaults.map((d) => d.hook).sort()).toEqual([...OTHER_TOKEN_HOOKS].sort());
    for (const d of defaults) expect(d.fallback, `${d.hook}'s default. ${RULING}`).not.toMatch(SAYS_GRATITUDE);
  });

  it("passes no caller's fallback for another token as Gratitude", () => {
    const calls: string[] = [];
    const offenders: string[] = [];
    for (const rel of clientFiles()) {
      const sf = parse(rel);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (OTHER_TOKEN_HOOKS as readonly string[]).includes(node.expression.text)) {
          const hook = node.expression.text;
          const args = [...node.arguments];
          // useTokenNameFor(slug, fallback): the recognition token's own slug is the one place the word may live.
          const slug = hook === "useTokenNameFor" ? literal(args.shift()) : null;
          if (slug !== HEARTS) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            calls.push(`${rel}:${line}`);
            for (const a of args) {
              const value = literal(a);
              if (value === null) offenders.push(`${rel}:${line} passes ${hook} a fallback this guard cannot read`);
              else if (SAYS_GRATITUDE.test(value)) offenders.push(`${rel}:${line} paints "${value}" for ${hook}${slug ? `("${slug}")` : ""}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(calls.length, "no caller of the other token hooks was found").toBeGreaterThan(0);
    expect(offenders, RULING).toEqual([]);
  });
});
