/**
 * A POWER CROSSES OVER BY A VOTE THE WHOLE VILLAGE HELD (lane G-C), driven.
 *
 * R54, the founder's ruling: "these villages are meant to be taken over by
 * the electorate to run the game and put the admins out of a full time job."
 * Lane G-B made a power ABLE to move and gave an admin a route to hand one
 * over. This lane is the village asking for one itself, and the harm metric
 * is a sentence about the record rather than about the code:
 *
 *   A power crosses to the village by a vote the whole electorate held, and
 *   that crossing has a date, an author, an outcome sentence and a permanent
 *   row.
 *
 * Every clause of that is driven here over HTTP against the built server, and
 * the two rulings the spec calls load-bearing get a case each:
 *
 *  1. A transfer proposal may be opened only by the village, never by an
 *     admin. The route refuses an actor whose only path to `proposal.open` is
 *     `isAdmin`, and this file proves it by refusing the founder and then
 *     letting a member who reached co-creator do the same thing.
 *  2. `badge_grant` refuses `ballot.vote`; the transfer type does not. The
 *     unit half is in `server/lib/proposalDrafts.test.ts`; the half here is
 *     that the wizard actually offers the transfer type as conductable while
 *     badge_grant stays advisory.
 *
 * Plus the three things that make it safe to ship a permission change:
 * exactly ONE holding row per crossing, idempotent on a double close, and the
 * snapshot law untouched by a transfer landing while another vote is running.
 *
 * The cases run IN ORDER: one power walks the whole path. Run the whole file,
 * never a `-t` slice. Boots the BUILT `dist/index.js` against a throwaway
 * schema, so run `pnpm build` first or you are testing stale code. Skips
 * loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[powerTransfer.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
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
const PORT = 23902 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "transfer-admin";
const PASSWORD = "TransferTest123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
/** Wren reached co-creator, so she holds proposal.open as a MEMBER. */
let wrenToken = "";
let wrenId = "";
/** Ida is seated in the Steward Circle and will act on the crossed power. */
let idaToken = "";
let idaId = "";
/** Otto holds nothing anybody appointed. He is the control. */
let ottoToken = "";
let ottoId = "";

interface Answer { status: number; json: any }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null; headers?: Record<string, string> } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    token: "",
    body: { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** Push a ballot's window into the past: the clock, never a status change. */
const expire = async (ballotId: string) => {
  await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
};

/**
 * The window runs out with nobody stopping it, and the landing path runs.
 *
 * A power crossing changes the Game, so since 2026-09-03 the close stamps a
 * landing instant on the decision rather than moving the power there and then,
 * and a steward may stop it until that instant. Nothing in this file is about
 * the window, so the fixture runs it out and calls the landing path, which is
 * what the five-minute job does on its own in a running village.
 */
const land = async (ballotId: string) => {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "UPDATE ballots SET lands_at = DATE_SUB(NOW(), INTERVAL 1 HOUR), veto_closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) " +
      "WHERE id = ? AND lands_at IS NOT NULL",
    [ballotId],
  );
  await call("POST", "/api/admin/cycles/close", { body: {} });
};

/** The holding table exactly as it stands. The permanent row, read raw. */
const holdingRows = async (): Promise<Array<{ capability: string; role: string; ballot: string | null; movedAt: string }>> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT capability, holder_role_id, moved_by_ballot_id, moved_at FROM capability_holding ORDER BY capability",
  );
  return rows.map((r) => ({
    capability: String(r.capability),
    role: String(r.holder_role_id),
    ballot: r.moved_by_ballot_id == null ? null : String(r.moved_by_ballot_id),
    movedAt: r.moved_at instanceof Date ? r.moved_at.toISOString() : String(r.moved_at),
  }));
};

/** Every line the VILLAGE can read. Audience public, examples out. */
const publicPulse = async (): Promise<string[]> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT text FROM health_events WHERE audience = 'public' AND is_example = 0 ORDER BY at DESC, id DESC LIMIT 50",
  );
  return rows.map((r) => String(r.text));
};

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the power transfer route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-transfer-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

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
      AUTH_TOKEN_SECRET: "transfer-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s:\n${logs.join("")}`);
    try {
      if ((await fetch(`${BASE}/health`)).ok) break; // module-review-ok: the boot poll against the local test server
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }

  const boot = await call("POST", "/api/admin/bootstrap", {
    token: "",
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Transfer Founder" },
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: "", body: { token: claim, password: PASSWORD } });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const on = await call("PUT", "/api/admin/modules/governance/lifecycle", {
    body: { lifecycle: "members", examples: false },
  });
  expect(on.status, "governance must be on for this suite").toBe(200);
  await call("PUT", "/api/admin/modules/events/lifecycle", { body: { lifecycle: "public", examples: false } });

  const wren = await register("Wren Ashby", "wren");
  wrenToken = wren.token; wrenId = wren.id;
  const ida = await register("Ida Kestrel", "ida");
  idaToken = ida.token; idaId = ida.id;
  const otto = await register("Otto Brand", "otto");
  ottoToken = otto.token; ottoId = otto.id;

  /*
   * Everybody reaches member so `ballot.vote` unlocks and the roll is real.
   * Wren goes further, to co-creator, because that is the rung `proposal.open`
   * unlocks at: she holds it as a MEMBER of this village and not as its
   * operator, which is the whole premise of ruling 1.
   *
   * The FOUNDER is pinned at member on purpose, so the refusal this suite
   * asserts is the ruling working and never an accident of where a bootstrap
   * account happens to start.
   */
  for (const [id, stage] of [
    [founderId, "member"],
    [wrenId, "co-creator"],
    [idaId, "member"],
    [ottoId, "member"],
  ] as const) {
    const r = await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: stage } });
    expect(r.status, `${id} reaches ${stage}`).toBe(200);
  }

  // Ida takes a seat in the Steward Circle, which already carries event.manage
  // in the platform seed. Somebody has to be sitting there before the village
  // hands the seat a power, or the crossing lands on an empty chair.
  const seated = await call("POST", "/api/admin/roles/steward-circle/holders", {
    body: { userId: idaId, action: "add" },
  });
  expect(seated.status, JSON.stringify(seated.json)).toBe(200);
}, 180_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("ruling 1: a handover is the village's act and never the scaffolding's", () => {
  it("refuses the founder, whose only path to proposal.open is being an admin", async () => {
    /*
     * THE PREMISE, ESTABLISHED AND NEVER ASSUMED. The founder holds
     * proposal.open through the one gate, and holds it by exactly one path:
     * no role of theirs grants it, and their stage is member while the rung
     * that unlocks it is co-creator. So `isAdmin` is the whole of their claim
     * to it, which is the actor the ruling is about.
     */
    const explain = await call("GET", `/api/admin/members/${founderId}/capabilities`);
    expect(explain.status).toBe(200);
    const row = (explain.json?.capabilities ?? []).find((c: any) => c.capability === "proposal.open");
    expect(row.held).toBe(true);
    expect(row.source).toBe("admin");
    expect(explain.json?.roles ?? [], "no role of the founder's grants it").not.toContain("proposal.open");
    expect(explain.json?.badgeGrants ?? [], "no badge of the founder's grants it").not.toContain("proposal.open");
    expect(explain.json?.stage?.id ?? explain.json?.stage).toBe("member");

    const refused = await call("POST", "/api/governance/power-transfers", {
      body: {
        capability: "event.manage",
        roleId: "steward-circle",
        reason: "The stewards have been putting every gathering on the calendar for three seasons now.",
      },
    });
    expect(refused.status, JSON.stringify(refused.json)).toBe(403);
    // The refusal says which of the two things it is, and says what to do.
    expect(refused.json?.adminOnly).toBe(true);
    expect(String(refused.json?.error)).toContain("advisory vote");
    // And it refused before anything was written.
    expect(await holdingRows()).toEqual([]);
  });

  it("refuses a member who does not hold proposal.open at all, with the ordinary sentence", async () => {
    const refused = await call("POST", "/api/governance/power-transfers", {
      token: ottoToken,
      body: {
        capability: "event.manage",
        roleId: "steward-circle",
        reason: "I think the stewards should look after the calendar from now on, and here is why.",
      },
    });
    expect(refused.status).toBe(403);
    expect(refused.json?.adminOnly).toBe(false);
  });

  it("leaves the advisory door open, which is what an admin is pointed at instead", async () => {
    // Ruling 1 removes a route from an admin and it must not remove the act:
    // an admin who wants a handover asks the village what it thinks.
    const asked = await call("POST", "/api/governance/advisory", {
      body: {
        question: "Should the stewards look after the calendar from now on?",
        detail: "Nothing changes either way. This is to find out where we already stand before anyone opens a real one.",
      },
    });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    expect(asked.json?.ballot?.binding).toBe(false);
  });
});

describe.skipIf(!DB_CONFIGURED)("what the route refuses before a village ever votes on it", () => {
  const good = {
    capability: "event.manage",
    roleId: "steward-circle",
    reason: "The stewards have been putting every gathering on the calendar for three seasons, and the last four times an admin touched it was to fix a typo.",
  };

  it("refuses a key this platform does not know", async () => {
    const r = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken, body: { ...good, capability: "calendar.boss" },
    });
    expect(r.status).toBe(400);
  });

  it("refuses a key that may never move, because there is nobody for it to move to", async () => {
    const r = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken, body: { ...good, capability: "message.send" },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("not a power that can move");
  });

  it("refuses ballot.vote, and says the reason that is actually true of it", async () => {
    /*
     * THE HONEST HALF OF RULING 2. The transfer TYPE permits the governance
     * keys (proved in server/lib/proposalDrafts.test.ts: its refusal list is
     * empty). The PLATFORM does not move `ballot.vote`, and the route reads
     * that map rather than second-guessing it.
     *
     * 0103 CHANGED THE SENTENCE AND NOT THE ANSWER, and the difference is
     * the whole of this case now. The refusal above is one written line about
     * two reasons: a personal act, or plumbing an operator must keep
     * reachable. That line was true of every key it could meet until seven of
     * them crossed, and it was never true of this one. A village asking for
     * its own roll was being told it had asked for something a member does
     * for themselves, which is a fallback answering a question nobody put to
     * it. The reason now comes from `WIRED_BUT_HELD_BACK`, beside the power
     * it is about.
     *
     * The two facts stay separate and both stay true: nothing about this
     * ceremony is what stands between a village and its own roll, and the day
     * the key flips this route still needs no edit.
     */
    const r = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken, body: { ...good, capability: "ballot.vote" },
    });
    expect(r.status).toBe(409);
    const why = String(r.json?.error);
    expect(why).toContain("Who votes here is a rule of the game");
    expect(why).toContain("who is on the roll");
    // The sentence that is false about this key, and was being said anyway.
    expect(why).not.toContain("names something a member does for themselves");
    // And it is NOT the badge review's refusal talking: the transfer type
    // says nothing about ballot.vote at all.
    expect(why).not.toContain("badge");
  });

  it("refuses a role that could not act on it the day it crossed", async () => {
    const r = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken, body: { ...good, capability: "library.keep" },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("does not carry this power yet");
  });

  it("refuses a role that is not this village's", async () => {
    const r = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken, body: { ...good, roleId: "no-such-circle" },
    });
    expect(r.status).toBe(404);
  });

  it("asks for the case in words, because the whole roll reads it before voting", async () => {
    const r = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken, body: { ...good, reason: "time" },
    });
    expect(r.status).toBe(400);
    expect(String(r.json?.error)).toContain("why the village is ready");
  });

  it("has written nothing through any of that", async () => {
    expect(await holdingRows()).toEqual([]);
  });
});

describe.skipIf(!DB_CONFIGURED)("the crossing, end to end", () => {
  let transferId = "";
  let witnessId = "";
  let witnessBefore: any = null;

  it("the wizard offers it as a real vote, and still holds badge grants back", async () => {
    const facts = await call("GET", "/api/governance/wizard", { token: wrenToken });
    expect(facts.status).toBe(200);
    expect(facts.json?.conductable).toContain("power_transfer");
    // The badge_grant cautionary tale: config, pickers, a noun and no route.
    // It stays on the advisory list until somebody builds one.
    expect(facts.json?.conductable).not.toContain("badge_grant");
    expect(facts.json?.advisory).toContain("badge_grant");
  });

  it("a member opens the ask, and the frozen document says all three things", async () => {
    const opened = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken,
      body: {
        capability: "event.manage",
        roleId: "steward-circle",
        reason: "The stewards have been putting every gathering on the calendar for three seasons, and the last four times an admin touched it was to fix a typo.",
      },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const ballot = opened.json?.ballot;
    transferId = String(ballot?.id ?? "");
    expect(transferId).toBeTruthy();

    // It BINDS. A ceremony that decided nothing would be an advisory vote
    // with better wording, and a member is owed that fact before they vote.
    expect(ballot.binding).toBe(true);
    expect(ballot.subjectType).toBe("power_transfer");
    // The subject IS the crossing, so the record can be walked by power.
    expect(ballot.subjectRef).toBe("event.manage@steward-circle");

    // THE DOCUMENT, frozen at open: what the power does, who has it today,
    // and what changes on the day it crosses.
    const doc = String(ballot.docMarkdown);
    expect(doc).toContain("put gatherings on the village calendar");
    expect(doc).toContain("The admin panel is carrying it");
    expect(doc).toContain("stops passing this gate by being an administrator");
    expect(doc).toContain("three seasons");

    // The ceremony's own payload, which is what the card renders from.
    expect(ballot.transfer.capability).toBe("event.manage");
    expect(ballot.transfer.movable).toBe(true);
    expect(ballot.transfer.toRoleName).toBe("Steward Circle");
    expect(ballot.transfer.roleCarriesIt).toBe(true);
    expect(ballot.transfer.heldNow).toBeNull();
    expect(ballot.transfer.crossedHere).toBeNull();
  });

  it("refuses a second ask about the same power while the village is deciding", async () => {
    // A DIFFERENT role, on purpose. `open_key` alone gives one ballot per
    // (power, role) pair, so two ballots handing one power to two roles would
    // both open and whichever closed second would quietly overwrite the first
    // village decision. The refusal is a fact about the POWER, and it is
    // asked before anything about the role for exactly that reason.
    const again = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken,
      body: {
        capability: "event.manage",
        roleId: "treasury",
        reason: "Actually the treasury should have it, and here is a whole sentence about why that is.",
      },
    });
    expect(again.status).toBe(409);
    expect(String(again.json?.error)).toContain("already deciding where this power lives");
    expect(again.json?.ballotId).toBe(transferId);
  });

  it("the whole electorate votes, and a second vote opens beside it that must not move", async () => {
    /*
     * THE SNAPSHOT LAW, set up before the transfer lands. A power crossing
     * mid-ballot must not touch a roll that is already frozen. It cannot,
     * because a roll is a table and not a query, and this is the case that
     * proves it rather than asserting it.
     */
    const witness = await call("POST", "/api/governance/advisory", {
      token: wrenToken,
      body: { question: "Where should the winter gathering be held this year?" },
    });
    expect(witness.status, JSON.stringify(witness.json)).toBe(200);
    witnessId = String(witness.json?.ballot?.id ?? "");
    await call("POST", `/api/governance/ballots/${witnessId}/vote`, { token: idaToken, body: { choice: "yes" } });
    const read = await call("GET", `/api/governance/ballots/${witnessId}`, { token: wrenToken });
    witnessBefore = read.json;
    expect(witnessBefore.electorateCount).toBeGreaterThanOrEqual(4);

    for (const t of [founderToken, wrenToken, idaToken, ottoToken]) {
      const r = await call("POST", `/api/governance/ballots/${transferId}/vote`, { token: t, body: { choice: "yes" } });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
    }
  });

  it("IT CARRIES, AND THE POWER CROSSES: one row, with a date, an author and a sentence", async () => {
    await expire(transferId);
    const closed = await call("POST", `/api/governance/ballots/${transferId}/close`, {
      token: wrenToken,
      body: { outcomeNote: "Every one of us said yes. The Steward Circle keeps the calendar from today." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");
    // The close STAMPS and writes nothing; the landing path writes.
    expect(closed.json?.applied).toEqual([]);
    expect(String(closed.json?.held)).toContain("lands at");
    await land(transferId);

    // THE PERMANENT ROW. Exactly one, naming the ballot that moved it.
    const rows = await holdingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe("event.manage");
    expect(rows[0].role).toBe("steward-circle");
    expect(rows[0].ballot).toBe(transferId);

    // THE DATE, THE AUTHOR AND THE SENTENCE, off the ballot the ceremony
    // renders from, and not off the close response that only exists today.
    const cold = await call("GET", `/api/governance/ballots/${transferId}`, { token: ottoToken });
    expect(cold.status).toBe(200);
    expect(cold.json?.transfer?.crossedHere?.movedAt).toBeTruthy();
    expect(cold.json?.transfer?.heldNow?.roleName).toBe("Steward Circle");
    expect(cold.json?.transfer?.heldNow?.byBallot).toBe(true);
    expect(cold.json?.closedBy).toBeTruthy();
    expect(String(cold.json?.outcomeNote)).toContain("keeps the calendar from today");

    // The VILLAGE's own record, on the public pulse rather than in the admin
    // trail. A handover the village cannot read afterwards is a permission
    // change with a ceremony painted on it.
    const pulse = await publicPulse();
    expect(pulse.some((t) => t.includes("holds this now, by a vote of the whole village"))).toBe(true);
  });

  it("and the frozen ballot beside it did not move a single weight", async () => {
    const after = await call("GET", `/api/governance/ballots/${witnessId}`, { token: wrenToken });
    expect(after.json.electorateCount).toBe(witnessBefore.electorateCount);
    expect(after.json.totalWeight).toBe(witnessBefore.totalWeight);
    expect(after.json.tallies).toEqual(witnessBefore.tallies);
    expect(after.json.unityPct).toBe(witnessBefore.unityPct);
    expect(after.json.quorumPct).toBe(witnessBefore.quorumPct);
    // The roll itself, member for member.
    expect(after.json.votes.map((v: any) => v.name).sort()).toEqual(
      witnessBefore.votes.map((v: any) => v.name).sort(),
    );
    expect(after.json.silent.map((s: any) => s.name).sort()).toEqual(
      witnessBefore.silent.map((s: any) => s.name).sort(),
    );
  });

  it("IS IDEMPOTENT ON A DOUBLE CLOSE: still one row, still the same day", async () => {
    const rowsBefore = await holdingRows();
    const twice = await call("POST", `/api/governance/ballots/${transferId}/close`, {
      token: wrenToken,
      body: { outcomeNote: "Closing it a second time, by accident or by a retry." },
    });
    // `closeBallot` is one guarded UPDATE … WHERE status='open'. Zero rows
    // means somebody else closed it, and nothing executes.
    expect(twice.status).toBe(409);
    const rowsAfter = await holdingRows();
    expect(rowsAfter).toHaveLength(1);
    // Byte for byte, including moved_at: the crossing has ONE date forever.
    expect(rowsAfter).toEqual(rowsBefore);
  });
});

describe.skipIf(!DB_CONFIGURED)("what the village actually got", () => {
  it("the seated steward puts a gathering on the calendar with a MEMBER token", async () => {
    const made = await call("POST", "/api/admin/events", {
      token: idaToken,
      body: { title: "Winter work morning", startsAt: new Date(Date.now() + 7 * 864e5).toISOString() },
    });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
  });

  it("...and the admin who is not seated there is stopped", async () => {
    const stopped = await call("POST", "/api/admin/events", {
      body: { title: "An admin's gathering", startsAt: new Date(Date.now() + 8 * 864e5).toISOString() },
    });
    /*
     * THE CEILING IS REAL, AND THIS IS WHERE IT IS PROVED. Before this
     * crossing the same request from the same account made an event.
     *
     * THE GAP THIS USED TO PIN IS CLOSED. The calendar answered a bare 401
     * here, because its routes asked `mayManageEvents`, which reduced
     * `mayAct`'s verdict to a boolean and threw away the sentence naming the
     * holder. An operator meeting the library or the queues was told what had
     * happened and an operator meeting the calendar was not, which is the
     * case `guardCapability`'s own comment is about: a bare 401 reads as a
     * bug in the product, and an operator who believes the panel is broken
     * starts looking for a database to edit.
     *
     * Eleven refusal sites now ask `guardCapability` directly. The three
     * calls to `mayManageEvents` that remain are visibility reads deciding
     * whether a payload includes drafts, which is the one job a boolean is
     * the right answer to.
     */
    expect(stopped.status).toBe(409);
    // THE EXPLANATION ARRIVES: who holds it, and exactly what to send.
    expect(stopped.json?.villageHolds).toBe(true);
    expect(stopped.json?.requiresOverride).toBe(true);
    expect(stopped.json?.capability).toBe("event.manage");
    expect(String(stopped.json?.error)).toContain("Steward Circle");
    expect(String(stopped.json?.error)).toContain("override");
  });

  it("...and reaching past the village in the open works, and the village is told", async () => {
    const through = await call("POST", "/api/admin/events", {
      body: {
        title: "An admin's gathering, in the open",
        startsAt: new Date(Date.now() + 9 * 864e5).toISOString(),
        override: true,
      },
    });
    expect(through.status).toBe(200);
    const pulse = await publicPulse();
    expect(pulse.some((t) => t.includes("acted on a power this village holds"))).toBe(true);
  });

  it("the powers list says who holds it, in sentences, with no number on it", async () => {
    const powers = await call("GET", "/api/village/powers", { token: ottoToken });
    expect(powers.status).toBe(200);
    const entry = (powers.json?.powers ?? []).find((p: any) => p.capability === "event.manage");
    expect(entry.heldBy.roleName).toBe("Steward Circle");
    expect(entry.heldBy.byBallot).toBe(true);
    expect(entry.heldBy.people).toContain("Ida Kestrel");
    /*
     * R55, held at the payload. A village of two weeks and a village of two
     * years read the same shape here: no count, no total, no fraction, and no
     * ordering by held-versus-not, so a client cannot draw a completion bar
     * out of it without inventing the denominator itself.
     */
    const body = JSON.stringify(powers.json);
    expect(body).not.toMatch(/"(total|count|remaining|progress|percent|pct)"\s*:/);
    expect(body).not.toContain("%");
    // Held and unheld are ONE list in ONE fixed order. The power this village
    // just took on is not hoisted to the top, because sorting by held-versus-
    // unheld draws a completion bar out of a list nobody meant to draw one on.
    const order = (powers.json?.powers ?? []).map((p: any) => p.capability);
    expect(order[0]).not.toBe("event.manage");
    expect(order).toContain("event.manage");
  });

  it("the ask cannot be re-run once it has landed", async () => {
    const again = await call("POST", "/api/governance/power-transfers", {
      token: wrenToken,
      body: {
        capability: "event.manage",
        roleId: "steward-circle",
        reason: "Asking a second time for something the village already decided and already holds.",
      },
    });
    expect(again.status).toBe(409);
    expect(String(again.json?.error)).toContain("already holds this one");
  });
});
