/**
 * THE AMENDMENT LEDGER KEEPS THE ROW AND LOSES THE KEY.
 *
 * `mechanics_changes` stored every dial's before and after raw, so the moment
 * an admin set `tokens.base_rpc_url` to a dedicated endpoint the ledger held
 * the provider key in plain text, in every dump, forever. The public feed was
 * already closed (mechanicsHistory.ts); this is the storage.
 *
 * Two halves, one rule:
 *
 *   ON WRITE   the one INSERT stores a redacted value in place of a key.
 *   AT BOOT    rows written before this release are rewritten, by primary key,
 *              and ONLY where the rule says a key is present. Every other row
 *              is byte-identical afterwards, `at` included.
 *
 * The same pass rewrites the pulse lines an old release wrote as
 * "A game rule changed: <key> is now <value>", where the value carried a key.
 *
 * Every key below is fake.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  KEY_REMOVED,
  carriesCredential,
  isRedactedCredential,
  ledgerSafeNote,
  ledgerSafeValue,
} from "./credentialRedaction";
import { scrubCredentialCopies } from "./credentialScrub";
import { recordMechanicsChangeRow } from "./changeset";

const DIAL = "tokens.base_rpc_url";
const ALCHEMY_KEY = "AlchemyFakeKey0123456789abcdefgh";
const ALCHEMY = `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
// A provider that puts the key in a bare path segment: no pattern sees it, only
// the dial's declaration does.
const QUICK_KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const QUICKNODE = `https://fake-name.base-mainnet.quiknode.pro/${QUICK_KEY}/`;
const QUERY_VALUE = "Tok3nSecretValueNotReal";
const PLACE_WITH_TOKEN = `Meet by the river https://feed.example.test/x?token=${QUERY_VALUE}`;

describe("the rule", () => {
  it("removes a key in an Alchemy path and keeps where it pointed", () => {
    const out = ledgerSafeValue(DIAL, ALCHEMY)!;
    expect(out).not.toContain(ALCHEMY_KEY);
    expect(out).toBe(`https://base-mainnet.g.alchemy.com ${KEY_REMOVED}`);
    expect(isRedactedCredential(out)).toBe(true);
  });

  it("treats every value of the declared dial as a key, except its public default", () => {
    expect(ledgerSafeValue(DIAL, QUICKNODE)).not.toContain(QUICK_KEY);
    expect(ledgerSafeValue(DIAL, "https://mainnet.base.org")).toBe("https://mainnet.base.org");
    expect(carriesCredential(DIAL, "https://mainnet.base.org")).toBe(false);
  });

  it("removes a credential-shaped value on a dial nobody declared", () => {
    const out = ledgerSafeValue("sessions.place_line", PLACE_WITH_TOKEN)!;
    expect(out).not.toContain(QUERY_VALUE);
    expect(ledgerSafeValue("hypha.org_url", "https://user:pa55word@rpc.example.test/")).not.toContain("pa55word");
  });

  it("leaves an ordinary value exactly as it was, URLs included", () => {
    expect(ledgerSafeValue("governance.sensing_days", "10")).toBe("10");
    expect(ledgerSafeValue("hypha.org_url", "https://app.hypha.earth/our-dho")).toBe("https://app.hypha.earth/our-dho");
    expect(ledgerSafeValue("governance.sensing_days", null)).toBeNull();
    expect(carriesCredential("governance.sensing_days", "10")).toBe(false);
  });

  it("is idempotent, so a second pass changes nothing", () => {
    for (const [k, v] of [[DIAL, ALCHEMY], [DIAL, QUICKNODE], ["sessions.place_line", PLACE_WITH_TOKEN]] as const) {
      const once = ledgerSafeValue(k, v);
      expect(ledgerSafeValue(k, once)).toBe(once);
      expect(carriesCredential(k, once)).toBe(false);
    }
  });

  it("removes a key from inside a note and keeps the sentence", () => {
    const note = `Baseline moved between proposal (https://feed.example.test/x?token=${QUERY_VALUE}) and apply (plain)`;
    const out = ledgerSafeNote(note)!;
    expect(out).not.toContain(QUERY_VALUE);
    expect(out).toContain("Baseline moved between proposal");
    expect(ledgerSafeNote("An ordinary note")).toBe("An ordinary note");
    expect(ledgerSafeNote(null)).toBeNull();
    expect(ledgerSafeNote(out)).toBe(out);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("the ledger against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: a scratch schema, and the raw rows ARE the evidence
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM mechanics_changes"); // module-review-ok: scratch schema teardown
    await pool.query("DELETE FROM health_events WHERE kind = 'settings'"); // module-review-ok: scratch schema teardown
  });

  /** A row as an older release wrote it: straight into the table, no redaction. */
  async function seedRow(id: string, key: string, oldValue: string | null, newValue: string | null, note: string | null = null) {
    await pool.query( // module-review-ok: seeding rows the way a previous release left them is the only way to test the scrub
      "INSERT INTO mechanics_changes (id, config_key, old_value, new_value, actor_user_id, source, proposal_ref, note, at) " +
        "VALUES (?,?,?,?,?,?,?,?,?)",
      [id, key, oldValue, newValue, "user-1", "admin", null, note, new Date("2026-09-01T10:00:00Z")],
    );
  }

  async function rows(): Promise<Record<string, any>> {
    const [rs] = await pool.query<any[]>("SELECT * FROM mechanics_changes ORDER BY id"); // module-review-ok: reading the scratch ledger is the evidence
    return Object.fromEntries(rs.map((r) => [r.id, JSON.stringify(r)]));
  }

  it("the one INSERT stores no key, and still stores an ordinary change verbatim", async () => {
    await recordMechanicsChangeRow(pool, DIAL, { value: ALCHEMY, previous: "https://mainnet.base.org" }, "user-1", "admin");
    await recordMechanicsChangeRow(pool, "governance.sensing_days", { value: "10", previous: "8" }, "user-1", "admin");
    const [rs] = await pool.query<any[]>("SELECT config_key, old_value, new_value FROM mechanics_changes ORDER BY config_key"); // module-review-ok: reading the scratch ledger is the evidence
    const rpc = rs.find((r) => r.config_key === DIAL);
    // The row is on the record...
    expect(rpc, "the change is still recorded").toBeTruthy();
    expect(rpc.old_value).toBeNull();
    expect(String(rpc.new_value)).toContain("base-mainnet.g.alchemy.com");
    // ...and the key is not.
    expect(JSON.stringify(rs)).not.toContain(ALCHEMY_KEY);
    expect(rs.find((r) => r.config_key === "governance.sensing_days")).toMatchObject({ old_value: "8", new_value: "10" });
  });

  it("the boot scrub rewrites only the rows carrying a key, and a second pass is a no-op", async () => {
    await seedRow("m1", DIAL, null, ALCHEMY);
    await seedRow("m2", DIAL, ALCHEMY, QUICKNODE);
    await seedRow("m3", "sessions.place_line", "", PLACE_WITH_TOKEN);
    await seedRow("m4", "governance.sensing_days", "7", "10");
    await seedRow("m5", "hypha.org_url", null, "https://app.hypha.earth/our-dho");
    await seedRow("m6", DIAL, "https://mainnet.base.org", null);
    await seedRow("m7", "governance.sensing_days", "10", "12", `Baseline moved between proposal (https://x.example.test/?api_key=${QUERY_VALUE}) and apply (10)`);
    const before = await rows();
    // The seed really did put the keys in, so their absence below is the scrub.
    expect(Object.values(before).join("\n")).toContain(ALCHEMY_KEY);
    expect(Object.values(before).join("\n")).toContain(QUICK_KEY);

    const first = await scrubCredentialCopies(pool);
    const after = await rows();

    for (const id of ["m1", "m2", "m3", "m7"]) expect(after[id], `${id} carried a key`).not.toBe(before[id]);
    for (const id of ["m4", "m5", "m6"]) expect(after[id], `${id} carried no key and must be untouched`).toBe(before[id]);
    const all = Object.values(after).join("\n");
    for (const secret of [ALCHEMY_KEY, QUICK_KEY, QUERY_VALUE]) expect(all).not.toContain(secret);
    // The rows keep their shape: the date, the key, who did it.
    expect(JSON.parse(after.m1)).toMatchObject({ config_key: DIAL, actor_user_id: "user-1", old_value: null });
    expect(JSON.parse(after.m1).at).toEqual(JSON.parse(before.m1).at);
    expect(first.ledgerRows).toBe(4);

    const second = await scrubCredentialCopies(pool);
    expect(second.ledgerRows).toBe(0);
    expect(await rows()).toEqual(after);
  });

  it("rewrites an old pulse line that narrated a key, and no other line", async () => {
    const seedEvent = (id: string, kind: string, text: string, ref: string | null) =>
      pool.query( // module-review-ok: seeding the pre-2026-08-12 pulse line by hand is the only way to test rewriting it
        "INSERT INTO health_events (id, kind, text, entity_type, entity_ref, audience) VALUES (?,?,?,?,?, 'public')",
        [id, kind, text, ref ? "variable" : null, ref],
      );
    await seedEvent("e1", "settings", `A game rule changed: ${DIAL} is now ${ALCHEMY}`, DIAL);
    await seedEvent("e2", "settings", "A game rule changed: governance.sensing_days is now 10", "governance.sensing_days");
    await seedEvent("e3", "settings", `A game rule changed: sessions.place_line is now ${PLACE_WITH_TOKEN}`, "sessions.place_line");
    const read = async () => {
      const [rs] = await pool.query<any[]>("SELECT id, text FROM health_events WHERE kind = 'settings' ORDER BY id"); // module-review-ok: reading the scratch events is the evidence
      return Object.fromEntries(rs.map((r) => [r.id, String(r.text)]));
    };
    const first = await scrubCredentialCopies(pool);
    const after = await read();
    expect(after.e1).toBe(`A game rule changed: ${DIAL}`);
    expect(after.e3).toBe("A game rule changed: sessions.place_line");
    expect(after.e2).toBe("A game rule changed: governance.sensing_days is now 10");
    expect(first.narrations).toBe(2);
    expect((await scrubCredentialCopies(pool)).narrations).toBe(0);
  });
});
