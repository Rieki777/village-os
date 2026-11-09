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
 * double-quoted message. A message that does not compile fails the build and
 * names its id, the same strictness the catalog build applies to translations.
 */
/*
 * A JSX `<Trans>` with placeholders emits `values` (and, around an element,
 * `components`) BETWEEN the id and the message, so those keys may sit there.
 * Matching only an id directly before a message left every such message a
 * string, which the browser printed with its braces ("To decide {nDecide}").
 * The objects may nest three levels, enough for a component holding props.
 */
const DESCRIPTOR =
  /(\bid:\s*"[A-Za-z0-9_-]{6}",(?:\s*(?:values|components):\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\},)*\s*message:\s*)("(?:[^"\\\n]|\\.)*")/g;

export function precompileMessages(code: string): string {
  return code.replace(DESCRIPTOR, (_m, head: string, literal: string) => {
    const message = JSON.parse(literal) as string;
    let compiled;
    try {
      compiled = compileMessageOrThrow(message);
    } catch (err) {
      const id = /"([A-Za-z0-9_-]{6})"/.exec(head)?.[1];
      throw new Error(`Lingui message ${id} does not compile ("${message}"): ${(err as Error).message}`);
    }
    // A plain message compiles to itself; wrap it so the runtime sees "already compiled".
    return `${head}${JSON.stringify(typeof compiled === "string" ? [compiled] : compiled)}`;
  });
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
