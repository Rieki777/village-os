/**
 * The hand-written CSV reader (shared/csv.ts), held to RFC 4180 and to the
 * shapes the Governance Canvas Database actually sends: quoted cells with
 * commas, a doubled quote, a name that runs over three lines, an en dash, a
 * curly apostrophe, and a byte order mark when a sheet is saved by hand.
 */
import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvDetailed } from "./csv";

describe("parseCsv", () => {
  it("reads bare and quoted fields, with commas inside quotes", () => {
    expect(parseCsv('a,b,c\n"one, two",3,"four"\n')).toEqual([
      ["a", "b", "c"],
      ["one, two", "3", "four"],
    ]);
  });

  it("reads a doubled quote inside a quoted field as one quote", () => {
    expect(parseCsv('"She said ""consent"", twice",x')).toEqual([['She said "consent", twice', "x"]]);
  });

  it("keeps a line break inside a quoted cell, as the database's three-line paper title needs", () => {
    const text =
      '"Governance resource name","Type"\r\n' +
      '"Governance and management dynamics of landscape restoration at\nmultiple scales","Scientific Paper "\r\n';
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("Governance and management dynamics of landscape restoration at\nmultiple scales");
    expect(rows[1][1]).toBe("Scientific Paper ");
  });

  it("ends a record at CRLF, at a lone LF and at a lone CR", () => {
    expect(parseCsv("a,b\r\nc,d\ne,f\rg,h")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
  });

  it("adds no empty record for a trailing line break, and keeps an empty last field", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,\n")).toEqual([["a", ""]]);
    expect(parseCsv('a,""')).toEqual([["a", ""]]);
    expect(parseCsv("")).toEqual([]);
  });

  it("round-trips an en dash, an em dash and a curly apostrophe exactly", () => {
    const rows = parseCsv('"Sociocracy – basic concepts and principles","ABCD Process — Backcasting","Ostrom Didn’t Say That"');
    expect(rows[0][0]).toBe("Sociocracy – basic concepts and principles");
    expect(rows[0][0].charCodeAt(11)).toBe(0x2013);
    expect(rows[0][1]).toContain("—");
    expect(rows[0][2]).toBe("Ostrom Didn’t Say That");
    expect(rows.flat().join("")).not.toContain("�");
  });

  it("drops one byte order mark at the start, so the first header keeps its name", () => {
    const rows = parseCsv('﻿"Governance resource name","Type"\n"x","y"');
    expect(rows[0][0]).toBe("Governance resource name");
    // Only the first: a BOM anywhere else is data.
    expect(parseCsv("a,﻿b")[0][1]).toBe("﻿b");
  });

  it("does not trim: a space is data until the caller says otherwise", () => {
    expect(parseCsv(' a ,b ,"Canvas "')).toEqual([[" a ", "b ", "Canvas "]]);
  });
});

describe("parseCsvDetailed", () => {
  it("reports nothing for a clean file", () => {
    expect(parseCsvDetailed('"a","b"\n"c","d"\n').problems).toEqual([]);
  });

  it("reports a quote inside a bare field, and still reads it literally", () => {
    const out = parseCsvDetailed('ab"c,d');
    expect(out.rows).toEqual([['ab"c', "d"]]);
    expect(out.problems[0]).toMatch(/line 1: a quote inside an unquoted field/);
  });

  it("reports a quoted field left open at the end, which is what a cut-off download looks like", () => {
    const out = parseCsvDetailed('"a","b\nc');
    expect(out.problems[0]).toMatch(/still open at the end/);
  });
});
