/**
 * THE ONE LINE A MEMBER READS BEFORE THEIR WORDS FIRST GO TO A MODEL, AND
 * THEIR YES TO IT (plan 5.4, "Consent before any document reaches a model
 * provider"; Wave 4, 2026-09-28).
 *
 * The member companion (`POST /api/agent/ask`, server/routes/companion.ts)
 * answers from the record for nothing and with no model. To answer in its own
 * words it sends the member's question, the member's own note if they put it
 * at the assistant tier, and the village's words it read for them to a model
 * provider, through whoever holds the key. Before that happens the first
 * time, the member reads one line naming both, and says yes.
 *
 * ── WHO IS NAMED ───────────────────────────────────────────────────────────
 *
 *   the member's own key   their provider, on "your own key"
 *   the village's own key  Anthropic, on the village's own key
 *   a borrowed key         Anthropic, on a key the operator shares with the
 *                          village. The operator's name comes from
 *                          `PLATFORM_ASSISTANT_OPERATOR`, set at provisioning
 *                          by whoever holds that key (docs/FORK_RUNBOOK.md).
 *                          Unset, the line says the operator is not named on
 *                          this deployment, which is true, and a member can
 *                          decline on that.
 *
 * ── A YES IS TO ONE LINE ───────────────────────────────────────────────────
 *
 * The consent is stored with the provider, the operator and the kind of key
 * it was given for. A village that moves from a borrowed key to its own, or a
 * member who adds their own, is a different line, and the member is asked
 * again. A yes to one operator never carries to another.
 *
 * ── WHERE IT LIVES ─────────────────────────────────────────────────────────
 *
 * `users.prefs`, under `companionConsent`, the way `sheetSeen` lives there
 * (server/lib/sheetSeen.ts says why no migration). The route writes it through
 * `members.update`, which locks the row. The general preferences route merges
 * only named keys into prefs, so a member cannot forge this one through it,
 * and the erasure path clears prefs whole.
 */
import type { KeySource } from "./assistant";

export const CONSENT_PREFS_KEY = "companionConsent";
/** How many different lines one member's yes is kept for. The oldest falls off. */
export const MAX_CONSENTS = 10;

export interface CompanionDisclosure {
  /** Who runs the model, as the member reads it. */
  provider: string;
  /** Who holds the key: "you", the village's name, the named operator, or "" when unnamed. */
  operator: string;
  /** Which kind of key, so a yes to the village's key is not a yes to a borrowed one. */
  source: KeySource;
  /** The one line. */
  sentence: string;
}

export interface CompanionConsent {
  provider: string;
  operator: string;
  source: KeySource;
  at: string;
}

/** The member's own key, as far as the line needs it. */
export interface MemberKeyFacts {
  provider: string;
  baseUrl?: string | null;
}

function hostOf(url: string | null | undefined): string {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}

/**
 * The line for the key that would answer. `source` is `resolveKey`'s answer
 * (server/lib/assistant.ts); `villageName` is the village's own name.
 * `carries.note` is true when the member's own note would ride in the prompt
 * (`aboutMeForAssistant`), and the line then names it: the note is the
 * member's own writing and goes upstream with the question (first review of
 * the companion lane). The wording is not part of what a yes is keyed on.
 */
export function companionDisclosure(
  source: KeySource,
  memberKey: MemberKeyFacts | null,
  villageName: string,
  env: NodeJS.ProcessEnv = process.env,
  carries: { note?: boolean } = {},
): CompanionDisclosure {
  const village = villageName.trim() || "this village";
  let provider = "Anthropic";
  let operator: string;
  let key: string;
  if (source === "member") {
    if (memberKey?.provider === "openai_compatible") {
      const host = hostOf(memberKey.baseUrl);
      provider = host ? `the service at ${host}` : "the service your key names";
    }
    operator = "you";
    key = "your own key";
  } else if (source === "village") {
    operator = village;
    key = `${village}'s own key`;
  } else {
    operator = String(env.PLATFORM_ASSISTANT_OPERATOR ?? "").trim().slice(0, 120);
    key = operator
      ? `a key ${operator} shares with ${village}`
      : "a shared key whose operator is not named on this deployment";
  }
  return {
    provider,
    operator,
    source,
    sentence: `To answer in its own words, the guide sends your question, ${carries.note ? "your note to your agent, " : ""}and what it reads from the village's record for you, to ${provider}, on ${key}.`,
  };
}

/** Whatever is in prefs, read as a list of consents. Anything unreadable is dropped. */
export function readConsents(prefs: unknown): CompanionConsent[] {
  const raw = (prefs as Record<string, unknown> | null | undefined)?.[CONSENT_PREFS_KEY];
  if (!Array.isArray(raw)) return [];
  const out: CompanionConsent[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o.provider !== "string" || typeof o.operator !== "string" || typeof o.at !== "string") continue;
    if (o.source !== "member" && o.source !== "village" && o.source !== "platform") continue;
    out.push({ provider: o.provider, operator: o.operator, source: o.source, at: o.at });
  }
  return out;
}

function sameLine(c: { provider: string; operator: string; source: KeySource }, d: { provider: string; operator: string; source: KeySource }): boolean {
  return c.provider === d.provider && c.operator === d.operator && c.source === d.source;
}

/** The member's yes to exactly this line, or null. */
export function consentFor(prefs: unknown, d: CompanionDisclosure): CompanionConsent | null {
  return readConsents(prefs).find((c) => sameLine(c, d)) ?? null;
}

/** Prefs with a yes to this line added, newest last, capped. Returns a new object. */
export function withConsent(prefs: unknown, d: CompanionDisclosure, at: string): Record<string, unknown> {
  const base = prefs && typeof prefs === "object" && !Array.isArray(prefs) ? { ...(prefs as Record<string, unknown>) } : {};
  const kept = readConsents(base).filter((c) => !sameLine(c, d));
  kept.push({ provider: d.provider, operator: d.operator, source: d.source, at });
  base[CONSENT_PREFS_KEY] = kept.slice(-MAX_CONSENTS);
  return base;
}

/** Prefs with every yes taken back. Returns a new object. */
export function withoutConsents(prefs: unknown): Record<string, unknown> {
  const base = prefs && typeof prefs === "object" && !Array.isArray(prefs) ? { ...(prefs as Record<string, unknown>) } : {};
  delete base[CONSENT_PREFS_KEY];
  return base;
}
