/**
 * Agent tokens (round 4, lane L6): the credential, and the two-call confirm.
 *
 * Harm metric 2 has its pure half here: every confirm failure is a distinct
 * refusal and none of them writes. Harm metric 3's "the token value is never
 * in a row" is proven against a fake pool that records every INSERT.
 */
import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import {
  AGENT_SCOPES,
  CONFIRM_REASON_SENTENCE,
  LIVE_PER_USER,
  MINTS_PER_DAY,
  TOKEN_PREFIX,
  canonical,
  cleanScopes,
  echoHash,
  hashToken,
  isAgentBearer,
  mintConfirmToken,
  mintToken,
  verifyConfirmToken,
  verifyToken,
} from "./agentTokens";

/** A pool that answers COUNT queries from a script and records every write. */
function fakePool(opts: { mintedToday?: number; live?: number } = {}) {
  const writes: { sql: string; args: any[] }[] = [];
  const rowsByHash = new Map<string, any>();
  const pool = {
    query: async (sql: string, args: any[] = []) => {
      if (/COUNT\(\*\) AS n FROM agent_tokens WHERE user_id = \? AND created_at/.test(sql)) return [[{ n: opts.mintedToday ?? 0 }]];
      if (/COUNT\(\*\) AS n FROM agent_tokens WHERE user_id = \? AND revoked_at/.test(sql)) return [[{ n: opts.live ?? 0 }]];
      if (/^INSERT INTO agent_tokens/.test(sql)) {
        writes.push({ sql, args });
        rowsByHash.set(args[3], {
          id: args[0], user_id: args[1], name: args[2], prefix: args[4], scopes: args[5],
          created_at: new Date(), last_used_at: null, expires_at: args[6], revoked_at: null,
        });
        return [{ affectedRows: 1 }];
      }
      if (/FROM agent_tokens WHERE id = \?/.test(sql)) {
        const row = [...rowsByHash.values()].find((r) => r.id === args[0]);
        return [row ? [row] : []];
      }
      if (/FROM agent_tokens WHERE token_hash = \?/.test(sql)) {
        const row = rowsByHash.get(args[0]);
        return [row ? [row] : []];
      }
      if (/^INSERT INTO health_events/.test(sql)) { writes.push({ sql, args }); return [{ affectedRows: 1 }]; }
      if (/^UPDATE agent_tokens SET last_used_at/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`unexpected sql: ${sql}`);
    },
  } as any;
  return { pool, writes, rowsByHash };
}

describe("the token value", () => {
  it("is vat_ plus 32 random bytes, and only its hash is stored", async () => {
    const { pool, writes } = fakePool();
    const r = await mintToken(pool, "u-1", { name: "laptop", scopes: ["calendar.read"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token.startsWith(TOKEN_PREFIX)).toBe(true);
    // 32 bytes base64url is 43 chars.
    expect(r.token.length).toBe(TOKEN_PREFIX.length + 43);
    const inserted = writes.find((w) => /INSERT INTO agent_tokens/.test(w.sql))!;
    expect(inserted.args).not.toContain(r.token);
    expect(inserted.args).toContain(hashToken(r.token));
    // The audit line names the prefix, never the value.
    const audit = writes.find((w) => /health_events/.test(w.sql))!;
    expect(JSON.stringify(audit.args)).not.toContain(r.token.slice(TOKEN_PREFIX.length + 8));
    expect(JSON.stringify(audit.args)).toContain(r.row.prefix);
  });

  it("verifies by hash and refuses the near miss", async () => {
    const { pool } = fakePool();
    const r = await mintToken(pool, "u-1", { name: "laptop", scopes: ["calendar.read", "me.read"] });
    if (!r.ok) throw new Error("mint failed");
    const good = await verifyToken(pool, r.token);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.row.scopes).toEqual(["calendar.read", "me.read"]);
    const flipped = r.token.slice(0, -1) + (r.token.endsWith("A") ? "B" : "A");
    expect(await verifyToken(pool, flipped)).toEqual({ ok: false, reason: "unknown" });
    expect(await verifyToken(pool, "not-a-token")).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyToken(pool, "vat_short")).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a revoked and an expired row", async () => {
    const { pool, rowsByHash } = fakePool();
    const r = await mintToken(pool, "u-1", { name: "laptop", scopes: ["calendar.read"] });
    if (!r.ok) throw new Error("mint failed");
    const row = rowsByHash.get(hashToken(r.token));
    row.revoked_at = new Date();
    expect(await verifyToken(pool, r.token)).toEqual({ ok: false, reason: "revoked" });
    row.revoked_at = null;
    row.expires_at = new Date(Date.now() - 1000);
    expect(await verifyToken(pool, r.token)).toEqual({ ok: false, reason: "expired" });
  });

  it("caps mints per day and live tokens per member", async () => {
    const day = await mintToken(fakePool({ mintedToday: MINTS_PER_DAY }).pool, "u-1", { name: "x", scopes: ["me.read"] });
    expect(day).toMatchObject({ ok: false, status: 429 });
    const live = await mintToken(fakePool({ live: LIVE_PER_USER }).pool, "u-1", { name: "x", scopes: ["me.read"] });
    expect(live).toMatchObject({ ok: false, status: 429 });
  });

  it("recognises an agent bearer only by its prefix", () => {
    expect(isAgentBearer("Bearer vat_abc")).toBe(true);
    expect(isAgentBearer("Bearer eyJ.abc")).toBe(false);
    expect(isAgentBearer(undefined)).toBe(false);
  });
});

describe("scopes", () => {
  it("is a closed list", () => {
    expect([...AGENT_SCOPES]).toEqual(["calendar.read", "directory.read", "me.read", "rsvp.write", "intents.write", "map.draft"]);
  });
  it("refuses unknown scopes and dedupes", () => {
    expect(cleanScopes(["calendar.read", "calendar.read"], { intentsAllowed: false })).toEqual({ ok: true, scopes: ["calendar.read"] });
    expect(cleanScopes(["admin.everything"], { intentsAllowed: false }).ok).toBe(false);
    expect(cleanScopes([], { intentsAllowed: false }).ok).toBe(false);
  });
  it("holds intents.write behind the flag", () => {
    expect(cleanScopes(["intents.write"], { intentsAllowed: false }).ok).toBe(false);
    expect(cleanScopes(["intents.write"], { intentsAllowed: true }).ok).toBe(true);
  });
});

describe("the confirm token (harm metric 2, pure half)", () => {
  const secret = "test-signing-secret";
  const echo = { eventId: "ev-1", title: "Kitchen crew", startsAt: "2026-08-18T18:00:00.000Z", status: "going", idempotencyKey: null };
  const claims = { action: "rsvp", userId: "u-1", echo };

  it("hashes an echo the same whatever the key order", () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(echoHash({ status: "going", eventId: "ev-1" })).toBe(echoHash({ eventId: "ev-1", status: "going" }));
  });

  it("accepts the same echo back inside ten minutes", () => {
    const { token } = mintConfirmToken(secret, claims);
    expect(verifyConfirmToken(secret, token, claims)).toEqual({ ok: true });
    // Key order on the way back does not matter; the values do.
    expect(verifyConfirmToken(secret, token, { ...claims, echo: { ...echo, status: "going" } })).toEqual({ ok: true });
  });

  it("refuses every way the second call can go wrong, each by name", () => {
    const { token } = mintConfirmToken(secret, claims);
    expect(verifyConfirmToken(secret, undefined, claims)).toEqual({ ok: false, reason: "missing" });
    expect(verifyConfirmToken(secret, "garbage", claims)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyConfirmToken("other-secret", token, claims)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyConfirmToken(secret, token, { ...claims, echo: { ...echo, status: "declined" } })).toEqual({ ok: false, reason: "echo_mismatch" });
    expect(verifyConfirmToken(secret, token, { ...claims, echo: { ...echo, eventId: "ev-2" } })).toEqual({ ok: false, reason: "echo_mismatch" });
    expect(verifyConfirmToken(secret, token, { ...claims, userId: "u-2" })).toEqual({ ok: false, reason: "wrong_holder" });
    expect(verifyConfirmToken(secret, token, { ...claims, action: "intent" })).toEqual({ ok: false, reason: "wrong_action" });
    const late = Date.now() + 10 * 60 * 1000 + 1;
    expect(verifyConfirmToken(secret, token, claims, late)).toEqual({ ok: false, reason: "expired" });
  });

  it("carries a plain sentence for every reason", () => {
    for (const reason of ["missing", "malformed", "bad_signature", "expired", "wrong_action", "wrong_holder", "echo_mismatch"] as const) {
      expect(CONFIRM_REASON_SENTENCE[reason]).toContain("Nothing was written");
    }
  });

  it("refuses a token minted for another purpose under the same secret", () => {
    // A session token and a set-password token share the signing secret and
    // the <b64>.<hmac> shape; the purpose claim is what keeps them apart.
    const payload = Buffer.from(JSON.stringify({ a: "rsvp", u: "u-1", h: echoHash(echo), exp: Date.now() + 60_000 })).toString("base64url");
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    expect(verifyConfirmToken(secret, `${payload}.${sig}`, claims)).toEqual({ ok: false, reason: "malformed" });
  });

  it("cannot be forged by editing the payload", () => {
    const { token } = mintConfirmToken(secret, claims);
    const [payload, sig] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.exp = Date.now() + 10 * 60 * 60 * 1000;
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
    expect(verifyConfirmToken(secret, forged, claims)).toEqual({ ok: false, reason: "bad_signature" });
  });
});
