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
  readSetPasswordToken,
  sessionWindowMs,
  SET_PASSWORD_LINK_REFUSAL,
  SET_PASSWORD_TTL_MS,
  setPasswordLinkRefusal,
  signTokenPayload,
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
  const claimsOf = (token: string) =>
    JSON.parse(Buffer.from(token.slice(0, token.lastIndexOf(".")), "base64url").toString("utf-8"));

  it("round-trips the account id and the tokenVersion it was minted at", () => {
    const claim = makeSetPasswordToken(SECRET, "u-1", 3);
    expect(readSetPasswordToken(SECRET, claim)).toEqual({ userId: "u-1", v: 3 });
  });

  it("carries exactly four claims, none of them derived from a password", () => {
    // The link travels by email, so everything in it is readable by whoever
    // holds it. Until 2026-09-21 a fifth claim, `pw`, carried an HMAC of the
    // stored password hash (CodeQL alert 36). A new key here fails this test
    // on purpose: whoever adds one says what it is derived from.
    const claim = makeSetPasswordToken(SECRET, "u-1", 3);
    expect(Object.keys(claimsOf(claim)).sort()).toEqual(["exp", "purpose", "userId", "v"]);
    expect(claimsOf(claim)).toMatchObject({ userId: "u-1", purpose: "set-password-2", v: 3 });
  });

  it("is a purpose the previous release refuses outright, so rolling the image back fails closed", () => {
    // The previous release's reader, verbatim, gated on exactly this:
    //   if (decoded.purpose !== "set-password" || !decoded.userId) return null;
    // and its route skipped the single-use compare for a claim with no `pw`.
    // Under that name, a rollback would accept every link from the hour before
    // it with no single-use check at all.
    expect(claimsOf(makeSetPasswordToken(SECRET, "u-1", 0)).purpose).not.toBe("set-password");
  });

  it("refuses to mint when handed a stored hash where the tokenVersion goes", () => {
    // The third argument used to BE the stored hash. `user` is `any` at the
    // route, so the compiler cannot catch a caller left behind, and a string
    // must throw here and never be coerced into the claim.
    for (const stale of ["$2b$10$abcdefghijklmnopqrstuv", "", "0", null, undefined, -1, 1.5, Number.NaN]) {
      expect(() => makeSetPasswordToken(SECRET, "u-1", stale as any), JSON.stringify(stale)).toThrow(TypeError);
    }
  });

  it("cannot be forged by editing the account it names", () => {
    const claim = makeSetPasswordToken(SECRET, "u-1", 0);
    const forged = repayload(claim, (c) => {
      c.userId = "u-founder";
    });
    expect(readSetPasswordToken(SECRET, forged)).toBeNull();
  });

  it("cannot be forged by editing its tokenVersion to catch up with the account", () => {
    const claim = makeSetPasswordToken(SECRET, "u-1", 0);
    const forged = repayload(claim, (c) => {
      c.v = 4;
    });
    expect(readSetPasswordToken(SECRET, forged)).toBeNull();
  });

  it("refuses a claim signed with another secret", () => {
    expect(readSetPasswordToken(SECRET, makeSetPasswordToken(OTHER_SECRET, "u-1", 0))).toBeNull();
  });

  it("cannot be replayed as a session token, nor a session token as one of these", () => {
    // Different `purpose`, same HMAC. That is the only thing keeping the two
    // apart, so it is worth an assertion in both directions.
    const claim = makeSetPasswordToken(SECRET, "u-1", 0);
    expect(decodeToken(SECRET, claim, 30)).toBeNull();

    const session = encodeToken(SECRET, "u-1", "e@example.test", 0);
    expect(readSetPasswordToken(SECRET, session)).toBeNull();
  });

  it("refuses a claim whose purpose was edited", () => {
    const claim = makeSetPasswordToken(SECRET, "u-1", 0);
    const forged = repayload(claim, (c) => {
      c.purpose = "session";
    });
    expect(readSetPasswordToken(SECRET, forged)).toBeNull();
  });

  it("expires hard after an hour, whatever the session variable says", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const claim = makeSetPasswordToken(SECRET, "u-1", 0);

    vi.advanceTimersByTime(SET_PASSWORD_TTL_MS - 1000);
    expect(readSetPasswordToken(SECRET, claim)).not.toBeNull();

    vi.advanceTimersByTime(2000);
    expect(readSetPasswordToken(SECRET, claim)).toBeNull();
  });

  it("cannot have its expiry pushed out", () => {
    const claim = makeSetPasswordToken(SECRET, "u-1", 0);
    const forged = repayload(claim, (c) => {
      c.exp = Date.now() + 365 * DAY;
    });
    expect(readSetPasswordToken(SECRET, forged)).toBeNull();
  });
});

describe("a set-password link works once, and never outlives a password change", () => {
  /** Sign a payload this server's way, for claims in shapes the minter no longer writes. */
  const signed = (claims: unknown) => {
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${p}.${signTokenPayload(SECRET, p)}`;
  };

  it("redeems while the account is still at the tokenVersion the link was minted at", () => {
    const claim = readSetPasswordToken(SECRET, makeSetPasswordToken(SECRET, "u-1", 2))!;
    expect(setPasswordLinkRefusal(claim, 2)).toBeNull();
  });

  it("redeems a claim-pending account's first link, minted at version 0", () => {
    // The founder bootstrap and the first-password letter both mint at 0.
    // A missing tokenVersion on the member reads as 0, as it does for sessions.
    const claim = readSetPasswordToken(SECRET, makeSetPasswordToken(SECRET, "u-1", 0))!;
    expect(setPasswordLinkRefusal(claim, 0)).toBeNull();
    expect(setPasswordLinkRefusal(claim, undefined)).toBeNull();
  });

  it("refuses the same link once it has set a password, because setting one bumps tokenVersion", () => {
    const claim = readSetPasswordToken(SECRET, makeSetPasswordToken(SECRET, "u-1", 2))!;
    expect(setPasswordLinkRefusal(claim, 3)).toBe(SET_PASSWORD_LINK_REFUSAL.spent);
  });

  it("refuses a second link minted before the password changed, never opened", () => {
    // Two letters asked for, the first one used. The second was valid a
    // moment ago and must die with the first, which is what the old hash
    // fingerprint did and what tokenVersion now does.
    const first = readSetPasswordToken(SECRET, makeSetPasswordToken(SECRET, "u-1", 5))!;
    const second = readSetPasswordToken(SECRET, makeSetPasswordToken(SECRET, "u-1", 5))!;
    expect(setPasswordLinkRefusal(first, 5)).toBeNull();
    expect(setPasswordLinkRefusal(second, 6)).toBe(SET_PASSWORD_LINK_REFUSAL.spent);
  });

  it("refuses a link whose tokenVersion is AHEAD of the account's, which only a forger could hold", () => {
    const claim = readSetPasswordToken(SECRET, makeSetPasswordToken(SECRET, "u-1", 9))!;
    expect(setPasswordLinkRefusal(claim, 2)).toBe(SET_PASSWORD_LINK_REFUSAL.spent);
  });

  it("RETIRES a link in the shape this server signed before 2026-09-21, by name", () => {
    // Signed by this very secret, unexpired, carrying the old `pw` fingerprint
    // and no `v`. Deliberately refused, with a sentence of its own, however
    // its fingerprint compares. At most an hour of links existed in this shape
    // when it was retired, and Rye ruled that asking again is acceptable.
    const old = readSetPasswordToken(
      SECRET,
      signed({ userId: "u-1", purpose: "set-password", pw: "0123456789abcdef", exp: Date.now() + 60_000 }),
    );
    expect(old).toEqual({ userId: "u-1", v: null });
    expect(setPasswordLinkRefusal(old!, 0)).toBe(SET_PASSWORD_LINK_REFUSAL.retired);
  });

  it("retires an old-shape link even for an account that never signed out, which is where `?? 0` would let it through", () => {
    // The trap this pins: reading a missing `v` as 0 matches the tokenVersion
    // of every account that has never signed out or reset. The purpose
    // decides, so an old-purpose claim is retired even carrying a numeric `v`.
    for (const shape of [
      { userId: "u-1", purpose: "set-password", exp: Date.now() + 60_000 },
      { userId: "u-1", purpose: "set-password", pw: null, exp: Date.now() + 60_000 },
      { userId: "u-1", purpose: "set-password", v: 0, exp: Date.now() + 60_000 },
      { userId: "u-1", purpose: "set-password", v: "0", exp: Date.now() + 60_000 },
    ]) {
      const claim = readSetPasswordToken(SECRET, signed(shape));
      expect(claim?.v, JSON.stringify(shape)).toBeNull();
      expect(setPasswordLinkRefusal(claim!, 0), JSON.stringify(shape)).toBe(SET_PASSWORD_LINK_REFUSAL.retired);
    }
  });

  it("refuses a current-shape claim whose tokenVersion is missing or not a whole number, as invalid", () => {
    for (const v of [undefined, null, "0", -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      const shape = { userId: "u-1", purpose: "set-password-2", v, exp: Date.now() + 60_000 };
      expect(readSetPasswordToken(SECRET, signed(shape)), JSON.stringify(shape)).toBeNull();
    }
  });
});
