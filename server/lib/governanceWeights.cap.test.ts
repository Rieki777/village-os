/**
 * THE CAP ON ONE MEMBER'S VOTING WEIGHT, proven on a frozen roll.
 *
 * Rye, 2026-11-05: the cap is "built as an option, OFF by default". In token
 * mode a member weighs their raw balance of the weight token, and quorum is a
 * share of the weight frozen when a ballot opens, so one large holder can meet
 * quorum alone or carry a vote. The cap limits how much of the VOTE any one
 * member carries (a share of the frozen total, which quorum reads), and only
 * when a founder switches it on.
 *
 * The roll every case freezes: one member holds 90 Village Voice and four hold
 * 2.5 each, 100 between them. Village Voice keeps hundredths and a weight is
 * read in the ledger's minor units, so those are balances of 9000 and 250 and
 * an uncapped total of 10000. The proportions are the brief's exactly.
 *
 * Each case freezes the roll the way `buildElectorate` does (server/index.ts):
 * `weightModeNow` reads the dials, `rollWeightsFor` resolves the whole roll,
 * and `openBallot` writes it to `ballot_electorate`. The assertions read the
 * frozen rows back, because the frozen row is what quorum and every tally read.
 *
 * No TEST_DATABASE_URL: the DB cases skip loudly, never pass hollowly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { VILLAGE_VOICE, villageId } from "./economy";
import { seedEconomy } from "./economySeed";
import { loadTokenRegistry, memberAccount } from "./ledger";
import { loadVariables, setVariable } from "./variables";
import { openBallot } from "./ballots";
import {
  WEIGHT_CAP_ON_KEY,
  WEIGHT_CAP_PCT_KEY,
  rollWeightsFor,
  weightCapLine,
  weightModeNow,
} from "./governanceWeights";
import { VARIABLES_BY_KEY, criticalityOf, ringOf } from "../../shared/gameVariables";

const configured = testDbConfigured();

const BIG = "u-cap-big";
const SMALL = ["u-cap-s1", "u-cap-s2", "u-cap-s3", "u-cap-s4"];
const ROLL = [BIG, ...SMALL];
const HELD: Record<string, number> = { [BIG]: 9000, ...Object.fromEntries(SMALL.map((id) => [id, 250])) };
const UNCAPPED_TOTAL = 10000;

describe("the switch and the cap, as the registry ships them", () => {
  it("ships the switch OFF, held by the founders at the weight mode's bar", () => {
    const on = VARIABLES_BY_KEY[WEIGHT_CAP_ON_KEY];
    expect(on, `${WEIGHT_CAP_ON_KEY} must exist`).toBeTruthy();
    expect(on!.type).toBe("boolean");
    expect(on!.default).toBe("false");
    const mode = VARIABLES_BY_KEY["governance.weight_mode"]!;
    expect(ringOf(on!)).toBe(ringOf(mode));
    expect(criticalityOf(on!)).toBe(criticalityOf(mode));
  });

  it("ships the cap at 20 and refuses 0, because OFF is the switch and never a zero percent", () => {
    const pct = VARIABLES_BY_KEY[WEIGHT_CAP_PCT_KEY];
    expect(pct, `${WEIGHT_CAP_PCT_KEY} must exist`).toBeTruthy();
    expect(pct!.type).toBe("percentage");
    expect(pct!.default).toBe("20");
    expect(pct!.min).toBeGreaterThan(0);
    expect(pct!.max).toBe(100);
    expect(ringOf(pct!)).toBe("founder");
    expect(criticalityOf(pct!)).toBe("constitutional");
  });

  it("says the cap is a share of the vote, and where everyone weighs the same, only while it is on in token mode", () => {
    const line = weightCapLine({ mode: "token", token: VILLAGE_VOICE, capPct: 20 }) ?? "";
    expect(line).toContain("more than 20% of the vote");
    expect(line).toContain("fewer than 5 members holding weight, everyone weighs the same");
    expect(weightCapLine({ mode: "token", token: VILLAGE_VOICE, capPct: 30 })).toContain("fewer than 4 members");
    expect(weightCapLine({ mode: "token", token: VILLAGE_VOICE, capPct: null })).toBeNull();
    expect(weightCapLine({ mode: "token", token: VILLAGE_VOICE })).toBeNull();
    expect(weightCapLine({ mode: "equal", token: null, capPct: 20 })).toBeNull();
  });
});

describe.skipIf(!configured)("the cap on a frozen roll (MySQL)", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let n = 0;

  /** Freeze the roll as the next ballot would, and read the frozen rows back. */
  async function freeze(): Promise<{ total: number; frozen: Map<string, number> }> {
    const snapshot = weightModeNow();
    const weights = await rollWeightsFor(pool, ROLL, snapshot);
    const opened = await openBallot(pool, {
      subjectType: "mechanics",
      subjectRef: `cap-test-${++n}`,
      title: `Cap ballot ${n}`,
      docMarkdown: "# The document as checked",
      method: "custom",
      weightMode: snapshot.mode,
      weightToken: snapshot.token,
      unityPct: 80,
      quorumPct: 20,
      durationDays: 7,
      openedBy: "u-proposer",
      electorate: ROLL.map((userId) => ({ userId, weight: weights.get(userId) ?? 0 })),
    });
    expect(opened.ok, opened.ok ? "" : opened.error).toBe(true);
    if (!opened.ok) throw new Error(opened.error);
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT user_id, weight FROM ballot_electorate WHERE ballot_id = ?",
      [opened.ballot.id],
    );
    return {
      total: opened.ballot.totalWeight,
      frozen: new Map(rows.map((r) => [String(r.user_id), Number(r.weight)])),
    };
  }

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
    await loadVariables(pool);
    await seedEconomy(pool, villageId());
    await loadTokenRegistry(pool);
    for (const id of ROLL) {
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "INSERT INTO token_balances (account_id, token_type, balance) VALUES (?,?,?) " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "ON DUPLICATE KEY UPDATE balance = VALUES(balance)",
        [memberAccount(id), VILLAGE_VOICE, HELD[id]],
      );
    }
    expect((await setVariable(pool, "governance.weight_mode", "token")).ok).toBe(true);
    expect((await setVariable(pool, "governance.weight_token", VILLAGE_VOICE)).ok).toBe(true);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("with the switch at its default, freezes every raw balance, uncapped", async () => {
    expect(weightModeNow().capPct ?? null).toBeNull();
    const { total, frozen } = await freeze();
    for (const id of ROLL) expect(frozen.get(id), id).toBe(HELD[id]);
    expect(total).toBe(UNCAPPED_TOTAL);
  });

  it("with the cap on at 20, each of the five weighs exactly 20% of the frozen total", async () => {
    expect((await setVariable(pool, WEIGHT_CAP_ON_KEY, "true")).ok).toBe(true);
    expect((await setVariable(pool, WEIGHT_CAP_PCT_KEY, "20")).ok).toBe(true);
    try {
      const { total, frozen } = await freeze();
      // The frozen total is what quorum and unity read, so the share of the
      // VOTE is a share of it. Five holders at 20 is exactly one fifth each.
      for (const id of ROLL) {
        expect(frozen.get(id)! * 5, `${id} carries ${frozen.get(id)} of ${total}`).toBe(total);
      }
      // Nobody under the cap moves: the four smaller holders keep 250 each.
      for (const id of SMALL) expect(frozen.get(id), id).toBe(250);
      expect(total).toBe(1250);
    } finally {
      await setVariable(pool, WEIGHT_CAP_ON_KEY, "false");
    }
  });

  it("with the switch off again, the same roll freezes exactly as it did uncapped", async () => {
    // The percentage stays at 20 and does nothing while the switch is off.
    expect((await setVariable(pool, WEIGHT_CAP_PCT_KEY, "20")).ok).toBe(true);
    const { total, frozen } = await freeze();
    for (const id of ROLL) expect(frozen.get(id), id).toBe(HELD[id]);
    expect(total).toBe(UNCAPPED_TOTAL);
  });

  it("in equal mode the switch changes nothing: every member still weighs one", async () => {
    // 10 and not 20: five equal members each hold exactly 20% already, so a
    // cap of 20 applied by mistake in equal mode would trim nobody and this
    // case could not tell. At 10 a misapplied cap would freeze 0.5 each.
    expect((await setVariable(pool, "governance.weight_mode", "equal")).ok).toBe(true);
    expect((await setVariable(pool, WEIGHT_CAP_ON_KEY, "true")).ok).toBe(true);
    expect((await setVariable(pool, WEIGHT_CAP_PCT_KEY, "10")).ok).toBe(true);
    try {
      const { total, frozen } = await freeze();
      for (const id of ROLL) expect(frozen.get(id), id).toBe(1);
      expect(total).toBe(ROLL.length);
    } finally {
      await setVariable(pool, WEIGHT_CAP_PCT_KEY, "20");
      await setVariable(pool, WEIGHT_CAP_ON_KEY, "false");
      await setVariable(pool, "governance.weight_mode", "token");
    }
  });
});
