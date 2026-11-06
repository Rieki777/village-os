import { describe, expect, it } from "vitest";
import { sameMigrationText, sha256Hex } from "./migrate";

/**
 * The boot tamper guard compares a migration's recorded checksum with the file
 * on disk (R130). It hashed raw bytes, so the same file checked out with CRLF
 * (core.autocrlf on Windows) read as an edited migration, and the village went
 * into maintenance when it switched between a local build and the LF image.
 * Line endings are not an edit. Anything else still is.
 */
const LF = Buffer.from("CREATE TABLE `t` (\n  `id` int NOT NULL\n);\n");
const CRLF = Buffer.from("CREATE TABLE `t` (\r\n  `id` int NOT NULL\r\n);\r\n");
const EDITED = Buffer.from("CREATE TABLE `t` (\n  `id` bigint NOT NULL\n);\n");

describe("whether a migration on disk is the one that ran", () => {
  it("is the same text when only its line endings differ, either way round", () => {
    expect(sameMigrationText(sha256Hex(LF), CRLF)).toBe(true);
    expect(sameMigrationText(sha256Hex(CRLF), LF)).toBe(true);
    expect(sameMigrationText(sha256Hex(LF), LF)).toBe(true);
  });

  it("is still a different migration when a word changed, whatever the line endings", () => {
    expect(sameMigrationText(sha256Hex(LF), EDITED)).toBe(false);
    expect(sameMigrationText(sha256Hex(CRLF), EDITED)).toBe(false);
    expect(sameMigrationText(sha256Hex(LF), Buffer.from(EDITED.toString().replace(/\n/g, "\r\n")))).toBe(false);
  });

  it("does not treat a lone carriage return inside a statement as a line ending", () => {
    const bareCr = Buffer.from("CREATE TABLE `t` (\r  `id` int NOT NULL\n);\n");
    expect(sameMigrationText(sha256Hex(LF), bareCr)).toBe(false);
  });
});
