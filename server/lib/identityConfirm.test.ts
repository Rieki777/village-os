/**
 * The confirmation that stands in for a password, for a member who has none.
 *
 * Pure functions and the gate, with the members repository faked as one row.
 * What this file cannot prove is the row lock that makes single use hold
 * between two real requests; server/googleMemberExit.routes.e2e.test.ts drives
 * the built server against MySQL for that, and for the Google round trip.
 */
import { describe, expect, it } from "vitest";
import {
  CONFIRM_REFUSAL,
  IDENTITY_CONFIRM_TTL_MS,
  NO_WAY_TO_CONFIRM,
  PASSWORD_REFUSAL,
  confirmCookieName,
  confirmReturnUrl,
  confirmWithFor,
  googleRefusal,
  makeIdentityGate,
  mintConfirmation,
  readConfirmation,
  readCookieValue,
  recordPending,
  spendPending,
  type ConfirmAction,
} from "./identityConfirm";
import { makeGoogleLink } from "./oauthAccounts";
import { encodeToken } from "./memberTokens";
import { makeHandoffToken, makeOAuthState, readOAuthState } from "./oauthGoogle";

const SECRET = "identity-confirm-unit-secret"; // module-review-ok: a throwaway signing key for pure functions, never a deployment's
const T0 = 1_700_000_000_000;

describe("the confirmation token", () => {
  it("round-trips the member, the action and the session generation", () => {
    const m = mintConfirmation(SECRET, "user-1", "delete-account", 3, T0);
    const read = readConfirmation(SECRET, m.token, T0);
    expect(read).toEqual({
      ok: true,
      claims: { userId: "user-1", action: "delete-account", v: 3, jti: m.jti, exp: T0 + IDENTITY_CONFIRM_TTL_MS },
    });
  });

  it("lasts five minutes and not a millisecond more", () => {
    const m = mintConfirmation(SECRET, "user-1", "request-exit", 0, T0);
    expect(readConfirmation(SECRET, m.token, T0 + IDENTITY_CONFIRM_TTL_MS).ok).toBe(true);
    expect(readConfirmation(SECRET, m.token, T0 + IDENTITY_CONFIRM_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
    expect(IDENTITY_CONFIRM_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("cannot be edited to name another member", () => {
    const m = mintConfirmation(SECRET, "user-1", "request-exit", 0, T0);
    const [payload, sig] = m.token.split(".");
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    p.userId = "user-2";
    const forged = `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${sig}`;
    expect(readConfirmation(SECRET, m.token, T0).ok).toBe(true); // positive control
    expect(readConfirmation(SECRET, forged, T0)).toEqual({ ok: false, reason: "unreadable" });
    expect(readConfirmation("another-secret", m.token, T0)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("refuses every other token this server signs with the same key", () => {
    for (const other of [
      encodeToken(SECRET, "user-1", "a@example.test", 0),
      makeHandoffToken(SECRET, "user-1", 0, T0),
      makeOAuthState(SECRET, "/profile", T0, "delete-account"),
      "",
      "not.a.token",
    ]) {
      expect(readConfirmation(SECRET, other, T0)).toEqual({ ok: false, reason: "unreadable" });
    }
  });
});

describe("single use lives on the member's row", () => {
  const row = () => ({ id: "user-1", prefs: { googleLink: { sub: "s", linkedAt: "t", sig: "x" }, notify: { questsEmail: "off" } } as any });

  it("spends once, and only once", () => {
    const member = row();
    recordPending(member, "request-exit", "jti-a", T0 + 1000);
    expect(spendPending(member, "request-exit", "jti-a", T0)).toBe(true);
    expect(spendPending(member, "request-exit", "jti-a", T0)).toBe(false);
  });

  it("keeps every other preference it sits beside", () => {
    const member = row();
    recordPending(member, "request-exit", "jti-a", T0 + 1000);
    spendPending(member, "request-exit", "jti-a", T0);
    expect(member.prefs.googleLink).toEqual({ sub: "s", linkedAt: "t", sig: "x" });
    expect(member.prefs.notify).toEqual({ questsEmail: "off" });
  });

  it("stores a digest and never the id itself", () => {
    const member = row();
    recordPending(member, "delete-account", "the-raw-jti", T0 + 1000);
    expect(JSON.stringify(member.prefs)).not.toContain("the-raw-jti");
  });

  it("a wrong id spends nothing and leaves the real one spendable", () => {
    const member = row();
    recordPending(member, "request-exit", "jti-a", T0 + 1000);
    expect(spendPending(member, "request-exit", "jti-b", T0)).toBe(false);
    expect(spendPending(member, "request-exit", "jti-a", T0)).toBe(true);
  });

  it("one action's confirmation is not spent by the other action", () => {
    const member = row();
    recordPending(member, "request-exit", "jti-a", T0 + 1000);
    expect(spendPending(member, "delete-account", "jti-a", T0)).toBe(false);
    expect(spendPending(member, "request-exit", "jti-a", T0)).toBe(true);
  });

  it("a newer confirmation for the same action revokes the older one", () => {
    const member = row();
    recordPending(member, "delete-account", "jti-old", T0 + 1000);
    recordPending(member, "delete-account", "jti-new", T0 + 1000);
    expect(spendPending(member, "delete-account", "jti-old", T0)).toBe(false);
    expect(spendPending(member, "delete-account", "jti-new", T0)).toBe(true);
  });

  it("an expired record is refused even with the right id", () => {
    const member = row();
    recordPending(member, "request-exit", "jti-a", T0 + 1000);
    expect(spendPending(member, "request-exit", "jti-a", T0 + 1001)).toBe(false);
  });
});

/** One member, a fake repository that mutates the row in place, and a clock. */
function world(opts: { passwordHash?: string; linked?: boolean; google?: boolean } = {}) {
  const row: any = { id: "user-g", passwordHash: opts.passwordHash ?? "", tokenVersion: 0, prefs: {} };
  if (opts.linked !== false) row.prefs.googleLink = makeGoogleLink(SECRET, row.id, "sub-g");
  let clock = T0;
  const gate = makeIdentityGate({
    authSecret: SECRET,
    verifyPassword: async (pw, hash) => hash === `hash:${pw}`,
    googleAvailable: () => opts.google !== false,
    members: {
      update: async (id, mutate) => {
        if (id !== row.id) return null;
        mutate(row);
        return row;
      },
    },
    now: () => clock,
  });
  const cleared: string[] = [];
  const res: any = { clearCookie: (name: string) => cleared.push(name) };
  const confirmFor = (action: ConfirmAction, userId: string = row.id) => {
    const m = mintConfirmation(SECRET, userId, action, row.tokenVersion, clock);
    if (userId === row.id) recordPending(row, action, m.jti, m.exp);
    return m.token;
  };
  const req = (body: unknown, cookies: Record<string, string> = {}) =>
    ({
      body,
      headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ") },
    }) as any;
  return { row, gate, res, req, cleared, confirmFor, tick: (ms: number) => (clock += ms) };
}

describe("the gate both destructive routes call", () => {
  it("a password member passes with the right password, exactly as before", async () => {
    const w = world({ passwordHash: "hash:right" });
    expect(await w.gate(w.req({ password: "right" }), w.res, w.row, "request-exit")).toEqual({ ok: true, via: "password" });
  });

  it("a password member with the wrong password gets the old body, byte for byte", async () => {
    const w = world({ passwordHash: "hash:right" });
    expect(await w.gate(w.req({ password: "wrong" }), w.res, w.row, "request-exit")).toEqual({
      ok: false,
      body: { error: "Confirm with your password" },
    });
    expect(await w.gate(w.req({}), w.res, w.row, "delete-account")).toEqual({
      ok: false,
      body: { error: "Confirm with your password to delete your account" },
    });
    expect(PASSWORD_REFUSAL["delete-account"]).toBe("Confirm with your password to delete your account");
  });

  it("a password member cannot swap the password for a Google confirmation", async () => {
    const w = world({ passwordHash: "hash:right" });
    const token = w.confirmFor("delete-account");
    const out = await w.gate(w.req({}, { [confirmCookieName("delete-account")]: token }), w.res, w.row, "delete-account");
    expect(out).toEqual({ ok: false, body: { error: PASSWORD_REFUSAL["delete-account"] } });
  });

  it("GOOGLE OFF: a member with no password is refused in words, with a cookie or without", async () => {
    const w = world({ google: false });
    const bare = await w.gate(w.req({}), w.res, w.row, "delete-account");
    expect(bare).toEqual({ ok: false, body: { error: NO_WAY_TO_CONFIRM, confirmWith: "none" } });
    const token = w.confirmFor("delete-account");
    const carried = await w.gate(w.req({}, { [confirmCookieName("delete-account")]: token }), w.res, w.row, "delete-account");
    expect(carried).toEqual({ ok: false, body: { error: NO_WAY_TO_CONFIRM, confirmWith: "none" } });
  });

  it("a member with no password and no Google link is told the same way forward", async () => {
    const w = world({ linked: false });
    expect(await w.gate(w.req({ password: "anything" }), w.res, w.row, "request-exit")).toEqual({
      ok: false,
      body: { error: NO_WAY_TO_CONFIRM, confirmWith: "none" },
    });
  });

  it("with no confirmation, a Google member is asked for one, and a password is not accepted", async () => {
    const w = world();
    expect(await w.gate(w.req({ password: "" }), w.res, w.row, "request-exit")).toEqual({
      ok: false,
      body: { error: googleRefusal("request-exit"), confirmWith: "google" },
    });
    expect(googleRefusal("request-exit")).toContain("Confirm with Google");
  });

  it("a real confirmation passes once, clears its cookie, and is refused the second time", async () => {
    const w = world();
    const cookies = { [confirmCookieName("request-exit")]: w.confirmFor("request-exit") };
    expect(await w.gate(w.req({}, cookies), w.res, w.row, "request-exit")).toEqual({ ok: true, via: "google" });
    expect(w.cleared).toContain(confirmCookieName("request-exit"));
    expect(await w.gate(w.req({}, cookies), w.res, w.row, "request-exit")).toEqual({
      ok: false,
      body: { error: CONFIRM_REFUSAL.spent, confirmWith: "google" },
    });
  });

  it("two requests racing with one confirmation: exactly one passes", async () => {
    const w = world();
    const cookies = { [confirmCookieName("delete-account")]: w.confirmFor("delete-account") };
    const outs = await Promise.all([
      w.gate(w.req({}, cookies), w.res, w.row, "delete-account"),
      w.gate(w.req({}, cookies), w.res, w.row, "delete-account"),
    ]);
    expect(outs.filter((o) => o.ok)).toHaveLength(1);
  });

  it("an expired confirmation is refused", async () => {
    const w = world();
    const cookies = { [confirmCookieName("request-exit")]: w.confirmFor("request-exit") };
    w.tick(IDENTITY_CONFIRM_TTL_MS + 1);
    expect(await w.gate(w.req({}, cookies), w.res, w.row, "request-exit")).toEqual({
      ok: false,
      body: { error: CONFIRM_REFUSAL.expired, confirmWith: "google" },
    });
  });

  it("another member's confirmation is refused", async () => {
    const w = world();
    const cookies = { [confirmCookieName("request-exit")]: w.confirmFor("request-exit", "user-other") };
    expect(await w.gate(w.req({}, cookies), w.res, w.row, "request-exit")).toEqual({
      ok: false,
      body: { error: CONFIRM_REFUSAL.otherMember, confirmWith: "google" },
    });
  });

  it("a confirmation to leave cannot delete, and stays good for leaving", async () => {
    const w = world();
    const exitToken = w.confirmFor("request-exit");
    const wrongDoor = await w.gate(w.req({}, { [confirmCookieName("delete-account")]: exitToken }), w.res, w.row, "delete-account");
    expect(wrongDoor).toEqual({ ok: false, body: { error: CONFIRM_REFUSAL.otherAction, confirmWith: "google" } });
    const rightDoor = await w.gate(w.req({}, { [confirmCookieName("request-exit")]: exitToken }), w.res, w.row, "request-exit");
    expect(rightDoor).toEqual({ ok: true, via: "google" });
  });

  it("signing out anywhere retires a confirmation", async () => {
    const w = world();
    const cookies = { [confirmCookieName("delete-account")]: w.confirmFor("delete-account") };
    w.row.tokenVersion = 1;
    expect(await w.gate(w.req({}, cookies), w.res, w.row, "delete-account")).toEqual({
      ok: false,
      body: { error: CONFIRM_REFUSAL.expired, confirmWith: "google" },
    });
  });

  it("a confirmation replaced by a newer one is refused as used", async () => {
    const w = world();
    const older = w.confirmFor("delete-account");
    w.confirmFor("delete-account");
    expect(await w.gate(w.req({}, { [confirmCookieName("delete-account")]: older }), w.res, w.row, "delete-account")).toEqual({
      ok: false,
      body: { error: CONFIRM_REFUSAL.spent, confirmWith: "google" },
    });
  });
});

describe("the pieces around the gate", () => {
  it("OAuth state carries the action and still refuses an edit", () => {
    const state = makeOAuthState(SECRET, "/profile", T0, "delete-account");
    expect(readOAuthState(SECRET, state, T0)).toMatchObject({ next: "/profile", confirm: "delete-account" });
    expect(readOAuthState(SECRET, makeOAuthState(SECRET, "/profile", T0), T0)?.confirm).toBeNull();
    const [payload, sig] = state.split(".");
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    p.confirm = "request-exit";
    expect(readOAuthState(SECRET, `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${sig}`, T0)).toBeNull();
  });

  it("the return address goes back to the screen, with or without a query already on it", () => {
    expect(confirmReturnUrl(null, "request-exit", "google_confirm=request-exit")).toBe("/exit-policy?google_confirm=request-exit");
    expect(confirmReturnUrl("/profile?tab=data", "delete-account", "google_confirm=delete-account")).toBe(
      "/profile?tab=data&google_confirm=delete-account",
    );
  });

  it("reads one cookie out of a header", () => {
    expect(readCookieValue("a=1; village_confirm_request-exit=x.y; b=2", "village_confirm_request-exit")).toBe("x.y");
    expect(readCookieValue("a=1", "village_confirm_request-exit")).toBeNull();
    expect(readCookieValue(undefined, "a")).toBeNull();
  });

  it("tells the screen what a member confirms with", () => {
    const linked = { id: "user-g", passwordHash: "", prefs: { googleLink: makeGoogleLink(SECRET, "user-g", "sub-g") } };
    expect(confirmWithFor({ ...linked, passwordHash: "hash" }, SECRET, true)).toBe("password");
    expect(confirmWithFor(linked, SECRET, true)).toBe("google");
    expect(confirmWithFor(linked, SECRET, false)).toBe("none");
    expect(confirmWithFor({ id: "user-g", passwordHash: "", prefs: {} }, SECRET, true)).toBe("none");
    // A link signed for somebody else does not count for this member.
    expect(confirmWithFor({ ...linked, id: "user-h" }, SECRET, true)).toBe("none");
  });
});
