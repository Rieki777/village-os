/**
 * WHAT THE SOLO-FOUNDER WINDOW RECORDS, AND WHEN.
 *
 * No self-consent is the witness rule, and `quest.self_consent_until_members`
 * is its one exception: while the village is smaller than that, an admin may
 * consent to their own claim. `shared/constitution.ts` states the exception and
 * promises that "every such use is recorded", and the audit row
 * `quest:self-consent:solo-founder:<claim>` is the whole of that record. There
 * is no other trace: the /api/admin middleware attributes the request to an
 * admin without naming the rule that let it through.
 *
 * THE DEFECT THIS PINS. The row was written the moment the window was found
 * open, which is a whole decline branch and five refusals before anything
 * happens. So the record of the exception said a founder had witnessed their
 * own claim when the founder had DECLINED it, when the dials refused the
 * amount, when they were a steward the window was never open to, and when
 * another steward had already resolved the claim. A record of uses that did not
 * happen is worse than no record, because somebody auditing it cannot tell
 * which of the rows means anything.
 *
 * WHY THE NEGATIVE CASES END WITH A CONSENT THAT DOES RECORD. `recordEvent` is
 * fire-and-forget, so a row that was never written looks exactly like a row
 * that has not landed yet. Each refusal is followed by a consent that MUST
 * record, and the count is read once that one has arrived.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL and the suite skips loudly.
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { recordGameStart } from "../lib/gameStart";
import { loadTokenRegistry } from "../lib/ledger";
import { claimsRepo, questsRepo, type ClaimsRepo, type QuestsRepo } from "../repos/quests";
import { register } from "./questClaims";

const ctl = vi.hoisted(() => ({
  /** What the consent gate answers. A founder here, a steward when the test says so. */
  actor: { ok: true, userId: "u-hana", isAdminActor: true } as any,
  /** Who counts toward the solo-founder window. Empty is a founder building alone. */
  living: [] as any[],
}));

// The badges module's lifecycle is the one seam this file mocks: off means the
// reward multiplier is never asked. What a consent MOVES is not this file's
// subject, and everything else here is real: the claims repository and its row
// lock, the ledger, and the launch fact that opens issuance.
vi.mock("../lib/modules", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    effectiveLifecycle: (id: string) => (id === "badges" ? "off" : actual.effectiveLifecycle(id)),
  };
});

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[questSelfConsentAudit.test] TEST_DATABASE_URL not set, so this suite is SKIPPED.");
}

/** The founder, who is both the member doing the work and the actor consenting. */
const FOUNDER = { id: "u-hana", name: "Hana Ito" };

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let claims: ClaimsRepo;
let quests: QuestsRepo;

const consent = async (claimId: string, body: unknown) => {
  const r = await fetch(`${base}/api/admin/quest-claims/${claimId}/consent`, { // module-review-ok: the suite's own in-process server on 127.0.0.1, never an outbound call, so there is no correlation id to carry
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

/** A quest, and the founder's own submitted claim on it. Answers the claim id. */
const ownClaim = async (key: string, label = "50-100") => {
  const questId = `q-${key}`;
  const claimId = `claim-${key}`;
  await quests.add({ id: questId, title: `Quest ${key}`, gratitude: label, status: "Open", tags: [], order: 1 });
  await claims.add({
    id: claimId,
    questId,
    questTitle: `Quest ${key}`,
    userId: FOUNDER.id,
    userName: FOUNDER.name,
    status: "submitted",
    claimedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    artifactUrl: "",
    note: "Done.",
  });
  return claimId;
};

/** Every solo-founder row in the audit trail. */
const windowRows = async () => {
  const [rows]: any = await pool.query( // module-review-ok: reading back what the route recorded, on the S5 scratch schema this suite provisioned
    "SELECT text, entity_ref, actor_user_id, audience FROM health_events WHERE text LIKE 'quest:self-consent:solo-founder:%'",
  );
  return rows as Array<{ text: string; entity_ref: string; actor_user_id: string; audience: string }>;
};

/** A void write has to be waited for, and a deadline is the honest way to wait. */
const rowsOnceThereAre = async (n: number, ms = 5000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const rows = await windowRows();
    if (rows.length >= n || Date.now() > deadline) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
};

const refs = (rows: Array<{ entity_ref: string }>) => rows.map((r) => r.entity_ref).sort();

describe.skipIf(!configured)("what the solo-founder window records (MySQL)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await loadTokenRegistry(pool);
    // Issuance waits for the launch vote, and this village has cast it, so a
    // consent gets as far as the ledger.
    await recordGameStart(pool, { ballotId: "ballot-test", startedBy: FOUNDER.id, note: "test village" });
    claims = claimsRepo(pool);
    quests = questsRepo(pool);

    const app = express();
    app.use(express.json());
    register(app, {
      isAdmin: async () => true,
      authedUser: async () => FOUNDER,
      mayStillSee: async () => true,
      consentActor: async () => ctl.actor,
      getPool: () => pool,
      members: {
        all: async () => ctl.living,
        byId: async (id: string) => (id === FOUNDER.id ? { ...FOUNDER } : null),
        update: async (_id: string, fn: (u: any) => void) => {
          const u: any = { ...FOUNDER };
          fn(u);
          return u;
        },
      },
      claimsRepo: claims,
      questsRepo: quests,
      firstName: (n: string) => String(n).split(" ")[0],
      notify: async () => {},
      notifyAdmins: async () => {},
      stageOf: async () => "member",
      recordStageEvent: async () => {},
      addActivity: async () => {},
      dormantBadgeIds: async () => [],
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    ctl.actor = { ok: true, userId: FOUNDER.id, isAdminActor: true };
    ctl.living = [];
  });

  it("records one row, naming the claim, when the founder's own consent lands", async () => {
    const id = await ownClaim("landed");
    expect((await consent(id, { approve: true, amount: 60 })).status).toBe(200);

    const rows = await rowsOnceThereAre(1);
    expect(refs(rows)).toEqual([id]);
    expect(rows[0]!.text).toBe(`quest:self-consent:solo-founder:${id}`);
    expect(rows[0]!.actor_user_id).toBe(FOUNDER.id);
    // The village's history is public; this row is for the admin trail.
    expect(rows[0]!.audience).toBe("admin");
  });

  it("records nothing for a decline, a refused amount, a steward, or a claim already resolved", async () => {
    const before = refs(await windowRows());

    // A founder handing back their own stale claim. Nothing is witnessed and
    // nothing is paid, and this wrote a self-consent row until now.
    const declined = await ownClaim("declined");
    expect((await consent(declined, { approve: false })).status).toBe(200);

    // An amount the dials refuse. The claim is untouched.
    const refusedAmount = await ownClaim("refused-amount");
    expect((await consent(refusedAmount, { approve: true, amount: 0 })).status).toBe(400);

    // Role authority is not founder authority, however small the village is.
    const forSteward = await ownClaim("steward");
    ctl.actor = { ok: true, userId: FOUNDER.id, isAdminActor: false };
    expect((await consent(forSteward, { approve: true, amount: 60 })).status).toBe(403);
    ctl.actor = { ok: true, userId: FOUNDER.id, isAdminActor: true };

    // THE KNOWN POSITIVE, arriving after all three. A row nobody wrote and a
    // row still in flight look identical, so the count means nothing until a
    // consent that must record has landed.
    const landed = await ownClaim("known-positive");
    expect((await consent(landed, { approve: true, amount: 60 })).status).toBe(200);
    const rows = await rowsOnceThereAre(before.length + 1);
    expect(refs(rows)).toEqual([...before, landed].sort());

    // And the second press on work already witnessed, which is refused under
    // the claim's own row lock and must leave the record where it was.
    expect((await consent(landed, { approve: true, amount: 60 })).status).toBe(409);
    await new Promise((r) => setTimeout(r, 250));
    expect(refs(await windowRows())).toEqual([...before, landed].sort());
  });
});
