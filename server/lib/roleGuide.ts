/**
 * ONE TURN OF THE ROLE GUIDE: what a guide is handed, how its answer becomes
 * suggestions, and where each suggestion came from.
 *
 * Rye, 2026-10-24. The guide is the member's choice, the village's own or the
 * outside service's agent, and both are asked the same thing and read back
 * the same way:
 *
 *   IN    the card as it stands, written in the village's role card text
 *         format; what the village knows (the member's roles, their circle's
 *         charter, the season's goals, what they have accomplished); the
 *         village's own checks; what is missing, in order; the member's
 *         document on the turn it is brought in; the conversation so far.
 *         Every person in any of it is named by role (roleGuideContext.ts).
 *
 *   OUT   the whole card back in the same text format, with the guide's
 *         suggestions written in, and at most one question.
 *
 * THE ANSWER IS READ BY THE ONE STRICT READER, never by a second parser: the
 * card text format's `read` (shared/roleCardText.ts, the role proposal lane's)
 * turns the text into exactly the body a draft saves. A field that differs
 * from what the member has is a suggestion. A field the reader refuses comes
 * back as a suggestion carrying the reader's sentence, so the member sees why
 * it cannot go in as it stands.
 *
 * WHERE A SUGGESTION CAME FROM is worked out here, never taken from the
 * guide: the sentence of the member's document that shares the most words
 * with it (`sourceFor`). A suggestion that matches no sentence says it came
 * from what the village already knows. So a guide cannot cite a sentence the
 * document does not hold.
 *
 * NAMES COME OUT A SECOND TIME. Every suggested word is put through the name
 * swap again on the way back, so a name the guide wrote in is a role title by
 * the time the member reads it.
 */
import { contentWords } from "@shared/roleGuideChecks";
import type { GuideLine, GuideSuggestion, RoleGuideStep } from "@shared/roleGuide";
import { GUIDE_ANSWER_MAX, GUIDE_DOCUMENT_MAX, GUIDE_TURNS_MAX } from "@shared/roleGuide";
import type { ProposalBody } from "@shared/roleProposals";
import type { RoleGuideContext } from "./roleGuideContext";

/** The card text format, as the guide uses it. The real one is shared/roleCardText.ts. */
export interface CardTextFormat {
  write(body: ProposalBody): string;
  read(text: string): { ok: boolean; proposalBody: Partial<ProposalBody> | null; problems: Array<{ field: string; sentence: string }> };
}

/** The fields a guide may suggest, per step. Terms and review dates are never the guide's. */
export const GUIDE_FIELDS: Record<RoleGuideStep, readonly string[]> = {
  words: [
    "name", "aim", "existsWhile", "domain", "authorities", "accountabilities", "responsibilities",
    "bringMe", "notMine", "signsStretched", "flowsBack", "stepBack", "timeCommitment",
  ],
  season: ["aim", "seasonalGoals"],
};

/** The document as sentences, each trimmed, the empty ones dropped. PURE. */
export function sentencesOf(document: string): string[] {
  return document
    .replace(/\r\n?/g, "\n")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.replace(/^[\s*\-•\d.)]+/, "").trim())
    .filter((s) => s.length >= 3);
}

/**
 * The document's sentence a suggestion came from, or null. PURE.
 *
 * The sentence sharing the most content words with the suggestion wins, and
 * it must share at least two, or every content word of a suggestion of one or
 * two words. A tie goes to the earlier sentence.
 */
export function sourceFor(words: string | readonly string[], sentences: readonly string[]): string | null {
  const want = contentWords(Array.isArray(words) ? words.join(" ") : String(words));
  if (want.size === 0) return null;
  const need = want.size <= 2 ? want.size : 2;
  let best: { s: string; n: number } | null = null;
  for (const s of sentences) {
    let n = 0;
    for (const w of Array.from(contentWords(s))) if (want.has(w)) n++;
    if (n >= need && (!best || n > best.n)) best = { s, n };
  }
  return best?.s ?? null;
}

type Words = string | string[] | null;

const asWords = (v: unknown): Words =>
  v === null || v === undefined ? null : Array.isArray(v) ? v.map((s) => String(s ?? "").trim()).filter(Boolean) : String(v).trim() || null;

const sameWords = (a: Words, b: Words): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const swapWords = (w: string | string[], swap: (t: string) => string): string | string[] => (Array.isArray(w) ? w.map(swap) : swap(w));

/**
 * Every field the guide's card changes, as suggestions. PURE.
 *
 * `current` is the draft as it stands; `proposed` is what the reader made of
 * the guide's text. Roles are matched by the posted role they renew, new
 * roles by their place in the list. A field outside the step's set, or the
 * same as the member already has, is no suggestion.
 */
export function suggestionsFrom(
  step: RoleGuideStep,
  current: ProposalBody,
  proposed: Partial<ProposalBody>,
  problems: ReadonlyArray<{ field: string; sentence: string }>,
  ctx: Pick<RoleGuideContext, "roles" | "swap">,
  sentences: readonly string[],
): GuideSuggestion[] {
  const out: GuideSuggestion[] = [];
  const fields = new Set(GUIDE_FIELDS[step]);
  const problemAt = (path: string) => problems.find((p) => p.field === path || p.field.startsWith(`${path}.`))?.sentence ?? null;
  const push = (path: string, role: string | null, field: string, was: Words, now: Words) => {
    if (now === null || sameWords(was, now)) return;
    const words = swapWords(now, ctx.swap);
    out.push({ path, role, field, words, source: sourceFor(words, sentences), problem: problemAt(path) });
  };
  const roleName = (key: string) => ctx.roles.find((r) => r.key === key)?.name ?? null;

  if (step === "words") {
    (proposed.roles ?? []).forEach((p) => {
      const i = current.roles.findIndex((r) => r.roleId === p.roleId);
      if (i < 0) return;
      const key = `roles.${i}`;
      const known = ctx.roles.find((r) => r.key === key);
      const was = { ...(known?.words ?? {}) } as Record<string, unknown>;
      for (const [field, value] of Object.entries(p.words ?? {})) {
        if (fields.has(field)) push(`${key}.words.${field}`, roleName(key), field, asWords(was[field]), asWords(value));
      }
    });
    (proposed.newRoles ?? []).forEach((n, i) => {
      if (i >= current.newRoles.length) return;
      const key = `newRoles.${i}`;
      const was = current.newRoles[i].words as Record<string, unknown>;
      for (const [field, value] of Object.entries(n.words ?? {})) {
        if (fields.has(field)) push(`${key}.words.${field}`, roleName(key), field, asWords(was[field]), asWords(value));
      }
    });
  } else if (proposed.season) {
    push("season.aim", null, "aim", asWords(current.season.aim), asWords(proposed.season.aim));
    push("season.seasonalGoals", null, "seasonalGoals", asWords(current.season.seasonalGoals), asWords(proposed.season.seasonalGoals));
  }
  return out;
}

/**
 * What is missing or weak, most important first, for the guide's one
 * question. The village's own flags lead; then the step's empty fields, in the
 * card's order. PURE.
 */
export function gapsOf(step: RoleGuideStep, ctx: Pick<RoleGuideContext, "roles" | "checks" | "season">): string[] {
  const gaps = ctx.checks.map((f) => f.sentence);
  if (step === "season") {
    if (!ctx.season.aim) gaps.push("The season has no aim yet.");
    if (!ctx.season.seasonalGoals.length) gaps.push("The season has no goals yet.");
    return gaps;
  }
  const key = ["aim", "domain", "accountabilities", "authorities", "timeCommitment"];
  for (const r of ctx.roles) {
    for (const f of key) {
      const v = asWords(r.words[f]);
      if (v === null || (Array.isArray(v) && v.length === 0)) gaps.push(`${r.name} has no ${f} yet.`);
    }
  }
  return gaps;
}

/** The conversation, trimmed to what one turn carries: the newest turns, each clipped. PURE. */
export function trimConversation(lines: unknown): GuideLine[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l): l is GuideLine => !!l && (l.from === "guide" || l.from === "member") && typeof l.text === "string")
    .map((l) => ({ from: l.from, text: l.text.slice(0, GUIDE_ANSWER_MAX) }))
    .slice(-GUIDE_TURNS_MAX);
}

/** The document as one turn carries it: clipped, or null when there is none. PURE. */
export function clipDocument(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, GUIDE_DOCUMENT_MAX) : null;
}

/** Everything a guide is handed for one turn, already named by role. PURE. */
export function guideBrief(step: RoleGuideStep, cardText: string, ctx: RoleGuideContext, document: string | null, conversation: readonly GuideLine[]) {
  return {
    step,
    card: cardText,
    member: { roles: ctx.memberRoles },
    circles: ctx.circles,
    seasonGoalsOfTheOrg: ctx.orgGoals,
    accomplished: ctx.accomplished,
    checks: ctx.checks.map((c) => c.sentence),
    missing: gapsOf(step, ctx),
    document: document ? ctx.swap(document) : null,
    conversation: conversation.map((l) => ({ from: l.from, text: ctx.swap(l.text) })),
  };
}

/**
 * The village guide's instructions for this turn. The outside agent is sent
 * the same brief and is expected to honour the same rules.
 */
export function guideSystemPrompt(guideName: string, village: string): string {
  return [
    `You are ${guideName}, helping a member of ${village} write the role card they are proposing for next season.`,
    "You are given their card in the village's role card text format, what the village already knows, the village's own checks, what is missing, and sometimes a document the member wrote about their role.",
    "Return the WHOLE card in exactly the same text format, with your suggestions written into it. Keep every line you have no better words for exactly as it is.",
    "Suggest from the document first, then from what the village knows. Never invent work the member did not describe.",
    "Then ask exactly ONE question, about the first thing in `missing` that the document did not answer. If nothing is missing, ask nothing.",
    "House rules for every word you write: plain words; say role, never seat; no dashes of any kind between words; never the pattern 'not X but Y'; never a person's name, only the role's title; one sentence per line in a list; keep each list line under 200 characters; a role answers for 3 to 6 things.",
    "You only suggest. The member accepts each line themselves, and you never save or submit anything.",
    'Reply with JSON only: {"card": "<the whole card text>", "question": "<one question, or empty>"}',
  ].join("\n");
}
