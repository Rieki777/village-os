/**
 * THE INVOICE AS A PDF, written by hand (invoice rails).
 *
 * The email that carries an invoice to the village's Sera inbox attaches it as
 * a PDF. A text-only, single-font PDF is about a hundred lines of the format,
 * so this writes one directly: no dependency, nothing ESM-only to break the
 * Node 22 build, nothing in the client bundle.
 *
 * Helvetica with WinAnsiEncoding draws Latin-1. A character outside it is
 * drawn as "?", never dropped, so a reader can see something was there; the
 * amounts are written with the ISO code ("USD 1200.00"), which needs no
 * symbol at all.
 *
 * It carries what the printable invoice carries and nothing more: no payment
 * details (the invoice says payment goes to the account Finance has on file).
 */
import { exponentOf } from "../../shared/money";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const LEADING = 14;
const FONT_SIZE = 10;
const WRAP = 92;
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LEADING);

/** One string as a PDF literal's inside: escaped, Latin-1, unknown characters as "?". */
export function pdfText(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    const safe = c === 9 ? " " : c >= 32 && c <= 126 ? ch : c >= 160 && c <= 255 ? ch : "?";
    out += safe === "(" || safe === ")" || safe === "\\" ? `\\${safe}` : safe;
  }
  return out;
}

function wrap(line: string): string[] {
  if (line.length <= WRAP) return [line];
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(/\s+/)) {
    for (let w = word; w.length; ) {
      const piece = w.slice(0, WRAP);
      w = w.slice(WRAP);
      if (!cur) cur = piece;
      else if (cur.length + 1 + piece.length <= WRAP) cur += ` ${piece}`;
      else {
        out.push(cur);
        cur = piece;
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * A PDF of blocks of text lines, a blank line between blocks, paged. Every
 * byte offset in the xref is measured over the Latin-1 buffer it describes.
 */
export function textPdf(blocks: string[][]): Buffer {
  const flat: string[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) flat.push("");
    for (const l of b) for (const p of l.split("\n")) flat.push(...wrap(p));
  });
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(flat.length, 1); i += LINES_PER_PAGE) pages.push(flat.slice(i, i + LINES_PER_PAGE));

  // 1 catalog, 2 pages, 3 font, then a page and its content per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((lines, i) => {
    const pageId = pageIds[i];
    const body = [`BT /F1 ${FONT_SIZE} Tf ${LEADING} TL ${MARGIN} ${PAGE_H - MARGIN} Td`, ...lines.map((l) => `(${pdfText(l)}) Tj T*`), "ET"].join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Minor units as "USD 1200.00", exact, no floating point. */
export function moneyWords(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  const neg = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, "0");
  const whole = exp ? digits.slice(0, -exp) : digits;
  const frac = exp ? `.${digits.slice(-exp)}` : "";
  return `${currency} ${neg ? "-" : ""}${whole}${frac}`;
}

export interface InvoicePdfInput {
  billRef: string;
  memberNumber: string | null;
  period: string;
  from: { legalName: string; address: string } | null;
  /**
   * Who sent it, as the village knows them: their village name and their
   * bridge code-name. Set on every copy that leaves the village (Rye,
   * 2026-11-06: the legal name is always private), and then `from` is
   * never printed.
   */
  sender?: { villageName: string; codeName: string | null } | null;
  billTo: { legalName: string; address: string; taxId: string | null } | null;
  lines: Array<{ roleNames: string[]; basisLine: string; amountMinor: number | null; currency: string | null; listedAs: string | null }>;
  currency: string | null;
  totalMinor: number | null;
  supportLine: string;
  workSummary: string | null;
}

export function invoicePdfLines(v: InvoicePdfInput): string[][] {
  const head = [`Invoice for approval`, `Reference: ${v.billRef}`, ...(v.memberNumber ? [`Invoice number: ${v.memberNumber}`] : []), `Period: ${v.period}`];
  const from = v.sender
    ? ["From", `Village name: ${v.sender.villageName}`, ...(v.sender.codeName ? [`Code name: ${v.sender.codeName}`] : [])]
    : v.from
      ? ["From", v.from.legalName, ...v.from.address.split("\n")]
      : [];
  const to = v.billTo ? ["Bill to", v.billTo.legalName, ...v.billTo.address.split("\n"), ...(v.billTo.taxId ? [`Tax number: ${v.billTo.taxId}`] : [])] : [];
  const lines = [
    "Lines",
    ...v.lines.map((l) => {
      const amount = l.amountMinor !== null && l.currency ? moneyWords(l.amountMinor, l.currency) : (l.listedAs ?? "no amount");
      return `${l.roleNames.join(", ")}: ${l.basisLine}: ${amount}`;
    }),
    ...(v.totalMinor !== null && v.currency ? [`Total: ${moneyWords(v.totalMinor, v.currency)}`] : []),
  ];
  const summary = v.workSummary ? ["Work summary", ...v.workSummary.split("\n")] : [];
  return [head, from, to, lines, summary, [v.supportLine]].filter((b) => b.length > 0).map((b) => b.flatMap(wrap));
}

export function invoicePdf(v: InvoicePdfInput): Buffer {
  return textPdf(invoicePdfLines(v));
}
