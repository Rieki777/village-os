/**
 * DISCOVER, THE FIRST STEP OF THE ROLE DRAFT BOARD (role journey, lane L3).
 *
 * Two doors side by side: "Your R-Ikigai" and "Pick your characters", then an
 * optional "Add your Human Design or Gene Keys". This file is the pure half of
 * the first and the third. The characters door is shared/roleDraft.ts.
 *
 * R-IKIGAI. Four short prompts. The answers live in this browser beside the
 * draft, under IKIGAI_KEY, written and read through client/src/lib/safeStorage.ts.
 * What comes back is anyone's to have edited, so it is re-read through
 * `ikigaiFromStored`: strings only, trimmed, each capped. One tick carries the
 * answers into "Why you" on the open form as ordinary words the person can
 * edit; nothing else of them is ever sent, and they are never kept on an
 * application.
 *
 * HUMAN DESIGN AND GENE KEYS are self-knowledge. They are read in the browser,
 * mapped to characters here, and go nowhere: not to an application, not to
 * anyone deciding, not into any selection. The MAPPING from a type or a line to
 * characters belongs to the village (an `app_config` document stewards edit,
 * under MAPPING_KEY). The platform ships none, so with no mapping the step
 * explains itself and suggests nothing.
 *
 * Pure: no clock, no pool, no browser.
 */
import { OPEN_WHY_MAX } from "./openProposals";

/** The four circles, in the order the guide page keeps them (shared/pageContent/coCreatorsGuide.ts). */
export const IKIGAI_IDS = ["love", "good", "needs", "pays"] as const;
export type IkigaiId = (typeof IKIGAI_IDS)[number];

/** Where the answers are kept in the browser. Versioned, so a later shape can start clean. */
export const IKIGAI_KEY = "village.roleIkigai.v1";

/** The longest answer kept. Four of them, with their labels, still fit "Why you" (OPEN_WHY_MAX). */
export const IKIGAI_ANSWER_MAX = 240;

export type IkigaiAnswers = Record<IkigaiId, string>;

export interface IkigaiState {
  answers: IkigaiAnswers;
  /** The person's tick: carry the answers into "Why you". */
  carry: boolean;
}

export const EMPTY_IKIGAI: IkigaiState = { answers: { love: "", good: "", needs: "", pays: "" }, carry: false };

/**
 * The neutral prompts every village starts with. A village writes its own in
 * Admin, Pages (the `ask` of each circle on the guide page), so its words stay
 * village data and never platform code.
 */
export const IKIGAI_ASK_DEFAULTS: Record<IkigaiId, string> = {
  love: "What would you do even if nobody paid you?",
  good: "What do people come to you for?",
  needs: "Where do you see a need you could fill?",
  pays: "Which open work calls you?",
};

/** Short labels used when the answers are carried into "Why you". */
export const IKIGAI_LABELS: Record<IkigaiId, string> = {
  love: "What I love",
  good: "What I am good at",
  needs: "What I see the village needs",
  pays: "The work that calls me",
};

export const DISCOVER_WORDS = {
  ikigaiDoor: "Your R-Ikigai",
  charactersDoor: "Pick your characters",
  optionalDoor: "Add your Human Design or Gene Keys",
  kept: "Your answers stay in this browser. Nothing is sent unless you tick the box below or press Ask the guide.",
  carry: "Copy my answers into Why you, in my application. The people deciding will read them there.",
  askGuide: "Ask the guide",
  aiLabel: "AI suggestion",
  guideNote: "Only your four answers and the open role names go to the guide, and only now. Nothing is saved, and nobody deciding sees it.",
  signInToAsk: "Sign in to ask the guide.",
  noMapping:
    "This village has not yet said which characters a Human Design type or a Gene Keys line points toward, so nothing is suggested. You can still read your own chart here. It stays on this device, and no application ever carries it.",
  private: "Private to you. It is never put on an application, never shown to anyone deciding, and never used to choose anyone.",
} as const;

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** What is stored, made safe to use. Anything unreadable is empty. */
export function ikigaiFromStored(v: unknown): IkigaiState {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const a = o.answers && typeof o.answers === "object" ? (o.answers as Record<string, unknown>) : {};
  const answers = Object.fromEntries(IKIGAI_IDS.map((id) => [id, text(a[id], IKIGAI_ANSWER_MAX)])) as IkigaiAnswers;
  return { answers, carry: o.carry === true };
}

/** Whether any answer has words. */
export function hasIkigai(s: IkigaiState): boolean {
  return IKIGAI_IDS.some((id) => s.answers[id] !== "");
}

/** One answer kept to its cap while typing, spaces left alone so a space can be typed. */
export function clipAnswer(v: string): string {
  return v.slice(0, IKIGAI_ANSWER_MAX);
}

/**
 * The words that go into "Why you" when the person ticked. Empty unless they
 * ticked and wrote something, and never longer than the field allows.
 */
export function whyFromIkigai(s: IkigaiState): string {
  if (!s.carry) return "";
  const lines = IKIGAI_IDS.filter((id) => s.answers[id]).map((id) => `${IKIGAI_LABELS[id]}: ${s.answers[id]}`);
  return lines.join("\n").slice(0, OPEN_WHY_MAX);
}

// ── The village's mapping ──────────────────────────────────────────────────

/** The `app_config` key stewards edit. */
export const MAPPING_KEY = "role-discover-mapping";

const KEY_MAX = 60;
const CHARS_PER_KEY = 8;
const KEYS_MAX = 24;

export interface DiscoverMapping {
  /** A Human Design type, by name, to character keys. */
  humanDesign: Record<string, string[]>;
  /** A Gene Keys profile line, "1" to "6", to character keys. */
  lines: Record<string, string[]>;
}

export const EMPTY_MAPPING: DiscoverMapping = { humanDesign: {}, lines: {} };

function table(v: unknown, keyOk: (k: string) => boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= KEYS_MAX) break;
    const key = k.trim().slice(0, KEY_MAX);
    if (!key || !keyOk(key) || !Array.isArray(list)) continue;
    const chars: string[] = [];
    for (const c of list) {
      const id = typeof c === "string" ? c.trim().slice(0, KEY_MAX) : "";
      if (id && !chars.includes(id)) chars.push(id);
      if (chars.length >= CHARS_PER_KEY) break;
    }
    if (chars.length) out[key] = chars;
  }
  return out;
}

/** A stored or posted mapping, read strictly. Unknown keys and non-strings drop out. */
export function parseMapping(v: unknown): DiscoverMapping {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { humanDesign: table(o.humanDesign, () => true), lines: table(o.lines, (k) => /^[1-6]$/.test(k)) };
}

/** Whether the village has said anything at all. */
export function mappingIsEmpty(m: DiscoverMapping): boolean {
  return Object.keys(m.humanDesign).length === 0 && Object.keys(m.lines).length === 0;
}

/**
 * Characters a type and lines point toward, in the village's words. Only
 * characters in `cast` are kept. With no mapping this is empty, always.
 */
export function suggestCharacters(m: DiscoverMapping, have: { type?: string | null; lines?: readonly number[] }, cast: readonly string[]): string[] {
  const out: string[] = [];
  const add = (list: string[] | undefined) => {
    for (const c of list ?? []) if (cast.includes(c) && !out.includes(c)) out.push(c);
  };
  if (have.type) add(m.humanDesign[have.type]);
  for (const l of have.lines ?? []) add(m.lines[String(l)]);
  return out;
}

// ── The guide ──────────────────────────────────────────────────────────────

/** What the page may send the guide: the answers and the open roles' names. Nothing else. */
export const GUIDE_ROLES_MAX = 40;
export const GUIDE_NAME_MAX = 80;
export const GUIDE_AIM_MAX = 160;

export interface GuideRoleIn {
  id: string;
  name: string;
  aim: string;
}

export interface GuideSuggestionOut {
  roleId: string;
  why: string;
}

/** The request body, read strictly. Null when there is nothing to ask about. */
export function parseGuideAsk(body: unknown): { answers: IkigaiAnswers; roles: GuideRoleIn[] } | null {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const answers = ikigaiFromStored({ answers: o.answers }).answers;
  const roles: GuideRoleIn[] = [];
  for (const r of Array.isArray(o.roles) ? o.roles : []) {
    const id = text((r as any)?.id, 120);
    const name = text((r as any)?.name, GUIDE_NAME_MAX);
    if (!id || !name || roles.some((x) => x.id === id)) continue;
    roles.push({ id, name, aim: text((r as any)?.aim, GUIDE_AIM_MAX) });
    if (roles.length >= GUIDE_ROLES_MAX) break;
  }
  if (!hasIkigai({ answers, carry: false }) || roles.length === 0) return null;
  return { answers, roles };
}
