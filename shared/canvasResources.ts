/**
 * CANVAS RESOURCES: the Governance Canvas Database, read into a village's own
 * shelf (plan 5.1-5.3, Wave 4 of the canvas build, 2026-09-28).
 *
 * The Bioregional Weaving Labs Collective and Commonland keep a public
 * spreadsheet of governance resources beside their canvas: articles, books,
 * canvases, reports, papers, self-assessments and toolkits. A village shows
 * the ones that speak to a block in that block's Learn frame. This file is
 * the part both sides share: where the database is, which five columns are
 * read, and how one row of it becomes one resource. The fetch, the storing
 * and the nightly job are server/lib/canvasResourcesSync.ts; the SQL is
 * server/repos/canvasResources.ts; the block tags are
 * shared/canvasResourceTags.ts.
 *
 * ── ONLY FIVE COLUMNS, AND NO PERSON ───────────────────────────────────────
 *
 * The sheet also holds who suggested each row: a name, an email address, an
 * organisation and a timestamp, and eight of the name cells hold an email
 * address typed in by hand (counted on 2026-09-24, never copied). None of
 * that is ever fetched: the URL below asks the sheet's own query language for
 * columns A to E, and the header check refuses anything but the five names in
 * `CANVAS_DATABASE_COLUMNS`. As a second lock, `stripEmails` takes any
 * email-shaped text out of every field before it is stored, so a person's
 * address typed into a description cannot reach this village's database
 * either. shared/canvasResources.test.ts fails if any stored field of any row
 * still matches `EMAIL_PATTERN`.
 *
 * ── WHAT NORMALISING DOES, EACH STEP ASKED FOR BY THE DATA ────────────────
 *
 *   - Every field is trimmed and its runs of spaces and line breaks become
 *     one space. Upstream, four Type values end in a space ("Canvas ",
 *     "Report ", "Scientific Paper ", "Self-assessment "), one name ends in
 *     one, and one paper's name runs over three lines.
 *   - "Keywords:" is split out of the description into its own list (57 of
 *     58 rows carry it). The description keeps the sentence before it.
 *   - A URL cell that is not an http or https address is a FILENAME
 *     ("4RFA Introduction.pdf", "BWL STRATEGY 3.0 (FEBRUARY 2026 EDIT).docx"):
 *     15 rows. They are kept, with no link and `linkPending`, and a member is
 *     told the database lists them without a link yet. No call to action:
 *     the files are the authors' and are not ours to ask for on a member's
 *     behalf.
 *   - Two rows with the same address, once the address is normalised, are one
 *     resource (`urlIdentity`): the host in lower case, a leading `www.` and a
 *     trailing slash dropped, http and https the same. The first row keeps its
 *     words and the keywords of both are kept.
 *
 * ── THE KEY ───────────────────────────────────────────────────────────────
 *
 * A resource is keyed by its normalised name and its normalised address
 * together (`identity`); the server stores the SHA-1 of that string as
 * `resource_key`, the table's primary key. A row whose name or address
 * changes upstream is therefore a new resource, and the old one is marked
 * withdrawn by the next read, never deleted. `nameSlug` is also what
 * shared/canvasResourceTags.ts keys its hand-made block map by, because a
 * person mapping rows to blocks reads names.
 *
 * Isomorphic: no Node import. The client imports the constants and the
 * payload types; nothing here touches a network or a database.
 */
import type { CanvasBlockId } from "./governanceCanvas";

/**
 * The database, and the credit a village shows beside anything taken from it.
 * `sheetUrl` is the spreadsheet a person can open; `csvUrl` asks it for the
 * five public columns only, as CSV, with the first row as headers.
 */
export const CANVAS_DATABASE = {
  credit: "Governance Canvas Database, Bioregional Weaving Labs Collective and Commonland",
  sheetUrl: "https://docs.google.com/spreadsheets/d/1rDA_fXJe-WziLzhqV2WLBBTdSgNyPa7AwK_ftuGDs24/",
  csvUrl:
    "https://docs.google.com/spreadsheets/d/1rDA_fXJe-WziLzhqV2WLBBTdSgNyPa7AwK_ftuGDs24/gviz/tq" +
    "?tqx=out:csv&sheet=Database&headers=1&tq=select%20A%2CB%2CC%2CD%2CE",
} as const;

/** The five columns read, by the header each carries upstream. Nothing else is kept. */
export const CANVAS_DATABASE_COLUMNS = {
  name: "Governance resource name",
  type: "Type",
  authors: "Author(s)",
  description: "Short description",
  url: "URL",
} as const;
export type CanvasDatabaseField = keyof typeof CANVAS_DATABASE_COLUMNS;
const FIELDS = Object.keys(CANVAS_DATABASE_COLUMNS) as CanvasDatabaseField[];

/** How long each stored field may be. Strict MySQL refuses an oversized write, so every one is clipped first. */
export const RESOURCE_LIMITS = {
  name: 500,
  type: 64,
  authors: 500,
  description: 4000,
  url: 2048,
  keyword: 80,
  keywords: 30,
  nameSlug: 200,
} as const;

/**
 * Anything shaped like an email address. Deliberately broad: a false match
 * costs a few characters of a description, and a miss would store a person's
 * address.
 */
export const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;

/** `text` with every email-shaped run removed. */
export function stripEmails(text: string): string {
  return String(text ?? "").replace(EMAIL_PATTERN, "");
}

/** Whether any email-shaped text is left in `text`. */
export function holdsEmail(text: string): boolean {
  return new RegExp(EMAIL_PATTERN.source, "i").test(String(text ?? ""));
}

/** Trimmed, with every run of whitespace (line breaks included) as one space. */
export function oneLine(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** A field as stored: no email, one line, clipped. */
function clean(text: string, max: number): string {
  return oneLine(stripEmails(text)).slice(0, max).trim();
}

/**
 * Built with the constructor: `pnpm check` typechecks at the ES5 default,
 * which refuses the `u` flag on a literal (TS1501). server/lib/canvasNames.ts
 * does the same.
 */
const NOT_A_LETTER_OR_DIGIT = new RegExp("[^\\p{L}\\p{N}]+", "gu");

/**
 * A name as a key: lower case, letters and digits in any script, every other
 * run of characters one hyphen. "Sociocracy – basic concepts and principles"
 * and "Sociocracy - Basic Concepts and Principles" are the same slug.
 */
export function nameSlug(name: string): string {
  return oneLine(name)
    .normalize("NFKC")
    .toLowerCase()
    .replace(NOT_A_LETTER_OR_DIGIT, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, RESOURCE_LIMITS.nameSlug)
    .replace(/-+$/, "");
}

/** The cell as a web address, or null when it is not one (a filename, a title, nothing). */
export function webAddress(cell: string): URL | null {
  const text = oneLine(cell);
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * What makes two addresses the same resource: the host in lower case (the URL
 * parser does that) without a leading `www.`, no default port, no trailing
 * slash, and no scheme, so an http and an https copy of one page collapse.
 * The query and the fragment stay: a fragment is sometimes the whole point
 * ("extended-practises#beginning-anew").
 */
export function urlIdentity(url: URL): string {
  const host = url.host.replace(/^www\./, "");
  const pathname = url.pathname.replace(/\/+$/, "");
  return `//${host}${pathname}${url.search}${url.hash}`;
}

/** One row of the database, normalised and ready to store. */
export interface CanvasResourceInput {
  /** `nameSlug|address identity`. The server stores its SHA-1 as `resource_key`. */
  identity: string;
  nameSlug: string;
  name: string;
  type: string;
  authors: string;
  description: string;
  keywords: string[];
  /** The address as the database gives it, or null when the row has none yet. */
  url: string | null;
  /** The URL cell held a filename or nothing: the database lists this without a link yet. */
  linkPending: boolean;
}

/** The description with its "Keywords:" tail split off. The LAST "Keywords:" is the tail. */
export function splitKeywords(description: string): { description: string; keywords: string[] } {
  const text = String(description ?? "");
  const at = text.toLowerCase().lastIndexOf("keywords:");
  if (at === -1) return { description: text, keywords: [] };
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of text.slice(at + "keywords:".length).split(/[,;]/)) {
    const word = oneLine(raw).replace(/[.\s]+$/, "").slice(0, RESOURCE_LIMITS.keyword).trim();
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    keywords.push(word);
    if (keywords.length >= RESOURCE_LIMITS.keywords) break;
  }
  return { description: text.slice(0, at), keywords };
}

/** One upstream row, by field, into what is stored. Null when the row has no name. */
export function normaliseRow(cells: Record<CanvasDatabaseField, string>): CanvasResourceInput | null {
  const name = clean(cells.name, RESOURCE_LIMITS.name);
  if (!name) return null;
  const split = splitKeywords(stripEmails(cells.description));
  const keywords = split.keywords.map((k) => clean(k, RESOURCE_LIMITS.keyword)).filter(Boolean);
  const urlCell = clean(cells.url, RESOURCE_LIMITS.url + 1);
  const address = urlCell.length <= RESOURCE_LIMITS.url ? webAddress(urlCell) : null;
  const slug = nameSlug(name) || "untitled";
  const where = address ? urlIdentity(address) : `file:${urlCell.toLowerCase()}`;
  return {
    identity: `${slug}|${where}`,
    nameSlug: slug,
    name,
    type: clean(cells.type, RESOURCE_LIMITS.type),
    authors: clean(cells.authors, RESOURCE_LIMITS.authors),
    description: clean(split.description, RESOURCE_LIMITS.description),
    keywords,
    url: address ? urlCell : null,
    linkPending: !address,
  };
}

export type CanvasDatabaseRead =
  | { ok: true; resources: CanvasResourceInput[] }
  | { ok: false; refusal: string };

/**
 * The whole table, as `parseCsv` returns it, into resources: the header
 * checked by NAME, every other column dropped, each row normalised, and
 * duplicates collapsed.
 *
 * REFUSES, and says why, when a header is missing or when there is not one
 * row with a name. Both are what a changed or emptied sheet looks like, and
 * writing either would mark every resource the village has as withdrawn. A
 * refusal writes nothing; the caller keeps the rows it had.
 */
export function readCanvasDatabase(table: readonly (readonly string[])[]): CanvasDatabaseRead {
  const header = (table[0] ?? []).map((h) => oneLine(h));
  const at = {} as Record<CanvasDatabaseField, number>;
  const missing: string[] = [];
  for (const field of FIELDS) {
    const index = header.indexOf(CANVAS_DATABASE_COLUMNS[field]);
    if (index === -1) missing.push(`"${CANVAS_DATABASE_COLUMNS[field]}"`);
    at[field] = index;
  }
  if (missing.length) {
    return {
      ok: false,
      refusal:
        `The Governance Canvas Database changed shape: its first row no longer names ${missing.join(", ")}. ` +
        "Nothing was written, and the shelf keeps the resources it had.",
    };
  }

  const resources: CanvasResourceInput[] = [];
  const byIdentity = new Map<string, CanvasResourceInput>();
  const byAddress = new Map<string, CanvasResourceInput>();
  for (const row of table.slice(1)) {
    const cells = {} as Record<CanvasDatabaseField, string>;
    for (const field of FIELDS) cells[field] = row[at[field]] ?? "";
    const resource = normaliseRow(cells);
    if (!resource) continue;
    const address = resource.url ? resource.identity.slice(resource.identity.indexOf("|") + 1) : null;
    const earlier = (address && byAddress.get(address)) || byIdentity.get(resource.identity);
    if (earlier) {
      // The same resource listed twice: the first row's words stay, and the keywords of both.
      const known = new Set(earlier.keywords.map((k) => k.toLowerCase()));
      for (const k of resource.keywords) {
        if (earlier.keywords.length >= RESOURCE_LIMITS.keywords) break;
        if (!known.has(k.toLowerCase())) {
          known.add(k.toLowerCase());
          earlier.keywords.push(k);
        }
      }
      continue;
    }
    resources.push(resource);
    byIdentity.set(resource.identity, resource);
    if (address) byAddress.set(address, resource);
  }
  if (!resources.length) {
    return {
      ok: false,
      refusal:
        "The Governance Canvas Database answered with its headers and no resource under them. " +
        "Nothing was written, and the shelf keeps the resources it had.",
    };
  }
  return { ok: true, resources };
}

// ── What the Learn frame reads (GET /api/canvas/resources) ─────────────────

/** Where a resource's placing under a block came from. See shared/canvasResourceTags.ts. */
export type ResourcePlacing = "village" | "platform" | "suggested";

/** Whether an address answered the last time the village checked it. */
export type ResourceLinkState = "unchecked" | "ok" | "broken" | "refused";

/** The surfaces that ask for resources. A safety surface never carries a row `safetyExcluded` names. */
export const RESOURCE_SURFACES = ["learn", "safety"] as const;
export type ResourceSurface = (typeof RESOURCE_SURFACES)[number];

export interface CanvasResourceView {
  key: string;
  name: string;
  type: string;
  authors: string;
  description: string;
  keywords: string[];
  url: string | null;
  linkPending: boolean;
  link: ResourceLinkState;
  /** ISO instant of the last link check, or null. */
  linkCheckedAt: string | null;
  /** How it came to be under this block, and for a suggestion the keyword that matched. */
  placing: { by: ResourcePlacing; keyword: string | null };
  /** Every block it shows under in this village, in canvas order, for the pen's editor. */
  blocks: CanvasBlockId[];
}

export interface CanvasResourcesPayload {
  block: CanvasBlockId;
  surface: ResourceSurface;
  resources: CanvasResourceView[];
  credit: { text: string; url: string };
  /**
   * Where the shelf came from. `database`: read from the database itself, at
   * `asOf`. `snapshot`: the copy shipped with the platform, taken on `asOf`,
   * because this village has not read the database itself yet.
   */
  source: { kind: "database" | "snapshot"; asOf: string | null; syncOn: boolean };
  /** BWL's own suggestion form, once a village has set `canvas.suggest_url`. Null until then. */
  suggestUrl: string | null;
  /** Whether this viewer may change which blocks a resource shows under (the canvas pen). */
  mayPlace: boolean;
}
