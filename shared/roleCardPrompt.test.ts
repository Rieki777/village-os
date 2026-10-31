/**
 * The copy-and-paste prompt (shared/roleCardPrompt.ts): word for word the
 * same for the same village, every heading with its limit, the interview one
 * question at a time, a reply that is only the card, the founder's card as
 * the worked example naming roles and never people, and a real run of it:
 * the sample description in, the AI's last reply out, read clean by the one
 * reader (shared/__fixtures__/role-card-sample-ai-run.md says how it ran).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_CARD_FIELDS, readRoleCard, writeRoleCard, type RoleCardContext } from "./roleCardText";
import { EXAMPLE_ORG_GOALS, ROLE_CARD_PROMPT_VERSION, roleCardPrompt, workedExample } from "./roleCardPrompt";
import type { WordFieldsContext } from "./roleProposals";

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "__fixtures__", name), "utf8");

const WORDS: WordFieldsContext = {
  fields: ["name", "aim", "domain", "accountabilities", "whyItMatters", "bringMe", "notMine", "runbook", "existsWhile", "authorities", "responsibilities", "signsStretched", "flowsBack", "stepBack", "timeCommitment"],
  lists: new Set(["accountabilities", "bringMe", "notMine", "authorities", "responsibilities"]),
};

const INPUT = { village: "Riverbend", circles: ["Food circle", "Land circle"], orgGoals: ["Feed everyone", "Grow the orchard"] };

describe("the prompt", () => {
  const prompt = roleCardPrompt(INPUT);

  it("is word for word the same for the same village, and says its version", () => {
    expect(roleCardPrompt({ ...INPUT })).toBe(prompt);
    expect(prompt.split("\n")[0]).toBe(`Role card prompt, version ${ROLE_CARD_PROMPT_VERSION}, for Riverbend.`);
    expect(prompt).toContain("The card starts with this line, exactly:\nRiverbend role card v1\n");
  });

  it("explains every heading with its limit, in the card's order", () => {
    const shown = ROLE_CARD_FIELDS.filter((f) => f.key !== "roleId" && f.key !== "season");
    let at = 0;
    for (const f of shown) {
      const i = prompt.indexOf(`# ${f.heading}\n   ${f.limit}`, at);
      expect(i, f.heading).toBeGreaterThan(at);
      at = i;
    }
    expect(prompt).toContain("The village's circles are: Food circle; Land circle.");
    expect(prompt).toContain("Next season's goals are: Feed everyone; Grow the orchard.");
    expect(prompt).toContain("3 to 6 lines, each under 200 characters");
    expect(prompt).toContain("Never write bank, card or account numbers");
  });

  it("interviews one question at a time, and asks for the card and nothing else", () => {
    expect(prompt).toContain("ONE question at a time, and wait for each answer before the next");
    expect(prompt).toContain("Your last reply must be one role card in that format and nothing else.");
    expect(prompt).toContain("reply with the card and nothing else. No greeting, no notes, no code fence.");
  });

  it("names the role, never the person, and turns a name it is given into the role", () => {
    expect(prompt).toContain('Name the role, never the person. Write "the founder" or "the Operations role", never a person\'s name.');
    expect(prompt).toContain("write the title of the role that person holds");
  });

  it("carries the founder's card as the worked example, which names roles where it names anyone", () => {
    const example = writeRoleCard(workedExample("Riverbend")).trim();
    expect(prompt).toContain(`Its season served these goals: ${EXAMPLE_ORG_GOALS.join("; ")}.\n\n${example}\n`);
    expect(example).toContain("the founder");
    expect(example).toContain("the Operations role");
  });

  it("says when the season has no goals yet, and starts from the member's card when there is one", () => {
    expect(roleCardPrompt({ ...INPUT, orgGoals: [] })).toContain("The village has not set next season's goals yet, so leave this heading out.");
    const known = "Riverbend role card v1\n\n## Role title\nGate keeper\nRole id: r-gate\n";
    const withKnown = roleCardPrompt({ ...INPUT, knownCard: known });
    expect(withKnown).toContain(`This is the member's card as it stands. Start from it, and change only what the member wants changed:\n\n${known.trim()}\n`);
    expect(prompt).not.toContain("WHAT THE VILLAGE ALREADY KNOWS");
  });

  it("is plain words: no long dashes, and role, never seat", () => {
    expect(prompt).not.toMatch(/[–—]/);
    expect(prompt).not.toMatch(/\bseats?\b/i);
  });
});

describe("a run of the prompt, as an outside AI answered it", () => {
  const ctx: RoleCardContext = {
    words: WORDS,
    roles: [],
    circles: [
      { id: "c-food", name: "Food circle" },
      { id: "c-land", name: "Land circle" },
    ],
    orgGoals: INPUT.orgGoals,
    people: [
      { name: "Tomas Reyes", roles: [] },
      { name: "Ines Varga", roles: ["Treasurer"] },
    ],
  };

  it("the member's own description is not a card, so it goes to the AI half or the prompt", () => {
    expect(readRoleCard(fixture("role-card-sample-description.md"), ctx).isCard).toBe(false);
  });

  it("the AI's last reply reads clean, names nobody, and fills the proposal", () => {
    const r = readRoleCard(fixture("role-card-sample-ai-reply.md"), ctx);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.proposalBody.newRoles).toEqual([
      {
        circleId: "c-food",
        seats: 1,
        reviewOn: null,
        words: {
          name: "Community Kitchen Coordinator",
          aim: "Everyone at a work day eats a good meal, cooked by people who enjoy cooking.",
          existsWhile: "we cook together on work days. If the work days stop, it folds into the Food circle.",
          domain: "The community kitchen: its menus, its food orders and its volunteer cooks.",
          authorities: ["What goes on the menu.", "Who cooks each shift."],
          accountabilities: ["A menu planned for every Saturday work day.", "Food ordered from the farm co-op on time.", "Volunteer cooks coordinated for every shift."],
          responsibilities: ["Plan the menu for each Saturday work day.", "Order food from the farm co-op every Thursday.", "Send the volunteer cooks their shifts."],
          bringMe: ["Food allergies.", "Recipes.", "Wanting to cook."],
          notMine: ["The food budget and its money (the Treasurer)."],
          signsStretched: "Orders going in late, and the holder cooking every shift alone.",
          flowsBack: "The volunteers say how the meal went after each work day, and the farm co-op says what is in season.",
          stepBack: "Hand a Saturday to another cook, or ask the Food circle to cover the ordering for a week.",
          timeCommitment: "About 10 hours a week",
        },
      },
    ]);
    expect(r.proposalBody.settings?.scoreboard?.measures).toEqual([{ measure: "Nobody goes hungry on a work day." }, { measure: "Volunteer cooks come back for another shift." }]);
    expect(r.proposalBody.season).toEqual({
      aim: "The kitchen runs on a rota, so it never rests on one person.",
      seasonalGoals: [{ title: "A cook rota with 6 people", doneWhen: "six people each cook at least one shift a moon." }],
      servesGoals: [{ goal: "Feed everyone", howItHelps: "every work day has a meal for everyone who comes." }],
    });
  });

  it("had the description's names to catch: read as a card, the description's own words would be reported", () => {
    const named = readRoleCard(`Riverbend role card v1\n## Role title\nKitchen\n### Circle\nFood circle\n### Not mine to hold\n- The food budget money, Ines does that.`, ctx);
    expect(named.proposalBody.newRoles![0].words.notMine).toEqual(["The food budget money, the Treasurer does that."]);
    expect(named.problems.map((p) => p.kind)).toEqual(["name"]);
  });
});
