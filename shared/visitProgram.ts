/**
 * The visit program: the sentence under the Visit page's headline, the ways to
 * visit, and the logistics. Stored whole as the `visit-config` document in
 * `app_config`, served by `GET /api/visit-config`, drawn by
 * client/src/pages/Visit.tsx.
 *
 * WHY IT HAS ITS OWN SHAPE. The Visit page spec (shared/pageContent/visit.ts)
 * holds only the two lines that were typed into the page. The program was the
 * village's own long before page specs existed, and every village that saved
 * it holds it in this document, so it stays here and Admin, Pages, Visit edits
 * it in place (client/src/components/admin/pages/VisitProgramEditor.tsx).
 *
 * The limits are what the Visit page's layout holds: three cards to a row on a
 * wide screen, one column on a phone. `visitProgramProblems` is asked by the
 * editor and by `PUT /api/admin/visit-config` alike, so the editor can never
 * offer what the route refuses.
 */

export interface VisitType {
  id: string;
  title: string;
  duration: string;
  format: string;
  cost: string;
  description: string;
  cta_label: string;
  cta_url: string;
  order: number;
}

export interface VisitLogistics {
  getting_there: string;
  accommodation: string;
  what_to_bring: string;
  contact_note: string;
}

export interface VisitProgram {
  hero_subtitle: string;
  visit_types: VisitType[];
  logistics: VisitLogistics;
}

export interface VisitField<K extends string> {
  key: K;
  label: string;
  /** Where it shows, and what a blank does. */
  help: string;
  kind: "text" | "long" | "link";
  max: number;
  /** A blank box is refused. Every other box may be left blank. */
  required?: boolean;
}

export type VisitTypeTextKey = Exclude<keyof VisitType, "id" | "order">;

/** Two rows of three on a wide screen. */
export const MAX_VISIT_TYPES = 6;

export const VISIT_SUBTITLE_FIELD: VisitField<"hero_subtitle"> = {
  key: "hero_subtitle",
  label: "Sentence under the headline",
  help: "On the coloured band at the top of the Visit page. Leave blank for none.",
  kind: "long",
  max: 220,
};

export const VISIT_TYPE_FIELDS: readonly VisitField<VisitTypeTextKey>[] = [
  { key: "title", label: "Name", help: "The card's heading, and the choice in the visit form.", kind: "text", max: 40, required: true },
  { key: "duration", label: "How long", help: "Leave blank to leave the line out.", kind: "text", max: 24 },
  { key: "format", label: "Where", help: "In person, online, or both. Leave blank to leave the line out.", kind: "text", max: 24 },
  { key: "cost", label: "What it costs", help: "Write the currency you use. Leave blank to leave the line out.", kind: "text", max: 24 },
  { key: "description", label: "What happens", help: "A few lines on what the visit holds. Leave blank for none.", kind: "long", max: 260 },
  {
    key: "cta_label",
    label: "Button words",
    help: "Leave blank and the button says \"Contact the team\", or \"Learn more\" when it has a link.",
    kind: "text",
    max: 28,
  },
  {
    key: "cta_url",
    label: "Button goes to",
    help: "A web address, a mailto: address, or a page here such as /events. Leave blank and the button takes visitors to the visit form further down the page, still under your words.",
    kind: "link",
    max: 500,
  },
];

export const VISIT_LOGISTICS_FIELDS: readonly VisitField<keyof VisitLogistics>[] = [
  { key: "getting_there", label: "Getting there", help: "A card under Logistics. Leave blank and the card is left out.", kind: "long", max: 300 },
  { key: "accommodation", label: "Accommodation", help: "A card under Logistics. Leave blank and the card is left out.", kind: "long", max: 300 },
  { key: "what_to_bring", label: "What to bring", help: "A card under Logistics. Leave blank and the card is left out.", kind: "long", max: 300 },
  { key: "contact_note", label: "Line above the form", help: "Under \"Tell us you're coming\". Leave blank for none.", kind: "long", max: 200 },
];


/** Characters as a person counts them, so an accented name is not charged twice. */
function count(s: string): number {
  return Array.from(s).length;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The program with every box present, in the order visitors see the cards.
 * A document saved before a box existed reads that box as blank, and keys this
 * file does not know are kept, so a save never drops what another editor wrote.
 */
export function normalizeVisitProgram(doc: unknown): VisitProgram {
  const d = (doc && typeof doc === "object" ? doc : {}) as Record<string, unknown>;
  const rawTypes = Array.isArray(d.visit_types) ? d.visit_types : [];
  const taken: string[] = [];
  const types = rawTypes
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && !Array.isArray(t))
    .map((t, i) => ({
      ...t,
      // A card saved with no id, or with another card's, gets one of its own,
      // so the editor can always save what it read.
      id: ((id) => (taken.push(id), id))(
        str(t.id).trim() && !taken.includes(str(t.id)) && count(str(t.id)) <= 64 ? str(t.id) : newVisitTypeId(taken, `${i + 1}`),
      ),
      title: str(t.title),
      duration: str(t.duration),
      format: str(t.format),
      cost: str(t.cost),
      description: str(t.description),
      cta_label: str(t.cta_label),
      cta_url: str(t.cta_url),
      order: typeof t.order === "number" && Number.isFinite(t.order) ? t.order : i + 1,
    }))
    .sort((a, b) => a.order - b.order);
  const l = (d.logistics && typeof d.logistics === "object" ? d.logistics : {}) as Record<string, unknown>;
  return {
    ...d,
    hero_subtitle: str(d.hero_subtitle),
    visit_types: types,
    logistics: {
      ...l,
      getting_there: str(l.getting_there),
      accommodation: str(l.accommodation),
      what_to_bring: str(l.what_to_bring),
      contact_note: str(l.contact_note),
    },
  };
}

/** The cards in the order the editor shows them, numbered 1, 2, 3 as stored. */
export function renumberVisitTypes(types: readonly VisitType[]): VisitType[] {
  return types.map((t, i) => ({ ...t, order: i + 1 }));
}

/** An id no card in `taken` already has. */
export function newVisitTypeId(taken: readonly string[], seed: string = Date.now().toString(36)): string {
  let n = 0;
  let id = `visit-${seed}`;
  while (taken.includes(id)) id = `visit-${seed}-${++n}`;
  return id;
}

function tooLong(where: string, field: VisitField<string>, value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") return `${where}${field.label} must be words.`;
  if (count(value) > field.max) return `${where}${field.label} holds ${field.max} characters at most (it has ${count(value)}).`;
  return null;
}

/**
 * Why this document cannot be saved as the visit program, in sentences an
 * admin can act on. Empty means it can.
 */
export function visitProgramProblems(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return ["The visit program must be a document."];
  const d = body as Record<string, unknown>;
  const out: string[] = [];
  const subtitle = tooLong("", VISIT_SUBTITLE_FIELD, d.hero_subtitle);
  if (subtitle) out.push(subtitle);

  if (d.visit_types !== undefined) {
    if (!Array.isArray(d.visit_types)) {
      out.push("The ways to visit must be a list.");
    } else {
      if (d.visit_types.length > MAX_VISIT_TYPES) out.push(`The Visit page holds ${MAX_VISIT_TYPES} ways to visit at most.`);
      const ids: string[] = [];
      d.visit_types.forEach((raw, i) => {
        const where = `Way to visit ${i + 1}: `;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          out.push(`${where}it must be a card.`);
          return;
        }
        const t = raw as Record<string, unknown>;
        if (typeof t.id !== "string" || !t.id.trim() || count(t.id) > 64) out.push(`${where}its id must be a name of up to 64 characters.`);
        else if (ids.includes(t.id)) out.push(`${where}another card already has the id ${t.id}.`);
        else ids.push(t.id);
        if (t.order !== undefined && (typeof t.order !== "number" || !Number.isFinite(t.order))) out.push(`${where}its order must be a number.`);
        for (const field of VISIT_TYPE_FIELDS) {
          const p = tooLong(where, field, t[field.key]);
          if (p) out.push(p);
          else if (field.required && str(t[field.key]).trim() === "") out.push(`${where}${field.label} cannot be blank.`);
        }
      });
    }
  }

  if (d.logistics !== undefined) {
    if (!d.logistics || typeof d.logistics !== "object" || Array.isArray(d.logistics)) {
      out.push("The logistics must be a document.");
    } else {
      const l = d.logistics as Record<string, unknown>;
      for (const field of VISIT_LOGISTICS_FIELDS) {
        const p = tooLong("", field, l[field.key]);
        if (p) out.push(p);
      }
    }
  }
  return out;
}

/** The first problem, for a route that answers with one sentence. */
export function visitProgramProblem(body: unknown): string | null {
  return visitProgramProblems(body)[0] ?? null;
}
