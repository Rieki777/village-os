/**
 * GET /api/governance/voice-spread, against a real schema.
 *
 * What is pinned:
 *   - THE ONE THIS EXISTS FOR: the spread is measured over the roll, Voice
 *     held anywhere else (a system account, a member off the roll) is not in
 *     it, and no member's id, name or amount is anywhere in the answer.
 *   - A stranger reads it only while the village shows its people
 *     (`org.public_people`); otherwise 401.
 *   - Ballots: withdrawn ballots are not counted, a vetoed pass is
 *     not a pass, turnout is the average share of the roll that voted, and the
 *     season's first day bounds the count.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { register, type VoiceSpreadDeps } from "./voiceSpread";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(deps: VoiceSpreadDeps): Handler {
  const handlers = new Map<string, Handler>();
  register({ get: (path: string, h: Handler) => handlers.set(path, h) } as any, deps);
  return handlers.get("/api/governance/voice-spread")!;
}

async function call(deps: VoiceSpreadDeps) {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  await collect(deps)({}, res);
  return out;
}

// Twelve voters on the roll. Two hold 400 Voice each, four hold 50, six hold none.
const ROLL = Array.from({ length: 12 }, (_, i) => `u-v${String(i).padStart(2, "0")}`);
const HELD: Record<string, number> = { "u-v00": 400, "u-v01": 400, "u-v02": 50, "u-v03": 50, "u-v04": 50, "u-v05": 50 };

function deps(over: Partial<VoiceSpreadDeps> = {}): VoiceSpreadDeps {
  return {
    authedUser: async () => ({ id: "u-v00" }),
    getPool: () => pool,
    electorate: async () => ROLL,
    weightModeNow: () => ({ mode: "token", token: "village-voice" }),
    seasonStartsOn: () => "2026-10-01",
    quorumPct: () => 20,
    peopleArePublic: () => false,
    ...over,
  };
}

let n = 0;
async function ballot(opts: { status: string; opensAt: string; roll: number; voters: number; vetoed?: boolean }) {
  n += 1;
  const id = `b-spread-${n}`;
  await pool.query(
    // module-review-ok: a fixture ballot row on the scratch schema; the route under test only reads ballots
    "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, weight_mode, weight_token, unity_pct, quorum_pct, total_weight, electorate_count, opened_by, opens_at, closes_at, status, vetoed_at) VALUES (?, 'mechanics', ?, ?, 'A vote', '', 'majority', 'equal', NULL, 50, 20, ?, ?, 'u-v00', ?, ?, ?, ?)",
    [id, id, `mechanics:${id}`, opts.roll, opts.roll, opts.opensAt, opts.opensAt, opts.status, opts.vetoed ? opts.opensAt : null],
  );
  for (let i = 0; i < opts.voters; i += 1) {
    // module-review-ok: fixture votes on the scratch schema
    await pool.query("INSERT INTO ballot_votes (ballot_id, user_id, choice) VALUES (?, ?, 'yes')", [id, ROLL[i]]);
  }
}

describe.skipIf(!configured)("GET /api/governance/voice-spread", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db);
    for (const [id, amount] of Object.entries(HELD)) {
      // module-review-ok: fixture balances in the token_balances cache on the scratch schema
      await pool.query("INSERT INTO token_balances (account_id, token_type, balance) VALUES (?, 'village-voice', ?)", [`mem:${id}`, amount * 100]);
    }
    // Voice outside the roll: a system account and a member who cannot vote. Neither is in the spread.
    // module-review-ok: fixture balances on the scratch schema
    await pool.query("INSERT INTO token_balances (account_id, token_type, balance) VALUES ('sys:voice-decay', 'village-voice', 99999900), ('mem:u-off-roll', 'village-voice', 99999900)");
    await ballot({ status: "passed", opensAt: "2026-10-05 10:00:00", roll: 12, voters: 6 });
    await ballot({ status: "failed", opensAt: "2026-10-06 10:00:00", roll: 12, voters: 3 });
    await ballot({ status: "passed", opensAt: "2026-10-07 10:00:00", roll: 12, voters: 12, vetoed: true });
    await ballot({ status: "open", opensAt: "2026-10-08 10:00:00", roll: 12, voters: 2 });
    // Not counted: withdrawn, and one from before the season.
    await ballot({ status: "withdrawn", opensAt: "2026-10-09 10:00:00", roll: 12, voters: 1 });
    await ballot({ status: "passed", opensAt: "2026-09-01 10:00:00", roll: 12, voters: 12 });
  }, 240_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("THE ONE THIS EXISTS FOR: the spread is the roll's, and names nobody", async () => {
    const r = await call(deps());
    expect(r.status).toBe(200);
    // Total on the roll 1000. Top 25% (3 voters) hold 850; top 50% (6) hold 1000. Top 10% is 1 voter: withheld.
    expect(r.body.spread).toEqual({
      voters: 12,
      anyVoice: true,
      bands: [
        { topPct: 25, sharePct: 85 },
        { topPct: 50, sharePct: 100 },
      ],
      withheld: true,
      evenness: "concentrated",
    });
    const text = JSON.stringify(r.body);
    for (const id of [...ROLL, "u-off-roll", "sys:voice-decay"]) expect(text, id).not.toContain(id);
    expect(text).not.toContain("40000");
    expect(r.body.weightedByVoice).toBe(true);
    expect(r.body.quorumPct).toBe(20);
  });

  it("counts this season's village votes: a vetoed pass is not a pass, and turnout is the roll's average share", async () => {
    const r = await call(deps());
    // Counted: passed (6/12), failed (3/12), vetoed pass (12/12), open. Closed = 3, passed = 1.
    expect(r.body.ballots).toEqual({ since: "2026-10-01", run: 4, closed: 3, passed: 1, turnoutPct: Math.round(((0.5 + 0.25 + 1) / 3) * 100) });
  });

  it("with no season running, counts every village vote", async () => {
    const r = await call(deps({ seasonStartsOn: () => null }));
    expect(r.body.ballots.since).toBeNull();
    expect(r.body.ballots.run).toBe(5);
  });

  it("says so when votes are not weighted by Voice", async () => {
    const r = await call(deps({ weightModeNow: () => ({ mode: "equal", token: null }) }));
    expect(r.body.weightedByVoice).toBe(false);
  });

  it("a stranger reads it only while the village shows its people", async () => {
    const hidden = await call(deps({ authedUser: async () => null, peopleArePublic: () => false }));
    expect(hidden).toEqual({ status: 401, body: { error: "auth_required" } });
    const shown = await call(deps({ authedUser: async () => null, peopleArePublic: () => true }));
    expect(shown.status).toBe(200);
    expect(shown.body.spread.voters).toBe(12);
  });

  it("a village with nobody holding Voice draws no spread, and does not fail", async () => {
    const r = await call(deps({ electorate: async () => ["u-v06", "u-v07", "u-v08", "u-v09", "u-v10", "u-v11"] }));
    expect(r.status).toBe(200);
    expect(r.body.spread).toEqual({ voters: 6, anyVoice: false, bands: [], withheld: false, evenness: null });
  });
});
