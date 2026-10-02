/**
 * One sitting with the journal, as plain data: which practice, how deep, what
 * has been written so far, and where in the flow the member is. No React in
 * here, so the flow's rules can be tested without rendering anything.
 *
 * The questions and their words come from shared/journal.ts and nowhere else.
 * The prompt a member SAW is what gets saved beside their answer, with the
 * village's name already filled in, so an old entry reads right after a
 * question is reworded.
 */
import {
  JOURNAL_ANSWER_MAX,
  JOURNAL_ANSWERS_MAX,
  JOURNAL_REFLECTION_MAX,
  PULSE_METRICS,
  fillVillage,
  isJournalDepth,
  isJournalPractice,
  questionsFor,
  type GuideMessage,
  type JournalAnswer,
  type JournalDepth,
  type JournalEntryInput,
  type JournalPractice,
  type PulseScores,
} from "@shared/journal";
import { readStoredJson, removeStored, writeStoredJson } from "@/lib/safeStorage";

/** A question the guide offered and the member chose to answer. */
export interface ExtraQuestion {
  key: string;
  prompt: string;
}

export interface Sitting {
  clientId: string;
  practice: JournalPractice;
  depth: JournalDepth;
  /** Index into `stepsFor(...)`. */
  step: number;
  /** Answer text by question key, extras included. */
  texts: Record<string, string>;
  extras: ExtraQuestion[];
  scores: PulseScores;
  /** Debrief only: which call this was about. */
  call: string;
  /** Debrief only: would they decide it the same way elsewhere. Null is unsaid. */
  portable: boolean | null;
  /** The guide's reflection once the member confirmed it, or "". */
  reflection: string;
  guide: GuideMessage[];
  startedAt: string;
}

export type Step =
  | { kind: "metric"; key: string; prompt: string; min: number; max: number; ends: [string, string] }
  | { kind: "question"; key: string; prompt: string; hint?: string; extra: boolean }
  | { kind: "review" };

export function newSitting(practice: JournalPractice, depth: JournalDepth, clientId: string): Sitting {
  return {
    clientId,
    practice,
    depth,
    step: 0,
    texts: {},
    extras: [],
    scores: {},
    call: "",
    portable: null,
    reflection: "",
    guide: [],
    startedAt: new Date().toISOString(),
  };
}

/**
 * Every step of a sitting, in order: the pulse's five numbers first (pulse
 * only), then the questions for this depth, then any the guide added, then
 * the review.
 */
export function stepsFor(s: Pick<Sitting, "practice" | "depth" | "extras">, village: string): Step[] {
  const out: Step[] = [];
  if (s.practice === "pulse") {
    for (const m of PULSE_METRICS) {
      out.push({ kind: "metric", key: m.key, prompt: fillVillage(m.prompt, village), min: m.min, max: m.max, ends: m.ends });
    }
  }
  for (const q of questionsFor(s.practice, s.depth)) {
    out.push({
      kind: "question",
      key: q.key,
      prompt: fillVillage(q.prompt, village),
      hint: q.hint ? fillVillage(q.hint, village) : undefined,
      extra: false,
    });
  }
  for (const x of s.extras) out.push({ kind: "question", key: x.key, prompt: x.prompt, extra: true });
  out.push({ kind: "review" });
  return out;
}

/** Morning before noon, evening from six. Between the two, no suggestion. */
export function suggestedPractice(hour: number): JournalPractice | null {
  if (hour < 12) return "morning";
  if (hour >= 18) return "evening";
  return null;
}

/** A key for a guide-added question that no shipped question uses. */
export function extraKey(s: Pick<Sitting, "extras">): string {
  return `guide-${s.extras.length + 1}`;
}

/** The answers worth saving: non-empty, clipped to what the store keeps. */
export function answersOf(s: Sitting, village: string): JournalAnswer[] {
  const out: JournalAnswer[] = [];
  for (const step of stepsFor(s, village)) {
    if (step.kind !== "question") continue;
    const text = (s.texts[step.key] ?? "").trim();
    if (!text) continue;
    out.push({ questionKey: step.key, prompt: step.prompt, text: text.slice(0, JOURNAL_ANSWER_MAX) });
  }
  return out.slice(0, JOURNAL_ANSWERS_MAX);
}

/** True once there is anything at all to keep. */
export function hasContent(s: Sitting, village: string): boolean {
  return answersOf(s, village).length > 0 || Object.keys(s.scores).length > 0;
}

/** The entry this sitting saves as. `now` is when the member pressed Save. */
export function entryFrom(s: Sitting, village: string, now: Date = new Date()): JournalEntryInput {
  const entry: JournalEntryInput = {
    clientId: s.clientId,
    practice: s.practice,
    depth: s.depth,
    answers: answersOf(s, village),
    writtenAt: now.toISOString(),
    localHour: now.getHours(),
    reflection: s.reflection.trim() ? s.reflection.trim().slice(0, JOURNAL_REFLECTION_MAX) : null,
  };
  if (s.practice === "pulse" && Object.keys(s.scores).length > 0) entry.scores = { ...s.scores };
  if (s.practice === "debrief") {
    const meta: NonNullable<JournalEntryInput["meta"]> = {};
    if (s.call.trim()) meta.call = s.call.trim();
    if (s.portable !== null) meta.portable = s.portable;
    if (Object.keys(meta).length > 0) entry.meta = meta;
  }
  return entry;
}

// ── The draft, kept on the device while a sitting is open ──────────────────

const draftKey = (owner: string) => `village.journal.draft.${owner}`;

function isSitting(v: unknown): v is Sitting {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<Sitting>;
  return (
    typeof s.clientId === "string" &&
    isJournalPractice(s.practice) &&
    isJournalDepth(s.depth) &&
    typeof s.step === "number" &&
    !!s.texts && typeof s.texts === "object" &&
    Array.isArray(s.extras) &&
    !!s.scores && typeof s.scores === "object" &&
    Array.isArray(s.guide)
  );
}

/** The open sitting this member left on this device, if any. */
export function readDraft(owner: string): Sitting | null {
  const read = readStoredJson("local", draftKey(owner));
  if (read.status !== "value" || !isSitting(read.value)) return null;
  const s = read.value;
  return { ...newSitting(s.practice, s.depth, s.clientId), ...s };
}

export function writeDraft(owner: string, s: Sitting): void {
  writeStoredJson("local", draftKey(owner), s);
}

export function clearDraft(owner: string): void {
  removeStored("local", draftKey(owner));
}
