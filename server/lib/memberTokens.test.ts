/**
 * The member session token had no tests. None, anywhere in the repository.
 *
 * Its twin for agent tokens, server/lib/agentTokens.ts, has carried a forgery
 * test ("cannot be forged by editing the payload") for as long as it has
 * existed. The member session token, which is the thing that authenticates
 * every real person on the deployment, had nothing, because it lived in the
 * middle of server/index.ts and there was no unit to reach it through: that
 * file opens a database pool and an HTTP server on import.
 *
 * That asymmetry is the reason these functions moved to
 * server/lib/memberTokens.ts. This file is the test that could not be written
 * before, and it is written against the two properties that actually keep
 * accounts closed: the HMAC verify, and the TTL clamp.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  decodeToken,
  encodeToken,
  makeSetPasswordToken,
  passwordFingerprint,
  readSetPasswordToken,
  sessionWindowMs,
  SET_PASSWORD_TTL_MS,
  TOKEN_TTL_MS,
} from "./memberTokens";

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);
const DAY = 24 * 60 * 60 * 1000;

/** Rebuild a token from claims the caller chose, keeping the original signature. */
function repayload(token: string, mutate: (claims: any) => void): string {
  const dot = token.lastIndexOf(".");
  const claims = JSON.parse(Buffer.from(token.slice(0, dot), "base64url").toString("utf-8"));
  mutate(claims);
  const forgedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${forgedPayload}.${token.slice(dot + 1)}`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a member session token cannot be forged", () => {
  it("round-trips the claims it was minted with", () => {
    const token = encodeToken(SECRET, "u-1", "someone@example.test", 3);
    const claims = decodeToken(SECRET, token, 30);
    expect(claims).toMatchObject({ userId: "u-1", email: "someone@example.test", v: 3 });
  });

  it("REFUSES a token whose payload was edited to name another account", () => {
    // The whole point. Before the HMAC existed this was a bare base64 JSON
    // blob and this exact edit was a working impersonation of any user id.
    const token = encodeToken(SECRET, "u-1", "someone@example.test", 0);
    const forged = repayload(token, (c) => {
      c.userId = "u-admin";
    });
    expect(decodeToken(SECRET, forged, 30)).toBeNull();
  });

  it("refuses a token whose revocation counter was edited down", () => {
    const token = encodeToken(SECRET, "u-1", "someone@example.test", 7);
    const forged = repayload(token, (c) => {
      c.v = 0;
    });
    expect(decodeToken(SECRET, forged, 30)).toBeNull();
  });

  it("refuses a token whose mint timestamp was pushed forward to dodge expiry", () => {
    const token = encodeToken(SECRET, "u-1", "someone@example.test", 0);
    const forged = repayload(token, (c) => {
      c.timestamp = Date.now() + 100 * DAY;
    });
    expect(decodeToken(SECRET, forged, 30)).toBeNull();
  });

  it("refuses a token signed with a different secret", () => {
    const token = encodeToken(OTHER_SECRET, "u-1", "someone@example.test", 0);
    expect(decodeToken(SECRET, token, 30)).toBeNull();
  });

  it("refuses an unsigned token, which is the pre-HMAC format", () => {
    const payload = Buffer.from(
      JSON.stringify({ userId: "u-1", email: "e@example.test", timestamp: Date.now(), v: 0 }),
    ).toString("base64url");
    expect(decodeToken(SECRET, payload, 30)).toBeNull();
  });

  it("refuses malformed shapes without throwing", () => {
    for (const bad of ["", ".", "a.", ".b", "no-dot-at-all", "not-base64!!.sig", "a.b.c"]) {
      expect(decodeToken(SECRET, bad, 30)).toBeNull();
    }
  });

  it("refuses a signature of the wrong length rather than comparing it", () => {
    // timingSafeEqual THROWS on a length mismatch, so the length check in
    // front of it is load-bearing, not an optimisation.
    const token = encodeToken(SECRET, "u-1", "e@example.test", 0);
    const truncated = `${token.slice(0, token.lastIndexOf(".") + 1)}short`;
    expect(() => decodeToken(SECRET, truncated, 30)).not.toThrow();
    expect(decodeToken(SECRET, truncated, 30)).toBeNull();
  });

  it("refuses a validly signed payload that is missing required claims", () => {
    const sign = (obj: unknown) => {
      const p = Buffer.from(JSON.stringify(obj)).toString("base64url");
      return `${p}.${crypto.createHmac("sha256", SECRET).update(p).digest("base64url")}`;
    };
    expect(decodeToken(SECRET, sign({ email: "e@example.test", timestamp: Date.now() }), 30)).toBeNull();
    expect(decodeToken(SECRET, sign({ userId: "u-1", timestamp: Date.now() }), 30)).toBeNull();
    expect(decodeToken(SECRET, sign({ userId: "u-1", email: "e@example.test" }), 30)).toBeNull();
    expect(decodeToken(SECRET, sign({ userId: "u-1", email: "e@example.test", timestamp: "soon" }), 30)).toBeNull();
  });
});

describe("the session window clamp", () => {
  it("uses the village's auth.session_days when it is sane", () => {
    expect(sessionWindowMs(7)).toBe(7 * DAY);
    expect(sessionWindowMs(365)).toBe(365 * DAY);
  });

  it("never yields an immortal token, however broken the variable is", () => {
    // A hostile or fat-fingered value must not become a decade-long session.
    expect(sessionWindowMs(100000)).toBe(365 * DAY);
    expect(sessionWindowMs(Number.MAX_SAFE_INTEGER)).toBe(365 * DAY);
    expect(sessionWindowMs(Infinity)).toBe(365 * DAY);
  });

  it("never yields a zero-length window, which would log the whole village out", () => {
    expect(sessionWindowMs(0)).toBe(30 * DAY); // 0 is falsy, so the default applies
    expect(sessionWindowMs(Number.NaN)).toBe(30 * DAY);
    expect(sessionWindowMs(-5)).toBe(1 * DAY); // negative clamps up to the floor
    expect(sessionWindowMs(-Infinity)).toBe(1 * DAY);
  });

  it("is the same 30 days the module's fallback constant names", () => {
    expect(sessionWindowMs(0)).toBe(TOKEN_TTL_MS);
  });

  it("expires a token once the window has passed, and not before", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = encodeToken(SECRET, "u-1", "e@example.test", 0);

    vi.setSystemTime(new Date("2026-01-07T23:00:00Z")); // 6d23h, inside a 7 day window
    expect(decodeToken(SECRET, token, 7)).not.toBeNull();

    vi.setSystemTime(new Date("2026-01-08T01:00:00Z")); // 7d1h, outside it
    expect(decodeToken(SECRET, token, 7)).toBeNull();
  });

  it("retires an old session early when the village shortens the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = encodeToken(SECRET, "u-1", "e@example.test", 0);
    vi.setSystemTime(new Date("2026-01-20T00:00:00Z")); // 19 days later

    expect(decodeToken(SECRET, token, 30)).not.toBeNull(); // still inside 30
    expect(decodeToken(SECRET, token, 7)).toBeNull(); // the admin shortened it
  });
});

describe("set-password claim tokens", () => {
  it("round-trips the account id and the password fingerprint", () => {
    const claim = makeSetPasswordToken(SECRET, "u-1", "hash-v1");
    expect(readSetPasswordToken(SECRET, claim)).toEqual({
      userId: "u-1",
      pw: passwordFingerprint(SECRET, "hash-v1"),
    });
  });

  it("cannot be forged by editing the account it names", () => {
    const claim = makeSetPasswordToken(SECRET, "u-1", "hash-v1");
    const forged = repayload(claim, (c) => {
      c.userId = "u-founder";
    });
    expect(readSetPasswordToken(SECRET, forged)).toBeNull();
  });

  it("cannot be replayed as a session token, nor a session token as one of these", () => {
    // Different `purpose`, same HMAC. That is the only thing keeping the two
    // apart, so it is worth an assertion in both directions.
    const claim = makeSetPasswordToken(SECRET, "u-1", "hash-v1");
    expect(decodeToken(SECRET, claim, 30)).toBeNull();

    const session = encodeToken(SECRET, "u-1", "e@example.test", 0);
    expect(readSetPasswordToken(SECRET, session)).toBeNull();
  });

  it("refuses a claim whose purpose was edited", () => {
    const claim = makeSetPasswordToken(SECRET, "u-1", "hash-v1");
    const forged = repayload(claim, (c) => {
      c.purpose = "session";
    });
    expect(readSetPasswordToken(SECRET, forged)).toBeNull();
  });

  it("expires hard after an hour, whatever the session variable says", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const claim = makeSetPasswordToken(SECRET, "u-1", "hash-v1");

    vi.advanceTimersByTime(SET_PASSWORD_TTL_MS - 1000);
    expect(readSetPasswordToken(SECRET, claim)).not.toBeNull();

    vi.advanceTimersByTime(2000);
    expect(readSetPasswordToken(SECRET, claim)).toBeNull();
  });

  it("cannot have its expiry pushed out", () => {
    const claim = makeSetPasswordToken(SECRET, "u-1", "hash-v1");
    const forged = repayload(claim, (c) => {
      c.exp = Date.now() + 365 * DAY;
    });
    expect(readSetPasswordToken(SECRET, forged)).toBeNull();
  });

  it("fingerprints a changed password differently, which is what makes it single use", () => {
    // The route compares the fingerprint in the token against a fresh read of
    // the account. Setting a password changes the hash, so a replayed link no
    // longer matches. No nonce table required.
    expect(passwordFingerprint(SECRET, "hash-v1")).not.toBe(passwordFingerprint(SECRET, "hash-v2"));
    expect(passwordFingerprint(SECRET, null)).toBe(passwordFingerprint(SECRET, undefined));
    expect(passwordFingerprint(SECRET, "")).toBe(passwordFingerprint(SECRET, null));
    expect(passwordFingerprint(SECRET, "hash-v1")).toHaveLength(16);
  });

  it("cannot be reproduced without the server secret, which keeps a password out of the link", async () => {
    // The input is the stored hash, and an account dormant since the bcrypt
    // migration could still hold an unsalted SHA-256 of the password itself.
    // Digesting that bare put sha256(sha256(password)) in an emailed link,
    // which its holder can guess against offline. Keyed with the secret it
    // cannot be reproduced from a guess. Both assertions fail against the
    // old implementation, which returned exactly `bare`.
    const crypto = await import("node:crypto");
    const legacyStored = crypto.createHash("sha256").update("hunter2").digest("hex");
    const bare = crypto.createHash("sha256").update(legacyStored).digest("hex").slice(0, 16);

    expect(passwordFingerprint(SECRET, legacyStored)).not.toBe(bare);
    expect(passwordFingerprint(SECRET, legacyStored)).not.toBe(passwordFingerprint("another-secret", legacyStored));
  });
});
