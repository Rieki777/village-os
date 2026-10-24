/**
 * The agent inbox (round 4, lane L6): the signature both ways, the derived
 * secret, and the drain's retry, drop and disable arithmetic against a fake
 * pool. Nothing here dials the network; `post` is injected.
 */
import { describe, expect, it } from "vitest";
import {
  DISABLE_AFTER_FAILURES,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  SIGNATURE_HEADER,
  buildDelivery,
  drainDeliveries,
  enqueueAgentDelivery,
  inboxSecret,
  setInbox,
  verifyDelivery,
} from "./agentInbox";
import { MEMBER_SECRETS_ENV, NO_MEMBER_SECRETS_KEY_SENTENCE } from "./memberSecrets";

const ENV = { [MEMBER_SECRETS_ENV]: "ab".repeat(32) } as NodeJS.ProcessEnv;

describe("the derived secret", () => {
  it("is HMAC of the inbox id under the member-secrets key, and absent without it", () => {
    const a = inboxSecret("inb-1", ENV);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(inboxSecret("inb-1", ENV)).toBe(a);
    expect(inboxSecret("inb-2", ENV)).not.toBe(a);
    expect(inboxSecret("inb-1", {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("refuses to set an inbox with no member-secrets key, before any network", async () => {
    let touched = 0;
    const pool = { query: async () => { touched += 1; return [[]]; } } as any;
    const r = await setInbox(pool, "u-1", "https://example.com/hook", {} as NodeJS.ProcessEnv);
    expect(r).toEqual({ ok: false, status: 503, error: NO_MEMBER_SECRETS_KEY_SENTENCE });
    expect(touched).toBe(0);
  });

  it("refuses http and private targets", async () => {
    const pool = { query: async () => [[]] } as any;
    expect((await setInbox(pool, "u-1", "http://example.com/hook", ENV)).ok).toBe(false);
    expect((await setInbox(pool, "u-1", "https://127.0.0.1/hook", ENV)).ok).toBe(false);
    expect((await setInbox(pool, "u-1", "https://169.254.169.254/latest", ENV)).ok).toBe(false);
  });
});

describe("the signature", () => {
  const secret = "s".repeat(64);
  const env = { id: "dlv-1", kind: "test" as const, sentAt: "2026-08-16T12:00:00.000Z", data: { hello: "agent" } };

  it("signs sentAt.rawBody and puts the same value in the header and the body", () => {
    const wire = buildDelivery(secret, env);
    expect(wire.rawBody).toBe('{"id":"dlv-1","kind":"test","sentAt":"2026-08-16T12:00:00.000Z","data":{"hello":"agent"}}');
    expect(wire.header).toBe(`t=${env.sentAt},v1=${wire.body.signature}`);
    expect(verifyDelivery(secret, wire.body, wire.header)).toBe(true);
    expect(verifyDelivery(secret, wire.body, null)).toBe(true);
  });

  it("fails on a changed byte, a wrong secret, or a replayed timestamp", () => {
    const wire = buildDelivery(secret, env);
    expect(verifyDelivery(secret, { ...wire.body, data: { hello: "someone else" } }, null)).toBe(false);
    expect(verifyDelivery("t".repeat(64), wire.body, wire.header)).toBe(false);
    expect(verifyDelivery(secret, { ...wire.body, sentAt: "2026-08-17T12:00:00.000Z" }, null)).toBe(false);
    expect(verifyDelivery(secret, wire.body, "t=x,v1=00")).toBe(false);
  });
});

/**
 * A pool that holds one inbox and its deliveries in memory and answers the
 * exact SQL the drain issues. Fake on purpose: the arithmetic is what is under
 * test, and a real schema would test the driver.
 */
function drainPool(opts: { failures?: number; deliveries: { id: string; attempts: number; kind?: string }[] }) {
  const inbox: any = { id: "inb-1", user_id: "u-1", url: "https://hook.example/agent", enabled: 1, consecutive_failures: opts.failures ?? 0, disabled_reason: null, last_status: null };
  const rows: any[] = opts.deliveries.map((d) => ({ id: d.id, inbox_id: "inb-1", kind: d.kind ?? "test", payload: '{"n":1}', attempts: d.attempts, next_attempt_at: new Date(0), delivered_at: null, dropped_at: null, last_error: null, created_at: new Date(0) }));
  const pool = {
    query: async (sql: string, args: any[] = []) => {
      if (/^SELECT d\.\*/.test(sql)) {
        return [rows.filter((r) => !r.delivered_at && !r.dropped_at).map((r) => ({ ...r, inbox_url: inbox.url, inbox_user_id: inbox.user_id, inbox_enabled: inbox.enabled, inbox_failures: inbox.consecutive_failures }))];
      }
      if (/^SELECT \* FROM agent_inboxes WHERE user_id/.test(sql)) return [[inbox]];
      // The holder read (`holderListens`): a living member. A tombstone or a
      // missing holder is asserted against a real schema, in
      // server/lib/erasure.agentResume.test.ts.
      if (/ FROM users WHERE id = \?$/.test(sql)) return [[{ id: args[0], email: `${args[0]}@example.test` }]];
      if (/^UPDATE agent_deliveries SET attempts = attempts \+ 1/.test(sql)) {
        const r = rows.find((x) => x.id === args[0]);
        if (!r || r.attempts !== args[1]) return [{ affectedRows: 0 }];
        r.attempts += 1; return [{ affectedRows: 1 }];
      }
      if (/^UPDATE agent_deliveries SET delivered_at/.test(sql)) { rows.find((x) => x.id === args[1]).delivered_at = args[0]; return [{ affectedRows: 1 }]; }
      if (/^UPDATE agent_deliveries SET dropped_at/.test(sql)) { const r = rows.find((x) => x.id === args[args.length - 1]); r.dropped_at = args[0]; r.last_error = args[1] ?? "inbox disabled"; return [{ affectedRows: 1 }]; }
      if (/^UPDATE agent_deliveries SET next_attempt_at/.test(sql)) { const r = rows.find((x) => x.id === args[2]); r.next_attempt_at = args[0]; r.last_error = args[1]; return [{ affectedRows: 1 }]; }
      if (/^UPDATE agent_inboxes SET consecutive_failures = 0/.test(sql)) { inbox.consecutive_failures = 0; inbox.last_status = "delivered"; return [{ affectedRows: 1 }]; }
      if (/^UPDATE agent_inboxes SET enabled = 0/.test(sql)) { inbox.enabled = 0; inbox.consecutive_failures = args[0]; inbox.disabled_reason = args[1]; inbox.last_status = args[2]; return [{ affectedRows: 1 }]; }
      if (/^UPDATE agent_inboxes SET consecutive_failures = \?/.test(sql)) { inbox.consecutive_failures = args[0]; inbox.last_status = args[1]; return [{ affectedRows: 1 }]; }
      if (/^INSERT INTO agent_deliveries/.test(sql)) { rows.push({ id: args[0], inbox_id: args[1], kind: args[2], payload: args[3], attempts: 0, next_attempt_at: new Date(0), delivered_at: null, dropped_at: null, last_error: null, created_at: new Date() }); return [{ affectedRows: 1 }]; }
      throw new Error(`unexpected sql: ${sql}`);
    },
  } as any;
  return { pool, inbox, rows };
}

describe("the drain", () => {
  it("sends a due row through post with the signature header, and resets the failure count", async () => {
    const { pool, inbox, rows } = drainPool({ failures: 3, deliveries: [{ id: "dlv-1", attempts: 0 }] });
    const posts: any[] = [];
    const s = await drainDeliveries(pool, { post: async (url, body, headers) => { posts.push({ url, body, headers }); return null; }, notifyDisabled: async () => {}, env: ENV });
    expect(s).toEqual({ sent: 1, failed: 0, dropped: 0, disabled: 0 });
    expect(posts[0].url).toBe("https://hook.example/agent");
    expect(posts[0].headers[SIGNATURE_HEADER]).toMatch(/^t=.*,v1=[0-9a-f]{64}$/);
    expect(verifyDelivery(inboxSecret("inb-1", ENV)!, posts[0].body, posts[0].headers[SIGNATURE_HEADER])).toBe(true);
    expect(rows[0].delivered_at).toBeTruthy();
    expect(inbox.consecutive_failures).toBe(0);
  });

  it("backs off along the ladder and drops on the fifth failure", async () => {
    const { pool, rows } = drainPool({ deliveries: [{ id: "dlv-1", attempts: 0 }] });
    const now = new Date("2026-08-16T12:00:00.000Z");
    const deps = { post: async () => { throw new Error("503"); }, notifyDisabled: async () => {}, env: ENV, now: () => now };
    for (let n = 1; n < MAX_ATTEMPTS; n++) {
      rows[0].next_attempt_at = new Date(0);
      const s = await drainDeliveries(pool, deps);
      expect(s.failed).toBe(1);
      expect(rows[0].attempts).toBe(n);
      expect(new Date(rows[0].next_attempt_at).getTime() - now.getTime()).toBe(RETRY_DELAYS_MS[n - 1]);
      expect(rows[0].dropped_at).toBeNull();
    }
    rows[0].next_attempt_at = new Date(0);
    const last = await drainDeliveries(pool, deps);
    expect(last).toMatchObject({ failed: 1, dropped: 1 });
    expect(rows[0].dropped_at).toBeTruthy();
    expect(rows[0].last_error).toBe("503");
  });

  it("disables the inbox on the tenth consecutive failure and tells the member", async () => {
    const { pool, inbox } = drainPool({ failures: DISABLE_AFTER_FAILURES - 1, deliveries: [{ id: "dlv-1", attempts: 0 }, { id: "dlv-2", attempts: 0 }] });
    const told: string[] = [];
    const s = await drainDeliveries(pool, { post: async () => { throw new Error("timeout"); }, notifyDisabled: async (u, r) => { told.push(`${u}:${r}`); }, env: ENV });
    expect(inbox.enabled).toBe(0);
    expect(s.disabled).toBe(1);
    expect(told).toHaveLength(1);
    expect(told[0]).toContain("u-1:");
    // The second row for the same inbox was dropped, not dialled.
    expect(s.dropped).toBeGreaterThanOrEqual(1);
    expect(inbox.last_status).not.toContain("hook.example");
  });

  it("never claims a row twice", async () => {
    const { pool } = drainPool({ deliveries: [{ id: "dlv-1", attempts: 0 }] });
    let posts = 0;
    const deps = { post: async () => { posts += 1; return null; }, notifyDisabled: async () => {}, env: ENV };
    await Promise.all([drainDeliveries(pool, deps), drainDeliveries(pool, deps)]);
    expect(posts).toBe(1);
  });

  it("enqueue is a quiet no-op without an inbox, and refuses a kind it does not know", async () => {
    const none = { query: async () => [[]] } as any;
    expect(await enqueueAgentDelivery(none, "u-9", { kind: "weekly_digest", data: {} })).toEqual({ ok: false, reason: "no_inbox" });
    expect(await enqueueAgentDelivery(none, "u-9", { kind: "surprise" as any, data: {} })).toEqual({ ok: false, reason: "bad_kind" });
    const { pool, rows } = drainPool({ deliveries: [] });
    const r = await enqueueAgentDelivery(pool, "u-1", { kind: "opportunity", data: { intro: "x" } });
    expect(r.ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("opportunity");
  });
});
