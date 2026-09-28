/**
 * The conflict agreement editor's row edits (client/src/lib/agreementDraft.ts).
 */
import { describe, expect, it } from "vitest";
import { ideasNotYetAdded, namedContacts, removeAt, rolesOtherThan, withRungWords } from "./agreementDraft";

describe("agreementDraft", () => {
  it("removes exactly one row and leaves the list it was handed alone", () => {
    const list = ["a", "b", "c"];
    expect(removeAt(list, 1)).toEqual(["a", "c"]);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("keeps a rung's words in rung order, and replaces a rung already written", () => {
    let rungs = withRungWords([], 3, "Pause some keys");
    rungs = withRungWords(rungs, 1, "Ask");
    expect(rungs.map((r) => r.rung)).toEqual([1, 3]);
    expect(withRungWords(rungs, 3, "Pause them for a moon")).toEqual([
      { rung: 1, words: "Ask" },
      { rung: 3, words: "Pause them for a moon" },
    ]);
  });

  it("offers roles, contacts and practices the page may still choose", () => {
    expect(rolesOtherThan([{ id: "care" }, { id: "cover" }], "care")).toEqual([{ id: "cover" }]);
    expect(namedContacts([{ name: " " }, { name: "Ada" }])).toEqual([{ name: "Ada" }]);
    expect(ideasNotYetAdded([{ name: "Beginning Anew" }, { name: "A walk" }], [{ name: "A walk", when: "" }])).toEqual([{ name: "Beginning Anew" }]);
  });
});
