/**
 * A CSV READER, WRITTEN BY HAND TO RFC 4180 (2026-09-28, canvas resources).
 *
 * The Governance Canvas Database arrives as CSV from a public spreadsheet
 * (server/lib/canvasResourcesSync.ts), and the plan asked for no new
 * dependency to read it. So this is the whole of the grammar, in one pass
 * over the characters:
 *
 *   - a field is either bare, or wrapped in double quotes;
 *   - inside quotes, a doubled quote ("") is one quote, and a comma, a
 *     carriage return or a line feed is part of the field;
 *   - a record ends at CRLF, at a lone LF, or at a lone CR (RFC 4180 names
 *     CRLF; spreadsheets and hand edits send the other two, and refusing them
 *     would refuse real files for no gain);
 *   - one byte order mark at the very start is dropped, because a file saved
 *     by Excel or Sheets carries one and it would otherwise become part of the
 *     first header's name, so a header check would say the first column is
 *     missing when it is there.
 *
 * WHAT IT DOES NOT DO, and each one is deliberate:
 *
 *   - It does not trim. A space is data until the caller says it is not; the
 *     sync trims the fields it knows need trimming (the Type column carries
 *     trailing spaces upstream) and says so where it does.
 *   - It does not guess a delimiter or a quote character. The database says
 *     CSV, and a guess that is wrong once is a silent mis-read forever.
 *   - It does not throw on a stray quote inside a bare field, or on a quoted
 *     field that never closes. Both are read as literally as possible and the
 *     row count or the header check downstream is what notices. `strict`
 *     reports them instead, for a caller that wants to refuse.
 *
 * Isomorphic: no Node import, so a client could read a file a person picks.
 */

export interface CsvParseResult {
  rows: string[][];
  /**
   * Places where the text broke the grammar: a quote inside a bare field, or
   * a quoted field still open at the end of the text. Empty for a clean file.
   */
  problems: string[];
}

const BOM = "﻿";

/**
 * Every record in `text`, each as its list of fields, in order.
 *
 * A trailing line break after the last record adds no empty record. A blank
 * line in the middle is a record with one empty field, as RFC 4180 reads it;
 * `parseCsv` keeps it and the caller decides whether a row with nothing in it
 * means anything.
 */
export function parseCsvDetailed(input: string): CsvParseResult {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  const problems: string[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false; // inside a quoted field
  let wasQuoted = false; // this field opened with a quote
  let line = 1;

  const endField = () => {
    row.push(field);
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (field === "" && !wasQuoted) {
        quoted = true;
        wasQuoted = true;
      } else {
        // A quote in the middle of a bare field, or after a closing quote.
        problems.push(`line ${line}: a quote inside an unquoted field`);
        field += c;
      }
    } else if (c === ",") {
      endField();
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      line++;
      endRow();
    } else if (c === "\n") {
      line++;
      endRow();
    } else {
      field += c;
    }
  }
  if (quoted) problems.push(`line ${line}: a quoted field is still open at the end of the text`);
  // The last record, unless the text ended with its line break.
  if (field !== "" || row.length > 0 || wasQuoted) endRow();
  return { rows, problems };
}

/** The records only. See `parseCsvDetailed` for the grammar and what it forgives. */
export function parseCsv(text: string): string[][] {
  return parseCsvDetailed(text).rows;
}
