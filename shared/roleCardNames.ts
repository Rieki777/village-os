/**
 * THE NAME RULE for a role card (shared/roleCardText.ts). Rye, 2026-10-22:
 * "as a rule we never name people instead we name the role". The reader
 * finds a member's display name in a card's words, any case, and a first name
 * as written with its capital, and where that member holds exactly one role
 * writes the role's title in its place.
 *
 * A first name that is also an everyday word ("Will", "Mark") is never read
 * as a name, since a sentence's capital would match it. Two plain patterns,
 * never an inline flag, so Node 22 in CI and the Node on a dev box read the
 * same names.
 *
 * Pure: no imports.
 */

/** A member, for the name rule: their display name and the titles of the roles they hold now. */
export interface RoleCardPerson {
  name: string;
  roles?: readonly string[];
}

/** First names that are also everyday words, which a capital at a sentence's start would match. */
const COMMON_WORDS = new Set(
  "will may mark bill grace hope joy faith sky river rose summer dawn frank grant hunter sage ray art rob sue max ivy lily june april august page chase drew gene jean pat penny robin wade earl miles jay dale glen cliff rich sunny star rain storm brook forest ash iris daisy ruby pearl jade amber honey bliss harmony unity paris eve sandy holly heather heath victor guy carol gail lane reed wren noel bud early rusty".split(" "),
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface NameRule {
  /** Full display names, any case. */
  full: RegExp | null;
  /** First names, only as written with their capital. */
  first: RegExp | null;
  swap: Map<string, string | null>;
}

const NAME_EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const NAME_EDGE_AFTER = String.raw`(?![\p{L}\p{N}])`;
/** Built at run time: the build target refuses the `u` flag on a literal. */
const CAPITAL = new RegExp(String.raw`^\p{Lu}`, "u");

/**
 * Two patterns for every member's name, and the role title to write in its
 * place when they hold exactly one role. Two plain patterns, never an inline
 * flag: `(?i:...)` parses on one Node and throws on another, which is a
 * difference CI would find and this machine would not.
 */
export function nameRule(people: readonly RoleCardPerson[] | undefined, skip: ReadonlySet<string>): NameRule | null {
  if (!people?.length) return null;
  const swap = new Map<string, string | null>();
  const full = new Set<string>();
  const first = new Set<string>();
  const add = (n: string, role: string | null) => {
    const k = n.toLowerCase();
    // Two members answering to one name: no single role to write.
    swap.set(k, swap.has(k) && swap.get(k) !== role ? null : role);
  };
  for (const p of people) {
    const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 3 || skip.has(name.toLowerCase())) continue;
    const role = p.roles && p.roles.length === 1 ? String(p.roles[0]).trim() || null : null;
    const words = name.split(" ");
    if (words.length > 1 || !COMMON_WORDS.has(name.toLowerCase())) {
      full.add(escapeRe(name));
      add(name, role);
    }
    const f = words[0];
    if (words.length > 1 && f.length >= 3 && CAPITAL.test(f) && !COMMON_WORDS.has(f.toLowerCase()) && !skip.has(f.toLowerCase())) {
      first.add(escapeRe(f));
      add(f, role);
    }
  }
  const pattern = (names: Set<string>, flags: string) =>
    names.size ? new RegExp(`${NAME_EDGE_BEFORE}(?:${Array.from(names).sort((a, b) => b.length - a.length).join("|")})${NAME_EDGE_AFTER}`, flags) : null;
  const rule = { full: pattern(full, "giu"), first: pattern(first, "gu"), swap };
  return rule.full || rule.first ? rule : null;
}

/** The text with each name it can swap written as the role's title, and every name it found. */
export function applyNameRule(text: string, rule: NameRule | null): { text: string; found: Array<{ name: string; role: string | null }> } {
  if (!rule || !text) return { text, found: [] };
  const found: Array<{ name: string; role: string | null }> = [];
  const swapIn = (src: string, re: RegExp | null) =>
    !re
      ? src
      : src.replace(re, (m: string, offset: number) => {
          const role = rule.swap.get(m.toLowerCase()) ?? null;
          found.push({ name: m, role });
          if (!role) return m;
          const before = src.slice(0, offset);
          if (/\bthe\s+$/i.test(before)) return role;
          const atStart = !before.trim() || /[.!?:]\s*$/.test(before);
          return `${atStart ? "The" : "the"} ${role}`;
        });
  // Full names first, so "Rick Moss" is one name and not "Rick" twice.
  const out = swapIn(swapIn(text, rule.full), rule.first);
  return { text: out, found };
}
