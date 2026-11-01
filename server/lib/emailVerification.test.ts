/**
 * The address-proof link, and the two row writes R104 rests on.
 *
 * A sign-up stores an address nobody has proved. This link is how its owner
 * proves it: it is mailed to the address, signed, purpose-bound, and dies
 * once the address is proved. `proveAddress` and `endUnprovenPassword` are
 * the mutators every route runs under the row lock, so the rule lives in one
 * place.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_VERIFY_REFUSAL,
  EMAIL_VERIFY_TTL_MS,
  emailVerifyRefusal,
  endUnprovenPassword,
  makeEmailVerifyToken,
  proveAddress,
  raiseToFounder,
  readEmailVerifyToken,
  sendVerifyLetter,
} from "./emailVerification";
import { makeSetPasswordToken, readSetPasswordToken } from "./memberTokens";

const SECRET = "an-address-proof-test-secret"; // module-review-ok: a throwaway signing key; these routes run on a stand-in app
const EMAIL = "wren@example.test";
const PROVED = "2026-10-01T00:00:00.000Z";

const row = (over: Record<string, unknown> = {}) => ({
  id: "u-wren",
  email: EMAIL,
  passwordHash: "a-hash",
  tokenVersion: 2,
  emailVerifiedAt: null as string | null,
  ...over,
});

describe("the address-proof link", () => {
  it("reads back the member and the address it was minted for", () => {
    const token = makeEmailVerifyToken(SECRET, "u-wren", EMAIL);
    expect(readEmailVerifyToken(SECRET, token)).toEqual({ userId: "u-wren", email: EMAIL });
  });

  it("folds the address's case, so the link matches however the member typed it", () => {
    const token = makeEmailVerifyToken(SECRET, "u-wren", "Wren@Example.TEST");
    expect(readEmailVerifyToken(SECRET, token)?.email).toBe(EMAIL);
  });

  it("refuses a link past its expiry", () => {
    const minted = Date.now();
    const token = makeEmailVerifyToken(SECRET, "u-wren", EMAIL, minted);
    expect(readEmailVerifyToken(SECRET, token, minted + EMAIL_VERIFY_TTL_MS - 1000)).not.toBeNull();
    expect(readEmailVerifyToken(SECRET, token, minted + EMAIL_VERIFY_TTL_MS + 1000)).toBeNull();
  });

  it("refuses a link edited to name another member, and one signed with another key", () => {
    const token = makeEmailVerifyToken(SECRET, "u-wren", EMAIL);
    const [payload, sig] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    const edited = Buffer.from(JSON.stringify({ ...claims, userId: "u-founder" })).toString("base64url");
    expect(readEmailVerifyToken(SECRET, `${edited}.${sig}`)).toBeNull();
    expect(readEmailVerifyToken("another-secret", token)).toBeNull();
    expect(readEmailVerifyToken(SECRET, "not-a-token")).toBeNull();
  });

  it("is never a set-password link, and a set-password link is never one of these", () => {
    // Same signer, so the purpose field is the only thing keeping a link that
    // proves an address from setting a password, and the other way round.
    const proof = makeEmailVerifyToken(SECRET, "u-wren", EMAIL);
    const reset = makeSetPasswordToken(SECRET, "u-wren", 2);
    expect(readSetPasswordToken(SECRET, proof)).toBeNull();
    expect(readEmailVerifyToken(SECRET, reset)).toBeNull();
  });
});

describe("whether a link may prove the address now", () => {
  const claim = { userId: "u-wren", email: EMAIL };

  it("may, for the account it was minted for whose address is unproved", () => {
    expect(emailVerifyRefusal(claim, row())).toBeNull();
  });

  it("is spent once the address is proved, however that happened", () => {
    expect(emailVerifyRefusal(claim, row({ emailVerifiedAt: PROVED }))).toBe(EMAIL_VERIFY_REFUSAL.used);
  });

  it("is dead once the account's address is no longer the one it was sent to", () => {
    expect(emailVerifyRefusal(claim, row({ email: "someone-else@example.test" }))).toBe(EMAIL_VERIFY_REFUSAL.invalid);
    expect(emailVerifyRefusal(claim, row({ email: "deleted-u-wren@anonymized.invalid" }))).toBe(EMAIL_VERIFY_REFUSAL.invalid);
    expect(emailVerifyRefusal(claim, null)).toBe(EMAIL_VERIFY_REFUSAL.invalid);
    expect(emailVerifyRefusal(claim, row({ isExample: true }))).toBe(EMAIL_VERIFY_REFUSAL.invalid);
  });
});

describe("the row writes", () => {
  it("records the proof once, and a second proof keeps the first instant", () => {
    const u = row();
    expect(proveAddress(u, EMAIL, PROVED)).toBe(true);
    expect(u.emailVerifiedAt).toBe(PROVED);
    expect(proveAddress(u, EMAIL, "2026-10-31T00:00:00.000Z")).toBe(false);
    expect(u.emailVerifiedAt).toBe(PROVED);
  });

  it("proves only the address that was actually proved", () => {
    const u = row();
    expect(proveAddress(u, "other@example.test", PROVED)).toBe(false);
    expect(u.emailVerifiedAt).toBeNull();
    expect(proveAddress(u, "WREN@example.test", PROVED)).toBe(true);
  });

  it("ends a password nobody proved: the hash goes and every session with it", () => {
    const u = row();
    expect(endUnprovenPassword(u)).toBe(true);
    expect(u.passwordHash).toBe("");
    expect(u.tokenVersion).toBe(3);
  });

  it("leaves a proved password and an account with no password untouched", () => {
    const proved = row({ emailVerifiedAt: PROVED });
    expect(endUnprovenPassword(proved)).toBe(false);
    expect(proved).toEqual(row({ emailVerifiedAt: PROVED }));
    const bare = row({ passwordHash: "" });
    expect(endUnprovenPassword(bare)).toBe(false);
    expect(bare.tokenVersion).toBe(2);
  });
});

describe("bootstrap raising an existing row to founder (R104)", () => {
  function members(start: any) {
    let stored = structuredClone(start);
    return {
      get: () => stored,
      update: async (_id: string, mutate: (u: any) => void) => {
        const next = structuredClone(stored);
        mutate(next);
        stored = next;
        return structuredClone(next);
      },
    };
  }

  it("ends a password nobody proved, its sessions and its agent reach, in the write that raises the role", async () => {
    const m = members(row({ role: "member" }));
    const ended: string[] = [];
    const fresh = await raiseToFounder(m, m.get(), async (id, change) => (ended.push(id), change()));
    expect(m.get().role).toBe("founder");
    expect(m.get().passwordHash, "bootstrap made a founder of a row whose planted password still works").toBe("");
    expect(m.get().tokenVersion).toBe(3);
    expect(ended).toEqual(["u-wren"]);
    expect(fresh.tokenVersion, "the claim link would be minted at a version the bump already spent").toBe(3);
  });

  it("raises a PROVED row with its password, its sessions and its agent's reach untouched", async () => {
    const m = members(row({ role: "member", emailVerifiedAt: PROVED }));
    const ended: string[] = [];
    await raiseToFounder(m, m.get(), async (id, change) => (ended.push(id), change()));
    expect(m.get().role).toBe("founder");
    expect(m.get().passwordHash).toBe("a-hash");
    expect(m.get().tokenVersion).toBe(2);
    expect(ended).toEqual([]);
  });
});

describe("the letter", () => {
  const deps = (sendEmail: any) => ({
    authSecret: SECRET,
    sendEmail,
    escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
    origin: () => "https://village.example",
    projectName: () => "Test Village",
  });

  it("goes to the address on the account, carrying a link that proves exactly that account", async () => {
    const sent: any[] = [];
    const result = await sendVerifyLetter(deps(async (m: any) => (sent.push(m), { sent: true })), row());
    expect(result).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([EMAIL]);
    const link = /https:\/\/village\.example\/verify-email\?token=([^"<\s]+)/.exec(sent[0].html);
    expect(link, "no link in the letter").not.toBeNull();
    expect(readEmailVerifyToken(SECRET, decodeURIComponent(link![1]))).toEqual({ userId: "u-wren", email: EMAIL });
  });

  it("answers what the post office did, and never throws into the sign-up", async () => {
    expect(await sendVerifyLetter(deps(async () => ({ sent: false, reason: "no_api_key" })), row())).toEqual({ sent: false, reason: "no_api_key" });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendVerifyLetter(deps(async () => { throw new Error("provider down"); }), row())).toEqual({ sent: false, reason: "failed" });
    quiet.mockRestore();
  });
});
