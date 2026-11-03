/**
 * About three roles, ranked from the member's own answers.
 *
 * Open roles come first. Each suggestion keeps the sentence it came from.
 * A suggestion is a role's name and that sentence: a holder is not a field
 * here, so the shared step cannot print one. An empty answer, or a chart
 * the answers do not touch, is an empty list. The member's words are read
 * and never written.
 */
import { contentWords } from "./roleGuideChecks";

export const ROLE_SUGGEST_LIMIT = 3;

export interface SuggestRoleIn {
  id: string;
  name: string;
  /** What the role is about. A circle's purpose, a domain. No person's name. */
  about: string;
  open: boolean;
}

export interface SuggestedRole {
  id: string;
  name: string;
  open: boolean;
  /** The member's sentence this role was ranked from. */
  source: string;
}

export interface OwnAnswers {
  love: string;
  offer: string;
  why: string;
}

function sentences(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n+|(?<=[.!?。？！])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of Array.from(a)) if (b.has(w)) n++;
  return n;
}

/** Hiragana, katakana, and the han range. A run of these has no spaces between words. */
function isCjk(code: number): boolean {
  return (code >= 0x3040 && code <= 0x30ff) || (code >= 0x3400 && code <= 0x9fff);
}

/**
 * Letters outside the latin folder, so an answer in another language can
 * still meet a role whose name is written in that language.
 */
function extraTokens(line: string): Set<string> {
  const out = new Set<string>();
  let run = "";
  const flush = () => {
    if (run.length >= 2 && /[^\u0000-\u007f]/.test(run)) out.add(run.toLowerCase());
    for (const ch of Array.from(run)) {
      const code = ch.codePointAt(0) ?? 0;
      if (isCjk(code)) out.add(ch);
    }
    run = "";
  };
  for (const ch of Array.from(line)) {
    const code = ch.codePointAt(0) ?? 0;
    const latin = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (latin || code > 127) run += ch;
    else flush();
  }
  flush();
  return out;
}

function wordsOf(line: string): Set<string> {
  const out = contentWords(line);
  for (const t of Array.from(extraTokens(line))) out.add(t);
  return out;
}

/** Up to three roles. Open ones first, then the closer match. PURE. */
export function suggestRoles(answers: OwnAnswers, roles: readonly SuggestRoleIn[]): SuggestedRole[] {
  const lines = sentences([answers.love, answers.offer, answers.why].filter(Boolean).join("\n"));
  if (lines.length === 0) return [];
  const scored = lines.map((s) => ({ s, w: wordsOf(s) }));
  const ranked: Array<SuggestedRole & { score: number }> = [];
  for (const role of roles) {
    const name = String(role.name ?? "").trim();
    if (!role.id || !name) continue;
    const about = wordsOf(`${name} ${role.about ?? ""}`);
    if (about.size === 0) continue;
    let best: { s: string; n: number } | null = null;
    for (const line of scored) {
      const n = overlap(line.w, about);
      if (n > 0 && (!best || n > best.n)) best = { s: line.s, n };
    }
    if (!best) continue;
    ranked.push({ id: role.id, name, open: role.open === true, source: best.s, score: best.n });
  }
  ranked.sort((a, b) => Number(b.open) - Number(a.open) || b.score - a.score || a.name.localeCompare(b.name));
  return ranked.slice(0, ROLE_SUGGEST_LIMIT).map(({ id, name, open, source }) => ({ id, name, open, source }));
}
