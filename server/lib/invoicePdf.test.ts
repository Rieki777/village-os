import { describe, expect, it } from "vitest";
import { invoicePdf, invoicePdfLines, pdfText, textPdf } from "./invoicePdf";

/** The text a content stream draws, unescaped, in order. */
function drawn(pdf: Buffer): string[] {
  const s = pdf.toString("latin1");
  const out: string[] = [];
  const re = /\(((?:\\.|[^\\)])*)\) Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1].replace(/\\([()\\])/g, "$1"));
  return out;
}

const view = {
  billRef: "us-llc-0007",
  memberNumber: "INV-12",
  period: "6 Oct to 3 Nov 2026",
  from: { legalName: "A. Member", address: "1 Road\nTown" },
  billTo: { legalName: "Payer LLC", address: "2 Street", taxId: "99-1" },
  lines: [
    { roleNames: ["Steward"], basisLine: "28 of 28 days", amountMinor: 120000, currency: "USD", listedAs: null },
    { roleNames: ["Host (allowance)"], basisLine: "listed", amountMinor: null, currency: null, listedAs: "in-kind" },
  ],
  currency: "USD",
  totalMinor: 120000,
  supportLine: "Support document for the member's own invoice.",
  workSummary: "Did (the) thing \\ well",
};

describe("a text PDF with no dependency", () => {
  it("is a well-formed PDF: header, objects, an xref whose offsets point at each object, and a trailer", () => {
    const pdf = textPdf([["Hello"]]);
    const s = pdf.toString("latin1");
    expect(s.startsWith("%PDF-1.4\n")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)\n/.exec(s)?.[1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const offsets = [...s.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThanOrEqual(5);
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
  it("escapes parentheses and backslashes, and writes a character it cannot draw as ?", () => {
    expect(pdfText("a(b)c\\d")).toBe("a\\(b\\)c\\\\d");
    expect(pdfText("₡ 5 é")).toBe("? 5 é");
  });
  it("starts a new page when the lines run past the bottom", () => {
    const many = Array.from({ length: 140 }, (_, i) => `line ${i}`);
    const s = textPdf([many]).toString("latin1");
    expect(s.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
    expect(drawn(textPdf([many]))).toContain("line 139");
  });
});

describe("the invoice PDF", () => {
  it("carries the reference, the parties, every line and the total", () => {
    const text = drawn(invoicePdf(view)).join("\n");
    expect(text).toContain("Reference: us-llc-0007");
    expect(text).toContain("Invoice number: INV-12");
    expect(text).toContain("A. Member");
    expect(text).toContain("Payer LLC");
    expect(text).toContain("Steward");
    expect(text).toContain("USD 1200.00");
    expect(text).toContain("in-kind");
    expect(text).toContain("Total: USD 1200.00");
    expect(text).toContain("Did (the) thing \\ well");
  });
  it("wraps a long line instead of running off the page", () => {
    const lines = invoicePdfLines({ ...view, workSummary: "word ".repeat(60) });
    expect(Math.max(...lines.flat().map((l) => l.length))).toBeLessThanOrEqual(92);
  });
});
