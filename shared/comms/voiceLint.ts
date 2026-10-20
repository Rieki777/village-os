/**
 * THE VOICE CHECK the Words editor runs on every subject, preheader and body
 * (the comms build spec 5.5), with the same rules the repository holds its
 * own shipped words to.
 *
 * THE LISTS ARE COPIES OF `scripts/check-voice.mjs`, AND A TEST HOLDS THEM
 * THERE. That script is a build tool and cannot be bundled into the admin
 * screen, so the dash rule, the filler words, the contrast frames, the
 * passive-inspiration phrases and the rhetorical openers are restated here,
 * and `shared/comms/voiceLint.test.ts` imports the script and fails the day the
 * two lists differ by a single word. Change the script, then change this.
 *
 * TWO MORE THINGS THE GATE CANNOT SEE, both from the voice profile: "unlock"
 * and "navigate" used as a metaphor, which the profile lists and the gate does
 * not; and a hyphen with a space on each side, which is an em-dash in
 * disguise. They are advice here like everything else.
 *
 * ADVICE, NEVER A REFUSAL. A village's words are its own. The check says what
 * it found and why, and saving still works: the platform's voice is the
 * default, and a founder who wants to write differently may.
 *
 * Pure and isomorphic.
 */

/**
 * The filler words `scripts/check-voice.mjs` refuses in shipped copy. Kept
 * identical by a test. Each line carries the gate's waiver, because the gate
 * reads string literals and these are the words it exists to catch.
 */
export const AI_WORDS = [
  "delve", "tapestry", "foster", "leverage", "vibrant", "crucial", // voice-ok: the gate's own list, restated for the Words editor
  "groundbreaking", "transformative", "testament to", "beacon", "unleash", // voice-ok: the gate's own list, restated for the Words editor
  "seamless", "robust", "comprehensive", "cutting-edge", "empower", // voice-ok: the gate's own list, restated for the Words editor
  "utilize", "in conclusion", "it's worth noting", "embark on", "delves", // voice-ok: the gate's own list, restated for the Words editor
];

/** Contrast framing: "not X but Y" in its shapes. Kept identical by a test. */
export const CONTRAST = [
  /\bnot just .{1,60}? but\b/i,
  /\bnot only .{1,60}? but\b/i,
  /\bisn'?t about .{1,60}?,? it'?s\b/i,
  /\bis not .{1,60}?,? (?:it'?s|but)\b/i,
  /\bless .{1,40}?, more\b/i,
  /\brather than\b/i,
  /\bnot .{1,40}?, but\b/i,
];

/** Passive inspiration: a feeling where a fact should be. Kept identical by a test. */
export const PASSIVE = [
  /\bjoin us on\b/i, /\bbe part of something\b/i, /\bjourney together\b/i,
  /\bcome along on\b/i, /\bpart of the journey\b/i, /\btogether we can\b/i,
];

/** A question opening a paragraph as filler. Kept identical by a test. */
export const RHETORICAL = /^\s*(what if we could|have you ever|imagine if|ever wondered)/i;

/** The voice profile's words that the repository gate does not hold. */
export const PROFILE_WORDS = ["unlock", "navigate"];

export type VoiceRule = "dash" | "filler-word" | "contrast" | "passive" | "rhetorical-opener";

export interface VoiceFinding {
  rule: VoiceRule;
  /** Where it was found: `subject`, `preheader` or `body`. */
  where: string;
  /** The words that tripped it. */
  match: string;
  /** What to do instead, in one sentence. */
  hint: string;
}

const HINTS: Record<VoiceRule, string> = {
  dash: "Use a comma, a period or a colon, or say it as two sentences.",
  "filler-word": "Say the specific thing this word is standing in for.",
  contrast: "Say what it is. Leave out what it is not.",
  passive: "Say something specific that happens, or leave the line out.",
  "rhetorical-opener": "Start with the thing itself.",
};

const escapeForRe = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Words with the parts nobody reads taken out: a link keeps its words and loses
 * its address, a bare address goes, and a merge token becomes a plain word, so
 * "leverage" inside a URL is never reported as prose.
 */
function readable(text: string): string {
  return String(text ?? "")
    .replace(/!?\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\{\{[^}]*\}\}/g, "it");
}

/** Every finding in one piece of words. */
export function voiceLint(text: string, where = "body"): VoiceFinding[] {
  const words = readable(text);
  const found: VoiceFinding[] = [];
  const push = (rule: VoiceRule, match: string) => found.push({ rule, where, match: match.trim().slice(0, 80), hint: HINTS[rule] });

  for (const m of Array.from(words.matchAll(/[\u2014\u2013]/g))) push("dash", m[0]);
  // Spaces and tabs only: a newline before a hyphen is a list starting, not a dash.
  for (const m of Array.from(words.matchAll(/\S[ \t]+-[ \t]+\S/g))) push("dash", m[0]);

  const low = words.toLowerCase();
  for (const w of [...AI_WORDS, ...PROFILE_WORDS]) {
    const re = new RegExp(`(?<![a-z])${escapeForRe(w)}(?![a-z])`, "g");
    for (const m of Array.from(low.matchAll(re))) push("filler-word", m[0]);
  }
  for (const re of CONTRAST) {
    const m = words.match(re);
    if (m) push("contrast", m[0]);
  }
  for (const re of PASSIVE) {
    const m = words.match(re);
    if (m) push("passive", m[0]);
  }
  // Each paragraph can open with a question, so each is checked on its own.
  for (const para of words.split(/\n\s*\n/)) {
    if (RHETORICAL.test(para)) push("rhetorical-opener", para.trim().slice(0, 50));
  }
  return found;
}

/** Every finding in one email's words. */
export function voiceLintWords(words: { subject: string; preheader?: string | null; bodyMd: string }): VoiceFinding[] {
  return [
    ...voiceLint(words.subject, "subject"),
    ...voiceLint(words.preheader ?? "", "preheader"),
    ...voiceLint(words.bodyMd, "body"),
  ];
}
