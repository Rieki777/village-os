/**
 * DOCUMENTS FOR THE ROLE CARD TESTS, built in code so no binary is committed:
 * a real zip (deflated, with its central directory) for a .docx, and a real
 * one-page PDF in Helvetica. Read by server/lib/roleDocumentText.test.ts and
 * server/routes/roleCardImport.test.ts. For tests and for nothing else.
 */
import zlib from "node:zlib";

/** A zip of the given entries, deflated, with its central directory. */
export function makeZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content, "utf8");
    const data = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export const para = (text: string, opts: { style?: string; list?: boolean } = {}) =>
  `<w:p><w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ""}${opts.list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ""}</w:pPr>${text
    .split("|")
    .map((t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`)
    .join("")}</w:p>`;

/** A Word document whose body is these paragraphs. */
export function makeDocx(paragraphs: string[]): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:sectPr/></w:body></w:document>`;
  return makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": xml });
}

/** A PDF of `pages` pages (one by default), each drawing the lines on their own lines in Helvetica. */
export function makePdf(lines: string[], pages = 1): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  // Objects 1 to 4 are shared; every page is its own object from 5 on, all drawing the one stream.
  const pageIds = Array.from({ length: pages }, (_, i) => i + 5);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    ...pageIds.map(() => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>"),
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** PDF objects, numbered from 1, with a true cross-reference table. Each object is its bytes. */
function pdfOf(objects: Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [];
  let at = parts[0].length;
  objects.forEach((o, i) => {
    offsets.push(at);
    const piece = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), o, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(piece);
    at += piece.length;
  });
  const table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  parts.push(Buffer.from(`${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}

/**
 * A COMPRESSION BOMB: one page whose content stream is a few tens of
 * kilobytes deflated and `inflatedBytes` once inflated, every byte of it a
 * text-show operator, so reading its words is real work and real memory.
 */
export function makeBombPdf(inflatedBytes = 64 * 1024 * 1024): Buffer {
  const op = Buffer.from("(A) Tj ", "latin1");
  const raw = Buffer.alloc(inflatedBytes);
  for (let i = 0; i < inflatedBytes; i += op.length) op.copy(raw, i, 0, Math.min(op.length, inflatedBytes - i));
  const body = Buffer.concat([Buffer.from("BT /F1 12 Tf 72 720 Td ", "latin1"), raw, Buffer.from(" ET", "latin1")]);
  const deflated = zlib.deflateSync(body, { level: 9 });
  return pdfOf([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [5 0 R] /Count 1 >>", "latin1"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "latin1"),
    Buffer.concat([Buffer.from(`<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), deflated, Buffer.from("\nendstream", "latin1")]),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>", "latin1"),
  ]);
}

/** One real page in a page tree that claims `claimed` of them, as a crafted file might. */
export function makeClaimedPagesPdf(claimed: number): Buffer {
  const stream = "BT /F1 12 Tf 72 720 Td (Gate keeper) Tj ET";
  return pdfOf([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from(`<< /Type /Pages /Kids [5 0 R] /Count ${claimed} >>`, "latin1"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "latin1"),
    Buffer.from(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "latin1"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>", "latin1"),
  ]);
}

/** A readable PDF whose cross-reference table points every object at the wrong place, and whose startxref lies. */
export function makeBrokenXrefPdf(lines: string[]): Buffer {
  const good = makePdf(lines).toString("latin1");
  return Buffer.from(
    good.replace(/^(\d{10}) 00000 n $/gm, (_m, o: string) => `${String(Number(o) + 7919).padStart(10, "0")} 00000 n `).replace(/startxref\n\d+/, "startxref\n999999"),
    "latin1",
  );
}
