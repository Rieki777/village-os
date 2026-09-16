/**
 * The ballot engine driven over HTTP against the BUILT dist, one day after it
 * shipped (0089, round 5 lane G1; this file is lane GOV-FIX).
 *
 * WHY THIS FILE EXISTS. `server/lib/ballots.test.ts` proves the conduct rules
 * at the storage layer and is right about all of them. What it cannot see is
 * the ROUTE, and the route was where the two live defects were:
 *
 *   1. A ballot that missed quorum wrote `status='failed'` on its subject. So
 *      "not enough of us were here" was recorded as "the village rejected
 *      this", which is a different fact and a false one. A village of forty
 *      where six people voted killed a proposal it had never answered, and
 *      its author started again from a blank form because of a quiet week.
 *   2. `status='withdrawn'` was declared in 0089, rendered by the decision
 *      page, and written by nothing. A member who opened a vote in error had
 *      no way out while the interface implied there was one.
 *
 * And one feature the engine could already conduct and nobody had asked it
 * for: an ADVISORY vote, which freezes a real electorate, weighs real votes by
 * the village's real dials, and executes nothing when it closes. That last
 * clause is the one this file has to prove, because a member who thinks they
 * decided something and finds out later that they did not is worse off than a
 * member who never voted.
 *
 * The cases run IN ORDER: one proposal walks the whole path, from a quiet week
 * through a called-off vote. Run the whole file, never a `-t` slice.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, like
 * `loop.e2e.test.ts` and `tokenSinks.routes.e2e.test.ts`. Run `pnpm build`
 * first or you are testing stale code. Skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[governance.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window. It is checked, not asserted.
 *
 * A hand-written survey used to live here, ending with RE-GREP BEFORE
 * TRUSTING THIS. Nobody re-grepped, the tree moved, and the paragraph went on
 * claiming the window was clear when it had not been for over a week. Worse,
 * every one of those surveys grepped for `process.pid %` and so never saw the
 * stub ports (GOOGLE_PORT, BARE_PORT, STUB_PORT) or the fixed 8127 that
 * actually caused a failure.
 *
 * `scripts/check-e2e-ports.mjs` is that survey, executable, run in CI. It
 * refuses any two windows in different files that overlap at all, any fixed
 * port, and anything reaching into Linux's ephemeral range. Change the number
 * below and it will tell you.
 */
const PORT = 14200 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "governance-admin";
const PASSWORD = "Governance123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
const voters: Array<{ name: string; token: string; id: string }> = [];

interface Answer { status: number; json: any }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Push a ballot's window into the past: the clock, never a status change. */
const expire = async (ballotId: string) => {
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

/** The subject's own status, read from the table the route writes. */
const proposalStatus = async (id: string): Promise<string> => {
  const [rows] = await pool.query<any[]>("SELECT status FROM mechanics_proposals WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return String(rows[0]?.status ?? "gone");
};

/** How many rows the amendment ledger holds: where execution LANDS. */
const amendmentRows = async (): Promise<number> => {
  const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM mechanics_changes"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return Number(rows[0]?.n ?? 0);
};

const proposalCard = async (id: string): Promise<any> => {
  const r = await call("GET", "/api/game/mechanics/proposals");
  expect(r.status).toBe(200);
  return (r.json ?? []).find((p: any) => p.id === id) ?? null;
};

const titlesInBell = async (token: string): Promise<string[]> => {
  const r = await call("GET", "/api/notifications", { token });
  expect(r.status).toBe(200);
  const list = Array.isArray(r.json) ? r.json : (r.json?.items ?? r.json?.notifications ?? []);
  return list.map((n: any) => String(n?.title ?? ""));
};

async function register(name: string, email: string): Promise<{ name: string; token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    body: { name, email, password: PASSWORD, paths: ["resident"] },
    token: null,
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { name, token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the governance route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-gov-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "governance-secret",
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", {
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Gov Founder" },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", {
    body: { token: claim, password: PASSWORD },
    token: null,
  });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  for (const name of ["Anna Vale", "Ben Orr", "Cara Lin"]) {
    const slug = name.split(" ")[0].toLowerCase();
    const who = await register(name, `${slug}-${PORT}@example.test`);
    // ballot.vote unlocks at the member stage, so the electorate builder needs
    // these three to have joined. Nothing here reaches around the one gate.
    const staged = await call("PUT", `/api/admin/players/${who.id}/stage`, { body: { stageId: "member" } });
    expect(staged.status, `${name} reaches member stage`).toBe(200);
    voters.push(who);
  }
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the governance engine, driven", () => {
  let proposalId = "";
  let firstBallotId = "";
  let secondBallotId = "";
  let advisoryId = "";

  it("mounts behind the module switch: OFF is a 404, and that is the fork-safe default", async () => {
    // Every non-core module ships OFF (absent module_settings row = off), and
    // while governance is off the shipped Hypha loop is the behaviour.
    const closed = await call("GET", "/api/governance/ballots");
    expect(closed.status).toBe(404);

    const on = await call("PUT", "/api/admin/modules/governance/lifecycle", {
      body: { lifecycle: "members", examples: false },
    });
    expect(on.status).toBe(200);
    expect((await call("GET", "/api/governance/ballots")).status).toBe(200);
  });

  it("opens a real ballot: the snapshot freezes the roll, the weights and the dials", async () => {
    // A quorum the village will genuinely miss with one voter, set through the
    // admin door so the ballot snapshots it the way any village's would.
    const dial = await call("PUT", "/api/admin/variables/governance.quorum_pct", { body: { value: "60" } });
    expect(dial.status).toBe(200);

    const made = await call("POST", "/api/game/mechanics/proposals", {
      body: {
        title: "Raise the gratitude budget for the winter cycle",
        rationale: "The cold months are when people carry each other, and the budget runs out before the moon does.",
        changes: [{ key: "gratitude.base_budget", to: "120" }],
      },
    });
    expect(made.status).toBe(200);
    proposalId = String(made.json?.id ?? "");
    expect(made.json?.status).toBe("open");

    const opened = await call("POST", `/api/governance/mechanics/${proposalId}/open-ballot`);
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const ballot = opened.json?.ballot;
    firstBallotId = String(ballot?.id ?? "");
    expect(firstBallotId).toBeTruthy();

    // The founder plus three members who reached member stage.
    expect(ballot.electorateCount).toBeGreaterThanOrEqual(3);
    expect(ballot.quorumPct).toBe(60);
    expect(ballot.status).toBe("open");
    // A mechanics ballot BINDS: closing it changes the village's rules.
    expect(ballot.binding).toBe(true);
    expect(await proposalStatus(proposalId)).toBe("onsite_vote");
  });

  it("A QUIET WEEK DOES NOT KILL THE SUBJECT: no quorum sends the proposal back to open", async () => {
    // One member of four answers. Everyone who spoke was in FAVOUR, which is
    // exactly why calling this a rejection was false.
    const voted = await call("POST", `/api/governance/ballots/${firstBallotId}/vote`, {
      token: voters[0].token,
      body: { choice: "yes" },
    });
    expect(voted.status).toBe(200);

    await expire(firstBallotId);
    const closed = await call("POST", `/api/governance/ballots/${firstBallotId}/close`, {
      body: { outcomeNote: "One member voted in the whole window. The village asked for more than that before it counts." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("no_quorum");
    expect(closed.json?.unity).toBe(100);
    // Nothing was applied and nothing was held back: there was no answer to act on.
    expect(closed.json?.applied).toEqual([]);
    expect(closed.json?.held).toBeNull();

    // THE FIX. The subject is back where it stood, not dead.
    expect(await proposalStatus(proposalId)).toBe("open");

    // And it is READABLE as the thing that happened. A proposal sitting at
    // `open` while holding a ballot id is one that went to a vote and came
    // back, and the ballot's own status says which of the two ways back it is.
    const card = await proposalCard(proposalId);
    expect(card.status).toBe("open");
    expect(card.ballotId).toBe(firstBallotId);
    expect(card.lastBallotStatus).toBe("no_quorum");

    // The proposer is told the true thing, in words that are not "rejected".
    const bell = await titlesInBell(founderToken);
    expect(bell.some((t) => t.includes("Too few of the village voted"))).toBe(true);
    expect(bell.some((t) => t.includes("did not pass"))).toBe(false);

    // The ballot itself is immutable at its outcome. The snapshot law does not
    // bend for a second attempt.
    const b = await call("GET", `/api/governance/ballots/${firstBallotId}`);
    expect(b.json?.status).toBe("no_quorum");
  });

  it("and it goes again as a NEW ballot with a NEW freeze, with nothing re-authored", async () => {
    const again = await call("POST", `/api/governance/mechanics/${proposalId}/open-ballot`);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    secondBallotId = String(again.json?.ballot?.id ?? "");
    expect(secondBallotId).toBeTruthy();
    // A NEW ballot. Never the old one resumed with stale weights.
    expect(secondBallotId).not.toBe(firstBallotId);
    expect(again.json?.ballot?.status).toBe("open");
    // The document it carries is the proposal's own words, unchanged: the
    // author was not asked to write anything twice.
    expect(String(again.json?.ballot?.docMarkdown)).toContain("cold months");

    // Both ballots stand on the record, in order, under the same subject.
    const record = await call("GET", `/api/governance/ballots?subjectType=mechanics&subjectRef=${proposalId}`);
    expect(record.status).toBe(200);
    expect((record.json ?? []).map((x: any) => x.id).sort()).toEqual([firstBallotId, secondBallotId].sort());
  });

  it("A BALLOT CAN BE CALLED OFF: withdraw frees the subject and decides nothing", async () => {
    const gone = await call("POST", `/api/governance/ballots/${secondBallotId}/withdraw`, {
      body: { reason: "Opened before the numbers were checked. Reopening once they are." },
    });
    expect(gone.status, JSON.stringify(gone.json)).toBe(200);
    expect(gone.json?.votesDiscarded).toBe(0);
    expect(gone.json?.ballot?.status).toBe("withdrawn");
    // Withdrawn is its own fact and reads as neither passed nor failed.
    expect(["passed", "failed", "no_quorum"]).not.toContain(gone.json?.ballot?.status);
    expect(gone.json?.ballot?.outcomeNote).toContain("numbers were checked");

    // The subject is free again, immediately, with no re-authoring.
    expect(await proposalStatus(proposalId)).toBe("open");
    const card = await proposalCard(proposalId);
    expect(card.lastBallotStatus).toBe("withdrawn");

    // A withdrawn ballot is closed for good: no vote, no second withdrawal.
    const late = await call("POST", `/api/governance/ballots/${secondBallotId}/vote`, {
      token: voters[0].token,
      body: { choice: "yes" },
    });
    expect(late.status).toBe(409);
    expect((await call("POST", `/api/governance/ballots/${secondBallotId}/withdraw`, {
      body: { reason: "Again." },
    })).status).toBe(409);
  });

  it("refuses a withdrawal that would discard somebody else's cast vote", async () => {
    const opened = await call("POST", `/api/governance/mechanics/${proposalId}/open-ballot`);
    expect(opened.status).toBe(200);
    const id = String(opened.json?.ballot?.id ?? "");
    expect((await call("POST", `/api/governance/ballots/${id}/vote`, {
      token: voters[1].token, body: { choice: "no", reason: "Too much at once." },
    })).status).toBe(200);

    // Anna opened nothing and holds no proposal.decide, so she is refused on
    // both counts, and the sentence says which one applies.
    const notHers = await call("POST", `/api/governance/ballots/${id}/withdraw`, {
      token: voters[0].token, body: { reason: "I would rather it went away." },
    });
    expect(notHers.status).toBe(403);

    // The founder facilitates, so the act is available, and the answer says
    // what it cost.
    const done = await call("POST", `/api/governance/ballots/${id}/withdraw`, {
      body: { reason: "Superseded by the budget review the council opened this morning." },
    });
    expect(done.status).toBe(200);
    expect(done.json?.votesDiscarded).toBe(1);
    expect(await proposalStatus(proposalId)).toBe("open");
  });

  it("AN ADVISORY VOTE IS CONDUCTED FOR REAL AND SAYS SO", async () => {
    const asked = await call("POST", "/api/governance/advisory", {
      body: {
        question: "Would we welcome a second work morning each moon?",
        detail: "Nothing changes either way. This one is to find out where we already stand.",
        about: "agreement",
      },
    });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    const ballot = asked.json?.ballot;
    advisoryId = String(ballot?.id ?? "");
    expect(advisoryId).toBeTruthy();

    // The fact that decides everything else about this vote.
    expect(ballot.binding).toBe(false);
    expect(ballot.subjectType).toBe("advisory");
    // It is in the FROZEN DOCUMENT, so it survives any client that has not
    // learned to read the flag yet.
    expect(String(ballot.docMarkdown)).toContain("changes nothing on its own");
    expect(String(ballot.docMarkdown)).toContain("agreement");

    // Everything about the CONDUCT is identical to a binding ballot. A village
    // practising on a softer engine would learn something untrue about its own.
    expect(ballot.quorumPct).toBe(60);
    expect(ballot.electorateCount).toBeGreaterThanOrEqual(3);
    expect(ballot.totalWeight).toBeGreaterThan(0);

    // One at a time per member: an advisory vote rings the whole roll twice.
    const second = await call("POST", "/api/governance/advisory", {
      body: { question: "And should the second one be on a Saturday?" },
    });
    expect(second.status).toBe(409);
  });

  it("...and closing it changes NOTHING, which is the whole promise", async () => {
    const ledgerBefore = await amendmentRows();
    const budgetBefore = (await call("GET", "/api/game/rules")).json?.gratitude?.baseBudget;

    for (const v of voters) {
      const r = await call("POST", `/api/governance/ballots/${advisoryId}/vote`, {
        token: v.token, body: { choice: "yes" },
      });
      expect(r.status, `${v.name} votes`).toBe(200);
    }
    expect((await call("POST", `/api/governance/ballots/${advisoryId}/vote`, { body: { choice: "yes" } })).status).toBe(200);

    await expire(advisoryId);
    const closed = await call("POST", `/api/governance/ballots/${advisoryId}/close`, {
      body: { outcomeNote: "Everyone who voted said yes, and the whole roll voted." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);

    // It reached a REAL verdict on REAL dials.
    expect(closed.json?.outcome).toBe("passed");
    expect(closed.json?.quorum).toBe(100);
    expect(closed.json?.unity).toBe(100);

    // And it did nothing at all.
    expect(closed.json?.binding).toBe(false);
    expect(closed.json?.applied).toEqual([]);
    expect(closed.json?.held).toBeNull();
    expect(await amendmentRows()).toBe(ledgerBefore);
    expect((await call("GET", "/api/game/rules")).json?.gratitude?.baseBudget).toBe(budgetBefore);
    // The mechanics proposal that has been through three ballots is untouched
    // by a vote that was never about it.
    expect(await proposalStatus(proposalId)).toBe("open");

    /*
     * Nobody is told they carried anything.
     *
     * WITH A BOUNDED WAIT, and this is the whole reason this case was the one
     * that failed in company and passed alone. The close fires its roll notice
     * as `void notifyRoll(...)` and then answers 200, and notifyRoll walks the
     * frozen roll SEQUENTIALLY at two database round trips per member. So the
     * 200 does not mean the roll has been told; nothing in the close's contract
     * says it does, and the product is deliberate about that (a trace must not
     * hold up the deed it traces). Reading the bell once, immediately, asserted
     * a promise the server never made, and the margin was about two round
     * trips: sampled 16 times, 12 of them found the roll still being written.
     * The same assertion asked of the LAST member of the roll rather than the
     * first was false in 3 of 4 samples.
     *
     * server/loop.e2e.test.ts:5642 already reads these same un-awaited notices
     * with a bounded wait and says why. This one is bounded by the CLOCK rather
     * than by a read count, which is the difference between a wait and a hope:
     * a fixed number of reads with no sleeps is only ever worth as much as the
     * round trips happen to cost, and under load those are the moments the
     * writer is slow too. Verified by making the writer slow on purpose (500ms
     * per member of the roll, four members): the count-bounded form failed, this
     * one passes, and both go red if the notice never lands at all.
     *
     * The NEGATIVE half is checked after the positive one arrives, on purpose.
     * "No Carried: line" is true of an empty bell too, so asserting it before
     * anything has landed would pass for the wrong reason.
     */
    const bellDeadline = Date.now() + 10_000;
    let bell: string[] = [];
    for (;;) {
      bell = await titlesInBell(voters[0].token);
      if (bell.some((t) => t.includes("The village would have said yes"))) break;
      if (Date.now() > bellDeadline) break;
      await settle(100);
    }
    expect(bell.some((t) => t.includes("The village would have said yes")), 
      `the advisory close must tell the roll; the bell held: ${JSON.stringify(bell)}`).toBe(true);
    expect(bell.some((t) => t.startsWith("Carried:")),
      `an advisory vote carries nothing, so nothing may say so; the bell held: ${JSON.stringify(bell)}`).toBe(false);
  });

  it("the weight trail is append-only and member-readable, after all of that", async () => {
    // The invariant the round is held to, read from the member's own door
    // rather than computed here.
    const record = await call("GET", "/api/governance/weights", { token: voters[0].token });
    expect(record.status).toBe(200);
    expect(record.json?.mode).toBe("equal");
    expect(Array.isArray(record.json?.history)).toBe(true);

    // And the economy is where it was: governance moved no value.
    const recon = await call("GET", "/api/admin/ledger/reconciliation");
    expect(recon.status).toBe(200);
    expect(recon.json?.invariants?.problems).toEqual([]);
    expect(recon.json?.invariants?.ok).toBe(true);
  });
});
