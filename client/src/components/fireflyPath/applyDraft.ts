/**
 * THE APPLICATION'S SAVED DRAFT (the lead, 11 Nov 2026: "Back keeps what was
 * entered, and progress is saved").
 *
 * A draft lives in this browser only, one per role and per link, so somebody
 * can leave and come back to the step they were on. What it keeps is the
 * applicant's own words. What it never keeps, by rule:
 *   - references (other people's names and contacts) and the background-check
 *     consent: third-party data stays on the screen until it is sent;
 *   - files, which a browser cannot store safely anyway;
 *   - the agreements and the membership alignment, which are asked fresh.
 * A draft older than DRAFT_DAYS is ignored, and a sent application clears it.
 *
 * Pure: the page reads and writes through lib/safeStorage, and a test reads
 * every rule here without drawing a page.
 */
import type { ProposalLink } from "@shared/proposalAttachments";
import type { ProposalGoal } from "@shared/proposalGoals";
import type { TermAnswers } from "@shared/termsWords";
import type { DraftMarks } from "@shared/seraDrafts";

export const DRAFT_VERSION = 1;
export const DRAFT_DAYS = 30;

/** The key a draft is kept under: the role, and the personal link when there is one. */
export function draftKey(roleId: string, link: string): string {
  return `apply-draft:v${DRAFT_VERSION}:${link ? `link:${link.slice(0, 100)}` : "public"}:${roleId}`;
}

export interface ApplyDraft {
  savedAt: string;
  step: number;
  reached: number;
  knowUs: string[];
  why: string;
  name: string;
  email: string;
  about: { based: string; languages: string; story: string };
  selfKnowledge: string;
  links: ProposalLink[];
  aim: string;
  items: ProposalGoal[];
  marks: DraftMarks;
  terms: { answers: TermAnswers; commitmentPct: number | null };
  rampUp: boolean;
  practical: { timeZone: string; windows: string[]; earliestStart: string };
}

const str = (v: unknown, max = 4000): string => (typeof v === "string" ? v.slice(0, max) : "");
const strs = (v: unknown, n: number, max = 300): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.slice(0, max)).slice(0, n) : []);

/**
 * What is written: exactly the fields above, whatever else the page holds.
 * References, consent, files and agreements cannot reach it, because the type
 * has no place for them and this copies field by field.
 */
export function toDraft(d: Omit<ApplyDraft, "savedAt">, now: Date): ApplyDraft {
  return {
    savedAt: now.toISOString(),
    step: d.step,
    reached: d.reached,
    knowUs: [...d.knowUs],
    why: d.why,
    name: d.name,
    email: d.email,
    about: { based: d.about.based, languages: d.about.languages, story: d.about.story },
    selfKnowledge: d.selfKnowledge,
    links: d.links.map((l) => ({ label: l.label, url: l.url })),
    aim: d.aim,
    items: d.items.map((g) => ({ ...g })),
    marks: { ...(d.marks.aim ? { aim: d.marks.aim } : {}), ...(d.marks.story ? { story: d.marks.story } : {}) },
    terms: { answers: d.terms.answers, commitmentPct: d.terms.commitmentPct },
    rampUp: d.rampUp,
    practical: { timeZone: d.practical.timeZone, windows: [...d.practical.windows], earliestStart: d.practical.earliestStart },
  };
}

/** A stored draft read back, or null when there is none, it is unreadable, or it is older than DRAFT_DAYS. Never throws. */
export function fromDraft(raw: unknown, now: Date, lastStep: number): ApplyDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, any>;
  const at = Date.parse(str(o.savedAt, 40));
  if (!Number.isFinite(at) || now.getTime() - at > DRAFT_DAYS * 24 * 60 * 60_000) return null;
  const step = (n: unknown) => (typeof n === "number" && Number.isInteger(n) ? Math.max(0, Math.min(lastStep, n)) : 0);
  const items: ProposalGoal[] = Array.isArray(o.items)
    ? o.items
        .filter((g: unknown) => g && typeof g === "object")
        .slice(0, 8)
        .map((g: any) => ({ title: str(g.title, 160), doneWhen: str(g.doneWhen, 200), moves: "", serves: str(g.serves, 64), date: "", roleId: str(g.roleId, 128), ...(g.seraDraft === true ? { seraDraft: true } : {}) }))
    : [];
  const pct = o.terms?.commitmentPct;
  return {
    savedAt: new Date(at).toISOString(),
    step: step(o.step),
    reached: Math.max(step(o.step), step(o.reached)),
    knowUs: strs(o.knowUs, 8, 160),
    why: str(o.why, 1200),
    name: str(o.name, 120),
    email: str(o.email, 254),
    about: { based: str(o.about?.based, 200), languages: str(o.about?.languages, 200), story: str(o.about?.story, 300) },
    selfKnowledge: str(o.selfKnowledge, 300),
    links: Array.isArray(o.links) ? o.links.filter((l: any) => l && typeof l === "object").slice(0, 5).map((l: any) => ({ label: str(l.label, 80), url: str(l.url, 500) })) : [],
    aim: str(o.aim, 300),
    items,
    marks: { ...(str(o.marks?.aim, 300) ? { aim: str(o.marks.aim, 300) } : {}), ...(str(o.marks?.story, 300) ? { story: str(o.marks.story, 300) } : {}) },
    terms: { answers: o.terms?.answers && typeof o.terms.answers === "object" && !Array.isArray(o.terms.answers) ? o.terms.answers : {}, commitmentPct: typeof pct === "number" && Number.isInteger(pct) && pct >= 0 && pct <= 100 ? pct : null },
    rampUp: o.rampUp === true,
    practical: { timeZone: str(o.practical?.timeZone, 64), windows: strs(o.practical?.windows, 6, 40), earliestStart: str(o.practical?.earliestStart, 10) },
  };
}
