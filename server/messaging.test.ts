/**
 * The messaging substrate's repo layer, against a real MySQL scratch schema.
 *
 * What is pinned here is the set of properties that a later refactor could
 * quietly break without any type error:
 *
 *   - a non-member cannot read a thread OR learn that it exists;
 *   - opening a direct thread twice reuses the first one, from either side;
 *   - unread counts are per member and ignore your own words and tombstones;
 *   - the read mark only ever moves forward;
 *   - a deleted message stays as a tombstone and moves nobody's count;
 *   - a busy thread produces ONE notification per unread run per recipient,
 *     and reading it re-arms the next one;
 *   - last_message_at is a cache that the audit re-derives rather than trusts.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL → the suite skips loudly.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { splitStatements } from "./db/migrate";
import type { NotifyDeps } from "./lib/notify";
import { presenceTest } from "./lib/memberPresence";
import {
  addMembers,
  advanceRead,
  auditLastMessageAt,
  cleanText,
  conversationFor,
  createGroup,
  directKeyFor,
  editMessage,
  inboxFor,
  latestSeq,
  leaveConversation,
  membersOf,
  membershipOf,
  messageDedupeKey,
  messagesFor,
  onMessageSent,
  openDirect,
  previewOf,
  recomputeLastMessageAt,
  removeMember,
  reportMessage,
  sendMessage,
  setMuted,
  softDeleteMessage,
  totalUnreadFor,
  transferOwnership,
} from "./lib/messaging";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

const ANA = "usr-ana";
const BEN = "usr-ben";
const CARA = "usr-cara";
const NOSY = "usr-nosy";

async function addUser(id: string, name: string) {
  await pool.query(
    "INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name = VALUES(name)",
    [id, name, `${id}@example.test`, "hash"],
  );
}

/**
 * A notify spine wired to the real pool with email switched off at the
 * preference layer, so insertNotification does its real dedupe work against
 * the real unique index and never reaches a mailer.
 */
const notifyDeps = (): NotifyDeps => ({
  pool,
  memberById: async (id: string) => ({ id, email: `${id}@example.test`, passwordHash: "hash", prefs: { notify: { emailsOff: true } } }),
  sendEmail: async () => {
    throw new Error("no email should be attempted with emailsOff");
  },
  origin: () => "https://example.test",
  projectName: () => "Test village",
  isPresent: presenceTest("messaging-test-secret"),
});

async function notificationsFor(userId: string) {
  const [rows] = await pool.query<any[]>(
    "SELECT id, type, title, dedupe_key FROM notifications WHERE user_id = ? ORDER BY created_at, id",
    [userId],
  );
  return rows;
}

describe("messaging pure helpers", () => {
  it("keys a direct thread the same whichever side opens it", () => {
    expect(directKeyFor("b", "a")).toBe(directKeyFor("a", "b"));
    expect(directKeyFor("a", "b")).toBe("d:a|b");
  });

  it("keys one notification per unread run", () => {
    expect(messageDedupeKey("cnv-1", "usr-1", 0)).toBe("msg:cnv-1:usr-1:0");
    // The key changes only when the reader moves, which is what makes a busy
    // thread collapse to one row.
    expect(messageDedupeKey("cnv-1", "usr-1", 4)).not.toBe(messageDedupeKey("cnv-1", "usr-1", 0));
  });

  it("strips control and bidi characters that render as nothing", () => {
    // A zero-width space between two words: invisible, and it defeats any
    // naive match on the stored text.
    expect(cleanText("hi\u200Bthere")).toBe("hithere");
    // A right-to-left override makes stored text display reversed, which is
    // a spoofing surface on a screen two people are trusting.
    expect(cleanText("safe\u202Egnirts")).toBe("safegnirts");
    expect(cleanText("bell\u0007ring")).toBe("bellring");
    expect(cleanText("  padded  ")).toBe("padded");
    expect(cleanText("a\r\nb")).toBe("a\nb");
    expect(cleanText(null)).toBe("");
  });

  it("keeps newlines and tabs, which are real formatting", () => {
    expect(cleanText("one\ntwo\tthree")).toBe("one\ntwo\tthree");
    expect(cleanText("a\n\n\n\n\n\nb")).toBe("a\n\n\nb");
  });

  it("previews a tombstone as a tombstone, never as an empty line", () => {
    expect(previewOf("hello there", null)).toBe("hello there");
    expect(previewOf("hello there", "2026-08-10T00:00:00Z")).toBe("Message deleted");
    expect(previewOf("x".repeat(300), null)).toHaveLength(140);
  });
});

describe.skipIf(!configured)("messaging repo (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
    for (const [id, name] of [
      [ANA, "Ana Ruiz"],
      [BEN, "Ben Cole"],
      [CARA, "Cara Diaz"],
      [NOSY, "Nosy Parker"],
    ]) {
      await addUser(id, name);
    }
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM notifications");
    await pool.query("DELETE FROM message_reports");
    await pool.query("DELETE FROM messages");
    await pool.query("DELETE FROM conversation_members");
    await pool.query("DELETE FROM conversations");
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  it("refuses a non-member without confirming the conversation exists", async () => {
    const c = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "just between us" });

    // The real thread, to somebody not in it.
    expect(await membershipOf(pool, c.id, NOSY)).toBeNull();
    expect(await conversationFor(pool, c.id, NOSY)).toBeNull();

    // A conversation id that does not exist at all. Identical answer, which
    // is the whole point: the miss is indistinguishable from the refusal, so
    // a guessed id never confirms that a thread is there.
    expect(await conversationFor(pool, "cnv-does-not-exist", NOSY)).toBeNull();
    expect(await conversationFor(pool, "cnv-does-not-exist", ANA)).toBeNull();
  });

  it("stops treating someone as a member the moment they leave", async () => {
    const c = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN, CARA] });
    expect(await membershipOf(pool, c.id, CARA)).not.toBeNull();
    await leaveConversation(pool, c.id, CARA);
    expect(await membershipOf(pool, c.id, CARA)).toBeNull();
    expect(await conversationFor(pool, c.id, CARA)).toBeNull();
  });

  it("keeps a member who left in the roster so old lines keep a name", async () => {
    const c = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN] });
    await leaveConversation(pool, c.id, BEN);
    const roster = await membersOf(pool, c.id);
    expect(roster.map((m) => m.userId)).toContain(BEN);
    expect(roster.find((m) => m.userId === BEN)?.left).toBe(true);
  });

  // ── Direct-thread dedupe ───────────────────────────────────────────────────

  it("reuses the direct thread whichever side opens it, and however often", async () => {
    const first = await openDirect(pool, ANA, BEN);
    const again = await openDirect(pool, ANA, BEN);
    const fromTheOtherSide = await openDirect(pool, BEN, ANA);
    expect(again.id).toBe(first.id);
    expect(fromTheOtherSide.id).toBe(first.id);

    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM conversations WHERE kind = 'direct'");
    expect(Number(rows[0].n)).toBe(1);
  });

  it("puts someone back in the direct thread they left rather than starting a second", async () => {
    const first = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: first.id, authorId: ANA, body: "hello" });
    await leaveConversation(pool, first.id, BEN);
    expect(await membershipOf(pool, first.id, BEN)).toBeNull();

    const reopened = await openDirect(pool, BEN, ANA);
    expect(reopened.id).toBe(first.id);
    expect(await membershipOf(pool, first.id, BEN)).not.toBeNull();
    // The history came back with them.
    expect(await messagesFor(pool, first.id)).toHaveLength(1);
  });

  it("gives every group its own unique dedupe key without colliding", async () => {
    const one = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN] });
    const two = await createGroup(pool, { createdBy: ANA, name: "Compost crew", memberIds: [BEN] });
    expect(one.id).not.toBe(two.id);
    const [rows] = await pool.query<any[]>("SELECT COUNT(DISTINCT direct_key) AS n FROM conversations");
    expect(Number(rows[0].n)).toBe(2);
  });

  // ── Unread counts and read state ───────────────────────────────────────────

  it("counts unread per member, ignoring your own words", async () => {
    const c = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "one" });
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "two" });

    expect(await totalUnreadFor(pool, BEN)).toBe(2);
    // Writing is reading: the author's own mark advanced with the send.
    expect(await totalUnreadFor(pool, ANA)).toBe(0);
  });

  it("clears the count when the reader catches up", async () => {
    const c = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "one" });
    const seq = await latestSeq(pool, c.id);
    await advanceRead(pool, c.id, BEN, seq);
    expect(await totalUnreadFor(pool, BEN)).toBe(0);
  });

  it("only ever moves the read mark forward", async () => {
    const c = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "one" });
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "two" });
    const seq = await latestSeq(pool, c.id);

    expect(await advanceRead(pool, c.id, BEN, seq)).toBe(seq);
    // A slow request from a second tab, carrying a stale position.
    expect(await advanceRead(pool, c.id, BEN, 1)).toBe(seq);
    expect(await advanceRead(pool, c.id, BEN, -50)).toBe(seq);
    expect(await totalUnreadFor(pool, BEN)).toBe(0);
  });

  it("will not let the read mark run past what the conversation holds", async () => {
    // seq is global across the table, so an unclamped mark would let a member
    // park their read position in the future and stop hearing about the
    // thread for good. That reads as a broken inbox, not as a mute.
    const c = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "one" });
    const seq = await latestSeq(pool, c.id);

    expect(await advanceRead(pool, c.id, BEN, 9_000_000)).toBe(seq);
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "two" });
    expect(await totalUnreadFor(pool, BEN)).toBe(1);
  });

  it("keeps a muted thread out of the badge total", async () => {
    const c = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "one" });
    expect(await totalUnreadFor(pool, BEN)).toBe(1);
    await setMuted(pool, c.id, BEN, true);
    expect(await totalUnreadFor(pool, BEN)).toBe(0);
  });

  it("counts each member of a group separately", async () => {
    const c = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN, CARA] });
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "one" });
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "two" });
    await advanceRead(pool, c.id, BEN, await latestSeq(pool, c.id));

    expect(await totalUnreadFor(pool, BEN)).toBe(0);
    expect(await totalUnreadFor(pool, CARA)).toBe(2);
  });

  // ── Tombstones ─────────────────────────────────────────────────────────────

  it("leaves a tombstone rather than a hole, and moves nobody's count", async () => {
    const c = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "one" });
    const two = await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "two" });
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "three" });
    expect(await totalUnreadFor(pool, BEN)).toBe(3);

    expect(await softDeleteMessage(pool, c.id, two.id, ANA)).toBe(true);

    const page = await messagesFor(pool, c.id);
    // Three rows still, in the same order, with the middle one hollowed out.
    expect(page).toHaveLength(3);
    expect(page[1].id).toBe(two.id);
    expect(page[1].seq).toBe(two.seq);
    expect(page[1].deletedAt).not.toBeNull();
    expect(page[1].body).toBe("");
    // The count drops by exactly the deleted line, and the seqs either side
    // are untouched, so nothing else shifted.
    expect(await totalUnreadFor(pool, BEN)).toBe(2);
    expect(page[0].seq).toBeLessThan(page[1].seq);
    expect(page[2].seq).toBeGreaterThan(page[1].seq);
  });

  it("lets only the author delete their own line", async () => {
    const c = await openDirect(pool, ANA, BEN);
    const m = await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "mine" });
    expect(await softDeleteMessage(pool, c.id, m.id, BEN)).toBe(false);
    expect(await softDeleteMessage(pool, c.id, m.id, ANA)).toBe(true);
    // And deleting twice is not a second event.
    expect(await softDeleteMessage(pool, c.id, m.id, ANA)).toBe(false);
  });

  it("lets only the author edit their own line, and marks it", async () => {
    const c = await openDirect(pool, ANA, BEN);
    const m = await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "teh meeting is at 4" });

    expect(await editMessage(pool, c.id, m.id, BEN, "hijacked"), "not your line").toBe(false);
    expect(await editMessage(pool, c.id, m.id, ANA, "the meeting is at 4")).toBe(true);

    const page = await messagesFor(pool, c.id);
    expect(page[0].body).toBe("the meeting is at 4");
    expect(page[0].editedAt, "an edit must leave its mark").not.toBeNull();
    expect(page[0].seq, "editing must not move the ordering key").toBe(m.seq);
  });

  it("will not edit a line in another conversation, or a tombstone", async () => {
    // Same scoping rule as deleting, and the same reason: proving membership
    // of one thread must not authorize a write in another.
    const theirs = await createGroup(pool, { createdBy: ANA, name: "Elsewhere", memberIds: [BEN, CARA] });
    const target = await sendMessage(pool, { conversationId: theirs.id, authorId: CARA, body: "on the record" });
    const mine = await openDirect(pool, CARA, BEN);
    expect(await editMessage(pool, mine.id, target.id, CARA, "rewritten")).toBe(false);
    expect((await messagesFor(pool, theirs.id))[0].body).toBe("on the record");

    // A tombstone stays a tombstone. Editing it would restore a body while
    // deleted_at stayed set, so it would read as deleted and render as text.
    const own = await sendMessage(pool, { conversationId: mine.id, authorId: CARA, body: "oops" });
    expect(await softDeleteMessage(pool, mine.id, own.id, CARA)).toBe(true);
    expect(await editMessage(pool, mine.id, own.id, CARA, "un-deleting myself")).toBe(false);
    const after = (await messagesFor(pool, mine.id)).find((x) => x.id === own.id);
    expect(after?.deletedAt).not.toBeNull();
    expect(after?.body).toBe("");
  });

  it("will not reach into another conversation to delete a line", async () => {
    // The security review's finding, pinned. Without conversation_id in the
    // WHERE clause, proving membership of ONE conversation authorizes a
    // destructive write against your messages in EVERY conversation,
    // including ones you were removed from, which erases the bodies attached
    // to any report about them.
    const evidence = await createGroup(pool, { createdBy: ANA, name: "The room", memberIds: [BEN, CARA] });
    const bad = await sendMessage(pool, { conversationId: evidence.id, authorId: CARA, body: "something reportable" });
    await removeMember(pool, evidence.id, CARA);

    // Cara still has a conversation of her own, and the message id from before.
    const hers = await openDirect(pool, CARA, BEN);
    expect(await softDeleteMessage(pool, hers.id, bad.id, CARA)).toBe(false);

    const [rows] = await pool.query<any[]>("SELECT body, deleted_at FROM messages WHERE id = ?", [bad.id]);
    expect(rows[0].deleted_at).toBeNull();
    expect(rows[0].body).toBe("something reportable");
  });

  // ── Notifications ──────────────────────────────────────────────────────────

  it("sends ONE notification per unread run, however busy the thread", async () => {
    const c = await openDirect(pool, ANA, BEN);
    const deps = notifyDeps();

    for (let i = 0; i < 12; i++) {
      const message = await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: `line ${i}` });
      await onMessageSent(deps, {
        conversation: c,
        message,
        author: { id: ANA, name: "Ana Ruiz" },
        titleFor: () => "Ana sent you a message",
      });
    }

    // Twelve messages, one row: the dedupe key carried Ben's unchanged read
    // position every time.
    expect(await notificationsFor(BEN)).toHaveLength(1);
    expect(await notificationsFor(ANA)).toHaveLength(0);

    // Ben reads. The next message starts a NEW unread run and rings again.
    await advanceRead(pool, c.id, BEN, await latestSeq(pool, c.id));
    const next = await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "after reading" });
    await onMessageSent(deps, {
      conversation: c,
      message: next,
      author: { id: ANA, name: "Ana Ruiz" },
      titleFor: () => "Ana sent you a message",
    });
    expect(await notificationsFor(BEN)).toHaveLength(2);
  });

  it("notifies every other live member of a group, and never the author", async () => {
    const c = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN, CARA] });
    const deps = notifyDeps();
    const message = await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "meeting moved" });
    await onMessageSent(deps, {
      conversation: c,
      message,
      author: { id: ANA, name: "Ana Ruiz" },
      titleFor: () => "Ana wrote in Water crew",
    });

    expect(await notificationsFor(BEN)).toHaveLength(1);
    expect(await notificationsFor(CARA)).toHaveLength(1);
    expect(await notificationsFor(ANA)).toHaveLength(0);
  });

  it("says nothing to a member who muted the thread or left it", async () => {
    const c = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN, CARA] });
    await setMuted(pool, c.id, BEN, true);
    await leaveConversation(pool, c.id, CARA);

    const deps = notifyDeps();
    const message = await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "still here?" });
    await onMessageSent(deps, {
      conversation: c,
      message,
      author: { id: ANA, name: "Ana Ruiz" },
      titleFor: () => "Ana wrote in Water crew",
    });

    expect(await notificationsFor(BEN)).toHaveLength(0);
    expect(await notificationsFor(CARA)).toHaveLength(0);
  });

  // ── The last_message_at cache ──────────────────────────────────────────────

  it("recomputes last_message_at rather than trusting an increment", async () => {
    const c = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "one" });

    const [before] = await pool.query<any[]>("SELECT last_message_at FROM conversations WHERE id = ?", [c.id]);
    expect(before[0].last_message_at).not.toBeNull();

    // Corrupt the cache the way a hand-edit or a half-finished write would.
    await pool.query("UPDATE conversations SET last_message_at = '2001-01-01 00:00:00' WHERE id = ?", [c.id]);
    const audit = await auditLastMessageAt(pool);
    expect(audit.drifted).toContain(c.id);
    expect(audit.repaired).toBe(1);

    // And a clean pass reports nothing.
    expect((await auditLastMessageAt(pool)).drifted).toHaveLength(0);
  });

  it("orders the inbox by latest activity, with silent threads last", async () => {
    const quiet = await createGroup(pool, { createdBy: ANA, name: "Quiet crew", memberIds: [BEN] });
    const older = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: older.id, authorId: ANA, body: "older" });
    const newer = await createGroup(pool, { createdBy: ANA, name: "Busy crew", memberIds: [BEN] });
    await sendMessage(pool, { conversationId: newer.id, authorId: ANA, body: "newer" });

    const inbox = await inboxFor(pool, BEN);
    expect(inbox.map((e) => e.conversation.id).slice(0, 2)).toEqual([newer.id, older.id]);
    expect(inbox[inbox.length - 1].conversation.id).toBe(quiet.id);
  });

  it("orders two conversations active in the SAME instant deterministically", async () => {
    // The regression that redded main. 0066 declared every timestamp without
    // precision, so MySQL stored whole seconds: two conversations messaged in
    // the same second held equal last_message_at, fell through to a
    // created_at that was also equal, and then had no tiebreaker at all. The
    // inbox came back in whichever order the engine felt like, which failed
    // this suite roughly half the time and, worse, reordered a real member's
    // inbox between two loads for no reason they could see.
    //
    // 0073 gives the columns millisecond precision and the ORDER BY ends in
    // `c.id DESC`, so even a genuine same-millisecond tie has one answer.
    // Written by forcing an EXACT tie rather than by racing the clock: a test
    // that depends on two writes landing in different milliseconds is the
    // same coin-flip in a different costume.
    const a = await createGroup(pool, { createdBy: ANA, name: "Tie A", memberIds: [BEN] });
    const b = await createGroup(pool, { createdBy: ANA, name: "Tie B", memberIds: [BEN] });
    await sendMessage(pool, { conversationId: a.id, authorId: ANA, body: "a" });
    await sendMessage(pool, { conversationId: b.id, authorId: ANA, body: "b" });

    const stamp = "2026-08-11 12:00:00.000";
    await pool.query("UPDATE conversations SET last_message_at = ?, created_at = ? WHERE id IN (?, ?)", [
      stamp, stamp, a.id, b.id,
    ]);

    const expected = [a.id, b.id].sort().reverse(); // c.id DESC
    for (let i = 0; i < 5; i++) {
      const inbox = await inboxFor(pool, BEN);
      const tied = inbox.map((e) => e.conversation.id).filter((id) => id === a.id || id === b.id);
      expect(tied, `read ${i + 1} must return the same order as every other read`).toEqual(expected);
    }
  });

  it("repairs BOTH cached columns in one pass, never one without the other", async () => {
    // The worst bug this module could have, and the reason it is tested before
    // the happy path. Since 0074 the inbox ORDERS BY last_message_seq and
    // DISPLAYS last_message_at. If the audit re-derives one and leaves the
    // other, it does not merely miss a drift, it manufactures one on every
    // boot: the list sorts by a stale key while rendering a fresh time, with
    // no error anywhere. Both directions are checked because a repair that
    // only ever fixes the column you thought of passes a one-sided test.
    const c = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "one" });
    const truth = await pool.query<any[]>(
      "SELECT last_message_at AS at, last_message_seq AS seq FROM conversations WHERE id = ?",
      [c.id],
    ).then(([r]) => r[0]);
    expect(Number(truth.seq), "the send path must fill the seq, not only the timestamp").toBeGreaterThan(0);

    // Corrupt ONLY the seq. The timestamp is still correct, so an audit that
    // compares timestamps alone would call this row clean and walk past it.
    await pool.query("UPDATE conversations SET last_message_seq = 1 WHERE id = ?", [c.id]);
    expect((await auditLastMessageAt(pool)).drifted, "a stale seq alone is drift").toContain(c.id);
    let after = await pool.query<any[]>(
      "SELECT last_message_at AS at, last_message_seq AS seq FROM conversations WHERE id = ?",
      [c.id],
    ).then(([r]) => r[0]);
    expect(Number(after.seq)).toBe(Number(truth.seq));
    expect(new Date(after.at).getTime(), "repairing the seq must not disturb the timestamp").toBe(
      new Date(truth.at).getTime(),
    );

    // Corrupt ONLY the timestamp, the mirror case.
    await pool.query("UPDATE conversations SET last_message_at = '2001-01-01 00:00:00.000' WHERE id = ?", [c.id]);
    expect((await auditLastMessageAt(pool)).drifted, "a stale timestamp alone is drift").toContain(c.id);
    after = await pool.query<any[]>(
      "SELECT last_message_at AS at, last_message_seq AS seq FROM conversations WHERE id = ?",
      [c.id],
    ).then(([r]) => r[0]);
    expect(new Date(after.at).getTime()).toBe(new Date(truth.at).getTime());
    expect(Number(after.seq), "repairing the timestamp must not drop the seq").toBe(Number(truth.seq));

    // And the row is clean afterwards, so the audit is not reporting forever.
    expect((await auditLastMessageAt(pool)).drifted).not.toContain(c.id);
  });

  it("backfills last_message_seq for conversations that predate 0074", async () => {
    // The harness applies every migration to an EMPTY schema, so 0074's
    // backfill runs against no rows and is the one statement in it that the
    // suite would otherwise never execute. On a real database it is the whole
    // job: without it every existing conversation carries a NULL seq, sorts
    // into the silent-threads bucket, and the boot audit reports the entire
    // table as drifted, which makes a genuine drift impossible to spot.
    //
    // The statement is READ OUT OF THE SHIPPED FILE rather than copied here,
    // so this cannot pass against a version of the SQL that is no longer the
    // one that runs.
    const sql = fs.readFileSync(path.join(process.cwd(), "drizzle", "0074_messaging_last_message_seq.sql"), "utf8");
    const backfill = splitStatements(sql).find((s) => /^UPDATE\s+`?conversations`?/i.test(s));
    expect(backfill, "0074 must still contain its backfill UPDATE").toBeTruthy();

    const withMessages = await openDirect(pool, ANA, BEN);
    await sendMessage(pool, { conversationId: withMessages.id, authorId: ANA, body: "before the migration" });
    const silent = await createGroup(pool, { createdBy: ANA, name: "Never spoken", memberIds: [BEN] });
    const expected = await latestSeq(pool, withMessages.id);

    // Put both rows back into their pre-0074 state.
    await pool.query("UPDATE conversations SET last_message_seq = NULL WHERE id IN (?, ?)", [
      withMessages.id, silent.id,
    ]);

    await pool.query(backfill!);

    const [rows] = await pool.query<any[]>(
      "SELECT id, last_message_seq AS seq FROM conversations WHERE id IN (?, ?)",
      [withMessages.id, silent.id],
    );
    const byId = new Map(rows.map((r: any) => [String(r.id), r.seq]));
    expect(Number(byId.get(withMessages.id))).toBe(expected);
    // A conversation with no messages has no seq, and MAX() over nothing is
    // NULL rather than 0, which is what keeps it in the silent bucket.
    expect(byId.get(silent.id)).toBeNull();

    // And the audit agrees the backfill was right, which is the property that
    // actually matters: a first boot after this migration reports nothing.
    expect((await auditLastMessageAt(pool, false)).drifted).not.toContain(withMessages.id);
  });

  it("orders the inbox on a key that cannot tie at all", async () => {
    // 0073 made the sort total; 0074 makes it independent of the id format.
    // Two conversations can never share a newest message, so last_message_seq
    // is unique per row by construction. This forces the condition that broke
    // main, identical timestamps on both, and shows the order is still exact
    // rather than merely stable: `newer` holds the higher seq and must lead,
    // which the old `c.id DESC` fallback could only have got right by luck.
    const older = await createGroup(pool, { createdBy: ANA, name: "Older", memberIds: [BEN] });
    const newer = await createGroup(pool, { createdBy: ANA, name: "Newer", memberIds: [BEN] });
    await sendMessage(pool, { conversationId: older.id, authorId: ANA, body: "first" });
    await sendMessage(pool, { conversationId: newer.id, authorId: ANA, body: "second" });

    const stamp = "2026-08-11 12:00:00.000";
    await pool.query("UPDATE conversations SET last_message_at = ?, created_at = ? WHERE id IN (?, ?)", [
      stamp, stamp, older.id, newer.id,
    ]);

    for (let i = 0; i < 5; i++) {
      const seen = (await inboxFor(pool, BEN))
        .map((e) => e.conversation.id)
        .filter((id) => id === older.id || id === newer.id);
      expect(seen, `read ${i + 1}: the later message must lead, every time`).toEqual([newer.id, older.id]);
    }
  });

  it("keeps millisecond precision through the AUDIT's repair, not just the recompute", async () => {
    // The recompute stays inside SQL, so its precision never leaves the
    // engine. auditLastMessageAt() is the other path and it is the risky one:
    // it SELECTs the value into JavaScript, compares it as a Date, and writes
    // it back as a bound parameter. If that round trip drops thousandths, the
    // boot audit would "repair" a correct row into a truncated one, then keep
    // reporting the same row as drifted forever, and the ordering key would
    // silently lose the precision 0073 exists to give it.
    const c = await openDirect(pool, ANA, BEN);
    await pool.query("INSERT INTO messages (id, conversation_id, author_id, body, created_at) VALUES (?,?,?,?,?)", [
      "msg-audit-ms-probe", c.id, ANA, "precise", "2026-08-11 12:00:00.456",
    ]);
    // Force the audit down its repair branch by corrupting the cache first.
    await pool.query("UPDATE conversations SET last_message_at = '2001-01-01 00:00:00.000' WHERE id = ?", [c.id]);

    const first = await auditLastMessageAt(pool);
    expect(first.drifted).toContain(c.id);

    const [rows] = await pool.query<any[]>(
      "SELECT MICROSECOND(last_message_at) AS us FROM conversations WHERE id = ?",
      [c.id],
    );
    expect(Number(rows[0].us), "the repair must write thousandths, not whole seconds").toBe(456000);

    // And the row must now be CLEAN: an audit that repairs to a value it will
    // reject on the next pass is an infinite drift report.
    expect((await auditLastMessageAt(pool)).drifted).not.toContain(c.id);
  });

  it("keeps millisecond precision through the cache recompute", async () => {
    // last_message_at is derived from MAX(messages.created_at), so raising the
    // precision of the cache without raising it on the SOURCE would just
    // store whole seconds in a column that can hold thousandths. 0073 changes
    // both; this proves the sub-second part actually survives the round trip.
    const c = await openDirect(pool, ANA, BEN);
    await pool.query("INSERT INTO messages (id, conversation_id, author_id, body, created_at) VALUES (?,?,?,?,?)", [
      "msg-precision-probe", c.id, ANA, "precise", "2026-08-11 12:00:00.123",
    ]);
    await recomputeLastMessageAt(pool, c.id);
    const [rows] = await pool.query<any[]>(
      "SELECT MICROSECOND(last_message_at) AS us FROM conversations WHERE id = ?",
      [c.id],
    );
    expect(Number(rows[0].us)).toBe(123000);
  });

  it("carries a tombstone into the inbox preview instead of an empty line", async () => {
    const c = await openDirect(pool, ANA, BEN);
    const m = await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "oops" });
    await softDeleteMessage(pool, c.id, m.id, ANA);
    const inbox = await inboxFor(pool, BEN);
    expect(inbox[0].preview).toBe("Message deleted");
  });

  // ── Membership changes ─────────────────────────────────────────────────────

  it("hands ownership on when the owner walks out, so a group is never ownerless", async () => {
    const c = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN, CARA] });
    await leaveConversation(pool, c.id, ANA);
    const roster = await membersOf(pool, c.id);
    const owners = roster.filter((m) => !m.left && m.role === "owner");
    expect(owners).toHaveLength(1);
    expect(owners[0].userId).toBe(BEN);
  });

  it("moves ownership only to someone actually in the conversation", async () => {
    const c = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN] });
    expect(await transferOwnership(pool, c.id, ANA, NOSY)).toBe(false);
    expect(await transferOwnership(pool, c.id, ANA, BEN)).toBe(true);
    const roster = await membersOf(pool, c.id);
    expect(roster.find((m) => m.userId === BEN)?.role).toBe("owner");
    expect(roster.find((m) => m.userId === ANA)?.role).toBe("member");
  });

  it("does not let a former owner walk back in still holding the keys", async () => {
    // The security review's second finding, pinned. Owner is a property of
    // ACTIVE membership. A role left behind on a departed row comes back with
    // the person the moment anyone re-adds them, which hands the group to
    // whoever asked nicely to be let back in.
    const c = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN, CARA] });
    await leaveConversation(pool, c.id, ANA);
    // Ben inherited it.
    expect((await membershipOf(pool, c.id, BEN))?.role).toBe("owner");

    // Ben, the legitimate owner, lets Ana back in through the ordinary flow.
    await addMembers(pool, c.id, [ANA]);
    expect((await membershipOf(pool, c.id, ANA))?.role).toBe("member");
    expect((await membershipOf(pool, c.id, BEN))?.role).toBe("owner");

    // The same must hold for someone an owner removed rather than someone who left.
    await transferOwnership(pool, c.id, BEN, CARA);
    await removeMember(pool, c.id, CARA);
    await addMembers(pool, c.id, [CARA]);
    expect((await membershipOf(pool, c.id, CARA))?.role).toBe("member");
  });

  it("adds and removes people from a group", async () => {
    const c = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN] });
    expect(await addMembers(pool, c.id, [CARA])).toBe(1);
    expect(await membershipOf(pool, c.id, CARA)).not.toBeNull();
    expect(await removeMember(pool, c.id, CARA)).toBe(true);
    expect(await membershipOf(pool, c.id, CARA)).toBeNull();
    // Removing twice is not a second event.
    expect(await removeMember(pool, c.id, CARA)).toBe(false);
  });

  // ── Reports ────────────────────────────────────────────────────────────────

  it("takes one report per person per message", async () => {
    const c = await createGroup(pool, { createdBy: ANA, name: "Water crew", memberIds: [BEN, CARA] });
    const m = await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: "something unkind" });

    expect((await reportMessage(pool, { conversationId: c.id, messageId: m.id, reporterId: BEN, reason: "unkind" })).fresh).toBe(true);
    expect((await reportMessage(pool, { conversationId: c.id, messageId: m.id, reporterId: BEN, reason: "again" })).fresh).toBe(false);
    // A different person reporting the same message IS a new report.
    expect((await reportMessage(pool, { conversationId: c.id, messageId: m.id, reporterId: CARA })).fresh).toBe(true);

    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM message_reports WHERE message_id = ?", [m.id]);
    expect(Number(rows[0].n)).toBe(2);
  });

  // ── Paging ─────────────────────────────────────────────────────────────────

  it("pages backwards through a long thread without dropping or repeating", async () => {
    const c = await openDirect(pool, ANA, BEN);
    for (let i = 0; i < 12; i++) {
      await sendMessage(pool, { conversationId: c.id, authorId: ANA, body: `line ${i}` });
    }
    const newest = await messagesFor(pool, c.id, { limit: 5 });
    expect(newest).toHaveLength(5);
    expect(newest.map((m) => m.body)).toEqual(["line 7", "line 8", "line 9", "line 10", "line 11"]);

    const older = await messagesFor(pool, c.id, { limit: 5, before: newest[0].seq });
    expect(older.map((m) => m.body)).toEqual(["line 2", "line 3", "line 4", "line 5", "line 6"]);
    // No overlap between the pages.
    expect(older.some((m) => newest.some((n) => n.id === m.id))).toBe(false);
  });
});
