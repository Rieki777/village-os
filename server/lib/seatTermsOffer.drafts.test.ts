/**
 * Terms on offer are written by a published org draft a MEMBER wrote, and by
 * nothing else (seat settings PR3, migration 0247).
 *
 * THE RULE THIS HOLDS. Terms never cross the bridge: a draft a vendor or
 * Saberra wrote (`source_kind` other than `human`) carrying `termsOffer`, or
 * the column's own spelling `terms_offer`, is blocked at preview, so it cannot
 * publish, and the column stays empty. The control is the same payload on a
 * draft a person wrote, which previews clean and publishes. Revert puts the
 * offer back as it was.
 *
 * Every figure is fake: XTS is the ISO 4217 code reserved for testing.
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { OFFER_WORDS } from "../../shared/seatTermsOffer";
import { createOrgRole, listOrgRoles } from "./orgChart";
import { addChange, createDraft, offerColumns, previewDraft, publishDraft, revertDraft } from "./orgDrafts";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const FAKE_OFFER = { v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 50000, per: "month" } };
const OTHER_OFFER = { v: 1, pay: { kind: "honorary" } };

async function draftWith(sourceKind: string, op: "update_seat" | "create_seat", orgRoleId: string, payload: Record<string, unknown>) {
  const made = await createDraft(pool, {
    title: "Terms on offer, in a test",
    createdBy: "u-author",
    sourceKind,
    sourceModuleId: sourceKind === "human" ? null : "vendor",
    openCap: sourceKind === "human" ? null : 99,
  });
  if (!made.ok) throw new Error(made.error);
  const added = await addChange(pool, made.id, { op, orgRoleId, payload });
  if (!added.ok) throw new Error(added.error);
  return made.id;
}

/*
 * THE SECOND LOCK, held on its own. The preview blocks a machine's terms
 * first, so the database cases below never reach apply; this is the
 * apply-time refusal that stands if a preview ever lets one through.
 */
describe("the apply-time lock on a machine's terms", () => {
  it("refuses a machine's offer under either spelling, and writes a person's", () => {
    expect(() => offerColumns({ termsOffer: FAKE_OFFER }, { machine: true, by: null })).toThrow(OFFER_WORDS.machineRefused);
    expect(() => offerColumns({ terms_offer: FAKE_OFFER }, { machine: true, by: null })).toThrow(OFFER_WORDS.machineRefused);
    const cols = offerColumns({ termsOffer: FAKE_OFFER }, { machine: false, by: "u-publisher" });
    expect(cols?.[0]).toContain("50000");
    expect(cols?.[2]).toBe("u-publisher");
    expect(offerColumns({ aim: "No terms here" }, { machine: true, by: null })).toBeUndefined();
  });
});

const offerOf = async (id: string) => (await listOrgRoles(pool)).find((r) => r.id === id) ?? null;

describe.skipIf(!configured)("terms on offer ride a draft a member wrote, and only that", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    for (const name of ["Terms Vendor Seat", "Terms Human Seat", "Terms Revert Seat", "Terms Bad Seat"]) {
      await createOrgRole(pool, { name });
    }
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("a vendor's draft carrying termsOffer is blocked, cannot publish, and writes nothing", async () => {
    const id = await draftWith("agent", "update_seat", "terms-vendor-seat", { termsOffer: FAKE_OFFER });
    const preview = await previewDraft(pool, id, 99);
    expect(preview.blocked).toBe(1);
    expect(preview.lines[0].blocked).toBe(OFFER_WORDS.machineRefused);
    const r = await publishDraft(pool, id, "u-steward", 99);
    expect(r.ok).toBe(false);
    expect((await offerOf("terms-vendor-seat"))?.termsOffer).toBeNull();
  });

  it("the column's own spelling, terms_offer, is blocked on a vendor's draft too", async () => {
    const id = await draftWith("agent", "update_seat", "terms-vendor-seat", { aim: "Proposed aim", terms_offer: FAKE_OFFER });
    const preview = await previewDraft(pool, id, 99);
    expect(preview.lines[0].blocked).toBe(OFFER_WORDS.machineRefused);
  });

  it("a vendor's proposed NEW seat carrying terms is blocked the same way", async () => {
    const id = await draftWith("agent", "create_seat", "terms-vendor-new", { name: "Terms Vendor New", termsOffer: FAKE_OFFER });
    const preview = await previewDraft(pool, id, 99);
    expect(preview.lines[0].blocked).toBe(OFFER_WORDS.machineRefused);
    expect(await offerOf("terms-vendor-new")).toBeNull();
  });

  it("control: the same offer on a draft a person wrote previews clean and publishes, stamped", async () => {
    const id = await draftWith("human", "update_seat", "terms-human-seat", { termsOffer: FAKE_OFFER });
    const preview = await previewDraft(pool, id);
    expect(preview.blocked, JSON.stringify(preview.lines)).toBe(0);
    const r = await publishDraft(pool, id, "u-publisher");
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    const seat = await offerOf("terms-human-seat");
    expect(seat?.termsOffer).toMatchObject(FAKE_OFFER);
    expect(seat?.termsOfferBy).toBe("u-publisher");
    expect(seat?.termsOfferAt).toBeInstanceOf(Date);
  });

  it("a person's new seat may carry terms from the start", async () => {
    const id = await draftWith("human", "create_seat", "terms-human-new", { name: "Terms Human New", termsOffer: OTHER_OFFER });
    const r = await publishDraft(pool, id, "u-publisher");
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    expect((await offerOf("terms-human-new"))?.termsOffer).toMatchObject(OTHER_OFFER);
  });

  it("an offer carrying payment details is blocked with the parser's sentence", async () => {
    const id = await draftWith("human", "update_seat", "terms-bad-seat", {
      termsOffer: { v: 1, pay: { kind: "fixed", note: "IBAN GB29NWBK60161331926819" } },
    });
    const preview = await previewDraft(pool, id);
    expect(preview.lines[0].blocked).toMatch(/These terms cannot be offered\. .*bank or card number/);
    expect((await offerOf("terms-bad-seat"))?.termsOffer).toBeNull();
  });

  it("revert puts the offer back as it stood, and null takes terms off offer", async () => {
    const first = await draftWith("human", "update_seat", "terms-revert-seat", { termsOffer: FAKE_OFFER });
    expect((await publishDraft(pool, first, "u-publisher")).ok).toBe(true);
    const second = await draftWith("human", "update_seat", "terms-revert-seat", { termsOffer: null });
    expect((await publishDraft(pool, second, "u-other")).ok).toBe(true);
    expect((await offerOf("terms-revert-seat"))?.termsOffer).toBeNull();

    const back = await revertDraft(pool, second);
    expect(back.ok, !back.ok ? back.error : "").toBe(true);
    const seat = await offerOf("terms-revert-seat");
    expect(seat?.termsOffer).toMatchObject(FAKE_OFFER);
    expect(seat?.termsOfferBy).toBe("u-publisher");
  });
});
