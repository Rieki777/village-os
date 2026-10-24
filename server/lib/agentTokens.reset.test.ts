/**
 * Ending every agent token a member holds, and the rest of what a session can
 * leave standing for an agent, against a real schema (lane tokens-on-reset).
 *
 * A password set or reset and an admin's "revoke sessions" call
 * `revokeAllTokens` once the credential has changed. The route half is proven
 * in server/agent.routes.e2e.test.ts, over HTTP; this file pins the function
 * itself, because the questions worth asking are about which ROWS it touches:
 * only this member's, only the live ones, each one once, with the audit line
 * the single revoke writes. A fake pool would answer them by agreeing with
 * whatever SQL it was handed.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { endAgentReach, mintToken, revokeAllTokens, revokeToken, verifyToken, withAgentReachEnded } from "./agentTokens";
import { enqueueAgentDelivery, getInbox } from "./agentInbox";
import { mintFeedToken, resolveFeedToken } from "./icsFeed";
import { memberKeyView } from "./memberSecrets";
import { makeSetPasswordToken, readSetPasswordToken, setPasswordLinkRefusal } from "./memberTokens";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

const IVY = "usr-reset-ivy";
const JON = "usr-reset-jon";

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

async function mint(userId: string, name: string): Promise<{ token: string; id: string }> {
  const minted = await mintToken(pool, userId, { name, scopes: ["me.read"], ttlDays: 365 });
  if (!minted.ok) throw new Error(`mint refused: ${minted.error}`);
  return { token: minted.token, id: minted.row.id };
}

async function revokeLines(id: string): Promise<any[]> {
  return q("SELECT actor_user_id, actor_kind, audience FROM health_events WHERE kind = 'agent_token' AND entity_ref = ? AND text = ?", [
    id,
    `revoked agent token ${id}`,
  ]);
}

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 });
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("revokeAllTokens", () => {
  it("ends every live token the member holds, says how many, and leaves everyone else's standing", async () => {
    const laptop = await mint(IVY, "ivy laptop");
    const phone = await mint(IVY, "ivy phone");
    const bystander = await mint(JON, "jon laptop");

    // Already revoked: keeps its own revoke time and gets no second audit line.
    const old = await mint(IVY, "ivy old");
    expect(await revokeToken(pool, IVY, old.id)).toBe(true);
    await q("UPDATE agent_tokens SET revoked_at = '2026-01-02 03:04:05' WHERE id = ?", [old.id]);
    // Already expired: an expired token is dead, and the member's list keeps saying "expired".
    const lapsed = await mint(IVY, "ivy lapsed");
    await q("UPDATE agent_tokens SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE id = ?", [lapsed.id]);

    expect(await revokeAllTokens(pool, IVY)).toBe(2);

    for (const t of [laptop, phone]) {
      const verdict = await verifyToken(pool, t.token);
      expect(verdict.ok, `${t.id} still answers`).toBe(false);
      expect(verdict.ok ? null : verdict.reason).toBe("revoked");
      const lines = await revokeLines(t.id);
      expect(lines, `the audit line for ${t.id}`).toHaveLength(1);
      expect(lines[0]).toMatchObject({ actor_user_id: IVY, actor_kind: "agent", audience: "admin" });
    }

    expect((await verifyToken(pool, bystander.token)).ok, "another member's token was ended").toBe(true);
    expect(await revokeLines(bystander.id)).toHaveLength(0);

    const [oldRow] = await q("SELECT DATE_FORMAT(revoked_at, '%Y-%m-%d %H:%i:%s') AS at FROM agent_tokens WHERE id = ?", [old.id]);
    expect(oldRow.at, "an earlier revoke was rewritten").toBe("2026-01-02 03:04:05");
    expect(await revokeLines(old.id)).toHaveLength(1);

    const [lapsedRow] = await q("SELECT revoked_at FROM agent_tokens WHERE id = ?", [lapsed.id]);
    expect(lapsedRow.revoked_at, "an expired token was relabelled revoked").toBeNull();
    expect(await revokeLines(lapsed.id)).toHaveLength(0);
  });

  it("is safe to call again: a second run ends nothing and writes nothing", async () => {
    const before = await q("SELECT COUNT(*) AS n FROM health_events WHERE kind = 'agent_token'");
    expect(await revokeAllTokens(pool, IVY)).toBe(0);
    const after = await q("SELECT COUNT(*) AS n FROM health_events WHERE kind = 'agent_token'");
    expect(Number(after[0].n)).toBe(Number(before[0].n));
  });

  it("ends a member with no tokens at all without complaint", async () => {
    expect(await revokeAllTokens(pool, "usr-reset-nobody")).toBe(0);
  });
});

/*
 * THE REST OF THE REACH (adversarial round 1, findings 0 and 33). A stolen
 * session can leave four things standing for an agent, and a token is only
 * one of them. It can also mint a private calendar feed address, which never
 * expires; point the agent inbox at its own host, so the week ahead and the
 * weekly digest keep arriving there signed; and store a model key on its own
 * endpoint, so every question the member asks sends its prompt there. A new
 * password and an admin's revoke sessions end all four.
 */

/** Everything a signed-in session can plant for an agent, written the way the routes write it where that needs only the database. */
async function plantReach(userId: string): Promise<{ token: string; feed: string }> {
  const { token } = await mint(userId, `${userId} agent`);
  const feed = await mintFeedToken(pool, userId);
  // A plain row: setInbox resolves the host over DNS, and a database test does not reach the network.
  await q("INSERT INTO agent_inboxes (id, user_id, url, enabled) VALUES (?,?,?,1)", [`inb-${userId}`, userId, "https://attacker.example/hook"]);
  const queued = await enqueueAgentDelivery(pool, userId, { kind: "week_ahead", data: { note: "queued" } });
  expect(queued.ok, "the delivery must really be queued, or the zero below proves nothing").toBe(true);
  await q(
    "INSERT INTO member_llm_keys (user_id, provider, base_url, model, ciphertext, iv, tag, last4) VALUES (?,?,?,?,?,?,?,?)",
    [userId, "openai_compatible", "https://attacker.example", "m", "cipher", "iv", "tag", "abcd"],
  );
  return { token, feed };
}

/** Which of the four still stand for this member. */
async function standing(userId: string, planted: { token: string; feed: string }) {
  const [queued] = await q("SELECT COUNT(*) AS n FROM agent_deliveries WHERE inbox_id = ?", [`inb-${userId}`]);
  return {
    token: (await verifyToken(pool, planted.token)).ok,
    feed: (await resolveFeedToken(pool, planted.feed)) === userId,
    inbox: (await getInbox(pool, userId)) !== null,
    queued: Number(queued.n),
    key: (await memberKeyView(pool, userId)) !== null,
  };
}

const ALL_STANDING = { token: true, feed: true, inbox: true, queued: 1, key: true };
const NONE_STANDING = { token: false, feed: false, inbox: false, queued: 0, key: false };

/** A pool whose connections drop: the token revoke (a transaction) throws, and every plain query still answers. */
function droppingConnections(): mysql.Pool {
  return {
    query: pool.query.bind(pool),
    getConnection: () => Promise.reject(new Error("connection dropped")),
  } as unknown as mysql.Pool;
}

describe.skipIf(!configured)("endAgentReach", () => {
  it("ends the tokens, the private calendar feed, the inbox with its queue and the model key, and nobody else's", async () => {
    const mia = await plantReach("usr-reach-mia");
    const ned = await plantReach("usr-reach-ned");
    expect(await standing("usr-reach-mia", mia)).toEqual(ALL_STANDING);

    expect(await endAgentReach(pool, "usr-reach-mia")).toEqual({ agentTokens: 1, feeds: 1, inbox: true, key: true });

    expect(await standing("usr-reach-mia", mia), "something outlived the end of the agent's reach").toEqual(NONE_STANDING);
    expect(await standing("usr-reach-ned", ned), "another member's agent was ended").toEqual(ALL_STANDING);

    // The audit says the platform ended the inbox, the feed and the key. It never credits the member with pressing Remove.
    const lines = await q(
      "SELECT kind, text, actor_kind FROM health_events WHERE actor_user_id = ? AND kind IN ('agent_inbox','calendar_feed_revoked','agent_key') ORDER BY kind",
      ["usr-reach-mia"],
    );
    expect(lines.map((l) => l.kind)).toEqual(["agent_inbox", "agent_key", "calendar_feed_revoked"]);
    for (const l of lines) {
      expect(l.actor_kind, l.text).toBe("system");
      expect(l.text).toContain("a new password or a session revoke");
    }
  });

  it("is safe to call again: a second run ends nothing", async () => {
    expect(await endAgentReach(pool, "usr-reach-mia")).toEqual({ agentTokens: 0, feeds: 0, inbox: false, key: false });
    expect(await endAgentReach(pool, "usr-reach-nobody")).toEqual({ agentTokens: 0, feeds: 0, inbox: false, key: false });
  });

  it("still ends every other part when one throws, then names the part that did not end", async () => {
    const ola = await plantReach("usr-reach-ola");
    await expect(endAgentReach(droppingConnections(), "usr-reach-ola")).rejects.toMatchObject({
      name: "AgentReachNotEnded",
      parts: ["agent tokens"],
      ended: { agentTokens: 0, feeds: 1, inbox: true, key: true },
    });
    expect(await standing("usr-reach-ola", ola)).toEqual({ ...NONE_STANDING, token: true });
    // A second run on a healthy pool finishes it.
    expect(await endAgentReach(pool, "usr-reach-ola")).toEqual({ agentTokens: 1, feeds: 0, inbox: false, key: false });
    expect(await standing("usr-reach-ola", ola)).toEqual(NONE_STANDING);
  });
});

/*
 * THE ORDER (adversarial round 1, finding 28). The reset used to change the
 * password, which spends the link, and only then end the agent's reach. When
 * that end threw, the member was told to try again, the retry was refused as
 * a used link, and every token stood. `withAgentReachEnded` ends the reach
 * BEFORE the change too, so a failure there leaves the credential and the
 * link exactly as they were.
 */
describe.skipIf(!configured)("withAgentReachEnded", () => {
  const SIGNING = "agent-reset-test-secret"; // module-review-ok: a fixture signing secret for links this test reads back itself

  it("a failure before the change leaves the credential alone, so the same link finishes the reset", async () => {
    const pia = await plantReach("usr-reach-pia");
    // The member row's tokenVersion, which the link is bound to and the change bumps.
    let tokenVersion = 3;
    const claim = readSetPasswordToken(SIGNING, makeSetPasswordToken(SIGNING, "usr-reach-pia", tokenVersion));
    expect(claim).not.toBeNull();
    const change = async () => { tokenVersion += 1; return "set"; };

    await expect(withAgentReachEnded(droppingConnections(), "usr-reach-pia", change)).rejects.toMatchObject({ name: "AgentReachNotEnded" });
    expect(tokenVersion, "the credential changed although ending the agent failed").toBe(3);
    expect(setPasswordLinkRefusal(claim!, tokenVersion), "the link was spent by a reset that did not finish").toBeNull();

    const done = await withAgentReachEnded(pool, "usr-reach-pia", change);
    expect(done.changed).toBe("set");
    expect(done.ended.agentTokens).toBe(1);
    expect(tokenVersion).toBe(4);
    expect(setPasswordLinkRefusal(claim!, tokenVersion), "a finished reset spends its link").not.toBeNull();
    expect(await standing("usr-reach-pia", pia)).toEqual(NONE_STANDING);
  });

  it("ends again after the change, so a token minted between the two calls dies too", async () => {
    await plantReach("usr-reach-quy");
    let late = "";
    const { ended } = await withAgentReachEnded(pool, "usr-reach-quy", async () => {
      late = (await mint("usr-reach-quy", "minted while the password changed")).token;
    });
    expect(ended.agentTokens, "both tokens, one from each side of the change").toBe(2);
    const verdict = await verifyToken(pool, late);
    expect(verdict.ok ? null : verdict.reason, "a token minted during the change outlived it").toBe("revoked");
  });

  it("after the change it never throws: it tries again, and a second failure is logged and recorded for an admin", async () => {
    const change = async () => "set";
    let calls = 0;
    const flakyOnce = async (p: mysql.Pool, id: string) => {
      calls += 1;
      if (calls === 2) throw new Error("connection dropped");
      return endAgentReach(p, id);
    };
    const logged: string[] = [];
    const once = await withAgentReachEnded(pool, "usr-reach-ray", change, { end: flakyOnce, log: (m) => logged.push(m) });
    expect(once.changed).toBe("set");
    expect(calls, "the failed end after the change was not tried again").toBe(3);
    expect(logged).toEqual([]);

    calls = 0;
    const failsAfter = async (p: mysql.Pool, id: string) => {
      calls += 1;
      if (calls > 1) throw new Error("connection dropped");
      return endAgentReach(p, id);
    };
    const twice = await withAgentReachEnded(pool, "usr-reach-ray", change, { end: failsAfter, log: (m) => logged.push(m) });
    expect(twice.changed, "the change landed, so the caller still answers success").toBe("set");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("usr-reach-ray");
    const reported = await q("SELECT audience, actor_kind FROM health_events WHERE kind = 'agent_reach' AND entity_ref = ?", ["usr-reach-ray"]);
    expect(reported, "an admin cannot see that the end after a credential change failed").toEqual([{ audience: "admin", actor_kind: "system" }]);
  });
});
