/**
 * A role's words on the proposal steps (role proposals PR C), pure: the gold
 * goes on a field only when its words differ from the POSTED role, a save
 * carries only those fields, a new role writes every field it has, the 3 to 6
 * rule says the server's own sentence, and the card's gold map names the
 * card's sections.
 */
import { describe, expect, it } from "vitest";
import { ROLE_CCOS_WORDS } from "@shared/roleCcos";
import { POSTED, proposalWith } from "@/test/roleProposalFixture";
import { changedSections, differs, EDIT_FIELDS, fieldProblem, newWordsToSave, roleProblems, stateFrom, wordsToSave } from "./roleWords";

const kitchen = () => proposalWith({ roles: [{ roleId: "r1" }] }).roles[0];

describe("gold against the posted role", () => {
  it("a field typed back to its posted words is not changed, and list lines are read as the server reads them", () => {
    expect(differs("aim", "Feed the village well.", POSTED.r1.aim as string)).toBe(false);
    expect(differs("aim", "  Feed the village well.  ", POSTED.r1.aim as string)).toBe(false);
    expect(differs("accountabilities", "- Meals on time\nA clean kitchen\n\nStores counted", POSTED.r1.accountabilities as string[])).toBe(false);
    expect(differs("aim", "Feed everyone, every day.", POSTED.r1.aim as string)).toBe(true);
  });

  it("a save carries only the fields that differ from the posted role", () => {
    const s = stateFrom(kitchen().fields, { aim: "Feed everyone, every day.", domain: "The kitchen and its stores." });
    expect(wordsToSave(s)).toEqual({ aim: "Feed everyone, every day." });
  });

  it("a change the server already holds is sent again, so the group sent keeps it", () => {
    const held = proposalWith({ roles: [{ roleId: "r1", words: { domain: "The kitchen, its stores and the bakery." } }] }).roles[0];
    expect(wordsToSave(stateFrom(held.fields))).toEqual({ domain: "The kitchen, its stores and the bakery." });
  });

  it("a new role writes its name and every field it has, and nothing empty", () => {
    const fresh = proposalWith({ roles: [], newRoles: [{ id: "role-000000000001", circleId: "c-land", words: { name: "Seed saver" } }] }).newRoles[0];
    const s = stateFrom(fresh.fields, { aim: "Keep our seeds.", domain: "" });
    expect(newWordsToSave(s)).toEqual({ name: "Seed saver", aim: "Keep our seeds." });
  });
});

describe("one judge", () => {
  it("2 lines of what the role answers for is refused with the server's sentence", () => {
    expect(fieldProblem("accountabilities", "Meals on time\nA clean kitchen", POSTED.r1.accountabilities as string[], false)).toBe(ROLE_CCOS_WORDS.accountabilities);
    expect(fieldProblem("accountabilities", "a\nb\nc\nd\ne\nf\ng", POSTED.r1.accountabilities as string[], false)).toBe(ROLE_CCOS_WORDS.accountabilities);
    expect(fieldProblem("accountabilities", "a\nb\nc", POSTED.r1.accountabilities as string[], false)).toBeNull();
  });

  it("an unchanged field is never judged, so a role posted before the rule keeps loading", () => {
    const orchard = proposalWith({ roles: [{ roleId: "r2" }] }).roles[0];
    expect(Object.keys(roleProblems(stateFrom(orchard.fields), false))).toEqual([]);
  });

  it("a new role needs its name", () => {
    const fresh = proposalWith({ roles: [], newRoles: [{ id: "role-000000000001", circleId: "c-land", words: { name: "Seed saver" } }] }).newRoles[0];
    expect(roleProblems(stateFrom(fresh.fields, { name: "" }), true).name).toBe("Give the new role a name.");
  });
});

describe("the fields are the card's", () => {
  it("offers every role word the card shows, in its order", () => {
    expect(EDIT_FIELDS.map((f) => f.label)).toEqual([
      "Purpose",
      "This role exists while",
      "What I look after",
      "What I can decide on my own",
      "What you can count on me for",
      "What I do regularly",
      "Bring me",
      "Not mine to hold",
      "Signs I'm stretched",
      "What flows back",
      "How I can step back",
      "Time",
    ]);
  });

  it("the gold map names the card's sections, and a new role is new throughout", () => {
    const p = proposalWith({
      roles: [{ roleId: "r1", words: { aim: "Feed everyone.", timeCommitment: "20 hours a week" } }, { roleId: "r2" }],
      newRoles: [{ id: "role-000000000001", circleId: "c-land", words: { name: "Seed saver" } }],
    });
    expect(changedSections(p)).toEqual({
      r1: { keys: ["purpose", "timeCommitment"], isNew: false },
      "role-000000000001": { keys: [], isNew: true },
    });
  });
});
