/**
 * ERASURE AND THE ALIGNMENT STORE: THE FIXTURE (seat settings PR5, spec section 5).
 *
 * Decision 2 (2026-10-09): after a party erases their account, the words stay
 * with the person de-attributed. So a departed member's name and handle must
 * appear nowhere in the five tables (the four alignment tables and
 * seat_applications), the seats' terms on offer, or the village presets
 * document, and the seal must still verify.
 *
 * CONTROL FIRST: every place is shown to hold the name before the erasure
 * runs, so an absence afterwards is about the erasure and not about a fixture
 * that never wrote the name.
 *
 * Every name is fake, and every figure is in XTS.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { SEAT_PRESETS_DOC } from "../../shared/seatTermsOffer";
import { userParty, VILLAGE_PARTY } from "../../shared/alignments";
import { createOrgRole } from "./orgChart";
import { contentHashOf, prepareSeatTermsText, recordAlignment, sealIfReady, viewText, writePreparedText } from "./alignmentSubjects";
import { eraseFromAlignments, FORMER_MEMBER, scrubText } from "./alignmentErasure";
import { ensureSigningKey, resetSigningKeyForTests, signingKey, verifyDocument } from "./villageExport";
import { eraseApplicationWords, insertApplication, rewriteTermsOffer } from "../repos/seatApplications";
import { readText, sealsOf } from "../repos/alignments";
import { dbDocument } from "../repos/store-db";

const NAME = "Ana Quillfeather";
const HANDLE = "anaq";
const configured = testDbConfigured();
if (!configured) console.warn("[alignmentErasure] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

describe("scrubbing a name out of words", () => {
  it("replaces whole words, any case, and leaves look-alikes alone", () => {
    const names = [NAME, `@${HANDLE}`, HANDLE];
    expect(scrubText("Agreed with Ana Quillfeather and @anaq.", names)).toBe(`Agreed with ${FORMER_MEMBER} and ${FORMER_MEMBER}.`);
    expect(scrubText("ANA QUILLFEATHER keeps it", names)).toBe(`${FORMER_MEMBER} keeps it`);
    // "anaqua" is not the handle.
    expect(scrubText("the anaqua spring", names)).toBe("the anaqua spring");
  });
});

describe.skipIf(!configured)("erasure keeps the words, takes the name, and the seal still verifies", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    resetSigningKeyForTests();
    await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: "b".repeat(64) });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /** Everything the five tables hold, plus the offer column and the presets document, as one string. */
  const everything = async () => {
    const parts: string[] = [];
    for (const t of ["alignment_texts", "alignment_parties", "alignments", "alignment_seals", "seat_applications"]) {
      const [rows] = await pool.query<any[]>(`SELECT * FROM ${t}`); // module-review-ok: fixture read of the S5 scratch schema, the whole point of an erasure assertion
      parts.push(JSON.stringify(rows));
    }
    const [offers] = await pool.query<any[]>("SELECT terms_offer FROM org_roles WHERE terms_offer IS NOT NULL"); // module-review-ok: fixture read of the S5 scratch schema
    parts.push(JSON.stringify(offers));
    const doc = dbDocument<Record<string, any>>(pool, SEAT_PRESETS_DOC, { presets: [] });
    await doc.load();
    parts.push(JSON.stringify(doc.get()));
    return parts.join("\n");
  };

  it("the fixture: name and handle in the words, the settings, the note, the offer and the presets; then erased", async () => {
    const seatId = await createOrgRole(pool, { id: "seat-erasure-orchard", name: "Orchard steward", seats: 1 });
    await rewriteTermsOffer(pool, seatId, { v: 1, pay: { kind: "honorary", note: `Offered after talking with ${NAME}.` } });
    const presets = dbDocument<Record<string, any>>(pool, SEAT_PRESETS_DOC, { presets: [] });
    await presets.put({
      presets: [{ id: "custom:orchard", group: "pay", label: `Stipend as agreed with @${HANDLE}`, values: { kind: "honorary" }, version: 1, retiredAt: null }],
    });

    const settings = {
      v: 1 as const,
      pay: { kind: "fixed" as const, currency: "XTS", amountMinor: 4321000, per: "month" as const, note: `Reviewed by ${NAME} each moon.` },
      scoreboard: { measures: [{ measure: `Ledgers ${HANDLE} hands on`, target: "two people" }] },
    };
    const app = {
      id: "sa-00000000000000e1",
      candidateUserId: "u-ana",
      proposedBy: "u-ana",
      seatIds: [seatId],
      note: `I am ${NAME}, and I kept the ledger.`,
      deliverables: "Two more people run the orchard ledger.",
      settings,
      settingsHash: "a".repeat(64),
      termEndsAt: new Date("2029-06-30T00:00:00Z"),
      termSeasonId: null,
      termFollowsSeason: false,
      startsAt: null,
    };
    const prepared = prepareSeatTermsText(app, ["Orchard steward"], "u-ana", "UTC");
    await insertApplication(pool, { ...app, textId: prepared.text.id, textHash: prepared.text.contentHash, status: "adopted" });
    await writePreparedText(pool, prepared);
    for (const [partyKey, userId] of [
      [userParty("u-ana"), "u-ana"],
      [VILLAGE_PARTY, null],
    ] as const) {
      await recordAlignment(pool, { textId: prepared.text.id, partyKey, userId, contentHash: prepared.text.contentHash, intent: "I align.", method: "click", authorityRef: null });
    }
    const v = (await viewText(pool, prepared.text.id, "2027-01-01"))!;
    expect(await sealIfReady(pool, v)).toBe(true);
    // The other party's own copy of the words, as they downloaded it before the erasure.
    const theirCopy = { ...prepared.text, parties: prepared.parties };

    // CONTROL: every place holds the name or the handle before the erasure.
    const before = await everything();
    expect(before).toContain(NAME);
    expect(before).toContain(HANDLE);
    expect(prepared.text.body).toContain(NAME);

    await eraseApplicationWords(pool, "u-ana");
    const report = await eraseFromAlignments(pool, { id: "u-ana", name: NAME, handle: HANDLE });
    expect(report).toEqual({ textsRedacted: 1, applicationsScrubbed: 1, offersScrubbed: 1, presetsScrubbed: true });

    const after = await everything();
    expect(after).not.toContain("Quillfeather");
    expect(after.toLowerCase()).not.toMatch(/\banaq\b/);
    // The words stay, de-attributed (decision 2): the terms are still there to read.
    const text = (await readText(pool, prepared.text.id))!;
    expect(text.body).toContain(FORMER_MEMBER);
    expect(text.body).toContain("Orchard steward");
    expect(text.redactedAt).not.toBeNull();
    // The hash and the seal are untouched, and the seal verifies.
    expect(text.contentHash).toBe(prepared.text.contentHash);
    const [seal] = await sealsOf(pool, [text.id]);
    expect(verifyDocument(seal.receipt, signingKey().publicKeyPem)).toBe(true);
    expect(seal.receipt.contentHash).toBe(text.contentHash);
    // And the other party's own copy still hashes to the hash they aligned with.
    expect(contentHashOf(theirCopy)).toBe(seal.receipt.contentHash);
    // The rows keep their user id: the tombstone de-attributes, nothing is remapped.
    const [rows] = await pool.query<any[]>("SELECT user_id FROM alignments WHERE text_id = ? AND party_key = ?", [text.id, userParty("u-ana")]); // module-review-ok: fixture read of the S5 scratch schema
    expect(rows[0].user_id).toBe("u-ana");
  });
});
