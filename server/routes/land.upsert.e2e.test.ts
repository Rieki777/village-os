/**
 * The land upsert, against a real database, because the argument that lets
 * migration 0214 ship is a claim about what MySQL does.
 *
 * `server/routes/land.test.ts` runs the handlers against a stub pool, which is
 * right for the decision logic it covers and blind to everything here: the
 * stub answers every INSERT with `affectedRows: 1` and has no idea what a
 * UNIQUE key is. Its own header said an e2e suite "would be worth adding
 * alongside this one when the admin screen lands". The screen landed.
 *
 * THE CASE THAT MATTERS IS THE SECOND ONE. 0214 swaps this table's unique key
 * from `(village_id)` to `(village_id, slug)`, which the compat gate reports
 * as a new UNIQUE index on an existing table and which ships behind a
 * `compat-ok` waiver. The waiver's whole argument is that the PREVIOUS
 * release's upsert, which never names `slug`, still collides on the row it
 * always collided on, because the column defaults to 'home'. That was an
 * argument written in a header. This file executes it.
 *
 * It uses the provisioned scratch schema rather than a hand-built table, so
 * the shape under test is the one every migration in `drizzle/` actually
 * produces, including 0214 itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { splitStatements } from "../db/migrate";
import { deleteParcel, upsertParcel } from "../repos/villageLand";

const DB_CONFIGURED = testDbConfigured();
const VILLAGE = "land-upsert-probe";

let testDb: TestDb;
let conn: mysql.Connection;

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  testDb = await provisionTestDb();
  conn = testDb.conn;
  await conn.query("DELETE FROM village_land WHERE village_id = ?", [VILLAGE]); // module-review-ok: resetting the scratch schema this suite provisioned before it seeds its own rows
});

afterAll(async () => {
  if (!DB_CONFIGURED || !testDb) return;
  await conn.query("DELETE FROM village_land WHERE village_id = ?", [VILLAGE]).catch(() => {}); // module-review-ok: cleaning the scratch schema this suite provisioned after it
  await testDb.drop();
});

/*
 * THE REAL STATEMENT, not a copy of it. This file used to hold its own string
 * of the upsert "exactly as land.ts issues it", which is a promise only a
 * reader could check: change the route's SQL and this suite would go on
 * proving the old text. It now calls the repo function the route calls.
 */
const save = (id: string, slug: string, label: string, order: number, lat: number) =>
  upsertParcel(conn, {
    id, villageId: VILLAGE, slug, label, sortOrder: order, centreLat: lat, centreLon: -83.84,
    spanM: 800, visibility: "exact", sourceText: "t", sourceFormat: "decimal", updatedBy: "f1",
  });

/** The write the release BEFORE 0214 makes: it names no slug and no label. */
const previousReleaseSave = (id: string, lat: number) =>
  conn.query( // module-review-ok: the PREVIOUS release's own raw write, issued verbatim; routing it through the repo would test the new code instead of the old
    `INSERT INTO village_land (id, village_id, centre_lat, centre_lon, span_m, visibility)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE centre_lat = VALUES(centre_lat), span_m = VALUES(span_m)`,
    [id, VILLAGE, lat, -83.8, 800, "exact"],
  );

const rows = async (): Promise<any[]> => {
  const [r] = await conn.query( // module-review-ok: reading rows back to prove what the repo wrote, which is what this suite exists to check
    "SELECT slug, label, sort_order, centre_lat FROM village_land WHERE village_id = ? ORDER BY sort_order, created_at",
    [VILLAGE],
  );
  return r as any[];
};

describe.skipIf(!DB_CONFIGURED)("the land upsert, on the schema 0214 produces", () => {
  it("gives a row the previous release writes the slug 'home'", async () => {
    await previousReleaseSave("old-1", 9.1);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0].slug).toBe("home");
  });

  it("still lets the PREVIOUS release's upsert update instead of inserting a duplicate", async () => {
    /*
     * The compat-ok waiver, executed. If the key swap had broken this, a
     * rollback would start writing a second row per village and the gate's
     * warning would have been right.
     */
    await previousReleaseSave("old-2", 9.5);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(Number(r[0].centre_lat)).toBeCloseTo(9.5, 4);
  });

  it("does not blank a parcel's name when only its coordinates are saved", async () => {
    await save("a", "home", "The home block", 0, 9.2);
    await save("b", "home", "", 0, 9.3);
    const r = await rows();
    expect(r[0].label).toBe("The home block");
    expect(Number(r[0].centre_lat)).toBeCloseTo(9.3, 4);
  });

  it("makes a second parcel a second row, which is the whole point of 0214", async () => {
    await save("c", "the-ridge", "The ridge", 1, 9.4);
    const r = await rows();
    expect(r.map((x) => x.slug)).toEqual(["home", "the-ridge"]);
  });

  it("collides on the same parcel twice, so a rename never becomes a duplicate", async () => {
    await save("d", "the-ridge", "Renamed ridge", 1, 9.45);
    const r = await rows();
    expect(r).toHaveLength(2);
    expect(r[1].label).toBe("Renamed ridge");
  });

  it("orders parcels by sort_order, which is what decides the one that opens", async () => {
    await save("e", "south-block", "South block", 2, 9.6);
    const r = await rows();
    expect(r.map((x) => x.slug)).toEqual(["home", "the-ridge", "south-block"]);
  });
});
/**
 * THE CLASS, not the instance: at EVERY statement boundary of 0214, the
 * previous release's write must still collide.
 *
 * An earlier draft of 0214 dropped the old unique key in one statement and
 * added the new one in the next. Between them the table had no unique key at
 * all, the previous release's ON DUPLICATE KEY UPDATE had nothing to collide
 * on and INSERTed, and the ADD that followed died on the duplicate. Railway
 * deploys by rolling, so the old container writing mid-migration is a real
 * schedule, and a migration that fails at boot is a village that cannot
 * start. The merge-conflict lane found it by reading the file.
 *
 * This asserts the property rather than the fix. It builds the table from
 * 0123 itself, splits 0214 with the boot runner's OWN splitter (so a
 * statement boundary here is a statement boundary in production), and issues
 * the previous release's write before the file and after every statement. Any
 * future edit that reopens a gap, by splitting the swap again or by any other
 * route, makes this fail by name.
 *
 * It needs a table in the pre-0214 state, which the provisioned schema is
 * not, so it builds its own sibling database on the same server and drops it.
 */
describe.skipIf(!DB_CONFIGURED)("0214 leaves no moment without a unique key", () => {
  let side: mysql.Connection;
  let sideName = "";

  beforeAll(async () => {
    if (!DB_CONFIGURED) return;
    sideName = `land_window_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await conn.query(`CREATE DATABASE \`${sideName}\``); // module-review-ok: a throwaway sibling database holding the pre-0214 table on the same test server; dropped in afterAll
    side = await mysql.createConnection(testDb.url.replace(/\/[^/?]+(\?|$)/, `/${sideName}$1`)); // module-review-ok: connecting to that throwaway sibling database on the test server
  });

  afterAll(async () => {
    if (!DB_CONFIGURED || !sideName) return;
    await side?.end().catch(() => {});
    await conn.query(`DROP DATABASE IF EXISTS \`${sideName}\``).catch(() => {}); // module-review-ok: dropping the throwaway sibling database this suite created
  });

  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), "drizzle", f), "utf8");
  /** The previous release's write, in its real shape: it names no slug. */
  const previousWrite = (id: string) =>
    side.query(
      `INSERT INTO village_land (id, village_id, centre_lat, centre_lon, span_m, visibility)
       VALUES (?, 'local', 9.3, -83.8, 800, 'exact')
       ON DUPLICATE KEY UPDATE centre_lat = VALUES(centre_lat)`,
      [id],
    );
  const count = async () =>
    Number(((await side.query("SELECT COUNT(*) n FROM village_land WHERE village_id = 'local'")) as any)[0][0].n);

  it("keeps the previous release colliding before, between and after every statement", async () => {
    for (const st of splitStatements(read("0123_village_land.sql"))) await side.query(st);
    await previousWrite("seed");

    const statements = splitStatements(read("0214_village_land_parcels.sql"));
    expect(statements.length).toBeGreaterThan(0);

    const trail: number[] = [await count()];
    for (let i = 0; i < statements.length; i++) {
      await side.query(statements[i]);
      // The rolling deploy: the old container writes right here.
      await previousWrite(`after-${i}`);
      trail.push(await count());
    }
    // One row the whole way. A 2 anywhere names the boundary that had no key.
    expect(trail).toEqual(trail.map(() => 1));
  });
});

/**
 * TAKING A PIECE OF LAND BACK OFF, which the Add button made necessary the
 * day it shipped.
 *
 * Parcels are created from a text box, so parcels get created by mistake, and
 * until this there was no way back from the screen: the only remedy was a hand
 * DELETE in production. The route's judgement about WHICH parcels may go lives
 * in land.ts; what this proves is the statement underneath it, including the
 * property that is easy to get wrong and impossible to see in a single-village
 * deployment.
 */
describe.skipIf(!DB_CONFIGURED)("removing a parcel", () => {
  const OTHER = "land-upsert-neighbour";

  const otherVillageRows = async (): Promise<any[]> => {
    const [r] = await conn.query( // module-review-ok: reading a second village's rows back to prove the delete was scoped
      "SELECT slug FROM village_land WHERE village_id = ?",
      [OTHER],
    );
    return r as any[];
  };

  beforeAll(async () => {
    if (!DB_CONFIGURED) return;
    await conn.query("DELETE FROM village_land WHERE village_id IN (?, ?)", [VILLAGE, OTHER]); // module-review-ok: this block seeds its own rows in the scratch schema the suite provisioned
    await save("r1", "home", "The home block", 0, 9.1);
    await save("r2", "the-ridge", "The ridge", 1, 9.2);
    await save("r3", "south-block", "South block", 2, 9.3);
    await upsertParcel(conn, {
      id: "r4", villageId: OTHER, slug: "the-ridge", label: "Somebody else's ridge", sortOrder: 0,
      centreLat: 9.9, centreLon: -83.8, spanM: 800, visibility: "exact",
      sourceText: "t", sourceFormat: "decimal", updatedBy: "f2",
    });
  });

  afterAll(async () => {
    if (!DB_CONFIGURED || !testDb) return;
    await conn.query("DELETE FROM village_land WHERE village_id = ?", [OTHER]).catch(() => {}); // module-review-ok: cleaning the second village this block seeded
  });

  it("takes the named parcel and leaves the others in their order", async () => {
    await deleteParcel(conn, VILLAGE, "the-ridge");
    const r = await rows();
    expect(r.map((x) => x.slug)).toEqual(["home", "south-block"]);
  });

  it("leaves another village's parcel of the same name alone", async () => {
    /*
     * The delete is scoped to the village as well as the slug. This
     * deployment is one village today, so a statement missing the village
     * clause would pass every other test in this file and go wrong only after
     * the retrofit 0069 exists for. Slugs are chosen by founders, so two
     * villages naming a parcel 'the-ridge' is the ordinary case.
     */
    expect((await otherVillageRows()).map((x) => x.slug)).toEqual(["the-ridge"]);
  });

  it("is a quiet no-op on a name that is not there", async () => {
    const before = (await rows()).map((x) => x.slug);
    await deleteParcel(conn, VILLAGE, "never-existed");
    expect((await rows()).map((x) => x.slug)).toEqual(before);
  });
});
