/**
 * Reading a vendor field that POINTS AT another record, in whatever shape it
 * arrives, and resolving it against the records of the same read.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 *
 * The first live sync (2026-10-09) proposed 56 seats and every one of them
 * arrived as a name and an id: no circle, no aim. The translator kept a role's
 * `Circle` only when it was a non-empty string, and every unit test handed it
 * one ("Land & Ecology"). The vendor's store is Notion-backed, and a role's
 * circle there is a RELATION: a list of page ids, or of small objects carrying
 * an id and sometimes a name. A list is not a string, so all 56 were dropped
 * without a word, and the fixtures that should have caught it were written in
 * the shape we expected rather than the shape that is sent.
 *
 * The exact shape their `list_records` sends for a relation has not been
 * measured: nothing in this repository records one. So this reads every
 * plausible shape, resolves ids against the records of the SAME read (a
 * circle record's id is its page id, its name is `Circle Name`), and never
 * turns an id it cannot resolve into a name. And `shapeOf` describes what
 * arrived, by structure and never by value, so the next sync's answer says
 * which shape it was and the guess becomes a measurement.
 *
 * Pure: no pool, no clock, no network.
 */

/** A page id with or without its dashes, lowercased, so two spellings of one id meet. */
export function normaliseId(v: string): string {
  return v.trim().toLowerCase().replace(/-/g, "");
}

/** A Notion-style page id: 32 hex digits once the dashes are gone. */
export function looksLikeAnId(v: string): boolean {
  return /^[0-9a-f]{32}$/.test(normaliseId(v));
}

const nonBlank = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * Prose from a field that may be a string or a rich-text list.
 *
 * A Notion rich-text value is a list of runs, each `{ plain_text }` or
 * `{ text: { content } }`. Anything else (a number, a date object) is not
 * prose and gives null rather than "[object Object]".
 */
export function plainText(v: unknown): string | null {
  const raw = rawText(v, 0);
  return raw === null ? null : nonBlank(raw);
}

/** The runs joined as sent, spaces and all; trimmed once, by the caller, at the end. */
function rawText(v: unknown, depth: number): string | null {
  if (depth > 4) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const parts = v.map((x) => rawText(x, depth + 1)).filter((x): x is string => x !== null);
    return parts.length ? parts.join("") : null;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.plain_text === "string") return o.plain_text;
    if (typeof o.text === "string") return o.text;
    if (o.text && typeof o.text === "object" && typeof (o.text as Record<string, unknown>).content === "string") {
      return (o.text as Record<string, unknown>).content as string;
    }
    if (Array.isArray(o.rich_text)) return rawText(o.rich_text, depth + 1);
  }
  return null;
}

/**
 * A select or status value as its label: a string, or `{ name }` as Notion
 * sends a select. Null for anything else.
 */
export function labelOf(v: unknown): string | null {
  if (typeof v === "string") return nonBlank(v);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return nonBlank(o.name) ?? nonBlank(o.value) ?? null;
  }
  if (Array.isArray(v) && v.length === 1) return labelOf(v[0]);
  return null;
}

/** One pointer out of a relation: an id, a name, or both. */
interface Ref {
  id: string | null;
  name: string | null;
}

/** Every pointer a relation value carries, in order. */
function refsOf(v: unknown, depth = 0): Ref[] {
  if (depth > 4 || v === null || v === undefined) return [];
  if (typeof v === "string") {
    const t = nonBlank(v);
    if (!t) return [];
    return [looksLikeAnId(t) ? { id: t, name: null } : { id: null, name: t }];
  }
  if (Array.isArray(v)) return v.flatMap((x) => refsOf(x, depth + 1));
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Notion's own property shape: { type: "relation", relation: [{ id }] }.
    if (Array.isArray(o.relation)) return refsOf(o.relation, depth + 1);
    const id = nonBlank(o.id) ?? nonBlank(o.page_id) ?? null;
    const name =
      nonBlank(o.name) ??
      nonBlank(o["Circle Name"]) ??
      nonBlank(o["Role Name"]) ??
      plainText(o.title) ??
      nonBlank(o.value) ??
      null;
    if (id || name) return [{ id, name }];
  }
  return [];
}

export interface RelationReading {
  /** Every record the relation named that could be resolved, in order. */
  names: string[];
  /** Pointers that named nothing in this read and carried no name of their own. */
  unresolved: number;
  /** True when the field carried at least one pointer. */
  present: boolean;
}

/**
 * Resolve a relation against the records of the same read.
 *
 * `byId` is keyed by `normaliseId`. An id that resolves gives that record's
 * name; a pointer with no resolvable id gives its own name when it carries
 * one; anything else is counted as unresolved and NEVER becomes a name, so an
 * id is never shown to a steward as if it were a circle.
 */
export function resolveRelation(v: unknown, byId: ReadonlyMap<string, string>): RelationReading {
  const refs = refsOf(v);
  const names: string[] = [];
  let unresolved = 0;
  for (const r of refs) {
    const hit = r.id ? byId.get(normaliseId(r.id)) : undefined;
    const name = hit ?? r.name;
    if (name) {
      if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    } else {
      unresolved += 1;
    }
  }
  return { names, unresolved, present: refs.length > 0 };
}

/**
 * What a value LOOKS like, never what it says: "absent", "text", "id",
 * "list of 2 ids", "list of 1 object (id, name)". Safe to put on a steward's
 * screen and in a sync's answer, because no value survives it.
 */
export function shapeOf(v: unknown): string {
  if (v === undefined || v === null) return "absent";
  if (typeof v === "string") return looksLikeAnId(v) ? "id" : "text";
  if (Array.isArray(v)) {
    if (v.length === 0) return "empty list";
    const inner = Array.from(new Set(v.map((x) => shapeOf(x))));
    return `list of ${v.length} ${inner.join(" | ")}`;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).sort().slice(0, 6);
    return `object (${keys.join(", ")})`;
  }
  return typeof v;
}
