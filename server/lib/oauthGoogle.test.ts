/**
 * The Google protocol layer, checked against the attacks it exists to refuse.
 *
 * Every refusal case here is paired with a POSITIVE CONTROL that must pass,
 * because a check that refuses everything looks exactly like a check that
 * works. Where a test asserts "this is rejected", the line above it asserts
 * the same input without the tampering is accepted.
 */
import { describe, expect, it } from "vitest";
import {
  OAUTH_HANDOFF_TTL_MS,
  OAUTH_STATE_TTL_MS,
  createHandoffLedger,
  decodeIdTokenPayload,
  googleAuthUrl,
  identityFromClaims,
  makeHandoffToken,
  makeOAuthState,
  normalizeNext,
  readHandoffToken,
  readOAuthState,
  resolveGoogleConfig,
} from "./oauthGoogle";

const SECRET = "a-test-signing-secret";
const CLIENT_ID = "1234.apps.googleusercontent.com";

describe("resolveGoogleConfig tells an unconfigured village from a broken one", () => {
  it("is available when the three things it needs are present", () => {
    const r = resolveGoogleConfig(
      { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" },
      "https://village.example",
    );
    expect(r.available).toBe(true);
    if (!r.available) throw new Error("unreachable");
    expect(r.config.redirectUri).toBe("https://village.example/api/auth/google/callback");
  });

  it("names EVERY missing variable at once, so one restart fixes the set", () => {
    const r = resolveGoogleConfig({}, "");
    expect(r.available).toBe(false);
    if (r.available) throw new Error("unreachable");
    expect(r.missing).toEqual([
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "FRONTEND_URL (or GOOGLE_REDIRECT_URI)",
    ]);
  });

  it("is unavailable with credentials but no origin, because the redirect URI has to be exact", () => {
    // The trap this closes: deriving the callback from whichever hostname a
    // stranger reached first gives a village a sign-in that works or throws
    // redirect_uri_mismatch depending on traffic order after a restart.
    const r = resolveGoogleConfig({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }, "");
    expect(r.available).toBe(false);
    if (r.available) throw new Error("unreachable");
    expect(r.missing).toEqual(["FRONTEND_URL (or GOOGLE_REDIRECT_URI)"]);
  });

  it("lets an explicit redirect URI stand in for the origin, and strips a trailing slash", () => {
    const r = resolveGoogleConfig(
      {
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        GOOGLE_REDIRECT_URI: "https://other.example/cb/",
      },
      "",
    );
    expect(r.available).toBe(true);
    if (!r.available) throw new Error("unreachable");
    expect(r.config.redirectUri).toBe("https://other.example/cb");
  });

  it("refuses a redirect URI that is not an absolute http address", () => {
    const r = resolveGoogleConfig(
      { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_REDIRECT_URI: "/api/callback" },
      "",
    );
    expect(r.available).toBe(false);
  });

  it("treats whitespace-only credentials as absent", () => {
    // A Railway variable pasted with a trailing newline is the common shape.
    const r = resolveGoogleConfig(
      { GOOGLE_CLIENT_ID: "  ", GOOGLE_CLIENT_SECRET: "\n" },
      "https://village.example",
    );
    expect(r.available).toBe(false);
  });
});

describe("normalizeNext keeps a sign-in on this village", () => {
  it("keeps an ordinary internal path", () => {
    expect(normalizeNext("/admin")).toBe("/admin");
  });
  for (const hostile of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/ok\nSet-Cookie: x=1",
  ]) {
    it(`drops ${JSON.stringify(hostile)}`, () => {
      expect(normalizeNext(hostile)).toBeNull();
    });
  }
});

describe("OAuth state is the login-CSRF token", () => {
  it("round-trips a destination and a nonce", () => {
    const state = makeOAuthState(SECRET, "/admin");
    const read = readOAuthState(SECRET, state);
    expect(read?.next).toBe("/admin");
    expect(read?.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives a different nonce every time, so one state cannot stand for another", () => {
    const a = readOAuthState(SECRET, makeOAuthState(SECRET, null));
    const b = readOAuthState(SECRET, makeOAuthState(SECRET, null));
    expect(a?.nonce).not.toBe(b?.nonce);
  });

  it("cannot be forged by editing the payload", () => {
    const state = makeOAuthState(SECRET, "/admin");
    const [payload, sig] = state.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    decoded.next = "/somewhere-else";
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
    expect(readOAuthState(SECRET, state)).not.toBeNull(); // positive control
    expect(readOAuthState(SECRET, forged)).toBeNull();
  });

  it("is refused under a different signing secret", () => {
    const state = makeOAuthState(SECRET, "/admin");
    expect(readOAuthState("another-secret", state)).toBeNull();
  });

  it("expires, so a captured state cannot be replayed later", () => {
    const t0 = 1_000_000_000_000;
    const state = makeOAuthState(SECRET, "/admin", t0);
    expect(readOAuthState(SECRET, state, t0 + OAUTH_STATE_TTL_MS - 1)).not.toBeNull();
    expect(readOAuthState(SECRET, state, t0 + OAUTH_STATE_TTL_MS + 1)).toBeNull();
  });

  it("refuses a token minted for another purpose", () => {
    // A handoff token and a state token share a signing key and a shape. The
    // purpose field is the only thing stopping one being replayed as the other.
    const handoff = makeHandoffToken(SECRET, "user-1", 0);
    expect(readOAuthState(SECRET, handoff)).toBeNull();
  });

  it("re-normalises the destination on the way out", () => {
    // Signed by this server does not mean safe. The value is checked again.
    const payload = Buffer.from(
      JSON.stringify({ purpose: "oauth-state", next: "https://evil.example", nonce: "n", t: Date.now() }),
    ).toString("base64url");
    const crypto = require("node:crypto");
    const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(readOAuthState(SECRET, `${payload}.${sig}`)?.next).toBeNull();
  });

  it("carries an invitation's id, and a caller cannot write one in", () => {
    const id = "inv-1726000000000-abc123";
    expect(readOAuthState(SECRET, makeOAuthState(SECRET, "/profile", Date.now(), { invite: id }))?.invite).toBe(id);
    expect(readOAuthState(SECRET, makeOAuthState(SECRET, "/profile"))?.invite).toBeNull();

    // Writing the id into a state this server signed without one breaks the signature.
    const state = makeOAuthState(SECRET, "/profile");
    const [payload, sig] = state.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    decoded.invite = id;
    expect(readOAuthState(SECRET, state)).not.toBeNull(); // positive control
    expect(readOAuthState(SECRET, `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`)).toBeNull();
  });

  it("keeps only an id in the shape the village mints, so a token handed in is dropped", () => {
    const token = "A".repeat(43);
    expect(readOAuthState(SECRET, makeOAuthState(SECRET, null, Date.now(), { invite: token }))?.invite).toBeNull();
  });

  it("puts the nonce on the authorization URL, where Google binds it into the id_token", () => {
    const url = new URL(googleAuthUrl({ clientId: "cid", clientSecret: "s", redirectUri: "https://v/cb" }, "st", "nn"));
    expect(url.searchParams.get("nonce")).toBe("nn");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://v/cb");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });
});

function idToken(claims: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${body}.signature`;
}

const goodClaims = (over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 600,
  nonce: "the-nonce",
  sub: "google-subject-1",
  email: "Founder@Example.com",
  email_verified: true,
  name: "A Founder",
  ...over,
});

describe("identityFromClaims refuses everything it should", () => {
  const expected = { clientId: CLIENT_ID, nonce: "the-nonce" };

  it("accepts a well-formed token and lowercases the address", () => {
    const r = identityFromClaims(goodClaims(), expected);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.identity).toEqual({
      sub: "google-subject-1",
      email: "founder@example.com",
      emailVerified: true,
      name: "A Founder",
    });
  });

  it("REFUSES an unverified email, which is the founder-impersonation attack", () => {
    // Without this, an attacker registers a Google account carrying the
    // founder's address without ever proving they hold the mailbox, clicks
    // sign in, and is linked to the founder's village account.
    const r = identityFromClaims(goodClaims({ email_verified: false }), expected);
    expect(r).toEqual({ ok: false, reason: "email_unverified" });
  });

  it("refuses the string \"true\" as a stand-in for the boolean", () => {
    const r = identityFromClaims(goodClaims({ email_verified: "true" }), expected);
    expect(r).toEqual({ ok: false, reason: "email_unverified" });
  });

  it("refuses a token minted for a DIFFERENT Google application", () => {
    // The confused deputy: an attacker's own Google app collects a real
    // id_token from a real user and replays it here.
    const r = identityFromClaims(goodClaims({ aud: "someone-elses-client-id" }), expected);
    expect(r).toEqual({ ok: false, reason: "wrong_audience" });
  });

  it("accepts the array form of aud when our client id is in it", () => {
    const r = identityFromClaims(goodClaims({ aud: ["other", CLIENT_ID] }), expected);
    expect(r.ok).toBe(true);
  });

  it("refuses a nonce that does not match this sign-in", () => {
    const r = identityFromClaims(goodClaims({ nonce: "a-different-nonce" }), expected);
    expect(r).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("refuses a missing nonce", () => {
    const claims = goodClaims();
    delete (claims as any).nonce;
    expect(identityFromClaims(claims, expected)).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("refuses another issuer", () => {
    expect(identityFromClaims(goodClaims({ iss: "https://evil.example" }), expected)).toEqual({
      ok: false,
      reason: "bad_issuer",
    });
  });

  it("accepts Google's bare-host issuer form", () => {
    expect(identityFromClaims(goodClaims({ iss: "accounts.google.com" }), expected).ok).toBe(true);
  });

  it("refuses an expired token", () => {
    const r = identityFromClaims(goodClaims({ exp: Math.floor(Date.now() / 1000) - 1 }), expected);
    expect(r).toEqual({ ok: false, reason: "expired_id_token" });
  });

  it("refuses a token with no subject and one with no address", () => {
    expect(identityFromClaims(goodClaims({ sub: "" }), expected)).toEqual({ ok: false, reason: "no_subject" });
    expect(identityFromClaims(goodClaims({ email: "" }), expected)).toEqual({ ok: false, reason: "no_email" });
  });

  it("refuses nothing at all", () => {
    expect(identityFromClaims(null, expected)).toEqual({ ok: false, reason: "unreadable_id_token" });
  });
});

describe("decodeIdTokenPayload", () => {
  it("reads the middle segment", () => {
    expect(decodeIdTokenPayload(idToken({ sub: "x" }))).toEqual({ sub: "x" });
  });
  it("returns null for anything that is not three segments of JSON", () => {
    expect(decodeIdTokenPayload("not.a.jwt")).toBeNull();
    expect(decodeIdTokenPayload("two.parts")).toBeNull();
    expect(decodeIdTokenPayload("")).toBeNull();
  });
});

describe("the handoff between the callback and the page", () => {
  it("round-trips a member and their token version", () => {
    const t = makeHandoffToken(SECRET, "user-7", 3);
    expect(readHandoffToken(SECRET, t)).toMatchObject({ userId: "user-7", v: 3 });
  });

  it("cannot be forged by editing the member id", () => {
    const t = makeHandoffToken(SECRET, "user-7", 0);
    const [payload, sig] = t.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    decoded.userId = "the-founder";
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
    expect(readHandoffToken(SECRET, t)).not.toBeNull(); // positive control
    expect(readHandoffToken(SECRET, forged)).toBeNull();
  });

  it("expires in two minutes", () => {
    const t0 = 1_700_000_000_000;
    const t = makeHandoffToken(SECRET, "user-7", 0, t0);
    expect(readHandoffToken(SECRET, t, t0 + OAUTH_HANDOFF_TTL_MS - 1)).not.toBeNull();
    expect(readHandoffToken(SECRET, t, t0 + OAUTH_HANDOFF_TTL_MS + 1)).toBeNull();
  });

  it("is not a state token and cannot be used as one", () => {
    const state = makeOAuthState(SECRET, "/admin");
    expect(readHandoffToken(SECRET, state)).toBeNull();
  });

  it("carries a fresh id every time, which is what the ledger keys on", () => {
    const a = readHandoffToken(SECRET, makeHandoffToken(SECRET, "u", 0))!;
    const b = readHandoffToken(SECRET, makeHandoffToken(SECRET, "u", 0))!;
    expect(a.jti).not.toBe(b.jti);
  });
});

describe("the handoff ledger makes a copied cookie worth one sign-in", () => {
  it("claims once and refuses the replay", () => {
    const ledger = createHandoffLedger();
    expect(ledger.claim("jti-1")).toBe(true);
    expect(ledger.claim("jti-1")).toBe(false);
  });

  it("does not confuse two different handoffs", () => {
    const ledger = createHandoffLedger();
    expect(ledger.claim("a")).toBe(true);
    expect(ledger.claim("b")).toBe(true);
  });

  it("forgets spent ids once they could not be replayed anyway, so it cannot grow forever", () => {
    let now = 1_000;
    const ledger = createHandoffLedger(() => now);
    ledger.claim("old");
    expect(ledger.size).toBe(1);
    now += OAUTH_HANDOFF_TTL_MS * 2;
    ledger.claim("new");
    expect(ledger.size).toBe(1);
  });
});
