/**
 * The vendor proposal inbox (0140), and the four behaviours the work order
 * names as its acceptance test.
 *
 * Post a payload twice: the second is a no-op on the dedupe key. Post it
 * mutated: a new row lands and the old one is superseded. Post one carrying an
 * email address in any body field: the whole record is dropped and counted.
 * Post one asserting a role id that does not exist: the row lands with that
 * reference nulled and the row survives.
 *
 * The fifth is here too, because it is the same write: an agent-originated
 * event is attributable to its module in the journal.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { recentEvents } from "./events";
import {
  containsEmail,
  dedupeKeyFor,
  evidenceLevel,
  identityKeyFor,
  landProposal,
  markProposalDecided,
  normalizeClaim,
  proposalQueue,
  recentDrops,
} from "./externalProposals";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

const base = {
  villageId: "v1",
  moduleId: "saberra",
  batchId: "b1",
  kind: "role.proposed",
  sourceRef: "meeting-2026-08-14#42",
  quote: "Ada said the well needs one person answerable for it.",
  trustTier: "extracted_unreviewed",
};

/**
 * `recordEvent` is fire and forget by contract: it swallows its own failures so
 * that a trace cannot fail the mutation it describes. So the row it writes is
 * not there the instant `landProposal` returns, and asserting on it once is a
 * flake waiting to happen. This waits for it instead of guessing at a sleep.
 */
async function waitForEvent(kind: string, tries = 40): Promise<any | null> {
  for (let i = 0; i < tries; i += 1) {
    const [[row]] = await pool.query<any[]>( // module-review-ok: reading the journal on the scratch schema this suite provisioned
      "SELECT id, kind, actor_kind, origin_module_id, entity_ref, text FROM health_events " +
        "WHERE kind = ? ORDER BY at DESC, id DESC LIMIT 1",
      [kind],
    );
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe.skipIf(!configured)("the vendor proposal inbox", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM external_proposals"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM external_proposal_drops"); // module-review-ok: same
    await pool.query("DELETE FROM health_events"); // module-review-ok: same
    await pool.query("DELETE FROM roles"); // module-review-ok: same
  });

  // ── 1. POSTED TWICE ──────────────────────────────────────────────────────

  it("is a no-op on the dedupe key when the same claim arrives twice", async () => {
    const payload = { name: "Water Steward", aim: "Keep the well" };
    const first = await landProposal(pool, { ...base, payload });
    const second = await landProposal(pool, { ...base, payload });

    expect(first.ok && first.outcome).toBe("stored");
    expect(second.ok && second.outcome).toBe("duplicate");
    expect(second.ok && second.id).toBe(first.ok ? first.id : "");
    expect(await proposalQueue(pool)).toHaveLength(1);
  });

  it("swallows a reordered payload as the same claim, and a changed one as a new one", async () => {
    // A vendor that serialises its JSON differently on a retry has not said
    // anything new. A vendor that changed a word has.
    expect(normalizeClaim({ a: 1, b: "  Two  Words " })).toBe(normalizeClaim({ b: "two words", a: 1 }));
    expect(normalizeClaim({ seats: 3 })).not.toBe(normalizeClaim({ seats: 4 }));
  });

  it("never derives either key from a timestamp, so a re-extraction is not a new row", async () => {
    // The whole reason the key is computed here and not taken from the wire.
    const payload = { name: "Water Steward" };
    const a = dedupeKeyFor({ moduleId: "saberra", kind: "role.proposed", sourceRef: "m#42", payload });
    const b = dedupeKeyFor({ moduleId: "saberra", kind: "role.proposed", sourceRef: "m#42", payload });
    expect(a).toBe(b);

    // And an absent source ref hashes to the sentinel, never to the empty
    // string, so a missing anchor and a blank one cannot land as two rows.
    expect(identityKeyFor({ moduleId: "m", kind: "k", sourceRef: null })).toBe(
      identityKeyFor({ moduleId: "m", kind: "k", sourceRef: "   " }),
    );
  });

  // ── 2. POSTED MUTATED ────────────────────────────────────────────────────

  it("supersedes the open row when the same source says something different", async () => {
    const first = await landProposal(pool, { ...base, payload: { name: "Water Steward" } });
    const second = await landProposal(pool, { ...base, payload: { name: "Well Keeper" } });

    expect(second.ok && second.outcome).toBe("stored");
    expect(second.ok && second.superseded).toBe(1);

    const [rows] = await pool.query<any[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT id, status FROM external_proposals ORDER BY received_at",
    );
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    expect(byId.get(first.ok ? first.id : "")).toBe("superseded");
    expect(byId.get(second.ok ? second.id : "")).toBe("proposed");
    // The superseded row SURVIVES. A steward can still read what was proposed
    // before, which is the whole reason nothing here is a DELETE.
    expect(rows).toHaveLength(2);
  });

  it("supersedes nothing on a redelivery, which is what makes a vendor safe to retry", async () => {
    // The ordering argument in landProposal: if superseding ran before the
    // insert, a retry would retire the row it then failed to replace and a
    // steward's queue would empty itself.
    const payload = { name: "Water Steward" };
    await landProposal(pool, { ...base, payload });
    const again = await landProposal(pool, { ...base, payload });
    expect(again.ok && again.superseded).toBe(0);
    const [[open]] = await pool.query<any[]>( // module-review-ok: same
      "SELECT COUNT(*) AS n FROM external_proposals WHERE status = 'proposed'",
    );
    expect(Number(open.n)).toBe(1);
  });

  // ── 3. CARRYING AN EMAIL ADDRESS ─────────────────────────────────────────

  it("drops the whole record when any field carries an email address, and counts it", async () => {
    const r = await landProposal(pool, {
      ...base,
      payload: { name: "Water Steward", note: "ask ada@example.org about the well" },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("contained_an_email");

    // Nothing stored. Storing it in order to report it would be the leak.
    expect(await proposalQueue(pool)).toHaveLength(0);

    const drops = await recentDrops(pool);
    expect(drops).toEqual([
      expect.objectContaining({ moduleId: "saberra", reason: "contained_an_email", dropped: 1 }),
    ]);
  });

  it("finds an address nested, in an array, and used as a key", async () => {
    expect(containsEmail({ a: { b: [{ c: "x ada@example.org y" }] } })).toBe(true);
    expect(containsEmail({ "ada@example.org": "land steward" })).toBe(true);
    expect(containsEmail({ name: "Water Steward", note: "no addresses here" })).toBe(false);
    // A cycle must not hang the scanner. A vendor payload arrives as parsed
    // JSON and cannot hold one, and this is a scanner that runs before a write.
    const cyclic: Record<string, unknown> = { name: "Water Steward" };
    cyclic.self = cyclic;
    expect(containsEmail(cyclic)).toBe(false);
  });

  it("reads a long string in time that grows with its length, so a public form cannot stall it", () => {
    // The unbounded pattern was quadratic: 40,000 letters took 820 ms and each doubling
    // took four times as long. The bounded one reads a megabyte in about a fifth of a
    // second on a developer machine, and these two strings in a few milliseconds.
    const started = Date.now();
    expect(containsEmail("a".repeat(100_000))).toBe(false);
    expect(containsEmail("a".repeat(50_000) + "@" + "b".repeat(50_000))).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
    // And the bounds miss no address a person could have.
    expect(containsEmail("x".repeat(100) + "@example.org")).toBe(true);
    expect(containsEmail("write to ada.wren+quests@mail.example.co.uk today")).toBe(true);
  });

  it("counts drops per reason, so an empty queue can be read honestly", async () => {
    await landProposal(pool, { ...base, payload: { note: "ada@example.org" } });
    await landProposal(pool, { ...base, payload: { note: "bea@example.org" } });
    await landProposal(pool, { ...base, kind: "nothing.wecanread", payload: { name: "x" } });

    const drops = await recentDrops(pool);
    const byReason = new Map(drops.map((d) => [d.reason, d.dropped]));
    expect(byReason.get("contained_an_email")).toBe(2);
    expect(byReason.get("unknown_kind")).toBe(1);
    expect(await proposalQueue(pool)).toHaveLength(0);
  });

  // ── 4. AN UNRESOLVABLE REFERENCE ─────────────────────────────────────────

  it("lands with an unresolvable reference nulled, and the row survives", async () => {
    const r = await landProposal(pool, {
      ...base,
      payload: { name: "Water Steward", requiresRole: "role-that-never-existed" },
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.nulled).toEqual(["requiresRole"]);

    const [row] = await proposalQueue(pool);
    expect(row.payload.name).toBe("Water Steward");
    expect(row.payload.requiresRole).toBeNull();
  });

  it("keeps a reference this village CAN resolve", async () => {
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO roles (id, name, capabilities) VALUES ('keepers','The Keepers',?)",
      [JSON.stringify([])],
    );
    const r = await landProposal(pool, { ...base, payload: { name: "Water Steward", requiresRole: "keepers" } });
    expect(r.ok && r.nulled).toEqual([]);
    expect((await proposalQueue(pool))[0].payload.requiresRole).toBe("keepers");
  });

  // ── 5. ATTRIBUTABLE TO ITS MODULE ────────────────────────────────────────

  it("writes a journal line naming the integration, and that line can be read back", async () => {
    const r = await landProposal(pool, { ...base, payload: { name: "Water Steward" } });
    expect(r.ok).toBe(true);

    const row = await waitForEvent("external_proposal");
    expect(row).not.toBeNull();
    expect(row.actor_kind).toBe("agent");
    expect(row.origin_module_id).toBe("saberra");

    // THE READ-BACK IS THE HALF THAT WAS MISSING. `actor_kind` has been
    // written since 0052 and read by nothing, because EventRow omitted it and
    // both readers named their columns. Revocation by integration is not real
    // until the value can reach a screen, so this asserts the reader and not
    // just the row.
    const [event] = await recentEvents(pool, "admin", 10);
    expect(event.actorKind).toBe("agent");
    expect(event.originModuleId).toBe("saberra");
  });

  it("defaults a human write to no module, so nothing is attributed to an integration by accident", async () => {
    await markProposalDecided(pool, { id: "nope", status: "rejected", decidedBy: "u1" });
    const [{ recordEvent }] = [await import("./events")];
    await recordEvent(pool, { kind: "audit", text: "a person did a thing", actorUserId: "u1" });
    const [event] = await recentEvents(pool, "public", 10);
    expect(event.actorKind).toBe("human");
    expect(event.originModuleId).toBeNull();
  });

  // ── THE EVIDENCE RULE, APPLIED AT THE DOOR ───────────────────────────────

  it("holds a record with no verbatim quote to stewards, whatever audience was asked for", async () => {
    expect(evidenceLevel("a quote", "a ref")).toBe("quoted");
    expect(evidenceLevel(null, "a ref")).toBe("anchored");
    expect(evidenceLevel(null, null)).toBe("absent");

    const r = await landProposal(pool, {
      ...base,
      quote: null,
      sourceRef: null,
      audience: "member",
      payload: { name: "Water Steward" },
    });
    expect(r.ok).toBe(true);
    const [row] = await proposalQueue(pool);
    expect(row.evidence).toBe("absent");
    // Asked for member, held to steward. Applied once at the door instead of
    // at every renderer that might forget it.
    expect(row.audience).toBe("steward");
  });

  it("takes the ISO timestamp the envelope specifies, which MySQL refuses raw", async () => {
    // MEASURED, not reasoned about. A DATETIME column handed
    // "2026-08-14T09:00:00.000Z" raises ER_TRUNCATED_WRONG_VALUE, so passing
    // the vendor's own field straight through would throw inside the INSERT,
    // lose the whole proposal, and answer 500 to a vendor that sent exactly
    // what the work order asked for. The first version of this file did that,
    // and every other test in it passed, because none of them set the field.
    const r = await landProposal(pool, {
      ...base,
      sourceOccurredAt: "2026-08-14T09:00:00.000Z",
      payload: { name: "Water Steward" },
    });
    expect(r.ok, !r.ok ? r.message : "").toBe(true);
    expect((await proposalQueue(pool))[0].sourceOccurredAt).toBe("2026-08-14T09:00:00.000Z");
  });

  it("keeps a proposal whose source timestamp is nonsense, with the date nulled", async () => {
    // A malformed date is one bad field on an otherwise real record. Losing
    // the record over it would be the wrong trade every time, and it is the
    // same rule as an unresolvable reference one test up.
    const r = await landProposal(pool, {
      ...base,
      sourceOccurredAt: "last Thursday-ish",
      payload: { name: "Water Steward" },
    });
    expect(r.ok).toBe(true);
    expect((await proposalQueue(pool))[0].sourceOccurredAt).toBeNull();
  });

  // ── OVER-LONG FIELDS. THE CLASS THE DATE BUG BELONGED TO ────────────────
  //
  // MySQL is strict by default, so an over-long string is ER_DATA_TOO_LONG and
  // the INSERT throws: not a truncated field, a lost proposal and a 500 to a
  // vendor that did nothing wrong. Every sized column in this schema had that
  // shape, and every other test in this file passed the whole time, because
  // none of them set a long value. Coverage of the guards is not coverage of
  // the writes.

  it("clips over-long CONTENT to its column instead of losing the record", async () => {
    const r = await landProposal(pool, {
      ...base,
      quote: "q".repeat(20_000),
      sourceRef: "s".repeat(900),
      subjectRef: "subject".repeat(80),
      payload: { name: "Water Steward" },
    });
    expect(r.ok, !r.ok ? r.message : "").toBe(true);
    const [row] = await proposalQueue(pool);
    expect(row.sourceRef!.length).toBe(400);
    expect(row.subjectRef!.length).toBe(200);
    expect(row.quote!.length).toBe(8000);
  });

  it("REFUSES an over-long identifier, because clipping one corrupts it", async () => {
    // A shortened batch id merges two reviews into one. A shortened module id
    // attributes one integration's work to another, which is exactly the
    // attribution this table exists to make possible.
    const r = await landProposal(pool, {
      ...base,
      batchId: "b".repeat(70),
      payload: { name: "Water Steward" },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("identifier_too_long");
    expect(await proposalQueue(pool)).toHaveLength(0);
    expect((await recentDrops(pool)).map((d) => d.reason)).toEqual(["identifier_too_long"]);
  });

  it("separates hashed parts with something that cannot appear inside one", async () => {
    // A space would let ("a b", "c") and ("a", "b c") hash to the same row.
    expect(identityKeyFor({ moduleId: "a b", kind: "c" })).not.toBe(
      identityKeyFor({ moduleId: "a", kind: "b c" }),
    );
  });

  it("keeps an unstated confidence as null, because zero is a different claim", async () => {
    await landProposal(pool, { ...base, payload: { name: "Water Steward" } });
    expect((await proposalQueue(pool))[0].confidence).toBeNull();
  });

  it("refuses a trust tier outside the three, without a migration to do it", async () => {
    const r = await landProposal(pool, { ...base, trustTier: "very_sure", payload: { name: "x" } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("unknown_trust_tier");
  });
});
