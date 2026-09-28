/**
 * THE FIVE FRAMES, THE PAGE'S HALF: the shapes GET /api/canvas/blocks/:id
 * sends, and every sentence the frames say about them (plan 2.3, "Five
 * frames"; Wave 3b, 2026-09-28). docs/canvas-api.md is the contract.
 *
 * Pure, so each sentence is tested on its own line, and so the components in
 * client/src/components/canvas/ never need to sift or count. The canvas copy
 * test (canvasCopy.test.ts) holds those components to R55 by forbidding the
 * shapes a count takes (`.filter(`, `.length}` and the rest). Anything that
 * picks some items out of a list lives here instead, and it only ever picks
 * within ONE block: nothing in this file compares blocks or adds them up.
 *
 * ── TELLING THE TRUTH ABOUT WHAT ADOPTING DOES ─────────────────────────────
 *
 * `adoptEffect` is the one place that says what pressing Adopt will do, by
 * pen and by moment. Before the Birthing a suggestion that names a setting
 * writes it; after it, a dial suggestion is filed as a proposal in its
 * author's name, and the consequence pen's vote is not built yet, which the
 * sentence says instead of offering a button that would be refused. The
 * server decides in the end (`pen` on each suggestion), and the page only
 * ever offers what `pen.youMayAdopt` says will work.
 */
import {
  CANVAS_DOORS,
  isAdminOnlySection,
  isCanvasDoorId,
  MODULE_DOOR_LIFECYCLES,
  penForProposal,
  type CanvasDoorId,
  type DialChange,
  type ExitTermsChange,
  type MatrixRowChange,
  type ModuleChange,
  type ProposalSource,
  type ProposalStatus,
  type ProposalTarget,
  type RestorativeChange,
} from "@shared/canvasFrames";
import type { CanvasBlockId } from "@shared/governanceCanvas";
import type { CanvasPen } from "@shared/powerHands";
import { readingDate } from "./canvasCopy";

// ── The frames ──────────────────────────────────────────────────────────────

export const FRAME_IDS = ["sense", "see", "learn", "say", "adopt"] as const;
export type FrameId = (typeof FRAME_IDS)[number];

/** Each frame's name and the one line under the frame buttons that says what it holds. */
export const FRAMES: Record<FrameId, { label: string; intro: string }> = {
  sense: {
    label: "Sense",
    intro: "How this block stands today, in one of the canvas's five words and a sentence. Every reading is kept, with who gave it and when.",
  },
  see: {
    label: "See",
    intro: "What the village's settings and records already show about this block. Each fact links to where it is changed.",
  },
  learn: {
    label: "Learn",
    intro: "Where to read up on this block before the village answers it.",
  },
  say: {
    label: "Say",
    intro: "The village's answer in its own words, and where anybody in the village can suggest a change to it.",
  },
  adopt: {
    label: "Adopt",
    intro: "Suggestions waiting for a decision: who made each one and when, what adopting it would do, and who decides.",
  },
};

// ── What GET /api/canvas/blocks/:id sends ──────────────────────────────────

/** Who adopts a suggestion, as the server words it for this viewer. */
export interface PenView {
  pen: CanvasPen;
  how: "act" | "ballot";
  who: "the-gate" | "admins" | "founders" | "any-member" | "live-holders";
  sentence: string;
  ballotBuilt: boolean;
  youMayAdopt: boolean;
}

export type SuggestionChange = DialChange | ModuleChange | ExitTermsChange | RestorativeChange | MatrixRowChange;

export interface ProposalView {
  id: number;
  blockId: CanvasBlockId;
  target: ProposalTarget;
  sectionId: string | null;
  door: string | null;
  change: SuggestionChange | null;
  body: string;
  /** Present only where the purpose line exists; null when none was given. */
  servesPurpose?: string | null;
  source: ProposalSource;
  proposedBy: { id: string; name: string };
  createdAt: string;
  status: ProposalStatus;
  decidedBy?: string | null;
  decisionNote?: string | null;
  decidedAt?: string | null;
  outcome?: Record<string, unknown> | null;
  pen: PenView;
  youProposedIt: boolean;
}

export type SectionStatus = "confirmed" | "proposed" | "blank" | "not-shared" | "admin-only";

export interface AnswerSection {
  id: string;
  title: string;
  readable: boolean;
  status: SectionStatus;
  body?: string;
  audience?: string;
  updatedAt?: string;
  revision?: number;
}

export interface ObservedFact {
  id: string;
  text: string;
  href: string;
  label: string;
}

export interface DoorView {
  id?: CanvasDoorId;
  label: string;
  href: string;
  kind?: "dial" | "exit-policy" | "module";
  why?: string;
  wired: boolean;
}

/** The keys a block's `pens` may carry. */
export type PenKey = "words" | "adminWords" | "purpose" | "dial" | "module" | "consequence";

export interface BlockFramesPayload {
  block: {
    id: CanvasBlockId;
    number: number;
    name: string;
    briefSections: readonly string[];
    elsewhere?: { note: string; href: string; label: string };
  };
  answer: {
    sections: AnswerSection[];
    /** The Purpose block only: the statement, or null when none is written. */
    purposeStatement?: { statement: string; writtenAt: string } | null;
  };
  observed: ObservedFact[];
  proposals: ProposalView[];
  doors: DoorView[];
  pens: Partial<Record<PenKey, PenView>>;
  birthed: boolean;
  servesPurpose: { scoped: boolean; matrixScoped: boolean; requiredToday: boolean };
  notesArePublic: string;
}

export interface MatrixRowView {
  id: number;
  subject: string;
  approval: string;
  consultation: string;
  information: string;
  method: string;
  riskTags: string[];
  updatedBy: { id: string; name: string };
  updatedAt: string;
}

export interface MatrixRowsPayload {
  rows: MatrixRowView[];
  pen: PenView;
  riskTagsAreInformation: string;
}

// ── Reading failures ────────────────────────────────────────────────────────

/** Why a read failed, in words, and whether asking again could help. A refusal gets the same answer twice. */
export function readFailure(status: number | null, error: unknown, noun: string): { message: string; retry: boolean } {
  if (status === 401 || error === "auth_required") return { message: `Sign in to read ${noun}.`, retry: false };
  if ((status === 403 || status === 404) && typeof error === "string" && error) return { message: error, retry: false };
  return { message: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} could not be read just now.`, retry: true };
}

/**
 * The sentence a refusal carries. Most routes put it in `error`; a few answer
 * with a code there and the sentence in `message` (`restorative_in_agreement`,
 * `unknown_role`), and a code is never shown to a member.
 */
export function refusalText(body: unknown, fallback: string): string {
  const b = (body ?? {}) as { error?: unknown; message?: unknown };
  const error = typeof b.error === "string" ? b.error.trim() : "";
  const message = typeof b.message === "string" ? b.message.trim() : "";
  const isCode = /^[a-z0-9_.:-]+$/.test(error);
  if (message && (isCode || !error)) return message;
  if (error && !isCode) return error;
  return message || fallback;
}

// ── Say: the answer as it stands ────────────────────────────────────────────

/** A section's state, said from the reader's side. Keyed by the union, so a new state cannot render as nothing. */
export const SECTION_STATUS_WORDS: Record<SectionStatus, string> = {
  confirmed: "Adopted",
  proposed: "A draft nobody has adopted yet",
  blank: "Nothing written yet",
  "not-shared": "Written, and not opened to members",
  "admin-only": "Kept with the administrators",
};

/** "Suggested by Sage on 3 October 2026", with where it came from when that was not a member. */
export function suggestedLine(p: Pick<ProposalView, "proposedBy" | "createdAt" | "source" | "youProposedIt">, locale?: string): string {
  const who = p.youProposedIt ? "you" : p.proposedBy.name || "a member";
  const by = p.source === "derived" ? `Drafted from the live system by ${who}` : p.source === "import" ? `Imported by ${who}` : `Suggested by ${who}`;
  return `${by} on ${readingDate(p.createdAt, locale)}`;
}

/** The words a module lifecycle is shown in. */
export const LIFECYCLE_WORDS: Record<ModuleChange["to"], string> = {
  off: "off",
  preview: "on for the administrators only",
  members: "on for members",
  public: "on for everybody, visitors included",
};

export const MODULE_LIFECYCLES = MODULE_DOOR_LIFECYCLES;

const doorOf = (door: string | null) => (door && isCanvasDoorId(door) ? CANVAS_DOORS[door] : null);

/** What a suggestion changes, as a heading. */
export function proposalHeadline(p: Pick<ProposalView, "target" | "sectionId" | "door" | "change">, sectionTitles: Record<string, string>): string {
  if (p.target === "words") return `Words for ${sectionTitles[String(p.sectionId)] ?? String(p.sectionId)}`;
  if (p.target === "purpose") return "The governing purpose statement";
  if (p.target === "matrix") {
    const row = p.change as MatrixRowChange | null;
    return row?.rowId ? `A change to a row of the Decision Matrix: ${row.subject}` : `A new row for the Decision Matrix: ${row?.subject ?? ""}`;
  }
  return doorOf(p.door)?.label ?? "A setting";
}

/** The change a suggestion carries, one line per field, in words. Empty for words and the purpose statement. */
export function changeLines(p: Pick<ProposalView, "target" | "door" | "change">): string[] {
  const c = (p.change ?? {}) as Record<string, unknown>;
  if (p.target === "matrix") {
    const row = c as unknown as MatrixRowChange;
    return [
      `Who approves it: ${row.approval}`,
      `Who is asked first: ${row.consultation}`,
      `Who is told: ${row.information}`,
      ...(row.method ? [`How it is decided: ${row.method}`] : []),
      ...((row.riskTags ?? []).length ? [`Risk tags: ${row.riskTags.join(", ")}`] : []),
    ];
  }
  if (p.target !== "setting") return [];
  const door = doorOf(p.door);
  if (door?.kind === "dial") return [`New value: ${String((c as unknown as DialChange).value ?? "")}`];
  if (door?.kind === "module") {
    const to = (c as unknown as ModuleChange).to;
    return [`Switched ${LIFECYCLE_WORDS[to] ?? to}`];
  }
  const out: string[] = [];
  if (door?.id === "exit:terms") {
    const t = c as ExitTermsChange;
    if (t.noticePeriodDays !== undefined) out.push(`Notice before leaving: ${t.noticePeriodDays} ${t.noticePeriodDays === 1 ? "day" : "days"}`);
    if (t.valuationMethod !== undefined) out.push(`How a departing member's contribution is valued: ${t.valuationMethod}`);
    if (t.unwindSteps !== undefined) out.push(`The steps of leaving: ${t.unwindSteps.join(" / ")}`);
    if (t.involuntaryProcess !== undefined) out.push(`When somebody is asked to leave: ${t.involuntaryProcess}`);
    return out;
  }
  const r = c as RestorativeChange;
  if (r.steps !== undefined) out.push(`The restorative steps: ${r.steps.join(" / ")}`);
  if (r.intakeContactRole !== undefined) out.push(r.intakeContactRole ? `The care role: ${r.intakeContactRole}` : "The care role: none");
  if (r.coverRole !== undefined) out.push(r.coverRole ? `The cover role: ${r.coverRole}` : "The cover role: none");
  if (r.replyHours !== undefined) out.push(r.replyHours === null ? "No promised reply time" : `A reply within ${r.replyHours} hours`);
  return out;
}

// ── Adopt: what pressing the button does ────────────────────────────────────

/**
 * What adopting this suggestion would do, today, said plainly. `birthed` is
 * the Birthing (the Game started), read by the server on this request.
 */
export function adoptEffect(p: Pick<ProposalView, "target" | "sectionId" | "door" | "change" | "pen" | "proposedBy" | "youProposedIt">, birthed: boolean, sectionTitles: Record<string, string>): string {
  const pen = p.pen;
  const notBuilt = "That vote is not built yet, so this suggestion stays open until it is.";
  if (p.target === "words") {
    return `Adopting writes these words into ${sectionTitles[String(p.sectionId)] ?? String(p.sectionId)} as the village's adopted answer.`;
  }
  if (p.target === "purpose") {
    return pen.how === "act"
      ? "Adopting writes this as the governing purpose statement."
      : "Every power is with the village now, so a new statement goes to a vote of the whole village, opened from Start a proposal with a line on how it serves the purpose.";
  }
  const door = doorOf(p.door);
  if (p.target === "setting" && door?.kind === "dial") {
    if (pen.how === "act") {
      return `The Game has not started, so adopting sets ${lowerFirst(door.label)} to ${String((p.change as DialChange | null)?.value ?? "")} straight away.`;
    }
    const whose = p.youProposedIt ? "your" : `${p.proposedBy.name || "its author"}'s`;
    return `The Game has started, so adopting files this as a proposal to change the Game's rules, in ${whose} name, and the village votes on it. Only the member who suggested it can file it.`;
  }
  if (p.target === "setting" && door?.kind === "module") {
    const to = LIFECYCLE_WORDS[(p.change as ModuleChange | null)?.to ?? "off"];
    if (pen.how === "act") {
      return birthed
        ? `Adopting switches this ${to} straight away. No vote can move the module a vote runs on, so it stays with the administrators after the Game starts.`
        : `The Game has not started, so adopting switches this ${to} straight away.`;
    }
    return pen.ballotBuilt
      ? `The Game has started, so adopting files this as a proposal in its author's name, and the village votes on it.`
      : `The Game has started, so this goes to a vote of the whole village. ${notBuilt}`;
  }
  // The consequence pen: the exit terms, the care door and the matrix.
  if (pen.how === "ballot") {
    if (door?.id === "exit:restorative") {
      return "The Game has started, so the care door changes only by a vote on the village's conflict agreement, which carries the whole agreement. Open that vote from the agreement itself.";
    }
    return `The Game has started, so this goes to a vote of the whole village at the structural tier. ${notBuilt}`;
  }
  if (p.target === "matrix") {
    return (p.change as MatrixRowChange | null)?.rowId
      ? "The Game has not started, so adopting changes this row of the Decision Matrix straight away."
      : "The Game has not started, so adopting adds this row to the Decision Matrix straight away.";
  }
  return door?.id === "exit:restorative"
    ? "The Game has not started, so adopting writes this into the exit policy's care door straight away, unless a conflict agreement already holds it."
    : "The Game has not started, so adopting writes this into the exit policy straight away.";
}

/** The Adopt button's words: what it does, in a few. */
export function adoptLabel(p: Pick<ProposalView, "target" | "door" | "pen">): string {
  if (p.target === "words") return "Adopt these words";
  if (p.target === "purpose") return "Adopt this statement";
  if (p.target === "matrix") return "Adopt this row";
  const door = doorOf(p.door);
  if (door?.kind === "dial" || door?.kind === "module") return p.pen.how === "ballot" ? "File it as a proposal" : "Adopt and change the setting";
  return "Adopt and write it into the exit policy";
}

/**
 * Whether this viewer is offered Adopt. The server's `youMayAdopt` says yes to
 * every member on a purpose statement once the village holds the pen, because
 * any member may open that vote; the vote is opened from the proposal wizard
 * and never from here (the adopt route answers 409 with its door), so the page
 * links there instead of offering a button that is refused.
 */
export function mayAdopt(p: Pick<ProposalView, "target" | "pen">): boolean {
  return p.pen.youMayAdopt && !(p.target === "purpose" && p.pen.how === "ballot");
}

/** The purpose statement goes to a vote from the proposal wizard: offered where adopting cannot carry it. */
export function opensPurposeVote(p: Pick<ProposalView, "target" | "pen">): boolean {
  return p.target === "purpose" && p.pen.how === "ballot";
}

/** Whether this viewer is offered Decline: the pen, acting alone, on somebody else's suggestion. */
export function mayDecline(p: Pick<ProposalView, "pen" | "youProposedIt">): boolean {
  return !p.youProposedIt && p.pen.how === "act" && p.pen.youMayAdopt;
}

/** The Adopt frame's opening line, which changes at the Birthing. */
export function adoptIntro(birthed: boolean): string {
  return birthed
    ? "The Game has started, so adopting a suggestion that names a setting files a proposal, and the village decides it. Where that vote is not built yet, the suggestion says so and stays open. Words are still adopted by whoever holds the pen."
    : "The Game has not started, so adopting a suggestion that names a setting writes the setting straight away, through that setting's own checks.";
}

/** The pens a block names, in a fixed order, without repeating a sentence. */
export function penSentences(pens: Partial<Record<PenKey, PenView>>): string[] {
  const order: PenKey[] = ["words", "adminWords", "purpose", "dial", "module", "consequence"];
  const out: string[] = [];
  for (const key of order) {
    const s = pens[key]?.sentence;
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Which of a block's pens covers a suggestion. */
export function penKeyFor(p: { target: ProposalTarget; sectionId?: string | null; door?: string | null }): PenKey {
  const byPen: Record<CanvasPen, PenKey> = {
    prose: "words",
    admin: "adminWords",
    purpose: "purpose",
    dial: "dial",
    module: "module",
    consequence: "consequence",
  };
  return byPen[penForProposal(p)];
}

// ── See: where the words and the settings part ──────────────────────────────

export interface GapFact {
  id: string;
  text: string;
  href?: string;
  label?: string;
}

/**
 * Where the village's words and its settings say different things, or where
 * one exists without the other, as plain facts. Nothing is graded: each is a
 * sentence the reader weighs. Only facts the page can know for certain are
 * here, and a sentence is never written about words the viewer may not read.
 */
export function gapFacts(payload: Pick<BlockFramesPayload, "block" | "answer" | "doors" | "proposals">): GapFact[] {
  const out: GapFact[] = [];
  const wired = payload.doors.filter((d) => d.wired);
  const readable = payload.answer.sections.filter((s) => s.readable);
  if (wired.length > 0) {
    const settings = wired.map((d) => lowerFirst(d.label));
    for (const s of readable) {
      if (s.status === "blank") {
        out.push({ id: `blank-${s.id}`, text: `Nothing is written yet under ${s.title}, while the settings behind this block already apply: ${listed(settings)}.` });
      } else if (s.status === "proposed") {
        out.push({ id: `draft-${s.id}`, text: `The words under ${s.title} are a draft nobody has adopted yet, while the settings behind this block already apply.` });
      }
    }
  }
  for (const s of payload.answer.sections) {
    if (s.status === "not-shared") {
      out.push({ id: `not-shared-${s.id}`, text: `Words under ${s.title} are written and not opened to members, so members read the settings without them.` });
    }
  }
  const purpose = payload.answer.purposeStatement;
  if (payload.block.id === "purpose" && purpose !== undefined) {
    const adopted = readable.filter((s) => s.status === "confirmed").map((s) => s.title);
    if (purpose === null && adopted.length > 0) {
      out.push({ id: "purpose-unwritten", text: `The village has adopted words under ${listed(adopted)}, and its governing purpose statement is not written yet.` });
    }
    if (purpose !== null) {
      for (const s of readable) {
        if (s.status === "blank") out.push({ id: `purpose-${s.id}`, text: `The governing purpose statement is written, and nothing is written yet under ${s.title}.` });
      }
    }
  }
  for (const p of payload.proposals) {
    if (p.status !== "open" || (p.target !== "setting" && p.target !== "matrix")) continue;
    const what = p.target === "matrix" ? "the Decision Matrix" : lowerFirst(doorOf(p.door)?.label ?? "a setting");
    const who = p.youProposedIt ? "You" : p.proposedBy.name || "A member";
    out.push({ id: `open-${p.id}`, text: `${who} suggested a change to ${what}. Until it is decided, the setting stays as it is.` });
  }
  for (const d of payload.doors) {
    if (!d.wired) out.push({ id: `unwired-${d.label}`, text: `${d.label} cannot be changed from the canvas yet. ${d.why ?? ""}`.trim(), href: d.href, label: "Where it is set" });
  }
  return out;
}

// ── Say: the suggestion box ─────────────────────────────────────────────────

/** One thing a suggestion on this block can aim at. `key` is unique within the block. */
export interface SuggestionOption {
  key: string;
  target: ProposalTarget;
  sectionId?: string;
  door?: CanvasDoorId;
  label: string;
}

/** What a member can suggest on this block, in the order the page offers it. */
export function suggestionOptions(payload: Pick<BlockFramesPayload, "block" | "answer" | "doors">): SuggestionOption[] {
  const titles = sectionTitlesOf(payload.answer.sections);
  const out: SuggestionOption[] = [];
  if (payload.block.id === "purpose") out.push({ key: "purpose", target: "purpose", label: "The governing purpose statement" });
  for (const id of payload.block.briefSections) {
    out.push({ key: `words:${id}`, target: "words", sectionId: id, label: `Words for ${titles[id] ?? id}${isAdminOnlySection(id) ? " (kept with the administrators)" : ""}` });
  }
  for (const d of payload.doors) {
    if (d.wired && d.id) out.push({ key: `setting:${d.id}`, target: "setting", door: d.id, label: `A setting: ${lowerFirst(d.label)}` });
  }
  if (payload.block.id === "power") out.push({ key: "matrix", target: "matrix", label: "A row of the Decision Matrix" });
  return out;
}

export function sectionTitlesOf(sections: readonly AnswerSection[]): Record<string, string> {
  return Object.fromEntries(sections.map((s) => [s.id, s.title]));
}

/** The fields the suggestion box collects, all as typed. */
export interface SuggestionFields {
  body: string;
  servesPurpose: string;
  /** A dial's value, or a module's lifecycle. */
  value: string;
  noticePeriodDays: string;
  valuationMethod: string;
  unwindSteps: string;
  involuntaryProcess: string;
  steps: string;
  replyHours: string;
  /** KEEP leaves the role as it is; "" names no role. */
  intakeContactRole: string;
  coverRole: string;
  subject: string;
  approval: string;
  consultation: string;
  information: string;
  method: string;
  riskTags: string;
}

/** Leave a role as it is: the field is not sent at all. */
export const KEEP = "__keep__";

export const EMPTY_FIELDS: SuggestionFields = {
  body: "",
  servesPurpose: "",
  value: "",
  noticePeriodDays: "",
  valuationMethod: "",
  unwindSteps: "",
  involuntaryProcess: "",
  steps: "",
  replyHours: "",
  intakeContactRole: KEEP,
  coverRole: KEEP,
  subject: "",
  approval: "",
  consultation: "",
  information: "",
  method: "",
  riskTags: "",
};

const linesOf = (text: string): string[] => text.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
const tagsOf = (text: string): string[] => text.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0);

/**
 * The body POST /api/canvas/proposals takes, from the box's fields. Only the
 * fields somebody filled are sent, so an empty box changes nothing; the shared
 * validator then refuses what is missing in the route's own words.
 */
export function suggestionBody(blockId: CanvasBlockId, option: SuggestionOption, f: SuggestionFields, scoped: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { blockId, target: option.target, body: f.body.trim() };
  if (scoped && f.servesPurpose.trim()) body.servesPurpose = f.servesPurpose.trim();
  if (option.target === "words") body.sectionId = option.sectionId;
  if (option.target === "matrix") {
    body.change = {
      subject: f.subject,
      approval: f.approval,
      consultation: f.consultation,
      information: f.information,
      method: f.method,
      riskTags: tagsOf(f.riskTags),
    };
  }
  if (option.target !== "setting" || !option.door) return body;
  body.door = option.door;
  const door = CANVAS_DOORS[option.door];
  if (door.kind === "dial") body.change = { value: f.value.trim() };
  else if (door.kind === "module") body.change = { to: f.value };
  else if (door.id === "exit:terms") {
    const c: Record<string, unknown> = {};
    if (f.noticePeriodDays.trim()) c.noticePeriodDays = Number(f.noticePeriodDays.trim());
    if (f.valuationMethod.trim()) c.valuationMethod = f.valuationMethod.trim();
    if (linesOf(f.unwindSteps).length) c.unwindSteps = linesOf(f.unwindSteps);
    if (f.involuntaryProcess.trim()) c.involuntaryProcess = f.involuntaryProcess.trim();
    body.change = c;
  } else {
    const c: Record<string, unknown> = {};
    if (linesOf(f.steps).length) c.steps = linesOf(f.steps);
    if (f.intakeContactRole !== KEEP) c.intakeContactRole = f.intakeContactRole;
    if (f.coverRole !== KEEP) c.coverRole = f.coverRole;
    if (f.replyHours.trim()) c.replyHours = Number(f.replyHours.trim());
    body.change = c;
  }
  return body;
}

/** The box's label for the suggestion's own text, which reads differently per aim. */
export function bodyLabel(option: SuggestionOption, sectionTitles: Record<string, string>): string {
  if (option.target === "words") return `The words you suggest for ${sectionTitles[String(option.sectionId)] ?? option.sectionId}`;
  if (option.target === "purpose") return "The statement, whole, as the village would read it";
  if (option.target === "matrix") return "Why this row, in a sentence or more";
  return "Why this change, in a sentence or more";
}

/** A dial's current state, as GET /api/game/mechanics lists it, for the box. */
export interface DialFacts {
  key: string;
  label: string;
  type: string;
  unit: string | null;
  min: number | null;
  max: number | null;
  choices: Array<{ value: string; label: string; hint?: string }> | null;
  value: unknown;
}

/** The dial a door names, out of the mechanics list, or null when it is not listed to this viewer. */
export function dialFor(door: CanvasDoorId, variables: readonly DialFacts[]): DialFacts | null {
  const key = CANVAS_DOORS[door].dialKey;
  return variables.find((v) => v.key === key) ?? null;
}

/** "Today: 3 vouches" or "Today: Consent". */
export function dialToday(d: DialFacts): string {
  const raw = String(d.value ?? "");
  const choice = d.choices?.find((c) => c.value === raw);
  if (choice) return `Today: ${choice.label}`;
  return `Today: ${raw}${d.unit ? ` ${d.unit}` : ""}`;
}

// ── Small words ─────────────────────────────────────────────────────────────

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  const last = names.slice(-1)[0];
  return `${names.slice(0, -1).join(", ")} and ${last}`;
}
