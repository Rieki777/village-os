/**
 * The role card text format, v1 (shared/roleCardText.ts): the round trip on
 * the founder's own card, every limit and refusal, the headings people and
 * AIs actually write, prose ignored, circles matched or asked, the roles a
 * village has, the name rule, and what a member keeps (shared/roleCardApply.ts).
 *
 * Every person's name here is made up.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyBody, parseBodyUpdate, PROPOSAL_WORDS, type BodyContext, type ProposalBody, type WordFieldsContext } from "./roleProposals";
import { ROLE_CCOS_WORDS } from "./roleCcos";
import {
  docFromProposal,
  fieldPath,
  isRoleCardText,
  read,
  readRoleCard,
  ROLE_CARD_WORDS,
  roleCardHeader,
  write,
  writeRoleCard,
  type RoleCardContext,
  type RoleCardDoc,
} from "./roleCardText";
import { acceptOnly, changesOf, docFromBody, isBlocked } from "./roleCardApply";
import { EXAMPLE_CIRCLE, EXAMPLE_ORG_GOALS, roleCardPrompt, workedExample } from "./roleCardPrompt";

const FIXTURE = fs.readFileSync(path.join(import.meta.dirname, "__fixtures__", "role-card-rye.md"), "utf8");
/** The village the fixture was written in, read off its own header so no village's name is typed here. */
const VILLAGE = /^(.+) role card v1$/m.exec(FIXTURE)![1];

/** The word fields of the platform's roles, as the server reads them (pinned against the server in roleCardImport.test.ts). */
export const WORDS: WordFieldsContext = {
  fields: ["name", "aim", "domain", "accountabilities", "whyItMatters", "bringMe", "notMine", "runbook", "existsWhile", "authorities", "responsibilities", "signsStretched", "flowsBack", "stepBack", "timeCommitment"],
  lists: new Set(["accountabilities", "bringMe", "notMine", "authorities", "responsibilities"]),
};

const CIRCLES = [
  { id: "general-circle", name: EXAMPLE_CIRCLE },
  { id: "c-food", name: "Food circle", aliases: ["Kitchen"] },
  { id: "c-land", name: "Land" },
  { id: "c-twin-a", name: "Twin" },
  { id: "c-twin-b", name: "twin" },
  { id: "c-demo", name: "Demo circle", isExample: true },
];

const POSTED_KITCHEN = {
  name: "Kitchen keeper",
  aim: "Feed the village well.",
  domain: "The kitchen and its stores.",
  accountabilities: ["Meals on time", "A clean kitchen", "Stores counted"],
  bringMe: ["Food allergies"],
  notMine: null,
  timeCommitment: "30 hours a week",
};

function ctx(extra: Partial<RoleCardContext> = {}): RoleCardContext {
  return {
    words: WORDS,
    roles: [
      { id: "r-kitchen", name: "Kitchen keeper", circleId: "c-food", posted: POSTED_KITCHEN },
      { id: "r-gate", name: "Gate keeper", circleId: "c-food", posted: { name: "Gate keeper", aim: "Welcome every visitor.", accountabilities: [] } },
    ],
    circles: CIRCLES,
    orgGoals: [...EXAMPLE_ORG_GOALS],
    ...extra,
  };
}

/** The founder's proposal as the PUT holds it: three new roles, one set of terms, his season. */
function ryeBody(): ProposalBody {
  const doc = workedExample(VILLAGE);
  return {
    roles: [],
    newRoles: doc.roles.map((r, i) => ({ id: `role-00000000000${i + 1}`, circleId: "general-circle", seats: 1, words: { name: r.title, ...r.words }, reviewOn: i === 0 ? "2026-11-09" : null })),
    settings: { v: 1, scoreboard: { measures: doc.measures.map((measure) => ({ measure })) } },
    season: doc.season!,
  };
}

/** What the PUT itself says about a body, so a card that reads clean is one that saves clean. */
function putAccepts(body: object, current: ProposalBody = emptyBody(), c: RoleCardContext = ctx()): ReturnType<typeof parseBodyUpdate> {
  let n = 0;
  const bc: BodyContext = {
    words: WORDS,
    postedRoles: new Map(c.roles.map((r) => [r.id, r.posted])),
    circles: new Set(c.circles.filter((x) => !x.isExample).map((x) => String(x.id))),
    orgGoals: c.orgGoals,
    newRoleId: () => `role-${String(++n).padStart(12, "0")}`,
  };
  return parseBodyUpdate(body, current, bc);
}

const card = (body: string) => `${roleCardHeader("Riverbend")}\n\n${body}`;
const fields = (r: ReturnType<typeof readRoleCard>) => r.problems.map((p) => p.field);

describe("the founder's card, round trip", () => {
  it("reads the card as he would type it into the proposal he drafted", () => {
    const r = readRoleCard(FIXTURE, ctx());
    expect(r.isCard).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    const want = ryeBody();
    expect(r.proposalBody).toEqual({
      roles: [],
      newRoles: want.newRoles.map(({ id: _id, ...rest }) => ({ ...rest, reviewOn: null })),
      settings: want.settings,
      season: want.season,
    });
    // The prose before the header and the heading the format has no field for are never read.
    expect(r.ignored).toEqual(["Works closely with"]);
    expect(r.sections.map((s) => s.path)).toEqual(["newRoles.0", "newRoles.1", "newRoles.2"]);
    // A card that reads clean is one the PUT takes.
    expect(putAccepts(r.proposalBody).ok).toBe(true);
  });

  it("writes his proposal back to the same card, and read(write(x)) is x", () => {
    const x = ryeBody();
    const docCtx = { words: WORDS, roles: [], circles: CIRCLES, village: VILLAGE };
    const text = write(docFromBody(x, docCtx));
    // The worked example exactly: a new role carries no id line, and is found again by its title.
    expect(text).toBe(writeRoleCard(workedExample(VILLAGE)));
    expect(text.split("\n")[0]).toBe(`${VILLAGE} role card v1`);
    expect(text).not.toContain("Role id:");
    // Given the draft, its new roles' ids and the review date it holds come back too.
    expect(read(text, ctx({ current: x })).proposalBody).toEqual(x);
    // Read cold, every word, and ids for the server to give.
    expect(read(text, ctx()).proposalBody).toEqual({ ...x, newRoles: x.newRoles.map(({ id: _id, ...r }) => ({ ...r, reviewOn: null })) });
    // Writing what was read changes nothing.
    expect(write(docFromBody({ ...x, ...read(text, ctx({ current: x })).proposalBody } as ProposalBody, docCtx))).toBe(text);
  });

  it("writes the terms' measures once, after the roles, and reads every role's list into that one", () => {
    const text = writeRoleCard(workedExample(VILLAGE));
    const lines = text.split("\n");
    expect(lines.filter((l) => l === "## How we'll know it's working")).toHaveLength(1);
    expect(lines.indexOf("## How we'll know it's working")).toBeGreaterThan(lines.lastIndexOf("## Role title"));
    expect(lines.indexOf("## How we'll know it's working")).toBeLessThan(lines.indexOf("## My season"));
  });

  it("is the worked example the prompt carries, and the prompt's own example reads clean", () => {
    const prompt = roleCardPrompt({ village: VILLAGE, circles: [EXAMPLE_CIRCLE], orgGoals: [...EXAMPLE_ORG_GOALS] });
    const example = writeRoleCard(workedExample(VILLAGE)).trim();
    expect(prompt).toContain(example);
    const r = readRoleCard(prompt.slice(prompt.indexOf(example)), ctx());
    expect(r.ok).toBe(true);
    expect(r.proposalBody.newRoles).toHaveLength(3);
  });

  it("writes the draft as GET /:id sends it, straight through write(), ids and all", () => {
    const x = ryeBody();
    const payload = {
      roles: [],
      newRoles: x.newRoles.map((r) => ({ id: r.id, name: String(r.words.name), circle: { id: "general-circle", name: EXAMPLE_CIRCLE }, fields: Object.entries(r.words).map(([field, proposed]) => ({ field, posted: null, proposed, changed: true })) })),
      settings: x.settings,
      season: x.season,
    };
    const text = write(payload, { village: VILLAGE });
    expect(text).toBe(write(docFromBody(x, { words: WORDS, roles: [], circles: CIRCLES, village: VILLAGE })));
    expect(writeRoleCard(docFromProposal(payload, VILLAGE))).toBe(text);
    expect(read(text, ctx({ current: x })).proposalBody).toEqual(x);
  });
});

describe("limits and refusals: reported, never dropped", () => {
  const role = (extra: string) => card(`## Role title\nOrchard keeper\n\n### Circle\nLand\n\n${extra}`);

  it.each([
    ["two things a role answers for", "### What you can count on me for\n- One\n- Two", "newRoles.0.words.accountabilities", ROLE_CCOS_WORDS.accountabilities],
    ["seven things a role answers for", `### What you can count on me for\n${[1, 2, 3, 4, 5, 6, 7].map((n) => `- Thing ${n}`).join("\n")}`, "newRoles.0.words.accountabilities", ROLE_CCOS_WORDS.accountabilities],
    ["a decision line over 200 characters", `### What I can decide on my own\n- Short\n- ${"x".repeat(201)}`, "newRoles.0.words.authorities.1", ROLE_CCOS_WORDS.itemTooLong],
    ["nine regular things", `### What I do regularly\n${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `- Do ${n}`).join("\n")}`, "newRoles.0.words.responsibilities", ROLE_CCOS_WORDS.tooMany],
    ["a bring-me line over 160 characters", `### Bring me\n- ${"y".repeat(161)}`, "newRoles.0.words.bringMe.0", "Keep each line to 160 characters."],
    ["a link that is not https", "### Bring me\n- The notes at http://example.org/notes", "newRoles.0.words.bringMe.0", "Links need to start with https://."],
    ["a time over 80 characters", `### Time\n${"z".repeat(81)}`, "newRoles.0.words.timeCommitment", ROLE_CCOS_WORDS.textTooLong(80)],
    ["an exists-while over 300 characters", `### This role exists while\n${"w".repeat(301)}`, "newRoles.0.words.existsWhile", ROLE_CCOS_WORDS.textTooLong(300)],
    ["card numbers in the purpose", "### Purpose\nPay me at 4111 1111 1111 1111 please.", "newRoles.0.words.aim", PROPOSAL_WORDS.paymentInWords],
    ["card numbers in a list", "### Not mine to hold\n- My card 4111 1111 1111 1111", "newRoles.0.words.notMine.0", "This looks like a bank or card number. Payment details are never stored on a role."],
  ])("%s", (_name, body, field, sentence) => {
    const r = readRoleCard(role(body), ctx());
    expect(r.ok).toBe(false);
    expect(r.problems).toContainEqual(expect.objectContaining({ field, sentence, blocks: true }));
    // The value stays exactly as written, so nothing is lost.
    expect(JSON.stringify(r.proposalBody.newRoles![0].words)).toContain(body.split("\n")[1].replace(/^- /, "").slice(0, 20));
  });

  it("a title over 120 characters", () => {
    const r = readRoleCard(card(`## Role title\n${"T".repeat(121)}\n\n### Circle\nLand`), ctx());
    expect(r.problems).toContainEqual(expect.objectContaining({ field: "newRoles.0.words.name", sentence: "Keep this to 120 characters." }));
  });

  it("more roles than one proposal holds", () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => `## Role title\nKeeper ${n}\n\n### Circle\nLand`).join("\n\n");
    const r = readRoleCard(card(six), ctx());
    expect(r.proposalBody.newRoles).toHaveLength(6);
    expect(r.problems).toContainEqual(expect.objectContaining({ field: "roles", sentence: PROPOSAL_WORDS.tooManyRoles }));
  });

  it("season limits: four seasonal goals, an empty list, a goal with no done when, an aim too long, payment details", () => {
    const four = readRoleCard(card(`## My season\n\n### My seasonal goals\n${[1, 2, 3, 4].map((n) => `- Goal ${n}\n  Done when: it is done`).join("\n")}`), ctx());
    expect(four.problems).toContainEqual(expect.objectContaining({ field: "season.seasonalGoals", sentence: "Up to 3 seasonal goals." }));
    expect(four.proposalBody.season!.seasonalGoals).toHaveLength(4);

    const none = readRoleCard(card("## My season\n\n### My seasonal goals\n"), ctx());
    expect(none.problems).toContainEqual(expect.objectContaining({ field: "season.seasonalGoals", sentence: ROLE_CARD_WORDS.noSeasonalGoal }));

    const loose = readRoleCard(card("## My season\n\n### My seasonal goals\n- Build the barn"), ctx());
    expect(loose.problems).toEqual([expect.objectContaining({ field: "season.seasonalGoals.0.doneWhen", sentence: ROLE_CARD_WORDS.noDoneWhen, blocks: false })]);

    const long = readRoleCard(card(`## My season\n\n### My aim this season\n${"a".repeat(601)}`), ctx());
    expect(long.problems).toContainEqual(expect.objectContaining({ field: "season.aim", sentence: "Keep your aim to 600 characters." }));

    const pay = readRoleCard(card("## My season\n\n### My aim this season\nSend it to account 12345678 sort 12-34-56."), ctx());
    expect(pay.problems).toContainEqual(expect.objectContaining({ field: "season.aim", kind: "refused" }));
  });

  it("goals served: one the season does not have, and a season with none set", () => {
    const r = readRoleCard(card("## My season\n\n### Village goals I serve\n- World peace\n  How it helps: all of it"), ctx());
    expect(r.problems).toContainEqual(expect.objectContaining({ field: "season.servesGoals.0.goal", sentence: ROLE_CARD_WORDS.notAnOrgGoal("World peace", EXAMPLE_ORG_GOALS.join("; ")) }));
    const unset = readRoleCard(card("## My season\n\n### Village goals I serve\n- Investor ready"), ctx({ orgGoals: [] }));
    expect(unset.problems).toContainEqual(expect.objectContaining({ field: "season.servesGoals", sentence: ROLE_CARD_WORDS.noOrgGoals }));
  });

  it("a shortened goal name finds the one goal it starts", () => {
    const r = readRoleCard(card("## My season\n\n### Village goals I serve\n- A thriving community\n  How it helps: potlucks"), ctx());
    expect(r.problems).toEqual([]);
    expect(r.proposalBody.season!.servesGoals).toEqual([{ goal: EXAMPLE_ORG_GOALS[1], howItHelps: "potlucks" }]);
  });

  it("measures: more than eight across the roles, and a measure that ranks people", () => {
    const nine = readRoleCard(card(`## How we'll know it's working\n${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `- Sign ${n}`).join("\n")}`), ctx());
    expect(nine.problems).toContainEqual(expect.objectContaining({ field: "settings.scoreboard.measures", sentence: ROLE_CARD_WORDS.tooManyMeasures }));
    expect(nine.proposalBody.settings!.scoreboard!.measures).toHaveLength(9);
    const ranks = readRoleCard(card("## How we'll know it's working\n- The top 3 members each moon"), ctx());
    expect(ranks.problems).toContainEqual(expect.objectContaining({ field: "settings.scoreboard.measures.0", sentence: "A scoreboard measures the work. It never ranks people." }));
  });

  it("a version this village does not read, and text that is not a card", () => {
    const v2 = readRoleCard("Riverbend role card v2\n\n## Role title\nX", ctx());
    expect(v2.problems).toEqual([expect.objectContaining({ field: "card", sentence: ROLE_CARD_WORDS.wrongVersion(2) })]);
    const prose = readRoleCard("I run the kitchen and keep the stores counted. I am around on Mondays.", ctx());
    expect(prose.isCard).toBe(false);
    expect(isRoleCardText("I run the kitchen.")).toBe(false);
    expect(prose.proposalBody).toEqual({});
  });
});

describe("headings as people and AIs write them", () => {
  it("reads case, spacing, bold, colons, inline words, other markers, fences, CRLF and a BOM", () => {
    const text = [
      "﻿Sure! Here is your card:",
      "```markdown",
      "**riverbend ROLE CARD v1**",
      "",
      "# Role 1",
      "Role title: Orchard keeper",
      "**Circle:** the land",
      "PURPOSE: Keep the orchard bearing.",
      "This role exists while the young trees need daily care.",
      "### what   i look after",
      "The orchard and its tools.",
      "#### What I can decide on my own:",
      "* When to prune",
      "1. Which trees to water first",
      "What you can count on me for",
      "- Trees watered",
      "- Fruit picked",
      "- Tools put away",
      "  and oiled once a moon",
      "### Signs I’m stretched",
      "Trees going dry.",
      "### How we will know it's working",
      "- Fruit picked each week",
      "## My Season",
      "### Aim",
      "A bearing orchard.",
      "### Seasonal goal",
      "- Plant ten trees. Done when: ten trees are in the ground",
      "- Mend the fence",
      "- Done when: the fence holds the goats",
      "```",
    ].join("\r\n");
    const r = readRoleCard(text, ctx({ orgGoals: [] }));
    expect(r.problems).toEqual([]);
    const role = r.proposalBody.newRoles![0];
    expect(role.circleId).toBe("c-land");
    expect(role.words).toEqual({
      name: "Orchard keeper",
      aim: "Keep the orchard bearing.",
      existsWhile: "the young trees need daily care.",
      domain: "The orchard and its tools.",
      authorities: ["When to prune", "Which trees to water first"],
      accountabilities: ["Trees watered", "Fruit picked", "Tools put away and oiled once a moon"],
      signsStretched: "Trees going dry.",
    });
    expect(r.proposalBody.settings!.scoreboard!.measures).toEqual([{ measure: "Fruit picked each week" }]);
    expect(r.proposalBody.season).toEqual({
      aim: "A bearing orchard.",
      seasonalGoals: [
        { title: "Plant ten trees", doneWhen: "ten trees are in the ground" },
        { title: "Mend the fence", doneWhen: "the fence holds the goats" },
      ],
    });
  });

  it("a bare Aim inside a role is its purpose; under My season it is the season's aim", () => {
    const r = readRoleCard(card("## Role title\nGate keeper\n\n### Aim\nWelcome every guest.\n\n## My season\n\n### Aim\nA calm gate."), ctx());
    expect(r.proposalBody.roles![0].words.aim).toBe("Welcome every guest.");
    expect(r.proposalBody.season!.aim).toBe("A calm gate.");
  });

  it("a list written without markers is one item per line", () => {
    const r = readRoleCard(card("## Role title\nGate keeper\n\n### Bring me\nA visitor with no host\nA lost parcel"), ctx());
    expect(r.proposalBody.roles![0].words.bringMe).toEqual(["A visitor with no host", "A lost parcel"]);
  });

  it("a card with no header but a titled role and two headings is still read, and asked to start with the line", () => {
    const r = readRoleCard("## Role title\nGate keeper\n\n### Purpose\nWelcome.\n\n### Time\nMornings", ctx());
    expect(r.isCard).toBe(true);
    expect(r.problems).toEqual([expect.objectContaining({ field: "card", sentence: ROLE_CARD_WORDS.noHeader(roleCardHeader(null)), blocks: false })]);
    expect(r.proposalBody.roles![0].words).toEqual({ aim: "Welcome.", timeCommitment: "Mornings" });
  });
});

describe("prose outside the sections", () => {
  it("ignores text before the header, under headings it does not know, and directly under My season", () => {
    const r = readRoleCard(
      [
        "Notes to self: I wrote this on the bus.",
        "",
        roleCardHeader("Riverbend"),
        "## Role title",
        "Gate keeper",
        "## Notes",
        "Remember to ask about keys.",
        "### Purpose",
        "Welcome every visitor warmly.",
        "## My season",
        "This bit is just me thinking out loud.",
        "### My aim this season",
        "A calm gate.",
        "## Appendix",
        "Old job description pasted here.",
      ].join("\n"),
      ctx(),
    );
    expect(r.problems).toEqual([]);
    expect(r.ignored).toEqual(["Notes", "Appendix"]);
    expect(r.proposalBody.roles![0].words).toEqual({ aim: "Welcome every visitor warmly." });
    expect(r.proposalBody.season).toEqual({ aim: "A calm gate." });
    expect(JSON.stringify(r.proposalBody)).not.toContain("keys");
  });
});

describe("circles", () => {
  const newRole = (circle: string) => readRoleCard(card(`## Role title\nBee keeper\n\n### Circle\n${circle}`), ctx());

  it.each([
    ["Food circle", "c-food"],
    ["food CIRCLE", "c-food"],
    ["Kitchen", "c-food"],
    ["The Food circle", "c-food"],
    ["Food", "c-food"],
    ["Land circle", "c-land"],
  ])("matches %s by name or alias", (circle, id) => {
    const r = newRole(circle);
    expect(r.problems).toEqual([]);
    expect(r.proposalBody.newRoles![0].circleId).toBe(id);
  });

  it("asks when no circle has the name, naming the ones that do exist; an example circle never matches", () => {
    for (const name of ["Sky circle", "Demo circle"]) {
      const r = newRole(name);
      expect(r.proposalBody.newRoles![0].circleId).toBe("");
      expect(r.problems).toEqual([
        expect.objectContaining({ field: "newRoles.0.circleId", sentence: ROLE_CARD_WORDS.unknownCircle(name, "General Coordinating Circle, Food circle, Land, Twin, twin"), kind: "circle", blocks: true }),
      ]);
    }
  });

  it("asks when two circles share the name, or none is given", () => {
    expect(newRole("Twin").problems[0]).toEqual(expect.objectContaining({ sentence: ROLE_CARD_WORDS.twoCircles("Twin") }));
    const none = readRoleCard(card("## Role title\nBee keeper\n\n### Purpose\nBees."), ctx());
    expect(none.problems[0]).toEqual(expect.objectContaining({ field: "newRoles.0.circleId", sentence: ROLE_CARD_WORDS.noCircle("General Coordinating Circle, Food circle, Land, Twin, twin") }));
  });

  it("an existing role named in another circle is not moved, and says so", () => {
    const r = readRoleCard(card("## Role title\nKitchen keeper\n\n### Circle\nLand"), ctx());
    expect(r.proposalBody.roles![0].roleId).toBe("r-kitchen");
    expect(r.problems).toEqual([expect.objectContaining({ field: "roles.0", sentence: ROLE_CARD_WORDS.otherCircle("Kitchen keeper", "Food circle"), blocks: false })]);
  });
});

describe("a role the village has", () => {
  it("is that role, storing only the words that differ from the posted role", () => {
    const r = readRoleCard(
      card("## Role title\nkitchen KEEPER\n\n### Purpose\nFeed the village well.\n\n### What you can count on me for\n- Meals on time\n- A clean kitchen\n- Stores counted\n- Menus planned\n\n### Time\n"),
      ctx(),
    );
    expect(r.problems).toEqual([]);
    expect(r.proposalBody.roles).toEqual([{ roleId: "r-kitchen", words: { accountabilities: ["Meals on time", "A clean kitchen", "Stores counted", "Menus planned"] }, reviewOn: null }]);
    expect(putAccepts(r.proposalBody).ok).toBe(true);
  });

  it("keeps what the draft holds for headings the card leaves out, its review dates, and its other roles", () => {
    const current: ProposalBody = {
      ...emptyBody(),
      roles: [
        { roleId: "r-kitchen", words: { domain: "The kitchen, its stores and the garden." }, reviewOn: "2026-11-16" },
        { roleId: "r-gate", words: {}, reviewOn: "2026-11-23" },
      ],
      newRoles: [{ id: "role-0000000000aa", circleId: "c-land", seats: 2, words: { name: "Bee keeper", aim: "Bees thrive." }, reviewOn: null }],
    };
    const r = readRoleCard(card("## Role title\nKitchen keeper\n\n### Bring me\n- Food allergies\n- Recipes\n\n## Role title\nBee keeper\n\n### Time\nTwo mornings a week"), ctx({ current }));
    expect(r.problems).toEqual([]);
    expect(r.proposalBody.roles).toEqual([
      { roleId: "r-kitchen", words: { domain: "The kitchen, its stores and the garden.", bringMe: ["Food allergies", "Recipes"] }, reviewOn: "2026-11-16" },
      { roleId: "r-gate", words: {}, reviewOn: "2026-11-23" },
    ]);
    expect(r.proposalBody.newRoles).toEqual([{ id: "role-0000000000aa", circleId: "c-land", seats: 2, words: { name: "Bee keeper", aim: "Bees thrive.", timeCommitment: "Two mornings a week" }, reviewOn: null }]);
  });

  it("finds a role by the new title its draft already gives it", () => {
    const current: ProposalBody = { ...emptyBody(), roles: [{ roleId: "r-kitchen", words: { name: "Food steward" }, reviewOn: null }] };
    const r = readRoleCard(card("## Role title\nFood steward\n\n### Time\nMornings"), ctx({ current }));
    expect(r.proposalBody.roles).toEqual([{ roleId: "r-kitchen", words: { name: "Food steward", timeCommitment: "Mornings" }, reviewOn: null }]);
  });

  it("a Role id line names the role whatever its title says, and a new role's id keeps its place", () => {
    const current: ProposalBody = { ...emptyBody(), newRoles: [{ id: "role-0000000000aa", circleId: "c-land", seats: 1, words: { name: "Bee keeper" }, reviewOn: "2026-12-01" }] };
    const r = readRoleCard(
      card("## Role title\nFood steward\nRole id: r-kitchen\n\n### Time\nMornings\n\n## Role title\nHoney keeper\nRole id: role-0000000000aa\n\n### Purpose\nHoney for all."),
      ctx({ current }),
    );
    expect(r.problems).toEqual([]);
    expect(r.proposalBody.roles).toEqual([{ roleId: "r-kitchen", words: { name: "Food steward", timeCommitment: "Mornings" }, reviewOn: null }]);
    expect(r.proposalBody.newRoles).toEqual([{ id: "role-0000000000aa", circleId: "c-land", seats: 1, words: { name: "Honey keeper", aim: "Honey for all." }, reviewOn: "2026-12-01" }]);
    expect(r.sections.map((x) => x.path)).toEqual(["roles.0", "newRoles.0"]);
  });

  it("a role the village has is written with its Role id, and read back to the same body", () => {
    const x: ProposalBody = {
      ...emptyBody(),
      roles: [{ roleId: "r-kitchen", words: { name: "Food steward", bringMe: ["Food allergies", "Recipes"] }, reviewOn: "2026-11-16" }],
      newRoles: [{ id: "role-0000000000aa", circleId: "c-land", seats: 1, words: { name: "Bee keeper", aim: "Bees thrive." }, reviewOn: null }],
    };
    const text = write(docFromBody(x, { words: WORDS, roles: ctx().roles, circles: CIRCLES, village: "Riverbend" }));
    expect(text).toContain("## Role title\nFood steward\nRole id: r-kitchen\n");
    expect(text.match(/Role id:/g)).toHaveLength(1);
    // No measures and no season written, so the terms and the season are left out of the body and the PUT keeps them.
    const { settings: _terms, season: _season, ...rest } = x;
    expect(read(text, ctx({ current: x })).proposalBody).toEqual(rest);
  });

  it("an id nobody has is reported, and the role is read by its title", () => {
    const r = readRoleCard(card("## Role title\nGate keeper\nRole id: r-nope\n\n### Time\nEvenings"), ctx({ current: emptyBody() }));
    expect(r.problems).toEqual([expect.objectContaining({ field: "card", sentence: ROLE_CARD_WORDS.unknownId("r-nope"), blocks: false })]);
    expect(r.proposalBody.roles).toEqual([{ roleId: "r-gate", words: { timeCommitment: "Evenings" }, reviewOn: null }]);
  });

  it("a role named twice is asked about", () => {
    const r = readRoleCard(card("## Role title\nGate keeper\n### Time\nA\n\n## Role title\nGate keeper\n### Time\nB"), ctx());
    expect(r.problems).toContainEqual(expect.objectContaining({ field: "roles.1", sentence: ROLE_CARD_WORDS.twice }));
  });
});

describe("the name rule: name the role, not the person", () => {
  const people = [
    { name: "Tomas Reyes", roles: ["Operations Steward"] },
    { name: "Ines Varga", roles: [] },
    { name: "Will Park", roles: ["Gate keeper"] },
    { name: "Odile", roles: ["Kitchen keeper", "Gate keeper"] },
  ];
  const named = (text: string) => readRoleCard(card(`## Role title\nBee keeper\n\n### Circle\nLand\n\n${text}`), ctx({ people }));

  it("writes the role in place of a member who holds one, and reports it", () => {
    const r = named("### What flows back\nBack end and memory from Tomas. Hosting from tomas reyes too.");
    expect(r.proposalBody.newRoles![0].words.flowsBack).toBe("Back end and memory from the Operations Steward. Hosting from the Operations Steward too.");
    expect(r.problems).toEqual([
      expect.objectContaining({ field: "newRoles.0.words.flowsBack", sentence: ROLE_CARD_WORDS.personSwapped("tomas reyes", "the Operations Steward"), kind: "name", blocks: false }),
      expect.objectContaining({ field: "newRoles.0.words.flowsBack", sentence: ROLE_CARD_WORDS.personSwapped("Tomas", "the Operations Steward") }),
    ]);
  });

  it("starts a sentence with The, and keeps a list item's place in the path", () => {
    const r = named("### Bring me\n- A question\n- Tomas Reyes sends the invoices");
    expect(r.proposalBody.newRoles![0].words.bringMe).toEqual(["A question", "The Operations Steward sends the invoices"]);
    expect(fields(r)).toEqual(["newRoles.0.words.bringMe.1"]);
  });

  it("reports a member who holds no role, or several, and leaves the words as written", () => {
    const r = named("### Signs I'm stretched\nInes Varga has to cover for me. Odile notices first.");
    expect(r.proposalBody.newRoles![0].words.signsStretched).toBe("Ines Varga has to cover for me. Odile notices first.");
    expect(r.problems.map((p) => p.sentence)).toEqual([ROLE_CARD_WORDS.person]);
  });

  it("does not take an everyday word for a first name", () => {
    const r = named("### How I can step back\nI will hand it on. Will it hold? Mark the date.");
    expect(r.problems).toEqual([]);
  });

  it("reads the season too", () => {
    const r = readRoleCard(card("## My season\n### My aim this season\nHelp Ines Varga settle in."), ctx({ people }));
    expect(fields(r)).toEqual(["season.aim"]);
  });
});

describe("field paths", () => {
  it("spells every path one way", () => {
    expect(fieldPath.word("newRoles", 0, "accountabilities", 2)).toBe("newRoles.0.words.accountabilities.2");
    expect(fieldPath.word("roles", 1, "aim")).toBe("roles.1.words.aim");
    expect(fieldPath.circle("newRoles", 0)).toBe("newRoles.0.circleId");
    expect(fieldPath.role("roles", 3)).toBe("roles.3");
    expect(fieldPath.season("aim")).toBe("season.aim");
    expect(fieldPath.season("seasonalGoals", 0, "doneWhen")).toBe("season.seasonalGoals.0.doneWhen");
    expect(fieldPath.season("servesGoals", 1, "howItHelps")).toBe("season.servesGoals.1.howItHelps");
    expect(fieldPath.measures(3)).toBe("settings.scoreboard.measures.3");
    expect(fieldPath.measures()).toBe("settings.scoreboard.measures");
  });
});

describe("what the member keeps", () => {
  const current: ProposalBody = {
    ...emptyBody(),
    roles: [{ roleId: "r-kitchen", words: { domain: "The kitchen, its stores and the garden." }, reviewOn: "2026-11-16" }],
    season: { aim: "Feed us.", seasonalGoals: [], servesGoals: [] },
  };
  const text = card(
    "## Role title\nKitchen keeper\n\n### What I look after\nThe kitchen.\n\n### Bring me\n- Recipes\n\n## Role title\nBee keeper\n\n### Circle\nSky\n\n### Purpose\nBees thrive.\n\n## My season\n### My aim this season\nFeed everyone well.",
  );
  const r = readRoleCard(text, ctx({ current }));

  it("lists every change, line by line, with the path a tick keeps", () => {
    const changes = changesOf(r.proposalBody, current, (id) => (id === "r-kitchen" ? "Kitchen keeper" : id));
    expect(changes.map((c) => [c.path, c.label, c.value])).toEqual([
      ["roles.0.words.domain", "What I look after", "The kitchen."],
      ["roles.0.words.bringMe", "Bring me", "- Recipes"],
      ["newRoles.0", "Bee keeper", null],
      ["season.aim", "My aim this season", "Feed everyone well."],
    ]);
    expect(changes[2].words).toEqual([
      { path: "newRoles.0.words.name", label: "Role title", value: "Bee keeper" },
      { path: "newRoles.0.words.aim", label: "Purpose", value: "Bees thrive." },
    ]);
    // The new role's circle matched nothing, so it waits for a pick.
    expect(isBlocked("newRoles.0", r.problems)).toBe(true);
    expect(isBlocked("newRoles.0", r.problems, new Set(["newRoles.0.circleId"]))).toBe(false);
    expect(isBlocked("roles.0.words.domain", r.problems)).toBe(false);
  });

  it("sends only what is ticked, and leaves the rest as the draft holds it", () => {
    const put = acceptOnly(r.proposalBody, new Set(["roles.0.words.bringMe", "newRoles.0"]), current, { "newRoles.0": "c-land" });
    expect(put).toEqual({
      roles: [{ roleId: "r-kitchen", words: { domain: "The kitchen, its stores and the garden.", bringMe: ["Recipes"] }, reviewOn: "2026-11-16" }],
      newRoles: [{ circleId: "c-land", seats: 1, words: { name: "Bee keeper", aim: "Bees thrive." }, reviewOn: null }],
    });
    expect(putAccepts(put, current).ok).toBe(true);
    const nothing = acceptOnly(r.proposalBody, new Set(), current);
    expect(nothing).toEqual({ roles: current.roles, newRoles: [] });
  });
});

describe("the writer", () => {
  it("leaves out empty headings and writes lists one per line", () => {
    const doc: RoleCardDoc = { village: null, roles: [{ title: "Gate keeper", circle: null, words: { aim: "Welcome.", bringMe: ["Keys", "Parcels"], domain: null } }], measures: [], season: null };
    expect(writeRoleCard(doc)).toBe("Role card v1\n\n## Role title\nGate keeper\n\n### Purpose\nWelcome.\n\n### Bring me\n- Keys\n- Parcels\n");
  });
});
