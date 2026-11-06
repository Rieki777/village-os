/**
 * Stored page content + the spec's defaults -> what the page renders, and the
 * one check that decides whether a stored document is acceptable.
 *
 * Both run on both sides: the client resolves to render and validates before
 * it saves, the server validates before it writes. One function each, so the
 * editor can never accept what the route then refuses.
 */
import type {
  FieldSpec,
  ListSpec,
  PageSpec,
  PageVars,
  ResolvedItem,
  ResolvedPage,
  ResolvedSection,
  SectionSpec,
} from "./types";

type Doc = Record<string, unknown>;

function isObject(v: unknown): v is Doc {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Characters as a person counts them, so one emoji is one, not two. */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/**
 * Fill `{village}`-style words. A word the village has no value for stays
 * visible as typed, which is the honest failure: a founder sees `{member}` on
 * the page and knows what to set, where a silent blank would read as a typo.
 */
export function fillVars(text: string, vars: PageVars): string {
  return text.replace(/\{([a-z][a-z-]*)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
  );
}

/** A stored string wins; for a required field a stored blank does not. */
function fieldValue(field: FieldSpec, stored: unknown, fallback: string): string {
  if (typeof stored !== "string") return fallback;
  if (stored.trim() === "" && !field.optional) return fallback;
  return stored;
}

function resolveList(list: ListSpec, stored: unknown): ResolvedItem[] {
  if (list.fixed) {
    const rows = Array.isArray(stored) ? stored.filter(isObject) : [];
    return list.fixed.map((id, index) => {
      const own = rows.find((row) => row.id === id) ?? {};
      const base = list.default[index] ?? {};
      const item: Record<string, string> = { id };
      for (const field of list.fields) item[field.key] = fieldValue(field, own[field.key], base[field.key] ?? "");
      return item;
    });
  }
  // A FREE list is the village's whole answer once it has given one, and an
  // empty answer means none. Falling back on an empty list is how a founder
  // who deleted every option watched the compiled ones come back.
  const rows = Array.isArray(stored) ? stored.filter(isObject) : list.default;
  return rows.map((row) => {
    const item: Record<string, string> = {};
    for (const field of list.fields) item[field.key] = typeof row[field.key] === "string" ? String(row[field.key]) : "";
    return item;
  });
}

function resolveSection(section: SectionSpec, stored: unknown): ResolvedSection {
  const own = isObject(stored) ? stored : {};
  const fields: Record<string, string> = {};
  for (const field of section.fields) fields[field.key] = fieldValue(field, own[field.key], field.default);
  const lists: Record<string, ResolvedItem[]> = {};
  for (const list of section.lists ?? []) lists[list.key] = resolveList(list, own[list.key]);
  return { hidden: section.hideable === true && own.hidden === true, fields, lists };
}

/** The page's words before `{words}` are filled. What "keep these words" saves. */
export function resolvePageRaw(spec: PageSpec, stored: unknown): ResolvedPage {
  const doc = isObject(stored) ? stored : {};
  const out: Record<string, ResolvedSection> = {};
  for (const section of spec.sections) out[section.id] = resolveSection(section, doc[section.id]);
  return out;
}

/** What the page renders. */
export function resolvePage(spec: PageSpec, stored: unknown, vars: PageVars): ResolvedPage {
  const raw = resolvePageRaw(spec, stored);
  const out: Record<string, ResolvedSection> = {};
  for (const [id, section] of Object.entries(raw)) {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(section.fields)) fields[k] = fillVars(v, vars);
    const lists: Record<string, ResolvedItem[]> = {};
    for (const [k, rows] of Object.entries(section.lists)) {
      lists[k] = rows.map((row) => {
        const item: Record<string, string> = {};
        for (const [fk, fv] of Object.entries(row)) item[fk] = fk === "id" ? fv : fillVars(fv, vars);
        return item;
      });
    }
    out[id] = { hidden: section.hidden, fields, lists };
  }
  return out;
}

/**
 * The full document for "keep the words you see now as this village's own":
 * every field written out, `{words}` kept as words, so the page reads the same
 * after the platform's defaults change underneath it.
 */
export function adoptedDocument(spec: PageSpec, stored: unknown): Doc {
  const raw = resolvePageRaw(spec, stored);
  const doc: Doc = {};
  for (const section of spec.sections) {
    const resolved = raw[section.id];
    const out: Doc = { ...resolved.fields };
    for (const [k, rows] of Object.entries(resolved.lists)) out[k] = rows.map((row) => ({ ...row }));
    if (resolved.hidden) out.hidden = true;
    doc[section.id] = out;
  }
  return doc;
}

const LINK_OK = /^(\/(?!\/)|#|https?:\/\/|mailto:)/i;

/** Does this link resolve to a file in the vault? Parsed, so `/api/./uploads/x` is caught as the browser would read it. */
function linksIntoTheVault(raw: string): boolean {
  try {
    return /^\/api\/uploads\//i.test(new URL(raw, "http://village.invalid").pathname);
  } catch {
    return false;
  }
}

function fieldProblems(field: FieldSpec, value: unknown, where: string): string[] {
  if (typeof value !== "string") return [`${where} must be text.`];
  const problems: string[] = [];
  const n = charCount(value);
  if (n > field.max) problems.push(`${where} is ${n} characters; the most it holds is ${field.max}.`);
  if (field.kind === "link" && value.trim() !== "" && !LINK_OK.test(value.trim())) {
    problems.push(`${where} must start with /, #, https://, http:// or mailto:.`);
  } else if (field.kind === "link" && linksIntoTheVault(value.trim())) {
    // The same refusal the Visit and investor buttons make (vaultLinkProblem,
    // server/index.ts): a file under /api/uploads/ has no sign-in in front of
    // it, so a link on a public page publishes it to everyone, for good.
    problems.push(
      `${where} points into the investor vault, which would publish that document to anyone who opens the page. Share it from Admin, Investors, Documents instead.`,
    );
  }
  return problems;
}

function listProblems(list: ListSpec, value: unknown, where: string): string[] {
  if (!Array.isArray(value)) return [`${where} must be a list.`];
  const cap = list.fixed ? list.fixed.length : list.maxItems;
  const problems: string[] = [];
  if (value.length > cap) problems.push(`${where} has ${value.length} rows; the most it holds is ${cap}.`);
  const known = new Set(list.fields.map((f) => f.key));
  const seen = new Set<string>();
  value.forEach((row, i) => {
    const at = `${where}[${i + 1}]`;
    if (!isObject(row)) {
      problems.push(`${at} must be a row of fields.`);
      return;
    }
    for (const [k, v] of Object.entries(row)) {
      if (k === "id" && list.fixed) {
        if (typeof v !== "string" || !list.fixed.includes(v)) problems.push(`${at}.id is not one of ${list.fixed.join(", ")}.`);
        else if (seen.has(v)) problems.push(`${at}.id "${v}" appears twice.`);
        else seen.add(v);
        continue;
      }
      const field = list.fields.find((f) => f.key === k);
      if (!field || !known.has(k)) problems.push(`${at}.${k} is not a field of ${list.itemLabel}.`);
      else problems.push(...fieldProblems(field, v, `${at}.${k}`));
    }
  });
  return problems;
}

/**
 * Every reason a stored document is not one this page can render, in words a
 * founder can act on. Empty means acceptable. Unknown keys are refused, not
 * kept: a key nothing reads is a save that looks answered and changes nothing,
 * which is the exact failure this system exists to end.
 */
export function pageDocumentProblems(spec: PageSpec, doc: unknown): string[] {
  if (!isObject(doc)) return ["The page content must be an object of sections."];
  const problems: string[] = [];
  for (const [sectionId, value] of Object.entries(doc)) {
    const section = spec.sections.find((s) => s.id === sectionId);
    if (!section) {
      problems.push(`"${sectionId}" is not a section of ${spec.label}.`);
      continue;
    }
    if (!isObject(value)) {
      problems.push(`${sectionId} must be an object of fields.`);
      continue;
    }
    for (const [key, v] of Object.entries(value)) {
      const where = `${sectionId}.${key}`;
      if (key === "hidden") {
        if (!section.hideable) problems.push(`${section.label} cannot be hidden.`);
        else if (typeof v !== "boolean") problems.push(`${where} must be true or false.`);
        continue;
      }
      const field = section.fields.find((f) => f.key === key);
      if (field) {
        problems.push(...fieldProblems(field, v, where));
        continue;
      }
      const list = section.lists?.find((l) => l.key === key);
      if (list) {
        problems.push(...listProblems(list, v, where));
        continue;
      }
      problems.push(`${where} is not a field of ${section.label}.`);
    }
  }
  return problems;
}

/**
 * A document with a distinct marker in every field and every list row. Tests
 * render a page from it and look for every marker: a field the page ignores is
 * a field that fails, which is how the Tagline bug gets caught next time.
 */
/**
 * A short fingerprint of one stored content section, so a save can name the
 * words it was made from. The Pages editor sends it with every save and the
 * content route refuses one whose words moved since (another admin, or a boot
 * fixup such as server/lib/governanceWordsKept.ts). Absent and empty read the
 * same, because the editor opens an unwritten section as `{}`.
 */
export function contentVersion(section: unknown): string {
  const empty = section == null || (typeof section === "object" && !Array.isArray(section) && Object.keys(section as object).length === 0);
  const text = empty ? "" : JSON.stringify(section);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function markerDocument(spec: PageSpec, mark = "ZQ"): Doc {
  const doc: Doc = {};
  let n = 0;
  const next = () => `${mark}${String(++n).padStart(3, "0")}`;
  for (const section of spec.sections) {
    const out: Doc = {};
    for (const field of section.fields) out[field.key] = field.kind === "link" ? `/${next().toLowerCase()}` : next();
    for (const list of section.lists ?? []) {
      const ids = list.fixed ?? Array.from({ length: Math.max(1, Math.min(2, list.maxItems)) }, () => "");
      out[list.key] = ids.map((id) => {
        const row: Doc = list.fixed ? { id } : {};
        for (const field of list.fields) row[field.key] = field.kind === "link" ? `/${next().toLowerCase()}` : next();
        return row;
      });
    }
    doc[section.id] = out;
  }
  return doc;
}
