/**
 * WHAT A DEPARTURE DOES TO WHAT A LEAVER WAS PART OF, AND WHAT KEEPS THEIR
 * ACCOUNT (Rye, 2026-10-30: "yes build all the exit suggestions!").
 *
 * `resolveExit` is driven directly here, against a scratch schema with every
 * real migration applied, with the erasure's dependencies standing in for the
 * server's singletons and the notice spine recorded. The route-level half,
 * through the built server, is in server/exitLevers.routes.e2e.test.ts.
 *
 *   3. DELEGATIONS end when a member leaves, the same as erasure ends them:
 *      each member who handed them a voice is told and gets it back, and a
 *      vote copied from them is no longer cast. Their OWN vote on a ballot
 *      still open stands (suggestion 1), and the roll it froze is untouched.
 *   3. VOUCHES: a vouch that admitted somebody stands; one given to somebody
 *      still waiting stops counting while they are away, and is never deleted.
 *   6. CASH STILL OWED keeps the account: somebody holding no tokens and owed
 *      cash is kept as a former member, and somebody whose cash is all paid is
 *      erased as before.
 *
 * No TEST_DATABASE_URL: skips loudly, never passes hollowly (harness rule).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import type { ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { livingVouchesFor, recordVouch, vouchesFor } from "../repos/vouches";
import { acceptDelegations, DELEGATE_LEFT_NOTICE, setDelegation } from "./delegation";
import { castVote, openBallot } from "./ballots";
import { createExit, exitById } from "./exit";
import { FORMER_MEMBER_MARK, resolveExit } from "./exitResolve";
import { CYCLE_POOL_FAUCET, loadTokenRegistry, memberAccount, postTransfer } from "./ledger";
import { toLedgerUnits } from "./economy";

const configured = testDbConfigured();
const TOKEN = "credits";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";
let notices: any[] = [];
let ballots = 0;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

/** The erasure's singletons with the real users repository, and the spine as a recorder. */
function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: (u: any) => void) => real.update(id, fn) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn: () => Promise<any>) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
    notify: async (input: any) => {
      notices.push(input);
      return { fresh: true };
    },
  } as ErasureDeps;
}

/** A member, admitted unless told otherwise, holding `credits` whole credits. */
async function member(id: string, opts: { credits?: number; admitted?: boolean } = {}): Promise<any> {
  await usersRepo(pool).add({ id, name: `Name ${id}`, email: `${id}@example.test`, passwordHash: "x", paths: [] });
  if (opts.admitted !== false) await usersRepo(pool).update(id, (u: any) => { u.membershipGranted = true; });
  if ((opts.credits ?? 0) > 0) {
    const r = await postTransfer(pool, {
      from: CYCLE_POOL_FAUCET, to: memberAccount(id), tokenType: TOKEN, amount: toLedgerUnits(TOKEN, opts.credits!),
      source: "gratitude_pool", idempotencyKey: `exit-resolve-test:seed:${id}`,
    });
    expect(r.ok, `seed ${id}: ${r.error}`).toBe(true);
  }
  return usersRepo(pool).byId(id);
}

async function ballotFor(electorate: string[]): Promise<string> {
  const opened = await openBallot(pool, {
    subjectType: "mechanics",
    subjectRef: `exit-resolve-ballot-${++ballots}`,
    title: `Ballot ${ballots}`,
    docMarkdown: "# The document as checked",
    method: "custom",
    weightMode: "equal",
    unityPct: 80,
    quorumPct: 20,
    durationDays: 7,
    openedBy: electorate[0],
    electorate: electorate.map((userId) => ({ userId, weight: 1 })),
  });
  if (!opened.ok) throw new Error(`ballot refused to open: ${opened.error}`);
  return opened.ballot.id;
}

const votesOn = (ballotId: string) =>
  q("SELECT user_id, choice, followed_user_id FROM ballot_votes WHERE ballot_id = ? ORDER BY user_id", [ballotId]);
const rollOf = async (ballotId: string) =>
  (await q("SELECT user_id FROM ballot_electorate WHERE ballot_id = ? ORDER BY user_id", [ballotId])).map((r) => String(r.user_id));

/** Open a departure through the real door and resolve it. */
async function leave(target: any) {
  const made = await createExit(pool, { userId: target.id, kind: "voluntary", openedBy: target.id, noticeDays: 0 });
  if (!made.ok) throw new Error(made.error);
  const out = await resolveExit(pool, { exitId: made.exit.id, target, actorId: "admin-1", deps: deps(), now: new Date("2026-10-30T12:00:00Z") });
  return { out, exitId: made.exit.id };
}

const owe = (id: string, userId: string, amountMinor: number, state: "owed" | "claimed" | "paid") =>
  q(
    "INSERT INTO cash_owed (id, occurrence_key, user_id, work_kind, work_ref, work_title, amount_minor, currency, state) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, `exit-resolve-test:${id}`, userId, "quest", `q-${id}`, `Work ${id}`, amountMinor, "USD", state],
  );

describe.skipIf(!configured)("resolving a departure: what the leaver was part of, and what keeps the account", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-exit-resolve-"));
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  beforeEach(() => {
    clearMemberDrivers();
    notices = [];
  });

  it("ends every delegation a former member carried, tells each member who handed them a voice, and keeps their own vote", async () => {
    const leaver = await member("xr-dl-leaver", { credits: 50 });
    await member("xr-dl-ash");
    await member("xr-dl-bo");
    await member("xr-dl-cy");
    const ballot = await ballotFor([leaver.id, "xr-dl-ash", "xr-dl-cy"]);
    // Ash hands their voice to the leaver, accepted; Bo offers theirs, not yet taken up.
    expect((await setDelegation(pool, "xr-dl-ash", leaver.id)).ok).toBe(true);
    await acceptDelegations(pool, leaver.id, "xr-dl-ash");
    expect((await setDelegation(pool, "xr-dl-bo", leaver.id)).ok).toBe(true);
    // The leaver votes for themselves before leaving, which Ash's seat copies.
    expect((await castVote(pool, ballot, leaver.id, "yes")).ok).toBe(true);
    // The control: before the resolve, Ash's seat carries the leaver's yes.
    expect(await votesOn(ballot)).toEqual([
      { user_id: "xr-dl-ash", choice: "yes", followed_user_id: leaver.id },
      { user_id: leaver.id, choice: "yes", followed_user_id: null },
    ]);
    const rollBefore = await rollOf(ballot);

    const { out } = await leave(leaver);
    expect(out.outcome).toBe("former");

    expect(
      await q("SELECT delegator_id FROM delegations WHERE (delegator_id = ? OR delegate_id = ?) AND revoked_at IS NULL", [leaver.id, leaver.id]),
      "no delegation they are half of is still live",
    ).toEqual([]);
    expect(notices.map((n) => [n.userId, n.type, n.title, n.dedupeKey]).sort()).toEqual([
      ["xr-dl-ash", "governance", DELEGATE_LEFT_NOTICE.title, `delegation-ended:${leaver.id}:xr-dl-ash`],
      ["xr-dl-bo", "governance", DELEGATE_LEFT_NOTICE.title, `delegation-ended:${leaver.id}:xr-dl-bo`],
    ]);
    for (const n of notices) expect(n.actorUserId ?? null, "from the village, never from the person who left").toBeNull();

    // Ash's seat is Ash's again, uncast; the leaver's own yes stands; the roll did not move.
    expect(await votesOn(ballot)).toEqual([{ user_id: leaver.id, choice: "yes", followed_user_id: null }]);
    expect(await rollOf(ballot)).toEqual(rollBefore);
    // The account stays: they are a former member, not a tombstone.
    const after = (await usersRepo(pool).byId(leaver.id))!;
    expect(after.email).toBe(`${leaver.id}@example.test`);
    expect(after.membershipGranted).toBe(false);
  });

  it("ends the delegation a former member gave, so their seat carries nobody's vote afterwards", async () => {
    const leaver = await member("xr-dg-leaver", { credits: 50 });
    await member("xr-dg-cy");
    const ballot = await ballotFor([leaver.id, "xr-dg-cy"]);
    expect((await setDelegation(pool, leaver.id, "xr-dg-cy")).ok).toBe(true);
    await acceptDelegations(pool, "xr-dg-cy", leaver.id);
    expect((await castVote(pool, ballot, "xr-dg-cy", "no")).ok).toBe(true);
    // The control: the leaver's seat carries Cy's no.
    expect(await votesOn(ballot)).toContainEqual({ user_id: leaver.id, choice: "no", followed_user_id: "xr-dg-cy" });

    expect((await leave(leaver)).out.outcome).toBe("former");

    expect(await votesOn(ballot), "a vote they never cast themselves does not stand for them").toEqual([
      { user_id: "xr-dg-cy", choice: "no", followed_user_id: null },
    ]);
    expect(notices, "nobody handed them a voice, so nobody is told").toEqual([]);
  });

  it("a former member's vouch for somebody still waiting stops counting, the row stays, and it counts again when they are admitted again", async () => {
    const leaver = await member("xr-vc-leaver", { credits: 10 });
    await member("xr-vc-other");
    // Mo was vouched in by the leaver before they left: that admission stands.
    const mo = await member("xr-vc-mo");
    await recordVouch(pool, { id: "xr-vc-1", voucherUserId: leaver.id, vouchedUserId: mo.id, kind: "member" });
    // Pip is still waiting, with a vouch from the leaver and one from somebody staying.
    const pip = await member("xr-vc-pip", { admitted: false });
    await recordVouch(pool, { id: "xr-vc-2", voucherUserId: leaver.id, vouchedUserId: pip.id, kind: "member" });
    await recordVouch(pool, { id: "xr-vc-3", voucherUserId: "xr-vc-other", vouchedUserId: pip.id, kind: "member" });
    // The control: before the departure both vouches count toward Pip.
    expect((await livingVouchesFor(pool, pip.id)).map((v) => v.voucherUserId)).toEqual([leaver.id, "xr-vc-other"]);

    expect((await leave(leaver)).out.outcome).toBe("former");

    expect((await livingVouchesFor(pool, pip.id)).map((v) => v.voucherUserId), "only the vouch of somebody still here counts").toEqual(["xr-vc-other"]);
    expect((await vouchesFor(pool, pip.id)).map((v) => v.voucherUserId), "the row is never deleted").toEqual([leaver.id, "xr-vc-other"]);
    expect((await usersRepo(pool).byId(mo.id))!.membershipGranted, "the admission their vouch made stands").toBe(true);
    expect((await vouchesFor(pool, mo.id)).map((v) => v.voucherUserId)).toEqual([leaver.id]);

    // Admitted again through a door that admits anybody: their word counts again.
    await usersRepo(pool).update(leaver.id, (u: any) => { u.stageGranted = "member"; });
    expect((await livingVouchesFor(pool, pip.id)).map((v) => v.voucherUserId)).toEqual([leaver.id, "xr-vc-other"]);
  });

  it("cash still owed keeps an account that holds no tokens, and the exit says how much", async () => {
    const owed = await member("xr-cash-owed");
    await owe("xr-co-1", owed.id, 2000, "owed");
    await owe("xr-co-2", owed.id, 500, "claimed");
    await owe("xr-co-3", owed.id, 9900, "paid");

    const { out, exitId } = await leave(owed);
    expect(out.outcome).toBe("former");
    expect(out.held).toEqual([]);
    expect(out.owed).toEqual([{ currency: "USD", amountMinor: 2500, rows: 2 }]);

    const exit = await exitById(pool, exitId);
    expect(exit?.status).toBe("resolved");
    expect(String(exit?.resolution ?? "")).toContain(`${FORMER_MEMBER_MARK}is owed $25.00 in cash`);
    const after = (await usersRepo(pool).byId(owed.id))!;
    expect(after.email, "not a tombstone: they can still sign in and see it marked paid").toBe(`${owed.id}@example.test`);
    expect(after.membershipGranted).toBe(false);
    // The cash rows are untouched by the departure.
    expect((await q("SELECT state FROM cash_owed WHERE user_id = ? ORDER BY id", [owed.id])).map((r) => r.state)).toEqual(["owed", "claimed", "paid"]);
  });

  it("tokens and cash both: the line names each", async () => {
    const both = await member("xr-cash-both", { credits: 30 });
    await owe("xr-cb-1", both.id, 1234, "owed");
    const { out, exitId } = await leave(both);
    expect(out.outcome).toBe("former");
    expect(String((await exitById(pool, exitId))?.resolution ?? "")).toContain(
      `${FORMER_MEMBER_MARK}still holds 30 ${TOKEN}; is owed $12.34 in cash`,
    );
  });

  it("cash that is all paid keeps nothing: the account is erased as before", async () => {
    const paid = await member("xr-cash-paid");
    await owe("xr-cp-1", paid.id, 4000, "paid");
    const { out } = await leave(paid);
    expect(out.outcome).toBe("erased");
    expect(out.owed).toEqual([]);
    expect((await usersRepo(pool).byId(paid.id))!.email).toBe(`deleted-${paid.id}@anonymized.invalid`);
  });
});
