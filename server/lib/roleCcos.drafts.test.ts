/**
 * A role's CCOS words change on the ROLE, by draft (0274, Rye 2026-10-22),
 * and only by draft; and the CCOS limits bind a new write only.
 *
 * What this pins, each against a real schema:
 *   - MIGRATION COMPAT: the seven columns are nullable with no default, and
 *     the previous release's INSERT, which names none of them, still writes a
 *     role that reads back with nothing written;
 *   - the round trip for each field: an `update_seat` draft names it, the
 *     publish writes it, `listOrgRoles` reads it back, and the revert puts the
 *     words before it back;
 *   - a role a `create_seat` draft makes keeps all seven;
 *   - a bad value blocks at preview with the parser's sentence, and a draft
 *     that reaches the publish anyway is refused there too, nothing written;
 *   - 3 to 6 accountabilities on a new draft: 2 and 7 are refused at preview
 *     and at publish, while a role already stored with 2 still loads and its
 *     other words still change;
 *   - a change naming only the accountabilities is a change, and publishes;
 *   - 2 to 4 measures when a draft puts terms on offer, while a stored offer
 *     with 1 still loads;
 *   - reverting a draft whose `before_json` predates 0274 leaves words
 *     written since alone.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { addChange, createDraft, previewDraft, publishDraft, revertDraft } from "./orgDrafts";
import { listOrgRoles } from "./orgChart";
import { readTermsOffer } from "../../shared/seatTermsOffer";
import { ROLE_CCOS_WORDS } from "../../shared/roleCcos";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

async function draftWith(op: "update_seat" | "create_seat", orgRoleId: string, payload: Record<string, unknown>) {
  const made = await createDraft(pool, { title: "CCOS words", createdBy: "u-steward", openCap: 99 });
  if (!made.ok) throw new Error(made.error);
  const added = await addChange(pool, made.id, { op, orgRoleId, payload });
  if (!added.ok) throw new Error(added.error);
  return made.id;
}

async function publishWith(op: "update_seat" | "create_seat", orgRoleId: string, payload: Record<string, unknown>) {
  const id = await draftWith(op, orgRoleId, payload);
  const preview = await previewDraft(pool, id, 99);
  expect(preview.blocked, JSON.stringify(preview.lines)).toBe(0);
  const r = await publishDraft(pool, id, "u-steward", 99);
  expect(r.ok, !r.ok ? r.error : "").toBe(true);
  return id;
}

/** Preview blocks it with these words, and a publish attempted anyway is refused. */
async function refused(op: "update_seat" | "create_seat", orgRoleId: string, payload: Record<string, unknown>, words: RegExp) {
  const id = await draftWith(op, orgRoleId, payload);
  const preview = await previewDraft(pool, id, 99);
  expect(preview.blocked, JSON.stringify(payload)).toBe(1);
  expect(preview.lines[0].blocked).toMatch(words);
  const r = await publishDraft(pool, id, "u-steward", 99);
  expect(r.ok, JSON.stringify(payload)).toBe(false);
}

async function roleOf(id: string) {
  return (await listOrgRoles(pool)).find((r) => r.id === id);
}

const NOTHING = {
  existsWhile: null,
  authorities: null,
  responsibilities: null,
  signsStretched: null,
  flowsBack: null,
  stepBack: null,
  timeCommitment: null,
};

const three = ["Fresh water each week", "Clean tanks", "Readings on the board"];

describe.skipIf(!configured)("the CCOS words change on the role, by draft", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM org_draft_changes"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM org_drafts"); // module-review-ok: same
    await pool.query("DELETE FROM org_roles WHERE id LIKE 'ccos-%'"); // module-review-ok: same, only this suite's own roles
    await pool.query("INSERT INTO org_roles (id, name, aim, domain, accountabilities, seats) VALUES ('ccos-water', 'Water Steward', 'Keep the springs running', 'The tanks', '[]', 1)"); // module-review-ok: this suite's own fixture role
  });

  it("migration compat: seven nullable columns, no default, and the old INSERT still writes a role", async () => {
    const [cols] = await pool.query<any[]>( // module-review-ok: reading the scratch schema this suite provisioned
      "SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def, DATA_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_roles' AND COLUMN_NAME IN ('exists_while','authorities','responsibilities','signs_stretched','flows_back','step_back','time_commitment') ORDER BY COLUMN_NAME",
    );
    // MariaDB spells "no default" as the text NULL; MySQL as a real null.
    expect(cols.map((c) => [c.name, c.nullable, c.def === "NULL" ? null : (c.def ?? null)])).toEqual([
      ["authorities", "YES", null],
      ["exists_while", "YES", null],
      ["flows_back", "YES", null],
      ["responsibilities", "YES", null],
      ["signs_stretched", "YES", null],
      ["step_back", "YES", null],
      ["time_commitment", "YES", null],
    ]);
    const type = Object.fromEntries(cols.map((c) => [c.name, String(c.type)]));
    expect(type.exists_while).toBe("text");
    expect(type.time_commitment).toBe("varchar");
    // MariaDB keeps json as an alias of longtext; MySQL names it json.
    expect(["json", "longtext"]).toContain(type.authorities);
    // The previous release's create_seat INSERT, column for column (0268's). It names none of the seven.
    await pool.query( // module-review-ok: the previous release's own statement, replayed against the migrated schema
      "INSERT INTO org_roles (id, name, circle_id, aim, domain, accountabilities, seats, why_it_matters, criticality, recruiting, terms_offer, terms_offer_at, terms_offer_by, bring_me, not_mine, runbook) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", // module-review-ok: the previous release's own statement, replayed against the migrated schema
      ["ccos-old", "Old Release Role", null, null, null, "[]", 1, null, "normal", 0, null, null, null, null, null, null],
    );
    expect(await roleOf("ccos-old")).toMatchObject(NOTHING);
  });

  const ROUND_TRIPS: Array<[string, unknown, unknown]> = [
    ["existsWhile", "  the village draws water from its own springs  ", "the village draws water from its own springs"],
    ["authorities", ["Close a tank for cleaning", "  Order filters  "], ["Close a tank for cleaning", "Order filters"]],
    ["responsibilities", "Read the meters each Monday\n\nClean the filters each moon", ["Read the meters each Monday", "Clean the filters each moon"]],
    ["signsStretched", "Readings missed two weeks running.", "Readings missed two weeks running."],
    ["flowsBack", "A second pair of hands from the Build circle.", "A second pair of hands from the Build circle."],
    ["stepBack", "Name it at the Friday check-in.\nCleaning pauses first.", "Name it at the Friday check-in.\nCleaning pauses first."],
    ["timeCommitment", "Two mornings a week", "Two mornings a week"],
  ];

  for (const [field, sent, stored] of ROUND_TRIPS) {
    it(`round trip: ${field}, by update_seat, and the revert puts it back`, async () => {
      const id = await publishWith("update_seat", "ccos-water", { [field]: sent });
      expect((await roleOf("ccos-water")) as any).toHaveProperty(field, stored);
      const back = await revertDraft(pool, id);
      expect(back.ok, !back.ok ? back.error : "").toBe(true);
      expect((await roleOf("ccos-water")) as any).toHaveProperty(field, null);
    });
  }

  it("null clears a field, and a field the draft does not name is left as it was", async () => {
    await publishWith("update_seat", "ccos-water", { existsWhile: "the springs run", timeCommitment: "Two mornings a week" });
    await publishWith("update_seat", "ccos-water", { existsWhile: null });
    const r = await roleOf("ccos-water");
    expect(r?.existsWhile).toBeNull();
    expect(r?.timeCommitment).toBe("Two mornings a week");
    expect(r?.aim).toBe("Keep the springs running");
  });

  it("a role a create_seat draft makes keeps all seven, beside 3 accountabilities", async () => {
    await publishWith("create_seat", "ccos-new", {
      name: "Hearth Keeper",
      accountabilities: three,
      existsWhile: "the village gathers around one fire",
      authorities: ["Choose the wood"],
      responsibilities: ["Light the fire each evening"],
      signsStretched: "The fire goes out twice in a week.",
      flowsBack: "Wood from the Build circle.",
      stepBack: "Hand the evening to the Welcome role.",
      timeCommitment: "Every evening",
    });
    expect(await roleOf("ccos-new")).toMatchObject({
      accountabilities: three,
      existsWhile: "the village gathers around one fire",
      authorities: ["Choose the wood"],
      responsibilities: ["Light the fire each evening"],
      signsStretched: "The fire goes out twice in a week.",
      flowsBack: "Wood from the Build circle.",
      stepBack: "Hand the evening to the Welcome role.",
      timeCommitment: "Every evening",
    });
  });

  it("a bad value blocks at preview with the parser's sentence, and the publish refuses it too", async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ authorities: Array.from({ length: 9 }, (_, i) => `Decision ${i + 1}`) }, /What I can decide on my own: Up to 8 lines/],
      [{ responsibilities: ["x".repeat(201)] }, /What I do regularly: Keep each line to 200 characters/],
      [{ existsWhile: "x".repeat(301) }, /This role exists while: Keep it to 300 characters/],
      [{ timeCommitment: "x".repeat(81) }, /Time: Keep it to 80 characters/],
      [{ existsWhile: "one\ntwo" }, /Keep it to one line/],
      [{ flowsBack: "Pay into 12345678901" }, /bank or card number/],
    ];
    for (const [payload, words] of cases) await refused("update_seat", "ccos-water", payload, words);
    await refused("create_seat", "ccos-bad", { name: "Bad Role", stepBack: "x".repeat(301) }, /How I can step back: Keep it to 300 characters/);
    expect(await roleOf("ccos-water")).toMatchObject(NOTHING);
    expect(await roleOf("ccos-bad")).toBeUndefined();
  });

  it("the accountability limit refuses 2 and 7 on a new draft, at preview and at publish", async () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `Outcome ${i + 1}`);
    const words = new RegExp(ROLE_CCOS_WORDS.accountabilities.replace(/[.]/g, "\\."));
    await refused("update_seat", "ccos-water", { accountabilities: lines(2) }, words);
    await refused("update_seat", "ccos-water", { accountabilities: lines(7) }, words);
    await refused("create_seat", "ccos-two", { name: "Two Things", accountabilities: lines(2) }, words);
    await refused("create_seat", "ccos-seven", { name: "Seven Things", accountabilities: lines(7) }, words);
    expect((await roleOf("ccos-water"))?.accountabilities).toEqual([]);
    // 3 and 6 publish; none is "not written yet" and publishes too.
    await publishWith("update_seat", "ccos-water", { accountabilities: lines(3) });
    await publishWith("update_seat", "ccos-water", { accountabilities: lines(6) });
    await publishWith("create_seat", "ccos-none", { name: "Nothing Written Yet" });
    expect((await roleOf("ccos-water"))?.accountabilities).toEqual(lines(6));
  });

  it("an old role with 2 accountabilities still loads, and its other words still change", async () => {
    await pool.query("UPDATE org_roles SET accountabilities = ? WHERE id = 'ccos-water'", [JSON.stringify(["Fresh water", "Clean tanks"])]); // module-review-ok: a role stored before the limit, written the way it was then
    expect((await roleOf("ccos-water"))?.accountabilities).toEqual(["Fresh water", "Clean tanks"]);
    await publishWith("update_seat", "ccos-water", { aim: "Keep every spring running", authorities: ["Close a tank"] });
    const r = await roleOf("ccos-water");
    expect(r?.accountabilities).toEqual(["Fresh water", "Clean tanks"]);
    expect(r?.aim).toBe("Keep every spring running");
    expect(r?.authorities).toEqual(["Close a tank"]);
  });

  it("a role carried in from its own card keeps its count on create, and an edit here is still held to 3 to 6", async () => {
    const two = ["The kitchen", "The pantry"];
    await publishWith("create_seat", "ccos-carried", { name: "Cook", accountabilities: two, carriedFrom: "regen-civics" });
    expect((await roleOf("ccos-carried"))?.accountabilities).toEqual(two);
    const words = new RegExp(ROLE_CCOS_WORDS.accountabilities.replace(/[.]/g, "\\."));
    await refused("update_seat", "ccos-water", { accountabilities: two, carriedFrom: "regen-civics" }, words);
  });

  it("a change naming only the accountabilities is a change, and publishes (the card's proposal)", async () => {
    await publishWith("update_seat", "ccos-water", { accountabilities: three });
    expect((await roleOf("ccos-water"))?.accountabilities).toEqual(three);
  });

  it("terms put on offer name 2 to 4 measures, while an offer stored with 1 still loads", async () => {
    const board = (n: number) => ({ v: 1, scoreboard: { measures: Array.from({ length: n }, (_, i) => ({ measure: `Measure ${i + 1}` })) } });
    await refused("update_seat", "ccos-water", { termsOffer: board(1) }, /Name 2 to 4 measures/);
    await refused("update_seat", "ccos-water", { termsOffer: board(5) }, /Name 2 to 4 measures/);
    await publishWith("update_seat", "ccos-water", { termsOffer: board(2) });
    // An offer written before the limit, with one measure, as the column holds it.
    await pool.query("UPDATE org_roles SET terms_offer = ? WHERE id = 'ccos-water'", [JSON.stringify(board(1))]); // module-review-ok: an offer stored before the limit, written the way it was then
    const r = await roleOf("ccos-water");
    const read = readTermsOffer(r?.termsOffer);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.settings?.scoreboard?.measures).toHaveLength(1);
  });

  it("reverting a draft captured before 0274 leaves words written since alone", async () => {
    const id = await publishWith("update_seat", "ccos-water", { aim: "A new aim" });
    // What a release before 0274 captured: none of the seven columns.
    await pool.query( // module-review-ok: this suite rewrites its own draft row to the shape an older release stored
      "UPDATE org_draft_changes SET before_json = JSON_REMOVE(before_json, '$.exists_while', '$.authorities', '$.responsibilities', '$.signs_stretched', '$.flows_back', '$.step_back', '$.time_commitment') WHERE draft_id = ?",
      [id],
    );
    await publishWith("update_seat", "ccos-water", { authorities: ["Written since"], timeCommitment: "Written since" });
    const back = await revertDraft(pool, id);
    expect(back.ok, !back.ok ? back.error : "").toBe(true);
    const r = await roleOf("ccos-water");
    expect(r?.aim).toBe("Keep the springs running");
    expect(r?.authorities).toEqual(["Written since"]);
    expect(r?.timeCommitment).toBe("Written since");
  });
});
