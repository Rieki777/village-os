/**
 * One row of the Governance Canvas Database into one stored resource
 * (shared/canvasResources.ts): the header read by NAME and refused when it
 * drifts, the five columns and nothing else, email-shaped text gone from
 * every field, Type trimmed, "Keywords:" split out, filenames kept as
 * "link pending", and duplicates collapsed by address.
 *
 * The last block reads the SHIPPED SNAPSHOT (server/seeds/canvas-resources.json)
 * through the same function, so a snapshot that stopped reading would fail
 * here before it failed on a village with no network.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv";
import {
  CANVAS_DATABASE,
  CANVAS_DATABASE_COLUMNS,
  EMAIL_PATTERN,
  holdsEmail,
  nameSlug,
  normaliseRow,
  readCanvasDatabase,
  splitKeywords,
  stripEmails,
  urlIdentity,
  type CanvasResourceInput,
} from "./canvasResources";

const HEADER = Object.values(CANVAS_DATABASE_COLUMNS);
const row = (name: string, type = "Article", authors = "Sociocracy For All", description = "About consent. Keywords: decision making, consent.", url = "https://www.sociocracyforall.org/consent-decision-making/") => [
  name,
  type,
  authors,
  description,
  url,
];

/** Every stored string of a resource, keywords one by one, so a test can hold ALL of them to a rule. */
const storedFields = (r: CanvasResourceInput): string[] => [
  r.name,
  r.type,
  r.authors,
  r.description,
  r.url ?? "",
  r.nameSlug,
  r.identity,
  ...r.keywords,
];

describe("the header, read by name", () => {
  it("reads the five columns wherever they sit, and drops every other column", () => {
    const table = [
      ["Timestamp", "URL", "Email Address", "Type", "Your name", "Short description", "Author(s)", "Governance resource name", "Organization(s)"],
      ["2026-01-01", "https://example.org/a", "someone@example.org", "Canvas ", "Ada", "A canvas. Keywords: roles.", "Team Canvas", "Team Canvas", "Org"],
    ];
    const read = readCanvasDatabase(table);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.resources).toHaveLength(1);
    const r = read.resources[0];
    expect(r.name).toBe("Team Canvas");
    expect(r.type).toBe("Canvas");
    expect(r.url).toBe("https://example.org/a");
    // Nothing from the columns that are not ours reached the resource.
    expect(JSON.stringify(r)).not.toMatch(/Ada|Org"|2026-01-01|someone/);
  });

  it("REFUSES when a header drifts, naming what is missing, so nothing is written", () => {
    const renamed = [["Resource", "Type", "Author(s)", "Short description", "URL"], row("Consent decision making")];
    const read = readCanvasDatabase(renamed);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.refusal).toContain('"Governance resource name"');
    expect(read.refusal).toContain("Nothing was written, and the shelf keeps the resources it had.");
  });

  it("refuses an HTML page, which is what a sheet made private answers with", () => {
    const read = readCanvasDatabase(parseCsv("<!DOCTYPE html><html><body>Sign in</body></html>"));
    expect(read.ok).toBe(false);
  });

  it("refuses a sheet with its headers and no named row, which would otherwise withdraw everything", () => {
    const read = readCanvasDatabase([HEADER, ["", "", "", "", ""]]);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.refusal).toContain("no resource under them");
  });
});

describe("normalising a row", () => {
  it("trims Type, which carries trailing spaces upstream", () => {
    for (const type of ["Canvas ", "Report ", "Scientific Paper ", "Self-assessment "]) {
      const r = normaliseRow({ name: "x", type, authors: "", description: "", url: "" })!;
      expect(r.type).toBe(type.trim());
    }
  });

  it("splits Keywords out of the description, keeping the sentence before it", () => {
    expect(splitKeywords("Explains consent. Keywords: decision making, consent, objections, sociocracy, circles, power.")).toEqual({
      description: "Explains consent. ",
      keywords: ["decision making", "consent", "objections", "sociocracy", "circles", "power"],
    });
    const r = normaliseRow({ name: "x", type: "", authors: "", description: "Explains consent. Keywords: NVC, nvc, empathy.", url: "" })!;
    expect(r.description).toBe("Explains consent.");
    // Once each, in the row's own spelling.
    expect(r.keywords).toEqual(["NVC", "empathy"]);
    expect(splitKeywords("No keywords here.")).toEqual({ description: "No keywords here.", keywords: [] });
  });

  it("makes a name one line, as the three-line paper title needs, and trims a trailing space", () => {
    const r = normaliseRow({
      name: "Governance and management dynamics of landscape restoration at\nmultiple scales: Learning\r\nfrom Sweden",
      type: "",
      authors: "",
      description: "",
      url: "",
    })!;
    expect(r.name).toBe("Governance and management dynamics of landscape restoration at multiple scales: Learning from Sweden");
    expect(normaliseRow({ name: "Contractual Role Cards ", type: "", authors: "", description: "", url: "" })!.name).toBe("Contractual Role Cards");
  });

  it("keeps a row whose URL cell is a filename, with no link and link pending", () => {
    for (const cell of ["4RFA Introduction.pdf", "BWL STRATEGY 3.0 (FEBRUARY 2026 EDIT).docx", "Governance Canvas", "", "ftp://files.example.org/x.pdf"]) {
      const r = normaliseRow({ name: "A resource", type: "Report", authors: "", description: "", url: cell })!;
      expect(r.url, cell).toBeNull();
      expect(r.linkPending, cell).toBe(true);
    }
    const linked = normaliseRow({ name: "A resource", type: "", authors: "", description: "", url: " https://mspguide.org " })!;
    expect(linked.url).toBe("https://mspguide.org");
    expect(linked.linkPending).toBe(false);
  });

  it("skips a row with no name", () => {
    expect(normaliseRow({ name: "  ", type: "Article", authors: "x", description: "y", url: "https://example.org" })).toBeNull();
  });

  it("slugs a name so punctuation and case do not make two keys", () => {
    expect(nameSlug("Sociocracy – basic concepts and principles")).toBe("sociocracy-basic-concepts-and-principles");
    expect(nameSlug("Sociocracy - Basic Concepts and Principles")).toBe("sociocracy-basic-concepts-and-principles");
    expect(nameSlug("Ostrom Didn’t Say That")).toBe("ostrom-didn-t-say-that");
    expect(nameSlug("Wegwijzer Rechten van de Natuur")).toBe("wegwijzer-rechten-van-de-natuur");
    // Letters in any script stay letters.
    expect(nameSlug("Gebiedsteam ÖÄ ã")).toBe("gebiedsteam-öä-ã");
  });

  it("normalises an address: host case, www, trailing slash and scheme do not make two resources", () => {
    const id = (u: string) => urlIdentity(new URL(u));
    expect(id("https://www.onboardingnature.com")).toBe(id("http://onboardingnature.com/"));
    expect(id("https://WWW.SociocracyForAll.org/content/")).toBe(id("https://sociocracyforall.org/content"));
    // A fragment can be the whole point, so it stays part of the address.
    expect(id("https://plumvillage.org/mindfulness/extended-practises#beginning-anew")).not.toBe(
      id("https://plumvillage.org/mindfulness/extended-practises"),
    );
  });

  it("collapses two rows with the same address into one, keeping the first row's words and both rows' keywords", () => {
    const read = readCanvasDatabase([
      HEADER,
      row("Onboarding Nature Toolkit", "Toolkit", "Onboarding Nature", "Nature on the board. Keywords: rights of nature, stakeholders.", "https://www.onboardingnature.com"),
      row("Onboarding Nature toolkit ", "Toolkit ", "Onboarding Nature", "Again. Keywords: representation, stakeholders.", "https://onboardingnature.com/"),
    ]);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.resources).toHaveLength(1);
    expect(read.resources[0].description).toBe("Nature on the board.");
    expect(read.resources[0].keywords).toEqual(["rights of nature", "stakeholders", "representation"]);
  });

  it("keeps two different resources with no link apart", () => {
    const read = readCanvasDatabase([HEADER, row("Commons Canvas", "Canvas", "", "", "Commons Canvas (versie 1.01).pdf"), row("Team Canvas", "Canvas", "", "", "")]);
    expect(read.ok && read.resources.map((r) => r.name)).toEqual(["Commons Canvas", "Team Canvas"]);
  });
});

describe("no stored field ever holds an email address", () => {
  it("the pattern sees the shapes a person types", () => {
    for (const s of ["ada@example.org", "Ada.Lovelace+canvas@mail.example.co.uk", "x_y%z@sub-domain.example.io"]) {
      expect(holdsEmail(s), s).toBe(true);
      expect(stripEmails(`before ${s} after`)).toBe("before  after");
    }
    // An @ in a path is not an address.
    expect(holdsEmail("https://medium.com/@good-shift/governance")).toBe(false);
  });

  it("strips an address typed into EVERY column, before anything is stored", () => {
    const table = [
      HEADER,
      [
        "Consent decision making (ada@example.org)",
        "Article bob@example.org",
        "Sociocracy For All, carol.smith@sociocracy.example.org",
        "Explains consent; write to dan@example.org. Keywords: decision making, eve@example.org, consent.",
        "https://www.sociocracyforall.org/consent-decision-making/?by=frank@example.org",
      ],
      ["gina@example.org", "Report", "Hal <hal@example.net>", "Keywords: roles", "ivan@example.org"],
    ];
    const read = readCanvasDatabase(table);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.resources.length).toBeGreaterThan(0);
    for (const r of read.resources) {
      for (const field of storedFields(r)) {
        expect(field, JSON.stringify(field)).not.toMatch(new RegExp(EMAIL_PATTERN.source, "i"));
      }
    }
    expect(read.resources[0].name).toBe("Consent decision making ()");
    expect(read.resources[0].keywords).toEqual(["decision making", "consent"]);
  });
});

describe("the shipped snapshot, server/seeds/canvas-resources.json", () => {
  const file = path.join(__dirname, "..", "server", "seeds", "canvas-resources.json");
  const raw = fs.readFileSync(file, "utf8");
  const doc = JSON.parse(raw) as { header: string[]; rows: string[][]; taken: string; source: string; credit: string };

  it("holds the five public columns and nothing else, with its source and credit", () => {
    expect(doc.header).toEqual(HEADER);
    expect(doc.rows.every((r) => r.length === 5)).toBe(true);
    expect(doc.source).toBe(CANVAS_DATABASE.csvUrl);
    expect(doc.credit).toBe(CANVAS_DATABASE.credit);
    expect(doc.taken).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No submitter's column by any name, and no address anywhere in the file.
    expect(raw).not.toMatch(/Email Address|Your name|Timestamp|Organization\(s\)|File upload/);
    expect(holdsEmail(raw)).toBe(false);
  });

  it("is valid UTF-8 with its en dash intact and no replacement character", () => {
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    expect(raw).toContain("Sociocracy – basic concepts and principles");
    expect(raw).not.toContain("�");
  });

  it("reads through the same check as the nightly read: 58 resources, 15 of them link pending", () => {
    const read = readCanvasDatabase([doc.header, ...doc.rows]);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.resources).toHaveLength(58);
    expect(read.resources.filter((r) => r.linkPending)).toHaveLength(15);
    expect(new Set(read.resources.map((r) => r.identity)).size).toBe(58);
    const types = new Set(read.resources.map((r) => r.type));
    expect([...types].sort()).toEqual(["Article", "Book", "Canvas", "Report", "Scientific Paper", "Self-assessment", "Toolkit"]);
    const en = read.resources.find((r) => r.name.startsWith("Sociocracy "));
    expect(en?.name).toBe("Sociocracy – basic concepts and principles");
    for (const r of read.resources) for (const field of storedFields(r)) expect(holdsEmail(field)).toBe(false);
  });
});
