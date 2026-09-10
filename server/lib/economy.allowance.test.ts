/**
 * The allowance's refund term, driven against a real database.
 *
 * `allowanceFor` computes a member's spend as `given - back`. `given` was
 * always that member's own gifts in the open cycle. `back` was not: it summed
 * `token_ledger` rows with `source = 'reversal'` whose `source_ref` began
 * `gratitude.given:<village>:`, filtered by NEITHER the giver nor the gift,
 * and windowed on the MIRROR POSTING'S timestamp. Three separate defects sat
 * in one query a few lines under the one it was subtracted from:
 *
 *   1. VILLAGE-WIDE. Any member's reversal reduced the computed spend of
 *      EVERY member for that window, so one correction quietly topped up
 *      everybody's budget. A test that drives one member cannot see this —
 *      for the member who was actually reversed the answer is right — so the
 *      first test here drives TWO and asserts the second one's allowance did
 *      not move.
 *
 *   2. THE WRONG TIMESTAMP. Reversing a gift from three moons ago handed back
 *      allowance in the present moon; reversing this moon's gift a day after
 *      the boundary handed back nothing. The second test drives a reversal
 *      across a boundary and asserts both halves.
 *
 *   3. ONE DOOR ONLY. `gratitude.given:` is the key `give()` writes. The
 *      acknowledgement door writes `gratitude_received:<noteId>`, so its
 *      reversals matched nothing while its gifts were counted in `given` all
 *      along. The third test sends through that door and reverses it.
 *
 * And the settlement, which had no reversal term at all: the last test walks
 * a real gift, a real reversal, `reversedIds()` and `settleCycle` together,
 * because an allowance that refunds and a settlement that still pays out are
 * two readings of one moon.
 *
 * Written against the engine rather than over HTTP, for the reason
 * server/cycleId.test.ts gives: a route can refuse for its own reasons and
 * prove nothing about the arithmetic underneath it.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  allowanceFor,
  cycleWindow,
  ensureVoiceToken,
  give,
  keys,
  MAX_SOURCE_REF,
  reverse,
  villageId,
} from "./economy";
import { sendGratitude, type GratitudeDeps } from "./gratitude";
import { parseCycleId, settleCycle } from "./gratitude-cycles";
import { loadTokenRegistry, memberAccount } from "./ledger";
import { loadVariables } from "./variables";
import { seedEconomy } from "./economySeed";
import { gratitudeLogRepo } from "../repos/gratitude";
import type { UsersRepo } from "../repos/users";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

async function makeMember(id: string): Promise<string> {
  await pool.query(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@village.test`],
  );
  await pool.query(
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  return id;
}

/** The users repo the acknowledgement door needs, over the scratch pool. */
function depsOver(p: mysql.Pool): GratitudeDeps {
  const load = async (where: string, v: string) => {
    const [rows] = await p.query<any[]>(`SELECT * FROM \`users\` WHERE ${where} = ? LIMIT 1`, [v]);
    return rows[0] ?? null;
  };
  return {
    pool: p,
    log: gratitudeLogRepo(p),
    members: {
      async all() {
        const [rows] = await p.query<any[]>("SELECT * FROM `users`");
        return rows as any;
      },
      byId: (id: string) => load("`id`", id),
      byEmail: (email: string) => load("`email`", email),
      async update() {
        /* the recipient's cached balance is not what these tests measure */
      },
    } as unknown as UsersRepo,
    stageMultiplierFor: async () => 1,
  };
}

const hearts = (from: string, to: string, amount: number, nonce: string) =>
  give(pool, { fromUserId: from, toUserId: to, amount, clientNonce: nonce }, async () => 1);

/**
 * Move a note into another lunation, which is the only way a test can reach
 * across a boundary: `writeGratitudeRow` stamps `at` from the database clock.
 * The cycle id moves with it so the row stays internally consistent with what
 * a real gift in that moon would have looked like.
 */
async function backdate(noteId: string, at: Date, cycleId: string): Promise<void> {
  await pool.query(
    "UPDATE `gratitude_log` SET `at` = ?, `cycle_id` = ?, `cycle_number` = ? WHERE `id` = ?",
    [at, cycleId, parseCycleId(cycleId), noteId],
  );
}

/** The idempotency key of the ledger posting a note delivered — whichever door wrote it. */
async function deliveryKeyOf(noteId: string): Promise<string> {
  const [rows] = await pool.query<any[]>(
    "SELECT `idempotency_key` AS k FROM `token_ledger` WHERE `source_ref` = ? " +
      "AND `source` IN ('gratitude_received', 'heart_received') LIMIT 1",
    [noteId],
  );
  return String(rows[0]?.k ?? "");
}

describe.skipIf(!configured)("the allowance's refund term", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 });
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await loadTokenRegistry(pool);
    // `give` is inert until the village's rules are seeded.
    await seedEconomy(pool, villageId());
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /**
   * DEFECT 1, AND THE REASON IT NEEDS TWO MEMBERS.
   *
   * The reversal sum joined to nothing that identified the giver, so it was a
   * village-wide number subtracted from every member's own spending. The
   * member who WAS reversed saw the right answer, which is why this survived:
   * every test of it drove one member.
   */
  it("one member's reversal leaves every other member's allowance alone", async () => {
    const reversedGiver = await makeMember("alw-a-giver");
    const bystander = await makeMember("alw-a-bystander");
    const friend = await makeMember("alw-a-friend");

    const gift = await hearts(reversedGiver, friend, 15, "alw-a-1");
    expect(gift.ok).toBe(true);
    const noteId = gift.ok ? String(gift.noteId ?? "") : "";

    expect((await hearts(bystander, friend, 10, "alw-a-2")).ok).toBe(true);

    const beforeBystander = await allowanceFor(pool, bystander, 1);
    expect(beforeBystander.spent).toBe(10);

    const back = await reverse(pool, keys.gratitudeGiven(villageId(), noteId));
    expect(back.ok).toBe(true);

    // The member who was actually reversed gets their allowance back. This
    // half was always right, and it is the half every earlier test asserted.
    const afterGiver = await allowanceFor(pool, reversedGiver, 1);
    expect(afterGiver.spent).toBe(0);
    expect(afterGiver.remaining).toBe(afterGiver.total);

    // THE ASSERTION THIS TEST EXISTS FOR. Before the fix the bystander's
    // spend read `max(0, 10 - 15)` — zero — and their whole allowance came
    // back on the strength of somebody else's correction.
    const afterBystander = await allowanceFor(pool, bystander, 1);
    expect(afterBystander.spent).toBe(10);
    expect(afterBystander.remaining).toBe(beforeBystander.remaining);
  });

  /**
   * DEFECT 2, DRIVEN ACROSS A BOUNDARY IN BOTH DIRECTIONS.
   *
   * The rule this asserts, and the reason it is the defensible one: an
   * allowance is spent in the cycle the GIFT was made, so a refund belongs to
   * that cycle too. The window is therefore the gift's timestamp and the
   * mirror's timestamp is never read — see the block in `allowanceFor`.
   */
  it("refunds the cycle the gift was made in, not the cycle the correction lands in", async () => {
    const giver = await makeMember("alw-b-giver");
    const lastMoon = await makeMember("alw-b-last-moon");
    const thisMoon = await makeMember("alw-b-this-moon");

    const open = cycleWindow();
    const previous = cycleWindow(new Date(open.startsAt.getTime() - 1));
    const midPrevious = new Date((previous.startsAt.getTime() + previous.endsAt.getTime()) / 2);

    // A gift in the previous moon, moved there before anything else is given
    // so it cannot crowd the open cycle's share ceiling.
    const old = await hearts(giver, lastMoon, 15, "alw-b-old");
    expect(old.ok).toBe(true);
    const oldNoteId = old.ok ? String(old.noteId ?? "") : "";
    await backdate(oldNoteId, midPrevious, previous.key);

    // And a gift in the open one.
    expect((await hearts(giver, thisMoon, 12, "alw-b-new")).ok).toBe(true);

    expect((await allowanceFor(pool, giver, 1)).spent).toBe(12);
    expect((await allowanceFor(pool, giver, 1, midPrevious)).spent).toBe(15);

    // The correction arrives NOW, in the open cycle, undoing last moon's gift.
    expect((await reverse(pool, keys.gratitudeGiven(villageId(), oldNoteId))).ok).toBe(true);

    // It must not touch the open cycle. Before the fix `back` was 15 here —
    // the mirror's own timestamp is in this window — so the open allowance
    // read `max(0, 12 - 15)` and handed this member 105 to spend after they
    // had already spent 12 of it.
    const open2 = await allowanceFor(pool, giver, 1);
    expect(open2.spent).toBe(12);
    expect(open2.remaining).toBe(open2.total - 12);

    // And it must land where the charge did. Before the fix the previous
    // cycle's spend stayed at 15 forever, because the mirror's timestamp was
    // never inside that window.
    expect((await allowanceFor(pool, giver, 1, midPrevious)).spent).toBe(0);
  });

  /**
   * DEFECT 3, THE DOOR THE REFUND COULD NOT SEE.
   *
   * `sendGratitude` charges the same allowance out of the same table and
   * keys its ledger posting `gratitude_received:<noteId>`, which the old
   * prefix match never matched. So this whole channel could be reversed and
   * the giver never got their allowance back.
   */
  it("refunds a reversal that came through the acknowledgement door", async () => {
    const giver = await makeMember("alw-c-giver");
    const friend = await makeMember("alw-c-friend");

    const sent = await sendGratitude(depsOver(pool), {
      fromUser: { id: giver, name: giver },
      toId: friend,
      amount: 15,
      message: "thank you",
    });
    expect(sent.ok).toBe(true);
    const noteId = sent.ok ? String(sent.entry.id) : "";

    expect((await allowanceFor(pool, giver, 1)).spent).toBe(15);

    const key = await deliveryKeyOf(noteId);
    // This door's key is NOT `gratitude.given:...`, which is the whole defect,
    // and it is short enough for the mirror's clipped `source_ref` to still
    // carry it whole — which is what lets the refund walk back to the note.
    // Asserted rather than described: `reverse()` clips at MAX_SOURCE_REF.
    expect(key.startsWith("gratitude.given:")).toBe(false);
    expect(key.length).toBeLessThanOrEqual(MAX_SOURCE_REF);
    expect(keys.gratitudeGiven(villageId(), noteId).length).toBeLessThanOrEqual(MAX_SOURCE_REF);

    expect((await reverse(pool, key)).ok).toBe(true);

    const after = await allowanceFor(pool, giver, 1);
    expect(after.spent).toBe(0);
    expect(after.remaining).toBe(after.total);
  });

  /**
   * THE SETTLEMENT AND THE ALLOWANCE, ASKED ABOUT ONE REVERSAL.
   *
   * `settleCycle` summed `gratitude_log` with no reversal term, so a gift the
   * ledger had already clawed back still counted toward the recipient's
   * `received`, still counted toward `receivedEligible` — the figure a share
   * of the cycle's value pool is computed from — and still counted its sender
   * toward breadth.
   */
  it("keeps the settlement and the allowance agreeing about a reversal", async () => {
    const undone = await makeMember("alw-d-undone");
    const kept = await makeMember("alw-d-kept");
    const recipient = await makeMember("alw-d-recipient");

    const gift = await hearts(undone, recipient, 15, "alw-d-1");
    expect(gift.ok).toBe(true);
    const noteId = gift.ok ? String(gift.noteId ?? "") : "";
    expect((await hearts(kept, recipient, 5, "alw-d-2")).ok).toBe(true);

    expect((await reverse(pool, keys.gratitudeGiven(villageId(), noteId))).ok).toBe(true);

    const repo = gratitudeLogRepo(pool);
    const reversed = await repo.reversedIds();
    expect(reversed.has(noteId)).toBe(true);

    const entries = await repo.all();
    const cycleId = cycleWindow().key;
    const row = settleCycle(entries, cycleId, undefined, reversed).find((t) => t.userId === recipient);
    expect(row).toBeDefined();
    expect(row!.received).toBe(5);
    expect(row!.receivedEligible).toBe(5);
    expect(row!.distinctSenders).toBe(1);

    // What the close used to release value on: 20 received from two people,
    // 15 of which the recipient no longer holds.
    const believed = settleCycle(entries, cycleId).find((t) => t.userId === recipient);
    expect(believed!.received).toBe(20);
    expect(believed!.distinctSenders).toBe(2);

    // And the giver of the undone gift has their allowance back, which is the
    // reading the settlement now shares.
    expect((await allowanceFor(pool, undone, 1)).spent).toBe(0);
  });

  /**
   * A reversal that is nothing to do with gratitude must not enter either
   * number. The old prefix match had this property and the walk has to keep
   * it, because `reverse()` is the platform's one correction path and voice
   * claims use it too.
   */
  it("ignores a reversal of a posting that never delivered a gratitude note", async () => {
    const giver = await makeMember("alw-e-giver");
    const friend = await makeMember("alw-e-friend");
    expect((await hearts(giver, friend, 9, "alw-e-1")).ok).toBe(true);

    // The recipient's OWN credit, reversed by key: a gratitude posting, so it
    // is the closest thing to a false positive the walk could produce — and it
    // is a different member's row, which is what the giver's filter is for.
    const other = await makeMember("alw-e-other");
    const theirs = await hearts(other, friend, 4, "alw-e-2");
    expect(theirs.ok).toBe(true);
    expect(
      (await reverse(pool, keys.gratitudeGiven(villageId(), theirs.ok ? String(theirs.noteId) : ""))).ok,
    ).toBe(true);

    expect((await allowanceFor(pool, giver, 1)).spent).toBe(9);
    expect((await allowanceFor(pool, other, 1)).spent).toBe(0);
  });
});
