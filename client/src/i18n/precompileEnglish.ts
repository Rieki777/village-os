import { compileMessageOrThrow } from "@lingui/message-utils/compileMessage";
import type { Plugin } from "vite";

/**
 * Compile each English source message at BUILD time (internal spec i18n,
 * §8 R5 and R8).
 *
 * The Lingui macro leaves `{ id: "abc123", message: "Sign in" }` in the code.
 * Rendering a string message needs Lingui's ICU compiler in the browser:
 * 19.5 KB minified on the first page, measured 2026-11-06, which is most of
 * what the whole framework costs. Lingui's runtime skips the compiler for a
 * message that is already compiled (an array, not a string; @lingui/core
 * `I18n._`), so this replaces each macro message with Lingui's own compiled
 * form, using the same compiler, here in Node. The browser then never needs
 * a compiler: catalogs from the server arrive compiled too.
 *
 * The match is the macro's exact output shape: a 6-character id followed by a
 * message, double-quoted, or single-quoted when it holds a double quote
 * (found 2026-11-08 on the Funding rounds page, where such a message
 * rendered its placeholders raw). A message that does not compile fails the build and
 * names its id, the same strictness the catalog build applies to translations.
 */
const ID = /\bid:\s*"[A-Za-z0-9_-]{6}",\s*/g;
const MESSAGE = /^message:\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/;
const VALUES = /^(?:values|components):\s*\{/;

/**
 * The end of a balanced `{ ... }` starting at `open` (the index of its `{`),
 * skipping string literals, or -1 when it never closes. The macro emits
 * `values` between `id` and `message` for a <Trans> or <Plural> with
 * variables (`{id:"224D8v",values:{paidOn:o},message:"Paid {paidOn}"}`), and
 * a value can be any expression, so a regex cannot step over it safely.
 */
function closeOf(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < code.length && code[i] !== ch; i++) if (code[i] === "\\") i++;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The text a JS string literal holds, double- or single-quoted. */
function literalText(literal: string): string {
  if (literal.startsWith('"')) return JSON.parse(literal) as string;
  // Single-quoted: unescape \' and escape each bare " so JSON can read the rest.
  let json = "";
  const body = literal.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\" && body[i + 1] === "'") {
      json += "'";
      i++;
    } else if (c === "\\") {
      json += c + (body[i + 1] ?? "");
      i++;
    } else {
      json += c === '"' ? '\\"' : c;
    }
  }
  return JSON.parse(`"${json}"`) as string;
}

function compiledLiteral(literal: string, head: string): string {
  const message = literalText(literal);
  let compiled;
  try {
    compiled = compileMessageOrThrow(message);
  } catch (err) {
    const id = /"([A-Za-z0-9_-]{6})"/.exec(head)?.[1];
    throw new Error(`Lingui message ${id} does not compile ("${message}"): ${(err as Error).message}`);
  }
  // A plain message compiles to itself; wrap it so the runtime sees "already compiled".
  return JSON.stringify(typeof compiled === "string" ? [compiled] : compiled);
}

export function precompileMessages(code: string): string {
  let out = "";
  let last = 0;
  ID.lastIndex = 0;
  for (let m = ID.exec(code); m; m = ID.exec(code)) {
    const head = m[0];
    let at = m.index + head.length;
    // Step over `values: {...},` and `components: {...},` if the macro put them first.
    for (let guard = 0; guard < 2; guard++) {
      const v = VALUES.exec(code.slice(at));
      if (!v) break;
      const close = closeOf(code, at + v[0].length - 1);
      if (close < 0) break;
      const comma = /^\s*,\s*/.exec(code.slice(close + 1));
      if (!comma) break;
      at = close + 1 + comma[0].length;
    }
    const msg = MESSAGE.exec(code.slice(at));
    if (!msg) continue;
    const literalStart = at + msg[0].length - msg[1].length;
    out += code.slice(last, literalStart) + compiledLiteral(msg[1], head);
    last = literalStart + msg[1].length;
    ID.lastIndex = last;
  }
  return last === 0 ? code : out + code.slice(last);
}

export function precompileEnglish(): Plugin {
  return {
    name: "village-precompile-english",
    enforce: "pre",
    transform(code, id) {
      if (!/\.[jt]sx?$/.test(id.split("?")[0]) || id.includes("node_modules")) return null;
      if (!code.includes("message:")) return null;
      // Only code the macro produced: it imports the runtime. A file that
      // merely contains descriptor-shaped text (this plugin's own tests) is left alone.
      if (!/from\s*["'](?:@lingui\/core|@\/i18n\/runtime)["']/.test(code)) return null;
      const out = precompileMessages(code);
      return out === code ? null : { code: out, map: null };
    },
  };
}
