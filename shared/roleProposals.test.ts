/**
 * The role proposal contract (shared/roleProposals.ts), with no database.
 *
 * What is pinned:
 *
 *   - the word fields come off a role template, minus the fields that are not
 *     words, so a field a later release adds to roles passes through;
 *   - one role's words: an unknown field and a structure field are refused by
 *     name, payment details are refused, a value equal to the posted one is
 *     not stored, a list arrives one item per line, and the handover words
 *     pass their own parser;
 *   - the diff: posted, proposed and changed for every field, and a new role
 *     reads every word it writes as changed;
 *   - a body update: groups left out keep what is stored, at most five roles
 *     across existing and new, an unknown or repeated role is refused, a new
 *     role needs a circle and a name and keeps the id it was given, and a goal
 *     served must be one of next season's goals as written;
 *   - submit readiness, the application's words, comments and changesRoles.
 */
import { describe, expect, it } from "vitest";
import {
  applicationWordsOf,
  changesRoles,
  COMMENT_MAX,
  emptyBody,
  MAX_PROPOSAL_ROLES,
  NOT_ROLE_WORDS,
  parseBodyUpdate,
  parseComment,
  parseRoleWords,
  PROPOSAL_WORDS,
  submitRefusal,
  wordFields,
  wordFieldsOf,
  type BodyContext,
  type ProposalBody,
} from "./roleProposals";
import { MAX_SEATS } from "./seatApplications";

/** A role template the way `rowToRole({})` reads, with one field a later release might add. */
const TEMPLATE = {
  id: undefined,
  circleId: null,
  name: undefined,
  aim: null,
  domain: null,
  accountabilities: [],
  whyItMatters: null,
  seats: 1,
  criticality: "normal",
  termsOffer: null,
  archetypes: [],
  bringMe: null,
  notMine: null,
  runbook: null,
  existsWhile: null,
  authorities: null,
};

const WORDS = wordFieldsOf(TEMPLATE);

const POSTED = {
  id: "role-garden",
  name: "Garden Steward",
  aim: "Keep the garden fed and growing.",
  domain: "The garden beds and the compost.",
  accountabilities: ["Turn the compost each moon", "Plan the planting"],
  bringMe: null,
  notMine: null,
  runbook: null,
  existsWhile: null,
};

let counter = 0;
const ctx = (over: Partial<BodyContext> = {}): BodyContext => ({
  words: WORDS,
  postedRoles: new Map([
    ["role-garden", POSTED],
    ["role-kitchen", { ...POSTED, id: "role-kitchen", name: "Kitchen Lead" }],
    ["role-water", { ...POSTED, id: "role-water", name: "Water Keeper" }],
    ["role-paths", { ...POSTED, id: "role-paths", name: "Paths Keeper" }],
    ["role-tools", { ...POSTED, id: "role-tools", name: "Tool Keeper" }],
    ["role-seeds", { ...POSTED, id: "role-seeds", name: "Seed Keeper" }],
  ]),
  circles: new Set(["circle-land"]),
  orgGoals: ["Grow food for thirty people", "Ready to grow the team to 30"],
  newRoleId: () => `role-${String(++counter).padStart(12, "0")}`,
  ...over,
});

describe("the word fields of a role", () => {
  it("are every field the template carries, less the ones that are not words", () => {
    expect(WORDS.fields).toEqual(["name", "aim", "domain", "accountabilities", "whyItMatters", "bringMe", "notMine", "runbook", "existsWhile", "authorities"]);
    for (const f of ["id", "circleId", "seats", "criticality", "termsOffer", "archetypes"]) expect(NOT_ROLE_WORDS.has(f)).toBe(true);
  });

  it("knows a list from the template, and the handover and CCOS lists whatever the template says", () => {
    expect([...WORDS.lists].sort()).toEqual(["accountabilities", "authorities", "bringMe", "notMine"]);
  });

  it("passes a field a later release adds straight through", () => {
    const r = parseRoleWords({ existsWhile: "the village keeps a garden" }, "words", WORDS, POSTED);
    expect(r).toEqual({ ok: true, value: { existsWhile: "the village keeps a garden" } });
  });
});

describe("one role's words", () => {
  it("refuses a field roles do not have, and one that is not a word, each by name", () => {
    const unknown = parseRoleWords({ colour: "green" }, "roles.0.words", WORDS, POSTED);
    expect(unknown).toEqual({ ok: false, field: "roles.0.words.colour", error: PROPOSAL_WORDS.unknownField });
    const structure = parseRoleWords({ seats: "3" }, "roles.0.words", WORDS, POSTED);
    expect(structure).toEqual({ ok: false, field: "roles.0.words.seats", error: PROPOSAL_WORDS.notAWord });
    const terms = parseRoleWords({ termsOffer: "x" }, "w", WORDS, POSTED);
    expect(terms.ok).toBe(false);
  });

  it("refuses words that look like a card number", () => {
    const r = parseRoleWords({ aim: "Pay me at 4111 1111 1111 1111 each moon" }, "w", WORDS, POSTED);
    expect(r).toEqual({ ok: false, field: "w.aim", error: PROPOSAL_WORDS.paymentInWords });
  });

  it("does not store a value equal to the posted one, however it is spaced", () => {
    const r = parseRoleWords({ aim: "  Keep the garden fed and growing.  ", domain: "The garden and the orchard." }, "w", WORDS, POSTED);
    expect(r).toEqual({ ok: true, value: { domain: "The garden and the orchard." } });
  });

  it("reads a list sent as text one item per line, markers off", () => {
    const r = parseRoleWords({ accountabilities: "- Turn the compost each moon\n- Plan the planting\n- Save seed" }, "w", WORDS, POSTED);
    expect(r).toEqual({ ok: true, value: { accountabilities: ["Turn the compost each moon", "Plan the planting", "Save seed"] } });
  });

  it("reads a CCOS list sent as text one item per line, through the CCOS parser", () => {
    expect(parseRoleWords({ authorities: "Choose the rootstock\nSet the pruning days" }, "w", WORDS, POSTED)).toEqual({
      ok: true,
      value: { authorities: ["Choose the rootstock", "Set the pruning days"] },
    });
    const many = Array.from({ length: 9 }, (_, i) => `Power ${i + 1}`).join("\n");
    expect(parseRoleWords({ authorities: many }, "w", WORDS, POSTED).ok).toBe(false);
  });

  it("holds changed accountabilities to 3 to 6, and never re-judges a role sent back as it is", () => {
    // Two lines posted, sent back unchanged: no change, nothing judged.
    expect(parseRoleWords({ accountabilities: ["Turn the compost each moon", "Plan the planting"] }, "w", WORDS, POSTED)).toEqual({ ok: true, value: {} });
    expect(parseRoleWords({ accountabilities: ["Only one"] }, "w", WORDS, POSTED).ok).toBe(false);
    const seven = Array.from({ length: 7 }, (_, i) => `Line ${i + 1}`);
    expect(parseRoleWords({ accountabilities: seven }, "w", WORDS, POSTED).ok).toBe(false);
  });

  it("passes the handover words through their own parser", () => {
    const tooMany = Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`).join("\n");
    const r = parseRoleWords({ bringMe: tooMany }, "w", WORDS, POSTED);
    expect(r.ok).toBe(false);
  });

  it("refuses a text past the room a role's words have", () => {
    const r = parseRoleWords({ aim: "a".repeat(2001) }, "w", WORDS, POSTED);
    expect(r.ok).toBe(false);
  });
});

describe("the diff a page draws in gold", () => {
  it("names every field with what is posted, what is proposed, and whether they differ", () => {
    const fields = wordFields(POSTED, { domain: "The garden and the orchard.", accountabilities: ["Turn the compost each moon"] }, WORDS);
    const by = Object.fromEntries(fields.map((f) => [f.field, f]));
    expect(by.aim).toEqual({ field: "aim", posted: POSTED.aim, proposed: POSTED.aim, changed: false });
    expect(by.domain).toEqual({ field: "domain", posted: POSTED.domain, proposed: "The garden and the orchard.", changed: true });
    expect(by.accountabilities.changed).toBe(true);
    expect(by.runbook).toEqual({ field: "runbook", posted: null, proposed: null, changed: false });
  });

  it("reads a field cleared to nothing as changed when something was posted", () => {
    const by = Object.fromEntries(wordFields(POSTED, { domain: null }, WORDS).map((f) => [f.field, f]));
    expect(by.domain).toMatchObject({ posted: POSTED.domain, proposed: null, changed: true });
  });

  it("reads every word a new role writes as changed, and the rest as nothing", () => {
    const by = Object.fromEntries(wordFields(null, { name: "Orchard Keeper", aim: "Keep the orchard." }, WORDS).map((f) => [f.field, f]));
    expect(by.name).toEqual({ field: "name", posted: null, proposed: "Orchard Keeper", changed: true });
    expect(by.domain.changed).toBe(false);
  });
});

describe("a body update", () => {
  const start = (): ProposalBody => ({ ...emptyBody(), roles: [{ roleId: "role-garden", words: {}, reviewOn: "2026-11-09" }] });

  it("keeps every group the update leaves out", () => {
    const r = parseBodyUpdate({ season: { aim: "Feed thirty people." } }, start(), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.roles).toEqual(start().roles);
    expect(r.value.season.aim).toBe("Feed thirty people.");
  });

  it(`holds at most ${MAX_SEATS} roles across those the village has and new ones`, () => {
    expect(MAX_PROPOSAL_ROLES).toBe(MAX_SEATS);
    const five = ["role-garden", "role-kitchen", "role-water", "role-paths", "role-tools"].map((roleId) => ({ roleId }));
    expect(parseBodyUpdate({ roles: five }, emptyBody(), ctx()).ok).toBe(true);
    const six = [...five, { roleId: "role-seeds" }];
    expect(parseBodyUpdate({ roles: six }, emptyBody(), ctx())).toEqual({ ok: false, field: "roles", error: PROPOSAL_WORDS.tooManyRoles });
    const four = five.slice(0, 4);
    const two = [1, 2].map((i) => ({ circleId: "circle-land", words: { name: `New role ${i}` } }));
    expect(parseBodyUpdate({ roles: four, newRoles: two }, emptyBody(), ctx())).toEqual({ ok: false, field: "newRoles", error: PROPOSAL_WORDS.tooManyRoles });
  });

  it("refuses a role the village does not fill, and the same role twice", () => {
    expect(parseBodyUpdate({ roles: [{ roleId: "role-nope" }] }, emptyBody(), ctx())).toMatchObject({ ok: false, error: PROPOSAL_WORDS.noSuchRole });
    expect(parseBodyUpdate({ roles: [{ roleId: "role-garden" }, { roleId: "role-garden" }] }, emptyBody(), ctx()).ok).toBe(false);
  });

  it("gives a new role an id, keeps it on the next save, and refuses an id the draft never gave", () => {
    const first = parseBodyUpdate({ newRoles: [{ circleId: "circle-land", words: { name: "Orchard Keeper" } }] }, emptyBody(), ctx());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const id = first.value.newRoles[0].id;
    expect(id).toMatch(/^role-[0-9a-f]{12}$/);
    const again = parseBodyUpdate({ newRoles: [{ id, circleId: "circle-land", words: { name: "Orchard Steward" } }] }, first.value, ctx());
    expect(again.ok && again.value.newRoles[0].id).toBe(id);
    expect(parseBodyUpdate({ newRoles: [{ id: "role-000000000999", circleId: "circle-land", words: { name: "X" } }] }, first.value, ctx()).ok).toBe(false);
  });

  it("needs a new role's circle and its name", () => {
    expect(parseBodyUpdate({ newRoles: [{ words: { name: "Orchard Keeper" } }] }, emptyBody(), ctx())).toMatchObject({ ok: false, error: PROPOSAL_WORDS.newRoleCircle });
    expect(parseBodyUpdate({ newRoles: [{ circleId: "circle-land", words: { aim: "Keep it." } }] }, emptyBody(), ctx())).toMatchObject({ ok: false, error: PROPOSAL_WORDS.newRoleName });
  });

  it("serves only next season's goals, as the village wrote them", () => {
    const ok = parseBodyUpdate({ season: { servesGoals: [{ goal: "Grow food for thirty people", howItHelps: "The beds feed the kitchen." }] } }, emptyBody(), ctx());
    expect(ok.ok).toBe(true);
    const stray = parseBodyUpdate({ season: { servesGoals: [{ goal: "Something else", howItHelps: null }] } }, emptyBody(), ctx());
    expect(stray.ok).toBe(false);
    const noTarget = parseBodyUpdate({ season: { servesGoals: [{ goal: "Grow food for thirty people" }] } }, emptyBody(), ctx({ orgGoals: [] }));
    expect(noTarget.ok).toBe(false);
  });

  it("takes up to three seasonal goals", () => {
    const g = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Goal ${i + 1}`, doneWhen: null }));
    expect(parseBodyUpdate({ season: { seasonalGoals: g(3) } }, emptyBody(), ctx()).ok).toBe(true);
    expect(parseBodyUpdate({ season: { seasonalGoals: g(4) } }, emptyBody(), ctx()).ok).toBe(false);
  });

  it("reads the terms through the one settings parser", () => {
    expect(parseBodyUpdate({ settings: { v: 1, term: { lengthMoons: 3 } } }, emptyBody(), ctx()).ok).toBe(true);
    expect(parseBodyUpdate({ settings: { v: 1, colour: "green" } }, emptyBody(), ctx()).ok).toBe(false);
  });
});

describe("submit readiness", () => {
  const ready: ProposalBody = {
    ...emptyBody(),
    roles: [{ roleId: "role-garden", words: {}, reviewOn: null }],
    season: { aim: "Feed thirty people.", seasonalGoals: [{ title: "Beds planted", doneWhen: "every bed holds a crop" }], servesGoals: [] },
  };

  it("needs next season, a role, an aim and a seasonal goal, in that order", () => {
    expect(submitRefusal(ready, false)).toBe(PROPOSAL_WORDS.noTargetSubmit);
    expect(submitRefusal({ ...ready, roles: [] }, true)).toBe(PROPOSAL_WORDS.noRoles);
    expect(submitRefusal({ ...ready, season: { ...ready.season, aim: null } }, true)).toBe(PROPOSAL_WORDS.noAim);
    expect(submitRefusal({ ...ready, season: { ...ready.season, seasonalGoals: [] } }, true)).toBe(PROPOSAL_WORDS.noSeasonalGoal);
    expect(submitRefusal(ready, true)).toBeNull();
  });

  it("says Rye's words when next season has no dates", () => {
    expect(PROPOSAL_WORDS.noTarget).toBe("Next season's dates aren't set yet");
  });

  it("writes the aim as the note and the seasonal goals as what will be true at the season's end", () => {
    expect(applicationWordsOf(ready.season)).toEqual({ note: "Feed thirty people.", deliverables: "Beds planted: every bed holds a crop" });
  });

  it("changes roles only when it names a new role or a changed word", () => {
    expect(changesRoles(ready)).toBe(false);
    expect(changesRoles({ ...ready, roles: [{ roleId: "role-garden", words: { aim: "x" }, reviewOn: null }] })).toBe(true);
    expect(changesRoles({ ...ready, newRoles: [{ id: "role-000000000001", circleId: "c", seats: 1, words: { name: "N" }, reviewOn: null }] })).toBe(true);
  });
});

describe("a comment", () => {
  it(`is at most ${COMMENT_MAX} characters and never payment details`, () => {
    expect(parseComment("Looks right to me.")).toEqual({ ok: true, value: "Looks right to me." });
    expect(parseComment("a".repeat(COMMENT_MAX)).ok).toBe(true);
    expect(parseComment("a".repeat(COMMENT_MAX + 1)).ok).toBe(false);
    expect(parseComment("   ").ok).toBe(false);
    expect(parseComment("Send it to 4111 1111 1111 1111")).toEqual({ ok: false, field: "text", error: PROPOSAL_WORDS.paymentInComment });
  });
});
