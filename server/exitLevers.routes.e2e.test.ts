/**
 * THE FIVE REFUSALS, DRIVEN THROUGH THE DOOR A FOUNDER ACTUALLY USES (R4),
 * AND WHAT RESOLVE DOES ON THE SHIPPED DIALS (the ruling of 2026-10-23).
 *
 * There were seven refusals until the founder ruled that members keep their
 * tokens. A share of equity and keeping Voice were lifted that day, and the
 * cases for them below now assert that each SAVES. The describe after the
 * refusals drives the departure itself: a leaver still holding tokens is kept
 * as a former member, and an empty account is erased as before.
 *
 * `server/lib/exitPolicy.test.ts` proves `exitLeverProblem` in isolation, with
 * every fact injected. That is a claim about a function. This file is the claim
 * about the PRODUCT: an admin holding a session PUTs an incoherent exit lever
 * at `/api/admin/variables/:key` against the BUILT server, and meets the
 * sentence, and the value is not stored.
 *
 * WHY THE PAIR IS NEEDED AND NEITHER HALF WOULD DO. The unit tests would go
 * green with the route never calling the guard at all, which is exactly the
 * defect a lane adding a refusal is most likely to ship. This file would go
 * green with a guard that refused the right things for the wrong reasons, and
 * it cannot reach the burn case without registering a token first. So: the
 * function is proven by cases, the WIRING is proven here.
 *
 * THE ONE CASE THAT LOOKS LIKE A PASS AND IS THE POINT. The withdrawal window
 * saves. A full credit keep with no vote is a policy a village may genuinely
 * mean, so the route answers 200 and the value is stored; the sentence about it
 * belongs to the test run. A guard that refused it would be the platform
 * deciding a village's exit terms for it.
 *
 * ONE MORE DOOR RIDES ON THIS SERVER: the exit cancel (round 2, finding 1).
 * `server/routes/erasureQueue.test.ts` proves `cancelExit` against a real
 * database; the last block here proves the route in the built server calls it,
 * which no unit test can. The e2e port map is full, so it shares this boot.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { balanceOf, loadTokenRegistry, memberAccount, MINT_FAUCET, postTransfer, tokenDef } from "./lib/ledger";
import { fromLedgerUnits, VILLAGE_VOICE } from "./lib/economy";
import { LEFT_THE_VILLAGE_VOTE } from "./lib/ballots";
import { DELEGATE_LEFT_NOTICE } from "./lib/delegation";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[exitLevers.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED. A skip is not a pass.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window, checked by `scripts/check-e2e-ports.mjs` rather
 * than surveyed by hand.
 *
 * MOVED from 30402 at the main merge: two suites that could not see each other
 * took one window, and the guard refused.
 *
 * IT MOVED BELOW THE BLOCK, and the reason is worth leaving here because the
 * next lane to add an e2e suite meets it immediately.
 *
 * 6000 to 32701 IS NOW FULL. Not nearly full: full. `redemption.routes` ends
 * at 32701, the guard keeps every window clear of the 32768 ephemeral floor,
 * and the two apparent gaps at 7400 and 9500 are `agent.routes` STUB_PORT and
 * `backupUploads` PORT_NO_TOKEN, both derived as `SOMEPORT + n` and invisible
 * to a grep for a literal base. This lane tried 8300 on exactly that mistaken
 * survey and the guard refused it against `authGoogle.routes` GOOGLE_PORT,
 * which is the guard doing its whole job.
 *
 * So this one goes BELOW the block instead, at 2600, which is clear of every
 * service this repository or its tooling stands up: MySQL and the local
 * MariaDB on 3306 and 3307, vite on 5173, the docker daemon on 2375 and 2376,
 * and the 3000 range. There is no lower floor in the guard, only the ceiling.
 *
 * WHICH SUITE MOVED, and the rule it follows: the one that was NOT already on
 * main. `profilePaths.routes.e2e.test.ts` had itself moved to 30402 when
 * `review.routes` landed on main underneath it, and its comment records the
 * same rule. This is that rule applied one turn later.
 */
const PORT = 2600 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "exitlevers-admin";
const PASSWORD = "ExitLevers123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];
let founderToken = "";
/**
 * The bundle apply below, recorded once so the case that asserts THIS
 * BRANCH's partial-apply behaviour can be deleted whole at the merge with
 * the governance branch without touching the security claim.
 */
let bundleApply: Answer | undefined;
let siblingAfterBundle: string | null = null;

interface Answer { status: number; json: any }

async function call(method: string, route: string, opts: { body?: unknown; token?: string | null } = {}): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const setDial = (key: string, value: string) => call("PUT", `/api/admin/variables/${key}`, { body: { value } });

/** What the database actually holds for one key. An absent row IS the default. */
const storedValue = async (key: string): Promise<string | null> => {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT `value` FROM `game_variables` WHERE `config_key` = ?",
    [key],
  );
  return rows[0] ? String(rows[0].value) : null;
};

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the exit levers route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-exitlevers-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler, for the reason every e2e suite gives: the
      // first tick runs every job with no scheduled_jobs row against the
      // schema this suite is asserting on.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "exitlevers-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
    token: null,
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Exit Founder" },
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: null, body: { token: claim, password: PASSWORD } });
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("what the variables route refuses about a departure", () => {
  it("a coherent exit dial saves, so the guard is not simply refusing everything", async () => {
    // The control. Every refusal below means nothing without it.
    const ok = await setDial("exit.cooling_days", "14");
    expect(ok.status).toBe(200);
    expect(await storedValue("exit.cooling_days")).toBe("14");
    // Back to the platform default, which REMOVES the row rather than storing
    // a zero, so the cases below run on an inherited default.
    expect((await setDial("exit.cooling_days", "0")).status).toBe(200);
    expect(await storedValue("exit.cooling_days")).toBeNull();
  });

  it("a share of RECOGNITION is refused, and nothing is written", async () => {
    const r = await setDial("exit.keep_pct.recognition", "40");
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe(
      "Recognition is a record of what happened, not a holding. It stays on the village's books either way, so a share of it is not a thing a leaver can keep. Leave this share at zero.",
    );
    expect(await storedValue("exit.keep_pct.recognition")).toBeNull();
  });

  it("a share of EQUITY saves since the ruling of 2026-10-23, and the shipped 100 is the inherited default", async () => {
    // Refused until that day, when the only equity token was the Hypha mirror.
    // Earned Equity is a platform token, and members keep their tokens.
    const r = await setDial("exit.keep_pct.equity", "10");
    expect(r.status, `equity share: ${JSON.stringify(r.json)}`).toBe(200);
    expect(await storedValue("exit.keep_pct.equity")).toBe("10");
    // Back to the platform default, which removes the row.
    expect((await setDial("exit.keep_pct.equity", "100")).status).toBe(200);
    expect(await storedValue("exit.keep_pct.equity")).toBeNull();
  });

  it("BURN is allowed while every token this village issues has a faucet", async () => {
    /*
     * The order here is the argument. A seeded village's tokens all have a
     * faucet, so burn is a coherent answer and the route says so. The refusal
     * arrives only once the village mints something the engine has nowhere to
     * burn back to, which is the next case.
     */
    const r = await setDial("exit.remainder_account", "burn");
    expect(r.status).toBe(200);
    expect(await storedValue("exit.remainder_account")).toBe("burn");
    expect((await setDial("exit.remainder_account", "settlement")).status).toBe(200);
  });

  it("BURN is refused once the village mints a token with no faucet, and the refusal names it", async () => {
    // Created through the admin route and not by raw SQL, because the token
    // registry is an in-memory cache in the SERVER process: a row inserted
    // behind its back is a token the running server does not know about.
    const made = await call("POST", "/api/admin/tokens", {
      body: { slug: "harvest-credit", name: "Harvest Credit", kind: "credit", transferable: false },
    });
    expect(made.status, `token create: ${JSON.stringify(made.json)}`).toBe(200);

    const r = await setDial("exit.remainder_account", "burn");
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe(
      "Harvest Credit has no faucet, so there is nowhere to burn it back to. " +
        "Send what a leaver does not keep to an account the village can hold it in.",
    );
    expect(await storedValue("exit.remainder_account")).toBeNull();
  });

  it("CONVERT at a rate of zero is refused", async () => {
    const r = await setDial("exit.voice_on_exit", "convert");
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe("A conversion at zero is a forfeit. Say forfeit, or set a rate.");
    expect(await storedValue("exit.voice_on_exit")).toBeNull();
  });

  it("CONVERT with a rate but a Voice share of zero is refused, because nothing would convert", async () => {
    expect((await setDial("exit.voice_convert_rate", "2.5")).status).toBe(200);
    // The share is 100 by default since 2026-10-23, so the village sets it to 0.
    expect((await setDial("exit.keep_pct.voice", "0")).status).toBe(200);
    const r = await setDial("exit.voice_on_exit", "convert");
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe(
      "Convert turns the share of Voice a leaver keeps into credits, and that share is 0, so nothing would convert. Set the share of Voice a leaver keeps, or say forfeit.",
    );
    expect(await storedValue("exit.voice_on_exit")).toBeNull();
  });

  it("CONVERT saves once a rate and a share stand under it, which is the pair reading every dial", async () => {
    expect((await setDial("exit.keep_pct.voice", "50")).status).toBe(200);
    const r = await setDial("exit.voice_on_exit", "convert");
    expect(r.status).toBe(200);
    expect(await storedValue("exit.voice_on_exit")).toBe("convert");
    // The share cannot be taken back to zero underneath a standing conversion.
    expect((await setDial("exit.keep_pct.voice", "0")).status).toBe(400);
    expect(await storedValue("exit.keep_pct.voice")).toBe("50");
    // And back, so the rest of the suite runs on the shipped answers, each of
    // which removes its row.
    expect((await setDial("exit.voice_on_exit", "keep")).status).toBe(200);
    expect((await setDial("exit.voice_convert_rate", "0")).status).toBe(200);
    expect((await setDial("exit.keep_pct.voice", "100")).status).toBe(200);
    for (const key of ["exit.voice_on_exit", "exit.voice_convert_rate", "exit.keep_pct.voice"]) {
      expect(await storedValue(key), key).toBeNull();
    }
  });

  it("KEEPING Voice saves, and it is the shipped answer, because a leaver who holds it stays on", async () => {
    // Refused until 2026-10-23, while a resolved exit always made the account a
    // tombstone. The last describe in this file drives the former-member resolve.
    expect((await setDial("exit.voice_on_exit", "forfeit")).status).toBe(200);
    expect(await storedValue("exit.voice_on_exit")).toBe("forfeit");
    const r = await setDial("exit.voice_on_exit", "keep");
    expect(r.status, `keep: ${JSON.stringify(r.json)}`).toBe(200);
    expect(await storedValue("exit.voice_on_exit")).toBeNull();
  });

  it("a COOLING period longer than the published notice is refused, naming both numbers", async () => {
    // 30 is `DEFAULT_EXIT_POLICY.voluntary.noticePeriodDays`, which is what
    // this village publishes until it writes its own terms. The refusal reads
    // that document and not a constant, which the next case proves.
    const r = await setDial("exit.cooling_days", "45");
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe(
      "Your published policy says 30 days of notice and this would hold balances for 45. Change the published term first.",
    );
    expect(await storedValue("exit.cooling_days")).toBeNull();
  });

  it("the same 45 days SAVES once the village publishes a longer notice", async () => {
    /*
     * The refusal is about the gap between the page and the engine, so closing
     * the gap has to open the dial. This also proves the guard reads the LIVE
     * policy document through `exitPolicyRepo.get()` and not the platform
     * constant it happens to equal on a fresh village.
     */
    // Three sections or the route refuses as incomplete, and `placeholder`
    // stays TRUE: clearing it while the terms are still word for word the
    // platform's is a 409 from a different guard in the same file, and this
    // case is about the notice period and not about that one.
    const published = await call("PUT", "/api/admin/exit-policy", {
      body: {
        placeholder: true,
        voluntary: { noticePeriodDays: 60 },
        involuntary: {},
        restorative: {},
      },
    });
    expect(published.status, `publish: ${JSON.stringify(published.json)}`).toBe(200);
    const r = await setDial("exit.cooling_days", "45");
    expect(r.status).toBe(200);
    expect(await storedValue("exit.cooling_days")).toBe("45");
    expect((await setDial("exit.cooling_days", "0")).status).toBe(200);
  });

  it("THE WITHDRAWAL WINDOW SAVES: it is a warning, and a village may mean it", async () => {
    /*
     * A full credit keep with no vote over any amount. On a token somebody can
     * buy this is a withdrawal window wearing an exit, and it is still the
     * village's call, so the route answers 200 and stores it. The sentence
     * about it is the test run's to print. Since 2026-10-23 a full keep is the
     * shipped default, so the case moves away from it and back.
     */
    const away = await setDial("exit.keep_pct.credit", "40");
    expect(away.status).toBe(200);
    expect(await storedValue("exit.keep_pct.credit")).toBe("40");
    const r = await setDial("exit.keep_pct.credit", "100");
    expect(r.status).toBe(200);
    expect(r.json?.error).toBeUndefined();
    // The inherited default again: no row, which every village that never
    // touched the dial is reading.
    expect(await storedValue("exit.keep_pct.credit")).toBeNull();
    expect(await storedValue("exit.vote_over")).toBeNull(); // 0 by default: no departure asks anybody
  });

  it("A PASSED PROPOSAL cannot land what an admin is refused, and the apply names the element", async () => {
    /*
     * THE DOOR THIS CASE EXISTS FOR. The guard used to live in the variables
     * write route and nowhere else, while `applyMechanicsProposal` calls
     * `setVariable` directly and every Exit dial is Ring 2, so a village could
     * vote in a combination the product refuses to let a founder type. The
     * check now lives inside `setVariable`, so both doors reach one function.
     *
     * The proposal is CREATED successfully on purpose. `validateChangeSet`
     * checks the registry, the ring and the bounds and knows nothing about
     * exit levers, so a village really can take this to a vote; the refusal
     * belongs at the moment the value would land, and it comes back as a named
     * element rather than as a silent write.
     *
     * WHAT THIS CASE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT. The security
     * property is three facts: the apply does not answer 200, the body NAMES
     * the refused element, and the refused value was not written. Those three
     * are the whole claim, and they hold under both of the two behaviours this
     * route has on two live branches. It says NOTHING about the fate of the
     * sibling element, because that is exactly what differs: this branch
     * applies a bundle element by element and answers 207 with the coherent
     * half stored, while the governance branch validates every element before
     * any irreversible write and answers 409 with nothing stored, per Rye's
     * ruling that a bundle applies all or nothing. A case pinning either one
     * is green on its own branch and red after the merge, and CI cannot see it
     * because it merges each branch with main and never the two with each
     * other. The case below owns that difference and is disposable.
     *
     * The body is read as a STRING on purpose. The container differs with the
     * status (a partial apply reports `failed` beside `applied`; an
     * all-or-nothing refusal need not), and what matters is that an
     * administrator reading the response is told which element blocked it and
     * why, in the sentence the product already uses.
     */
    const proposed = await call("POST", "/api/game/mechanics/proposals", {
      body: {
        title: "What a leaver keeps",
        rationale: "The village discussed departures at the last gathering and wants a share to stay.",
        changes: [
          { key: "exit.keep_pct.voice", to: "10" },
          { key: "exit.keep_pct.recognition", to: "40" },
        ],
      },
    });
    expect(proposed.status, `propose: ${JSON.stringify(proposed.json)}`).toBe(200);
    const proposalId = String(proposed.json?.id ?? "");
    expect(proposalId).toBeTruthy();

    // Carried, by whatever route a village's vote comes home. The status is
    // set directly because this case is about the APPLY step and not about
    // how a proposal reaches it; every path into `applyMechanicsProposal`
    // lands on the same function.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE `mechanics_proposals` SET `status` = 'passed_verified' WHERE `id` = ?",
      [proposalId],
    );

    /*
     * THE DOOR THIS CASE KNOCKS ON IS SHUT IN A STARTED VILLAGE, and shutting
     * it was right. `POST /apply` now answers 409 once the Game has begun,
     * because an admin applying a carried change by hand is an apply inside
     * the window a steward was promised, from the one plane the veto does not
     * reach. After the Birthing the landing path owns it.
     *
     * So the fixture puts the village where this route is the way a change
     * lands: before its Birthing, when the admin plane is how a village is
     * built. The harness provisions an ordinary mid-life village by default
     * and the other cases in this file want that, so the row is cleared for
     * this one apply and put back straight after.
     *
     * WHAT THIS NARROWS, said plainly rather than left for a reader to notice.
     * The guard lives inside `setVariable`, so every door reaches it, and this
     * case now proves the pre-Birthing door only. The started-village door is
     * the landing path, and this file does not exercise it: that needs a real
     * ballot, a close, and a landing tick, which is `mintVote.routes.e2e`'s
     * fixture and not this one. The property is not weaker; the coverage of
     * the second door is a gap and belongs to whoever writes that case.
     */
    const gameStart = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT value FROM app_config WHERE config_key = 'game-start'",
    );
    const startRow = (gameStart[0] as any[])[0];
    await pool.query("DELETE FROM app_config WHERE config_key = 'game-start'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const applied = await call("POST", `/api/admin/mechanics/proposals/${proposalId}/apply`, {});
    if (startRow) {
      await pool.query("INSERT INTO app_config (config_key, value) VALUES ('game-start', ?)", [ // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        typeof startRow.value === "string" ? startRow.value : JSON.stringify(startRow.value),
      ]);
    }
    // RECORDED, never asserted here. The case below reads these two.
    bundleApply = applied;
    siblingAfterBundle = await storedValue("exit.keep_pct.voice");

    const body = JSON.stringify(applied.json);
    // THE VALUE FIRST, because it is the clause whose meaning cannot move. All
    // three were measured against the broken arrangement one at a time and all
    // three catch it, but this is the one that fails with the defect itself in
    // the message (`expected '40' to be null`) rather than with a status code
    // that is about to change under the all-or-nothing ruling.
    expect(await storedValue("exit.keep_pct.recognition")).toBeNull();
    expect(body, "the apply must name the element that blocked it").toContain("exit.keep_pct.recognition");
    expect(body, "and say why, in the sentence a founder already meets").toContain(
      "Recognition is a record of what happened, not a holding.",
    );
    expect(applied.status, `apply: ${body}`).not.toBe(200);

    // Back to the shipped answers for the rest of the file. A no-op when the
    // element never landed, which is why it belongs here and not below.
    expect((await setDial("exit.keep_pct.voice", "100")).status).toBe(200);
    expect(await storedValue("exit.keep_pct.voice")).toBeNull();
  });

  it("a dial outside the Exit category is untouched by any of this", async () => {
    // The guard returns before reading anything for a key that is not an exit
    // lever, and this is the case that would catch it refusing one by accident.
    const r = await setDial("gratitude.base_budget", "250");
    expect(r.status).toBe(200);
    expect(await storedValue("gratitude.base_budget")).toBe("250");
  });
});

/*
 * ── WHAT RESOLVE DOES ON THE SHIPPED DIALS (Rye, 2026-10-23) ─────────────────
 *
 * "As a general rule members keep their tokens", and on staying a former member
 * or being erased after a Hypha claim: "a if b hasn't already happened". So a
 * leaver who still holds value is KEPT, account and balances intact, with their
 * membership and roles ended; an account with nothing of value left is erased
 * exactly as before. Both are driven through the routes an admin and a member
 * actually use, against the built server, with every Exit dial at its default
 * (the describe above puts each one back, and the first case here checks).
 *
 * The balances are posted from this process through `postTransfer` into the
 * schema the server is writing to. The server reads balances off
 * `token_balances` on every request, so it sees them, and the ledger primitive
 * is the only door a posting may use.
 *
 * AND WHAT A FORMER MEMBER MAY STILL DO IN THE VILLAGE'S DECISIONS (Rye,
 * 2026-10-30: "yes build all the exit suggestions!"). A vote cast before
 * leaving stands and a new one is refused; the frozen roll does not move; a
 * member who handed them a voice gets it back and is told; no badge puts them
 * on a new roll; admitted again, they are on the next one. Cash still owed
 * keeps an account holding no tokens, and they can sign in to see it paid.
 */
describe.skipIf(!DB_CONFIGURED)("resolving a departure: a former member, or a tombstone", () => {
  const CREDIT_UNITS = 5_000;
  const VOICE_UNITS = 300;
  let holder = { id: "", token: "", email: "" };
  let empty = { id: "", token: "", email: "" };
  let cal = { id: "", token: "", email: "" };
  let holderExit = "";
  /** The advisory ballot open across the departure, its roll and its head count as they froze. */
  let ballotA = "";
  let rollA: string[] = [];
  let countA = 0;
  /** The ballot opened after they left, and the one after they came back. */
  let ballotB = "";

  const rollOf = async (ballotId: string): Promise<string[]> => {
    const [rows] = await pool.query<any[]>("SELECT user_id FROM ballot_electorate WHERE ballot_id = ? ORDER BY user_id", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    return rows.map((r) => String(r.user_id));
  };
  const votesOn = async (ballotId: string): Promise<any[]> => {
    const [rows] = await pool.query<any[]>("SELECT user_id, choice, followed_user_id FROM ballot_votes WHERE ballot_id = ? ORDER BY user_id", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    return rows;
  };
  /** The founder asks the village an advisory question, which freezes a roll through `buildElectorate`. */
  const ask = async (question: string) => {
    const r = await call("POST", "/api/governance/advisory", { body: { question } });
    expect(r.status, `advisory: ${JSON.stringify(r.json)}`).toBe(200);
    return { id: String(r.json?.ballot?.id ?? ""), count: Number(r.json?.ballot?.electorateCount) };
  };
  const callOff = async (ballotId: string) => {
    const r = await call("POST", `/api/governance/ballots/${ballotId}/withdraw`, { body: { reason: "Asked again below." } });
    expect(r.status, `withdraw: ${JSON.stringify(r.json)}`).toBe(200);
  };

  const register = async (name: string, slug: string) => {
    const email = `${slug}-${PORT}@example.test`;
    const r = await call("POST", "/api/auth/register", {
      token: null,
      body: { name, email, password: PASSWORD, paths: ["resident"] },
    });
    expect(r.status, `${name} must register: ${JSON.stringify(r.json)}`).toBe(200);
    return { id: String(r.json?.user?.id ?? ""), token: String(r.json?.token ?? ""), email };
  };
  const player = async (id: string) =>
    ((await call("GET", "/api/admin/players")).json ?? []).find((p: any) => p.id === id);
  const exitRecord = async (id: string) =>
    ((await call("GET", "/api/admin/exits")).json?.exits ?? []).find((e: any) => e.id === id);
  const seed = async (userId: string, token: string, units: number) => {
    const r = await postTransfer(pool, {
      from: MINT_FAUCET,
      to: memberAccount(userId),
      tokenType: token,
      amount: units,
      source: "test_seed",
      idempotencyKey: `exit-resolve:seed:${userId}:${token}`,
    });
    expect(r.ok, `seed ${token}: ${r.error}`).toBe(true);
  };

  it("every Exit dial is at its shipped default before a departure is driven", async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `config_key` FROM `game_variables` WHERE `config_key` LIKE 'exit.%'",
    );
    expect(rows.map((r) => r.config_key)).toEqual([]);
  });

  it("a member who holds credits and Voice, and sits in a role, opens their own departure", async () => {
    await loadTokenRegistry(pool);
    expect(tokenDef(VILLAGE_VOICE), "the village must carry Village Voice").toBeTruthy();
    holder = await register("Ash Holder", "ash-holder");
    /*
     * Admitted BOTH ways a village records it (`isAdmitted`), so the case can
     * show both cleared: a signed membership letter the village accepted, which
     * is what writes `membershipGranted`, and a stage grant at Member.
     */
    const letter = await call("GET", "/api/membership-letter", { token: null });
    expect(letter.status, `letter: ${JSON.stringify(letter.json)}`).toBe(200);
    const signed = await call("POST", "/api/forms/submit", {
      token: holder.token,
      body: {
        type: "membership-508",
        data: {
          name: "Ash Holder", email: holder.email, phone: "", paths: ["resident"],
          why: "I would like to belong here.", monthlyContribution: "108",
          acknowledgedGoodNeighbor: true, acknowledgedCommitments: true,
          signedAt: new Date().toISOString(), letterVersion: String(letter.json?.version ?? ""),
        },
      },
    });
    expect(signed.status, `sign: ${JSON.stringify(signed.json)}`).toBe(200);
    const accepted = await call("PUT", `/api/admin/submissions/${String(signed.json?.id ?? "")}/status`, { body: { status: "accepted" } });
    expect(accepted.status, `accept: ${JSON.stringify(accepted.json)}`).toBe(200);
    const admitted = await call("PUT", `/api/admin/players/${holder.id}/stage`, { body: { stageId: "member" } });
    expect(admitted.status, `admit: ${JSON.stringify(admitted.json)}`).toBe(200);
    const seated = await call("POST", "/api/admin/roles/treasury/holders", { body: { userId: holder.id, action: "add" } });
    expect(seated.status, `seat: ${JSON.stringify(seated.json)}`).toBe(200);
    await seed(holder.id, "credits", CREDIT_UNITS);
    await seed(holder.id, VILLAGE_VOICE, VOICE_UNITS);

    const before = await player(holder.id);
    expect(before?.membership, "the control: they are a member before they leave").toBe(true);
    const state = await call("GET", `/api/admin/players/${holder.id}/exit-state`);
    expect(state.json?.states?.find((s: any) => s.domain === "roles")?.count).toBe(1);

    const opened = await call("POST", "/api/profile/request-exit", { token: holder.token, body: { password: PASSWORD } });
    expect(opened.status, `request-exit: ${JSON.stringify(opened.json)}`).toBe(200);
    holderExit = String(opened.json?.exit?.id ?? "");
    expect(holderExit).toBeTruthy();
  });

  it("the settle act keeps every credit and every Voice, because that is the shipped share", async () => {
    const settled = await call("POST", `/api/admin/exits/${holderExit}/settle-balances`, {});
    expect(settled.status, `settle: ${JSON.stringify(settled.json)}`).toBe(200);
    expect(settled.json?.swept?.credits).toBeUndefined();
    expect(settled.json?.swept?.[VILLAGE_VOICE]).toBeUndefined();
  });

  it("before the resolve, they are on a ballot's roll, vote on it, and carry another member's voice", async () => {
    for (const id of ["governance", "badges"]) {
      const on = await call("PUT", `/api/admin/modules/${id}/lifecycle`, { body: { lifecycle: "members", examples: false } });
      expect(on.status, `${id} on: ${JSON.stringify(on.json)}`).toBe(200);
    }
    cal = await register("Cal Delegator", "cal-delegator");
    expect((await call("PUT", `/api/admin/players/${cal.id}/stage`, { body: { stageId: "member" } })).status).toBe(200);
    const offered = await call("PUT", "/api/governance/delegation", { token: cal.token, body: { delegateId: holder.id } });
    expect(offered.status, `offer: ${JSON.stringify(offered.json)}`).toBe(200);
    const accepted = await call("POST", "/api/governance/delegation/accept", { token: holder.token, body: {} });
    expect(accepted.json?.accepted, `accept: ${JSON.stringify(accepted.json)}`).toBe(1);

    const a = await ask("Should the orchard get a second water tank?");
    ballotA = a.id;
    countA = a.count;
    rollA = await rollOf(ballotA);
    expect(rollA).toEqual(expect.arrayContaining([holder.id, cal.id]));
    expect(rollA.length).toBe(countA);

    const voted = await call("POST", `/api/governance/ballots/${ballotA}/vote`, { token: holder.token, body: { choice: "yes" } });
    expect(voted.status, `vote: ${JSON.stringify(voted.json)}`).toBe(200);
    // The control for the delegation case below: Cal's seat carries the holder's yes.
    expect(await votesOn(ballotA)).toEqual(
      expect.arrayContaining([
        { user_id: holder.id, choice: "yes", followed_user_id: null },
        { user_id: cal.id, choice: "yes", followed_user_id: holder.id },
      ]),
    );
  });

  it("resolve keeps them as a former member, says so, and names what they still hold", async () => {
    const resolved = await call("POST", `/api/admin/exits/${holderExit}/resolve`, { body: { agreementRef: "kept-2026-10" } });
    expect(resolved.status, `resolve: ${JSON.stringify(resolved.json)}`).toBe(200);
    expect(resolved.json?.outcome).toBe("former");
    expect(resolved.json?.vacatedRoles).toEqual(["treasury"]);
    const held = Object.fromEntries((resolved.json?.held ?? []).map((h: any) => [h.token, h.amount]));
    expect(held).toEqual({
      credits: fromLedgerUnits("credits", CREDIT_UNITS),
      [VILLAGE_VOICE]: fromLedgerUnits(VILLAGE_VOICE, VOICE_UNITS),
    });

    const row = await exitRecord(holderExit);
    expect(row?.status).toBe("resolved");
    expect(row?.agreementRef).toBe("kept-2026-10");
    expect(row?.userName, "the account is not a tombstone").toBe("Ash Holder");
    expect(String(row?.resolution ?? "")).toContain(
      `kept as a former member: still holds ${fromLedgerUnits("credits", CREDIT_UNITS)} credits, ${fromLedgerUnits(VILLAGE_VOICE, VOICE_UNITS)} ${VILLAGE_VOICE}`,
    );

    // The stewards still hear which role opened.
    const titles = ((await call("GET", "/api/notifications")).json?.notifications ?? []).map((n: any) => String(n.title));
    expect(titles).toContain("An opening in treasury (departure resolved)");
  });

  it("membership ends and the role is vacated; the name, the tier and the balances stay", async () => {
    const after = await player(holder.id);
    expect(after?.name).toBe("Ash Holder");
    expect(after?.membership).toBe(false);
    expect(after?.stageGranted).toBeNull();
    expect(after?.role).toBe("member");
    const state = await call("GET", `/api/admin/players/${holder.id}/exit-state`);
    expect(state.json?.states?.find((s: any) => s.domain === "roles")?.count).toBe(0);
    expect(await balanceOf(pool, memberAccount(holder.id), "credits")).toBe(CREDIT_UNITS);
    expect(await balanceOf(pool, memberAccount(holder.id), VILLAGE_VOICE)).toBe(VOICE_UNITS);
  });

  it("a former member can still sign in, read their wallet, and reach the claim door", async () => {
    // The session they held through the departure still works.
    expect((await call("GET", "/api/profile", { token: holder.token })).status).toBe(200);
    // And a fresh sign-in works, because nothing about the account was scrubbed.
    const login = await call("POST", "/api/auth/login", { token: null, body: { email: holder.email, password: PASSWORD } });
    expect(login.status, `login: ${JSON.stringify(login.json)}`).toBe(200);
    const fresh = String(login.json?.token ?? "");
    expect(fresh).toBeTruthy();

    const wallet = await call("GET", "/api/me/wallet", { token: fresh });
    expect(wallet.status).toBe(200);
    const rows = Object.fromEntries((wallet.json?.rows ?? []).map((r: any) => [r.token, r.heldUnits]));
    expect(rows.credits).toBe(CREDIT_UNITS);
    expect(rows[VILLAGE_VOICE]).toBe(VOICE_UNITS);

    // The claim door asks for a session and nothing about membership. In this
    // build it answers every account the same way, because the connection to
    // Hypha is not built yet (`BRIDGE_DISPATCH_BUILT`): a 503 before anything
    // is debited. The point measured here is that a former member meets THAT
    // answer and no refusal of their own.
    const claim = await call("POST", "/api/me/wallet/claim", { token: fresh, body: { token: VILLAGE_VOICE } });
    expect(claim.status, `claim: ${JSON.stringify(claim.json)}`).toBe(503);
    expect(String(claim.json?.error ?? "")).toContain("The connection to Hypha is still being finished");
    expect(await balanceOf(pool, memberAccount(holder.id), VILLAGE_VOICE)).toBe(VOICE_UNITS);
  });

  it("the vote they cast before leaving stands, a new one is refused in a sentence, and the roll it froze does not move", async () => {
    const changed = await call("POST", `/api/governance/ballots/${ballotA}/vote`, { token: holder.token, body: { choice: "no" } });
    expect(changed.status).toBe(409);
    expect(changed.json?.error).toBe(LEFT_THE_VILLAGE_VOTE);
    expect((await votesOn(ballotA)).find((v) => v.user_id === holder.id)).toEqual({ user_id: holder.id, choice: "yes", followed_user_id: null });
    expect(await rollOf(ballotA), "the frozen roll still counts them, so the quorum does not shift").toEqual(rollA);
    const seen = await call("GET", `/api/governance/ballots/${ballotA}`);
    expect(Number(seen.json?.electorateCount)).toBe(countA);
  });

  it("the member who handed them a voice gets it back, uncast, and is told", async () => {
    const [live] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT delegator_id FROM delegations WHERE (delegate_id = ? OR delegator_id = ?) AND revoked_at IS NULL",
      [holder.id, holder.id],
    );
    expect(live).toEqual([]);
    expect((await votesOn(ballotA)).some((v) => v.user_id === cal.id), "the copy of the holder's yes is no longer cast").toBe(false);
    const titles = ((await call("GET", "/api/notifications", { token: cal.token })).json?.notifications ?? []).map((n: any) => String(n.title));
    expect(titles).toContain(DELEGATE_LEFT_NOTICE.title);
  });

  it("whatever a badge grants, a former member is on no new roll, casts nothing, and starts no delegation", async () => {
    const made = await call("POST", "/api/admin/badges", { body: { name: "Elder Voice", kind: "granted", capabilities: ["ballot.vote"] } });
    expect(made.status, `badge: ${JSON.stringify(made.json)}`).toBe(200);
    const awarded = await call("POST", `/api/admin/badges/${String(made.json?.badge?.id ?? "")}/award`, { body: { userId: holder.id } });
    expect(awarded.status, `award: ${JSON.stringify(awarded.json)}`).toBe(200);
    // The control: the badge really does grant the vote, so only the departure can keep them off.
    const caps = await call("GET", `/api/admin/members/${holder.id}/capabilities`);
    expect((caps.json?.capabilities ?? []).find((c: any) => c.capability === "ballot.vote")?.held, JSON.stringify(caps.json)).toBe(true);

    await callOff(ballotA);
    const b = await ask("Should the orchard get a third water tank?");
    ballotB = b.id;
    const rollB = await rollOf(ballotB);
    expect(rollB, "a former member is off the new roll").not.toContain(holder.id);
    expect(rollB, "and the member still here is on it").toContain(cal.id);
    expect(rollB.length).toBe(b.count);

    const refused = await call("POST", `/api/governance/ballots/${ballotB}/vote`, { token: holder.token, body: { choice: "yes" } });
    expect(refused.json?.error).toBe(LEFT_THE_VILLAGE_VOTE);
    const give = await call("PUT", "/api/governance/delegation", { token: holder.token, body: { delegateId: cal.id } });
    expect(give.status).toBe(403);
    expect(give.json?.error).toBe("You have left the village, so there is no voice here to hand on now");
  });

  it("the delete screen's read lists what they hold, for themselves alone", async () => {
    const mine = await call("GET", "/api/me/holdings", { token: holder.token });
    expect(mine.status).toBe(200);
    expect(Object.fromEntries((mine.json?.held ?? []).map((h: any) => [h.token, h.amount]))).toEqual({
      credits: fromLedgerUnits("credits", CREDIT_UNITS),
      [VILLAGE_VOICE]: fromLedgerUnits(VILLAGE_VOICE, VOICE_UNITS),
    });
    expect(mine.json?.cash).toEqual([]);
    expect((await call("GET", "/api/me/holdings", { token: null })).status).toBe(401);
  });

  it("an admin can admit a former member again, through the door that admits anybody", async () => {
    const back = await call("PUT", `/api/admin/players/${holder.id}/stage`, { body: { stageId: "member" } });
    expect(back.status).toBe(200);
    expect(back.json?.stageComputed).toBe("member");
    expect((await player(holder.id))?.stageGranted).toBe("member");
  });

  it("admitted again, their Voice counts again: they are on the next roll and vote on it", async () => {
    await callOff(ballotB);
    const c = await ask("Should the orchard get a fourth water tank?");
    expect(await rollOf(c.id)).toContain(holder.id);
    const voted = await call("POST", `/api/governance/ballots/${c.id}/vote`, { token: holder.token, body: { choice: "yes" } });
    expect(voted.status, `vote: ${JSON.stringify(voted.json)}`).toBe(200);
    await callOff(c.id);
  });

  it("a member holding nothing of value is erased on resolve, exactly as before", async () => {
    empty = await register("Bay Empty", "bay-empty");
    const opened = await call("POST", "/api/profile/request-exit", { token: empty.token, body: { password: PASSWORD } });
    expect(opened.status, `request-exit: ${JSON.stringify(opened.json)}`).toBe(200);
    const exitId = String(opened.json?.exit?.id ?? "");
    // The control: the session works until the resolve.
    expect((await call("GET", "/api/profile", { token: empty.token })).status).toBe(200);

    const resolved = await call("POST", `/api/admin/exits/${exitId}/resolve`, {});
    expect(resolved.status, `resolve: ${JSON.stringify(resolved.json)}`).toBe(200);
    expect(resolved.json?.outcome).toBe("erased");
    expect(resolved.json?.held).toEqual([]);

    expect((await call("GET", "/api/profile", { token: empty.token })).status).toBe(401);
    const row = await exitRecord(exitId);
    expect(row?.status).toBe("resolved");
    expect(row?.userName).toBe("A departed member");
    expect(String(row?.resolution ?? "")).not.toContain("kept as a former member");
  });

  it("cash still owed keeps an account holding no tokens, and they can still sign in to see it marked paid", async () => {
    const dee = await register("Dee Owed", "dee-owed");
    // The record the quest consent writes (0285), written here because the door to it is another lane's.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO cash_owed (id, occurrence_key, user_id, work_kind, work_ref, work_title, amount_minor, currency) VALUES (?,?,?,?,?,?,?,?)",
      ["e2e-cash-1", `exit-levers:cash:${dee.id}`, dee.id, "quest", "q-fence", "Mend the fence", 2500, "USD"],
    );
    const opened = await call("POST", "/api/profile/request-exit", { token: dee.token, body: { password: PASSWORD } });
    expect(opened.status, `request-exit: ${JSON.stringify(opened.json)}`).toBe(200);
    const exitId = String(opened.json?.exit?.id ?? "");

    // The exit desk shows it, and it blocks nothing.
    const state = await call("GET", `/api/admin/players/${dee.id}/exit-state`);
    const cash = (state.json?.states ?? []).find((s: any) => s.domain === "cash");
    expect(cash, JSON.stringify(state.json)).toMatchObject({ count: 1, blocking: false });
    expect(String(cash?.description)).toContain("is owed $25.00 in cash");

    const resolved = await call("POST", `/api/admin/exits/${exitId}/resolve`, {});
    expect(resolved.status, `resolve: ${JSON.stringify(resolved.json)}`).toBe(200);
    expect(resolved.json?.outcome).toBe("former");
    expect(resolved.json?.held).toEqual([]);
    expect(resolved.json?.owed).toEqual([{ currency: "USD", amountMinor: 2500, rows: 1 }]);
    expect(String((await exitRecord(exitId))?.resolution ?? "")).toContain("kept as a former member: is owed $25.00 in cash");

    // E4 of the e2e sweep: the desk showed Dee like anyone else, offered Open exit, and a second exit opened (200).
    const after = await call("GET", `/api/admin/players/${dee.id}/exit-state`);
    expect(after.json?.formerMember, "the desk must say they already left").toBe(true);
    expect(after.json?.exit).toBeNull();
    const desk = await call("GET", "/api/admin/exits");
    expect((desk.json?.exits ?? []).find((e: any) => e.id === exitId)?.formerMember).toBe(true);
    const again = await call("POST", "/api/admin/exits", { body: { userId: dee.id, kind: "voluntary" } });
    expect(again.status, `a former member had a second exit opened: ${JSON.stringify(again.json)}`).toBe(409);
    expect(String(again.json?.error)).toMatch(/former member/);
    const own = await call("POST", "/api/profile/request-exit", { token: dee.token, body: { password: PASSWORD } });
    expect(own.status, "nor may they open one themselves").not.toBe(200);

    // Still an account: a fresh sign-in, the delete screen's read, and the payment seen.
    const login = await call("POST", "/api/auth/login", { token: null, body: { email: dee.email, password: PASSWORD } });
    expect(login.status, `login: ${JSON.stringify(login.json)}`).toBe(200);
    const fresh = String(login.json?.token ?? "");
    expect((await call("GET", "/api/me/holdings", { token: fresh })).json?.cash).toEqual([{ currency: "USD", amountMinor: 2500, rows: 1 }]);
    const paid = await call("POST", "/api/cash-owed/e2e-cash-1/paid", { body: { note: "Paid in cash at the Saturday market" } });
    expect(paid.status, `paid: ${JSON.stringify(paid.json)}`).toBe(200);
    const mine = await call("GET", "/api/me/cash-owed", { token: fresh });
    expect((mine.json?.entries ?? []).map((e: any) => [e.id, e.state])).toEqual([["e2e-cash-1", "paid"]]);
  });
});

describe.skipIf(!DB_CONFIGURED)("the exit cancel route, wired to cancelExit (round 2, finding 1)", () => {
  /** A living member with an open exit, opened through the admin's own door. */
  async function openFor(id: string): Promise<string> {
    await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, "Ned Okafor", `${id}@example.test`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const opened = await call("POST", "/api/admin/exits", { body: { userId: id, kind: "voluntary" } });
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    return String(opened.json.exit.id);
  }

  it("ends the deletion a stopped resolve began, and names what it had already removed", async () => {
    const id = `exitlevers-stayed-${PORT}`;
    const exitId = await openFor(id);
    // What a resolve that stopped at portraits leaves behind: open, failed, short of the close.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `member_erasures` (`user_id`, `attempts`, `last_attempt_at`, `steps_done`, `failed_step`, `last_error`) " +
        "VALUES (?, 1, CURRENT_TIMESTAMP, JSON_ARRAY('role-holdings', 'skill-tags'), 'portraits', 'could not take it off the volume')",
      [id],
    );

    const out = await call("POST", `/api/admin/exits/${exitId}/cancel`);
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect(out.json.alreadyRemoved).toEqual(["role-holdings", "skill-tags"]);
    const [left] = await pool.query<any[]>("SELECT `user_id` FROM `member_erasures` WHERE `user_id` = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(left, "the cancel left the deletion armed for the next Finish them").toEqual([]);
    expect((await call("POST", `/api/admin/exits/${exitId}/cancel`)).status).toBe(404);
  });

  it("refuses once the account is closed, and the exit stays open", async () => {
    const id = `exitlevers-closed-${PORT}`;
    const exitId = await openFor(id);
    // The sweep got past the close, and the status write after it never ran.
    await pool.query("UPDATE `users` SET `email` = ?, `name` = 'A departed member' WHERE `id` = ?", [`deleted-${id}@anonymized.invalid`, id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

    const out = await call("POST", `/api/admin/exits/${exitId}/cancel`);
    expect(out.status, JSON.stringify(out.json)).toBe(409);
    const [exit] = await pool.query<any[]>("SELECT `status` FROM `exits` WHERE `id` = ?", [exitId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(exit).toEqual([{ status: "open" }]);
  });
});
