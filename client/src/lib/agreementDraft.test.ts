/**
 * The conflict agreement editor's row edits (client/src/lib/agreementDraft.ts).
 */
import { describe, expect, it } from "vitest";
import { contactsWithFreshIds, freshContactId, ideasNotYetAdded, namedContacts, removeAt, rolesOtherThan, withRungWords } from "./agreementDraft";

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

  it("never hands a contact an id another contact had, and keeps the id of a contact nobody changed", () => {
    const now = Date.UTC(2026, 8, 28);
    expect(freshContactId([], now)).toBe(`oc-${now.toString(36)}`);
    expect(freshContactId([`oc-${now.toString(36)}`], now)).toBe(`oc-${now.toString(36)}-1`);
    const ada = { id: "oc-1", name: "Ada Quill", organisation: "Cohort Care", role: "", howToReach: "ada@x" };
    const same = { outsideContacts: [{ ...ada, organisation: "Cohort Care Network" }], whenPowerInvolved: { outsideContactId: "oc-1" } };
    expect(contactsWithFreshIds(same, [ada], now)).toEqual(same);
    const typedOver = contactsWithFreshIds({ outsideContacts: [{ ...ada, name: "Ben Ortiz" }], whenPowerInvolved: { outsideContactId: "oc-1" } }, [ada], now);
    expect(typedOver.outsideContacts[0].id).toBe(`oc-${now.toString(36)}`);
    expect(typedOver.whenPowerInvolved.outsideContactId).toBe(`oc-${now.toString(36)}`);
  });
});
