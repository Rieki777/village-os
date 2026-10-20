/**
 * The canonical bytes, pinned.
 *
 * `canonicalJson` moved from server/lib/villageExport.ts to shared/ so the
 * seat settings hash and the village export's signature read one
 * canonicaliser. A change to its output would silently invalidate every
 * signature and every stored settings hash, so the bytes of a fixture are
 * written here literally, and the old import path is held to the same
 * function, so nobody can grow a twin behind the re-export.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonicalJson";
import { canonicalJson as fromVillageExport } from "../server/lib/villageExport";

const FIXTURE = { b: [3, { z: 1, a: [2, 1] }], a: "x", n: null, c: { y: true, x: 0 } };
const FIXTURE_BYTES = '{"a":"x","b":[3,{"a":[2,1],"z":1}],"c":{"x":0,"y":true},"n":null}';

describe("canonicalJson", () => {
  it("writes the fixture's exact bytes: keys sorted at every depth, arrays in order", () => {
    expect(canonicalJson(FIXTURE)).toBe(FIXTURE_BYTES);
  });

  it("is the same function villageExport re-exports, never a copy", () => {
    expect(fromVillageExport).toBe(canonicalJson);
    expect(fromVillageExport(FIXTURE)).toBe(FIXTURE_BYTES);
  });

  it("ignores insertion order and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    // Control: arrays are meaning, so a reordered array is a different document.
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
});
