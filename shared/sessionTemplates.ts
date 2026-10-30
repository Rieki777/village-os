/**
 * MEETING TEMPLATES for Live Sessions (0290): the contract.
 *
 * A template is a meeting the village holds again and again: its name, a
 * category it sorts under ("Weekly rhythm", "Heart share"), the circle that
 * usually meets, how long, and an ordered FLOW of sections, each with a kind,
 * a title, a prompt and some minutes. Everything a member reads about a
 * template is a row, never code, so the people who run sessions can change a
 * meeting's shape after every round of feedback (Rye, 2026-10-30: "I should
 * be able to give you feedback on each one of the template styles to keep
 * changing what that looks like and what the flow of that particular meeting
 * looks like").
 *
 * THE SERIES. A session opened from a template is linked to it, so the
 * sessions of one template form a series. A template may name another one it
 * FEEDS FROM: a Friday that feeds from Monday reads Monday's chosen
 * priorities and asks of each "did we tackle it?"; a Monday that feeds from
 * Friday reads what Friday carried over. Which section shows what is the
 * section's kind, and the words above it are the section's own title.
 *
 * THE TALKING STICK. A `talking_stick` section passes a visible stick around
 * the people present: whoever holds it shares, then passes it on, and the
 * room sees who holds it and who is next. What is shared can be captured
 * (grateful, working, not working, a tension) and a capture can be brought to
 * a later session as an agenda item (shared/sessionLibrary.ts).
 *
 * WHO. Reading the templates is every admitted member. Creating, duplicating,
 * changing, ordering and archiving them asks the one capability gate for
 * `session.template` (shared/capabilities.ts), which opens at the member
 * rung, the same people who may open a room. A village that wants a narrower
 * door moves the rung. Moving the stick, setting priorities and marking them
 * is the room's facilitator, its secretary or a joined admin, the same hosts
 * who move the room. Anybody in the room may capture a share.
 *
 * The three seeded templates (`DEFAULT_TEMPLATES`) are ordinary rows once
 * written: editable, duplicable, archivable. They carry no village's name.
 */
import { cleanLine, cleanText } from "./sessions";

// ── Doors ────────────────────────────────────────────────────────────────────

/**
 * Every door. A refusal is `{ error: <a sentence> }` with a 4xx status. The
 * prefix is its own, so no GET here is ever read as a room numbered
 * "templates" by `GET /api/sessions/:id`.
 *
 *   GET    /api/session-templates                       { templates, mayKeep }
 *   POST   /api/session-templates                       TemplateInput -> { template }
 *   PATCH  /api/session-templates/:id                   Partial<TemplateInput> -> { template }
 *   POST   /api/session-templates/:id/duplicate         {} -> { template }
 *   POST   /api/session-templates/:id/archive           { archived: boolean } -> { template }
 *   POST   /api/session-templates/:id/move             { direction: "up" | "down" } -> { templates }
 *   POST   /api/sessions                                gains `templateId?: number`
 *   GET    /api/session-templates/rooms/:sessionId      TemplateRoomView
 *   POST   /api/session-templates/rooms/:sessionId/stick       StickMove -> TemplateRoomView
 *   POST   /api/session-templates/rooms/:sessionId/priorities  { text } | { fromCarried: id } -> TemplateRoomView
 *   PATCH  /api/session-templates/rooms/:sessionId/priorities/:pid   { outcome } | { text } | { remove: true } -> TemplateRoomView
 *   POST   /api/session-templates/rooms/:sessionId/shares      { kind, text, speakerNo? } -> TemplateRoomView
 *   POST   /api/session-templates/rooms/:sessionId/shares/:shareId/bring   { circleId? } -> TemplateRoomView
 */
export const TEMPLATES_API = "/api/session-templates";
export const templateApi = (id: number) => `${TEMPLATES_API}/${id}`;
export const templateRoomApi = (sessionId: number) => `${TEMPLATES_API}/rooms/${sessionId}`;

// ── Section kinds ────────────────────────────────────────────────────────────

/**
 * What a section of the flow does. The room reads the kind; the words a
 * member sees are the section's own title and prompt.
 *
 * `wins` and `priority_vote` name what the room's item page and agenda carry
 * (the Wins and celebrations section, the crowd-voted agenda priority); the
 * flow names them so a template can say where in the meeting they come.
 */
export const SECTION_KINDS = [
  "round",
  "talking_stick",
  "wins",
  "agenda",
  "priority_vote",
  "priorities_set",
  "priorities_review",
  "carried_over",
  "close",
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export const isSectionKind = (v: unknown): v is SectionKind => typeof v === "string" && (SECTION_KINDS as readonly string[]).includes(v);

export const SECTION_KIND_DEFS: Record<SectionKind, { label: string; hint: string }> = {
  round: { label: "A round", hint: "Everyone speaks to the prompt, one at a time." },
  talking_stick: { label: "Talking stick", hint: "A visible stick passes around the people here. Whoever holds it shares, then passes it on." },
  wins: { label: "Wins and celebrations", hint: "What went well, said out loud and kept in the record." },
  agenda: { label: "Agenda items", hint: "The room works through its agenda, one item at a time." },
  priority_vote: { label: "Vote on priorities", hint: "The room votes items up and down to choose what comes first." },
  priorities_set: { label: "Set this week's priorities", hint: "The chosen priorities are kept for the next meeting in the series to read back." },
  priorities_review: { label: "Read back the priorities", hint: "The priorities the meeting this one feeds from chose, each marked done, partly or carried over." },
  carried_over: { label: "Carried over", hint: "What the meeting this one feeds from carried over, ready to take up again." },
  close: { label: "Close", hint: "A closing round." },
};

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface TemplateSection {
  /** Stable within a template, so a reordered flow keeps each section's identity. */
  key: string;
  kind: SectionKind;
  title: string;
  prompt: string;
  minutes: number;
}

export type TemplateStatus = "active" | "archived";

export interface SessionTemplate {
  id: number;
  name: string;
  category: string;
  /** What the template is for, in a sentence or two. */
  summary: string;
  circleId: string | null;
  /** Null: the village's usual length. */
  durationMin: number | null;
  flow: TemplateSection[];
  /** Order within its category, lowest first. */
  position: number;
  status: TemplateStatus;
  /** The template whose latest session this one reads back, or null. */
  feedsFromId: number | null;
  updatedAt: string;
}

export interface TemplatesPayload {
  templates: SessionTemplate[];
  /** Whether this viewer holds `session.template`. */
  mayKeep: boolean;
}

export interface TemplateInput {
  name: string;
  category: string;
  summary: string;
  circleId: string | null;
  durationMin: number | null;
  flow: TemplateSection[];
  feedsFromId: number | null;
}

// ── Limits ───────────────────────────────────────────────────────────────────

export const TEMPLATE_LIMITS = {
  name: 80,
  category: 60,
  summary: 400,
  sections: 20,
  sectionTitle: 80,
  prompt: 600,
  sectionMinutesMin: 1,
  sectionMinutesMax: 240,
  durationMin: 5,
  durationMax: 480,
  /** Active and archived together, so the list stays a list. */
  templates: 100,
  writesPerHour: 120,
  roomWritesPerHour: 600,
  priorities: 12,
  priorityText: 200,
  shares: 200,
  shareText: 1000,
  stickPeople: 60,
} as const;

// ── Cleaning ─────────────────────────────────────────────────────────────────

type Clean<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const no = (error: string): Clean<never> => ({ ok: false, status: 400, error });
const bodyOf = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;

const inRange = (n: unknown, lo: number, hi: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;

/** A section key: short, plain, and unique inside its flow. A missing one is made from its place. */
function sectionKey(raw: unknown, index: number): string {
  const s = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) : "";
  return s || `s${index + 1}`;
}

/** One flow, every section cleaned, or the sentence that says what is wrong. */
export function cleanFlow(raw: unknown): Clean<TemplateSection[]> {
  if (!Array.isArray(raw)) return no(TEMPLATE_REFUSALS.flowNeeded);
  if (raw.length > TEMPLATE_LIMITS.sections) return no(TEMPLATE_REFUSALS.flowTooLong);
  const out: TemplateSection[] = [];
  const keys = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const s = bodyOf(raw[i]);
    if (!isSectionKind(s.kind)) return no(TEMPLATE_REFUSALS.kindUnknown);
    const title = cleanLine(s.title, TEMPLATE_LIMITS.sectionTitle);
    if (!title) return no(TEMPLATE_REFUSALS.sectionTitleNeeded);
    const minutes = Number(s.minutes);
    if (!inRange(minutes, TEMPLATE_LIMITS.sectionMinutesMin, TEMPLATE_LIMITS.sectionMinutesMax)) return no(TEMPLATE_REFUSALS.sectionMinutes);
    let key = sectionKey(s.key, i);
    while (keys.has(key)) key = `${key}-${i + 1}`;
    keys.add(key);
    out.push({ key, kind: s.kind, title, prompt: cleanText(s.prompt, TEMPLATE_LIMITS.prompt) ?? "", minutes });
  }
  return { ok: true, value: out };
}

function readCircle(v: unknown, circleIds: ReadonlySet<string>): Clean<string | null> {
  if (v == null || v === "") return { ok: true, value: null };
  return typeof v === "string" && circleIds.has(v) ? { ok: true, value: v } : no(TEMPLATE_REFUSALS.circleUnknown);
}

function readDuration(v: unknown): Clean<number | null> {
  if (v == null || v === "") return { ok: true, value: null };
  const n = Number(v);
  return inRange(n, TEMPLATE_LIMITS.durationMin, TEMPLATE_LIMITS.durationMax) ? { ok: true, value: n } : no(TEMPLATE_REFUSALS.durationRange);
}

function readFeeds(v: unknown): Clean<number | null> {
  if (v == null || v === "") return { ok: true, value: null };
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? { ok: true, value: n } : no(TEMPLATE_REFUSALS.feedsUnknown);
}

/** A whole new template. */
export function cleanTemplate(raw: unknown, circleIds: ReadonlySet<string>): Clean<TemplateInput> {
  const b = bodyOf(raw);
  const name = cleanLine(b.name, TEMPLATE_LIMITS.name);
  if (!name) return no(TEMPLATE_REFUSALS.nameNeeded);
  const category = cleanLine(b.category, TEMPLATE_LIMITS.category);
  if (!category) return no(TEMPLATE_REFUSALS.categoryNeeded);
  const circle = readCircle(b.circleId, circleIds);
  if (!circle.ok) return circle;
  const duration = readDuration(b.durationMin);
  if (!duration.ok) return duration;
  const flow = cleanFlow(b.flow ?? []);
  if (!flow.ok) return flow;
  const feeds = readFeeds(b.feedsFromId);
  if (!feeds.ok) return feeds;
  return {
    ok: true,
    value: {
      name,
      category,
      summary: cleanText(b.summary, TEMPLATE_LIMITS.summary) ?? "",
      circleId: circle.value,
      durationMin: duration.value,
      flow: flow.value,
      feedsFromId: feeds.value,
    },
  };
}

/** The fields a change sends. A key left out is left alone. */
export function cleanTemplatePatch(raw: unknown, circleIds: ReadonlySet<string>): Clean<Partial<TemplateInput>> {
  const b = bodyOf(raw);
  const out: Partial<TemplateInput> = {};
  if (has(b, "name")) {
    const name = cleanLine(b.name, TEMPLATE_LIMITS.name);
    if (!name) return no(TEMPLATE_REFUSALS.nameNeeded);
    out.name = name;
  }
  if (has(b, "category")) {
    const category = cleanLine(b.category, TEMPLATE_LIMITS.category);
    if (!category) return no(TEMPLATE_REFUSALS.categoryNeeded);
    out.category = category;
  }
  if (has(b, "summary")) out.summary = cleanText(b.summary, TEMPLATE_LIMITS.summary) ?? "";
  if (has(b, "circleId")) {
    const circle = readCircle(b.circleId, circleIds);
    if (!circle.ok) return circle;
    out.circleId = circle.value;
  }
  if (has(b, "durationMin")) {
    const duration = readDuration(b.durationMin);
    if (!duration.ok) return duration;
    out.durationMin = duration.value;
  }
  if (has(b, "flow")) {
    const flow = cleanFlow(b.flow);
    if (!flow.ok) return flow;
    out.flow = flow.value;
  }
  if (has(b, "feedsFromId")) {
    const feeds = readFeeds(b.feedsFromId);
    if (!feeds.ok) return feeds;
    out.feedsFromId = feeds.value;
  }
  return { ok: true, value: out };
}

/** A stored flow, read tolerantly: a section that no longer cleans is dropped, never a crash. */
export function readFlow(raw: unknown): TemplateSection[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const kept = parsed.filter((s) => {
    const one = cleanFlow([s]);
    return one.ok;
  });
  const flow = cleanFlow(kept);
  return flow.ok ? flow.value : [];
}

/** The minutes a flow plans, added up. */
export const flowMinutes = (flow: readonly TemplateSection[]): number => flow.reduce((sum, s) => sum + s.minutes, 0);

/** Whether a flow carries a section of this kind. */
export const flowHas = (flow: readonly TemplateSection[], kind: SectionKind): boolean => flow.some((s) => s.kind === kind);

/** The first section of a kind, for its title. */
export const sectionOf = (flow: readonly TemplateSection[], kind: SectionKind): TemplateSection | null => flow.find((s) => s.kind === kind) ?? null;

// ── The picker ───────────────────────────────────────────────────────────────

export interface TemplateGroup {
  category: string;
  templates: SessionTemplate[];
}

/**
 * The active templates grouped by category for the "Meeting type" picker:
 * the categories in the order of their first template, each category's
 * templates by position, then by name.
 */
export function groupByCategory(templates: readonly SessionTemplate[], includeArchived = false): TemplateGroup[] {
  const shown = templates.filter((t) => includeArchived || t.status === "active");
  const sorted = [...shown].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name) || a.id - b.id);
  const groups = new Map<string, SessionTemplate[]>();
  for (const t of sorted) {
    const list = groups.get(t.category);
    if (list) list.push(t);
    else groups.set(t.category, [t]);
  }
  return Array.from(groups, ([category, list]) => ({ category, templates: list })).sort((a, b) => a.category.localeCompare(b.category));
}

/** The next position at the end of a category. */
export const nextPosition = (templates: readonly SessionTemplate[], category: string): number =>
  templates.filter((t) => t.category === category).reduce((m, t) => Math.max(m, t.position), 0) + 1;

/** A copy's name: "Name (copy)", cut to fit. */
export const copyName = (name: string): string => {
  const tail = " (copy)";
  return `${name.slice(0, TEMPLATE_LIMITS.name - tail.length)}${tail}`;
};

// ── The room: talking stick, priorities, shares ──────────────────────────────

/** Who holds the stick, as an order of member numbers and a place in it. */
export interface StickState {
  order: number[];
  at: number;
  /** How many times the stick has gone all the way round. */
  rounds: number;
}

export const emptyStick = (): StickState => ({ order: [], at: 0, rounds: 0 });

export function readStick(raw: unknown): StickState {
  let p: unknown = raw;
  if (typeof raw === "string") {
    try {
      p = JSON.parse(raw);
    } catch {
      return emptyStick();
    }
  }
  const b = bodyOf(p);
  const order = Array.isArray(b.order) ? (b.order as unknown[]).filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0) : [];
  const unique = Array.from(new Set(order)).slice(0, TEMPLATE_LIMITS.stickPeople);
  const at = typeof b.at === "number" && Number.isInteger(b.at) && b.at >= 0 && b.at < unique.length ? b.at : 0;
  const rounds = typeof b.rounds === "number" && Number.isInteger(b.rounds) && b.rounds >= 0 ? b.rounds : 0;
  return { order: unique, at, rounds };
}

export type StickMove =
  | { move: "start"; order: number[] }
  | { move: "pass" }
  | { move: "back" }
  | { move: "give"; to: number }
  | { move: "stop" };

/**
 * The stick after a move. Passing from the last person starts the next round
 * with the first. Giving it to somebody not in the order puts them in it,
 * next after whoever holds it now.
 */
export function moveStick(s: StickState, m: StickMove): StickState {
  switch (m.move) {
    case "start":
      return { order: Array.from(new Set(m.order)).slice(0, TEMPLATE_LIMITS.stickPeople), at: 0, rounds: 0 };
    case "stop":
      return emptyStick();
    case "pass":
      if (!s.order.length) return s;
      return s.at + 1 >= s.order.length ? { ...s, at: 0, rounds: s.rounds + 1 } : { ...s, at: s.at + 1 };
    case "back":
      if (!s.order.length || (s.at === 0 && s.rounds === 0)) return s;
      return s.at === 0 ? { ...s, at: s.order.length - 1, rounds: s.rounds - 1 } : { ...s, at: s.at - 1 };
    case "give": {
      const i = s.order.indexOf(m.to);
      if (i >= 0) return { ...s, at: i };
      if (s.order.length >= TEMPLATE_LIMITS.stickPeople) return s;
      const order = [...s.order.slice(0, s.at + 1), m.to, ...s.order.slice(s.at + 1)];
      return { ...s, order, at: s.order.length ? s.at + 1 : 0 };
    }
  }
}

/** Whoever holds the stick and whoever is next, as member numbers. */
export function stickHolders(s: StickState): { holder: number | null; next: number | null } {
  if (!s.order.length) return { holder: null, next: null };
  const holder = s.order[s.at] ?? null;
  const next = s.order.length > 1 ? (s.order[(s.at + 1) % s.order.length] ?? null) : null;
  return { holder, next };
}

export function cleanStickMove(raw: unknown): Clean<StickMove> {
  const b = bodyOf(raw);
  switch (b.move) {
    case "start": {
      if (!Array.isArray(b.order)) return no(TEMPLATE_REFUSALS.stickOrder);
      const order = (b.order as unknown[]).filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0);
      if (!order.length) return no(TEMPLATE_REFUSALS.stickOrder);
      return { ok: true, value: { move: "start", order } };
    }
    case "pass":
    case "back":
    case "stop":
      return { ok: true, value: { move: b.move } };
    case "give":
      return typeof b.to === "number" && Number.isInteger(b.to) && b.to > 0 ? { ok: true, value: { move: "give", to: b.to } } : no(TEMPLATE_REFUSALS.stickOrder);
    default:
      return no(TEMPLATE_REFUSALS.stickOrder);
  }
}

export const PRIORITY_OUTCOMES = ["done", "partly", "carried"] as const;
export type PriorityOutcome = (typeof PRIORITY_OUTCOMES)[number];
export const isPriorityOutcome = (v: unknown): v is PriorityOutcome => typeof v === "string" && (PRIORITY_OUTCOMES as readonly string[]).includes(v);
export const PRIORITY_OUTCOME_LABEL: Record<PriorityOutcome, string> = { done: "Done", partly: "Partly", carried: "Carried over" };
/** The outcomes that come back to the next meeting as carried over. */
export const CARRIES: ReadonlySet<PriorityOutcome> = new Set<PriorityOutcome>(["partly", "carried"]);

export interface PriorityRow {
  id: number;
  text: string;
  position: number;
  outcome: PriorityOutcome | null;
}

/** What one earlier session of the series hands this one. */
export interface SeriesReadBack {
  sessionId: number;
  sessionTitle: string;
  /** When that session was opened, ISO. */
  openedAt: string;
  rows: PriorityRow[];
}

export const SHARE_KINDS = ["grateful", "working", "not_working", "tension"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
export const isShareKind = (v: unknown): v is ShareKind => typeof v === "string" && (SHARE_KINDS as readonly string[]).includes(v);
export const SHARE_KIND_LABEL: Record<ShareKind, string> = {
  grateful: "Grateful for",
  working: "What's working",
  not_working: "What's not working",
  tension: "A tension",
};

export interface ShareRow {
  id: number;
  kind: ShareKind;
  text: string;
  /** Who held the stick when it was said, or null. */
  speaker: string | null;
  /** The agenda item it became, when it was brought to a later session. */
  broughtAs: number | null;
  at: string;
}

export interface StickView {
  people: { no: number; name: string }[];
  holder: number | null;
  next: number | null;
  rounds: number;
}

/** What the room's template panel reads. Absent pieces are null. */
export interface TemplateRoomView {
  template: Pick<SessionTemplate, "id" | "name" | "category" | "summary" | "flow"> | null;
  /** Whether this viewer may move the stick and set and mark priorities. */
  hosts: boolean;
  /** Whether this viewer is in the room and may capture a share. */
  joined: boolean;
  open: boolean;
  /** The people here now, for starting the stick. */
  here: { no: number; name: string }[];
  stick: StickView | null;
  /** This session's own priorities (a `priorities_set` section). */
  priorities: PriorityRow[];
  /** The fed-from session's priorities to mark (a `priorities_review` section). */
  review: SeriesReadBack | null;
  /** What the fed-from session carried over (a `carried_over` section). */
  carried: SeriesReadBack | null;
  shares: ShareRow[];
}

// ── Words ────────────────────────────────────────────────────────────────────

export const TEMPLATE_REFUSALS = {
  nameNeeded: "Give the template a name.",
  categoryNeeded: "Give the template a category, like Weekly rhythm.",
  circleUnknown: "That circle is not one of the village's live circles.",
  durationRange: `A meeting runs between ${TEMPLATE_LIMITS.durationMin} and ${TEMPLATE_LIMITS.durationMax} minutes.`,
  flowNeeded: "A template's flow is a list of sections.",
  flowTooLong: `A flow holds up to ${TEMPLATE_LIMITS.sections} sections.`,
  kindUnknown: "One of the sections has a kind this room does not know.",
  sectionTitleNeeded: "Every section needs a title.",
  sectionMinutes: `Each section runs between ${TEMPLATE_LIMITS.sectionMinutesMin} and ${TEMPLATE_LIMITS.sectionMinutesMax} minutes.`,
  feedsUnknown: "The template this one reads back from is not one the village keeps.",
  feedsSelf: "A template cannot read back from itself.",
  notFound: "That template is not here any more.",
  archived: "That template is archived. Bring it back first.",
  tooMany: `The village keeps up to ${TEMPLATE_LIMITS.templates} templates. Archive or change one first.`,
  mayNotKeep: "Keeping the meeting templates is for people who may run sessions.",
  membersOnly: "Meeting templates are for the village's members.",
  slowDown: "That is a lot of changes at once. Try again in a little while.",
  roomNotFound: "That session is not here.",
  roomClosed: "This session has closed, so its record stays as it is.",
  joinFirst: "Join the room first.",
  hostsOnly: "The facilitator or the secretary does this.",
  stickOrder: "Choose who the stick goes round, from the people here.",
  stickNotHere: "The stick goes to people who are in the room.",
  priorityNeeded: "Write the priority in a few words.",
  prioritiesFull: `A meeting keeps up to ${TEMPLATE_LIMITS.priorities} priorities.`,
  priorityNotFound: "That priority is not here any more.",
  priorityNotOurs: "That priority belongs to another meeting's read-back.",
  outcomeUnknown: "Mark it done, partly or carried over.",
  shareNeeded: "Write what was shared in a few words.",
  shareKind: "Say whether it is gratitude, what's working, what's not working or a tension.",
  sharesFull: `A meeting keeps up to ${TEMPLATE_LIMITS.shares} shares.`,
  shareNotFound: "That share is not here any more.",
  broughtAlready: "That share is on a later session's list already.",
} as const;

export const TEMPLATE_COPY = {
  pickerLabel: "Meeting type",
  noTemplate: "No template",
  pickerHint: "A template fills in the title, circle, length and the flow of the meeting.",
  flowHeading: "The flow",
  flowMinutes: (planned: number) => `${planned} min planned in the flow`,
  manage: "Templates",
  manageHeading: "Meeting templates",
  manageLede: "Each meeting the village holds again and again. Change a template after every meeting until its flow fits.",
  newTemplate: "New template",
  edit: "Edit",
  duplicate: "Duplicate",
  archive: "Archive",
  unarchive: "Bring it back",
  moveUp: "Earlier in its category",
  moveDown: "Later in its category",
  save: "Save the template",
  saving: "Saving",
  cancel: "Cancel",
  nameLabel: "Name",
  categoryLabel: "Category",
  summaryLabel: "What it is for",
  circleLabel: "Usual circle",
  anyCircle: "No circle in particular",
  durationLabel: "Usual length, in minutes",
  usualLength: "The village's usual length",
  feedsLabel: "Reads back from",
  feedsNone: "Nothing",
  feedsHint: "The latest meeting of this template hands this one its priorities, or what it carried over.",
  sectionsHeading: "Sections, in order",
  addSection: "Add a section",
  removeSection: "Remove",
  sectionKind: "Kind",
  sectionTitle: "Title",
  sectionPrompt: "Prompt",
  sectionMinutes: "Minutes",
  archivedHeading: "Archived",
  loadFailed: "The templates did not load. Try again in a moment.",
  saveFailed: "That did not save. Try again in a moment.",
  // The room's panel.
  panelHeading: (name: string) => `Meeting type: ${name}`,
  stickHolder: (name: string) => `${name} holds the talking stick`,
  stickNext: (name: string) => `Next: ${name}`,
  stickRound: (n: number) => `Round ${n}`,
  stickIdle: "The stick is resting. Start it to pass it around the people here.",
  stickStart: "Start the stick with everyone here",
  stickPass: "Pass the stick",
  stickBack: "Back one",
  stickStop: "Put the stick down",
  stickGive: "Give it to",
  captureLabel: "Capture what was shared",
  capturePlaceholder: "One line for the record",
  captureKind: "What it is",
  capture: "Keep it",
  sharesHeading: "Shared so far",
  bring: "Bring to a later session",
  broughtAs: "On a later session's list",
  prioritiesEmpty: "No priorities yet.",
  priorityPlaceholder: "A priority for the week",
  addPriority: "Add the priority",
  fromAgenda: "Take the agenda's top items",
  removePriority: "Take it off",
  reviewEmpty: "The meeting this one reads back from has not set priorities yet.",
  carriedEmpty: "Nothing was carried over.",
  takeUp: "Make it a priority again",
  readBackFrom: (title: string, day: string) => `From ${title}, ${day}`,
  outcomeAsk: "Did we tackle it?",
  thrivingLine: "What is shared here is kept so the village can ask: are we really helping people thrive?",
} as const;

// ── The three templates every village starts with ────────────────────────────

/**
 * Seeded once, when a village first reads its templates. `seedKey` makes the
 * seed idempotent; `feedsFrom` names another seed by its key and is resolved
 * to an id when written. Once written they are ordinary rows anyone who keeps
 * templates may change.
 */
export interface TemplateSeed extends Omit<TemplateInput, "feedsFromId" | "circleId"> {
  seedKey: string;
  position: number;
  feedsFrom: string | null;
}

const sec = (key: string, kind: SectionKind, title: string, minutes: number, prompt: string): TemplateSection => ({ key, kind, title, minutes, prompt });

export const DEFAULT_TEMPLATES: readonly TemplateSeed[] = [
  {
    seedKey: "heart-share",
    name: "Heart share",
    category: "Heart share",
    summary:
      "Space to process tensions and share what we are grateful for, what is working and what is not from the last season, week or period. Human to human. Everything shared is kept so the village can keep improving how it works.",
    durationMin: 60,
    position: 1,
    feedsFrom: null,
    flow: [
      sec("arrive", "round", "Arriving", 5, "One breath together, then one word each for how you are arriving."),
      sec("grateful", "talking_stick", "What I'm grateful for", 15, "Whoever holds the stick shares what they are grateful for from this period, then passes it on."),
      sec("working", "talking_stick", "What's working and what's not", 20, "What is working for you here, and what is not? Name a tension if you feel one."),
      sec("thrive", "round", "Are we helping people thrive?", 10, "Looking at what was shared: what would help the people here thrive? Bring anything to a later session."),
      sec("close", "close", "Closing round", 10, "One word each to close."),
    ],
  },
  {
    seedKey: "weekly-friday",
    name: "Friday check-in",
    category: "Weekly rhythm",
    summary: "A celebratory recounting of the week: our wins, what happened, how Monday's priorities went, and what to pick up next week.",
    durationMin: 60,
    position: 2,
    feedsFrom: "weekly-monday",
    flow: [
      sec("arrive", "round", "Arriving", 5, "How are you arriving, from 1 to 11?"),
      sec("wins", "wins", "Wins and celebrations", 15, "What did you win at this week? Big or small, say it out loud."),
      sec("review", "priorities_review", "Last Monday's priorities", 15, "For each priority Monday chose: did we tackle it? Done, partly, or carried over."),
      sec("week", "agenda", "What happened this week", 15, "Anything the circle needs to hear or settle before the weekend."),
      sec("next", "round", "What to pick up next week", 5, "What should Monday pick up? Partly done and carried over come to Monday on their own."),
      sec("close", "close", "Closing round", 5, "One word each to close the week."),
    ],
  },
  {
    seedKey: "weekly-monday",
    name: "Monday planning",
    category: "Weekly rhythm",
    summary: "Looking forward: planning and alignment on the week's priorities. The room finds the biggest things to tackle, votes them into order and keeps the chosen ones for Friday to read back.",
    durationMin: 60,
    position: 1,
    feedsFrom: "weekly-friday",
    flow: [
      sec("arrive", "round", "Arriving", 5, "How are you arriving, from 1 to 11?"),
      sec("carried", "carried_over", "Carried over from Friday", 10, "What Friday carried over. Take up what still matters."),
      sec("gather", "agenda", "The biggest things to tackle", 15, "Everyone adds what they think matters most this week."),
      sec("vote", "priority_vote", "Vote on priorities", 15, "Vote items up and down, and agree together what comes first."),
      sec("set", "priorities_set", "This week's priorities", 10, "Keep the chosen priorities. Friday reads them back."),
      sec("close", "close", "Closing round", 5, "One word each to start the week."),
    ],
  },
];

/** The doors the room's panel reads, for the page. */
export const TEMPLATES_ROOM_POLL_MS = 3000;

