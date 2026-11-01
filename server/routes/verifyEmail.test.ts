/**
 * Proving an address: the link mailed at sign-up, redeemed.
 *
 * WHY THE LINK ALONE IS NOT ENOUGH. A planted account (R104) mails its letter
 * to the real owner of the address, who never made it. If one click on that
 * letter proved the address, a curious click would mark the planted password
 * as the owner's own, and the owner's later Google sign-in would link without
 * ending it: the pre-hijack, one click away. So redeeming needs the link AND
 * the account's own credential, a live session for that member or its
 * password: the person holding the password and the person reading the
 * mailbox are then shown to be one person, which is the fact the proof means.
 *
 * No database: members are an in-memory store, sessions are a header the
 * stand-in session reader understands.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./verifyEmail";
import { EMAIL_VERIFY_REFUSAL, EMAIL_VERIFY_TTL_MS, makeEmailVerifyToken, readEmailVerifyToken } from "../lib/emailVerification";

const SECRET = "verify-route-test-secret"; // module-review-ok: a throwaway signing key; these routes run on a stand-in app
const EMAIL = "wren@example.test";

const member = (over: Record<string, unknown> = {}) => ({
  id: "u-wren",
  name: "Wren",
  email: EMAIL,
  passwordHash: "hashed:the-right-password",
  tokenVersion: 0,
  emailVerifiedAt: null as string | null,
  prefs: {},
  ...over,
});

function mount(rows: any[]) {
  const byId = new Map<string, any>(rows.map((r) => [r.id, structuredClone(r)]));
  const routes = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const app = {
    get: (p: string, h: any) => routes.set(`GET ${p}`, h),
    post: (p: string, h: any) => routes.set(`POST ${p}`, h),
  } as any;
  const letters: any[] = [];
  register(app, {
    authSecret: SECRET,
    sendEmail: async (m: any) => (letters.push(m), { sent: true }),
    escapeHtml: (s: string) => s,
    origin: () => "https://village.example",
    projectName: () => "Test Village",
    members: {
      byId: async (id: string) => (byId.has(id) ? structuredClone(byId.get(id)) : null),
      update: async (id: string, mutate: (u: any) => void) => {
        const r = byId.get(id);
        if (!r) return null;
        const next = structuredClone(r);
        mutate(next);
        byId.set(id, next);
        return structuredClone(next);
      },
    },
    // A session is `Bearer session-<id>`, for a member that exists.
    authedUser: async (req: any) => {
      const m = /^Bearer session-(.+)$/.exec(String(req.headers?.authorization ?? ""));
      return m && byId.has(m[1]) ? structuredClone(byId.get(m[1])) : null;
    },
    verifyPassword: async (password: string, hash: string) => !!hash && hash === `hashed:${password}`,
    overLimit: async () => false,
    clientIp: () => "127.0.0.1",
    recordAudit: () => {},
  });

  async function call(route: string, body: any, session?: string) {
    const out: { status: number; body: any } = { status: 200, body: null };
    const res: any = {
      status: (s: number) => ((out.status = s), res),
      json: (b: any) => ((out.body = b), res),
    };
    await routes.get(route)!({ body, headers: session ? { authorization: `Bearer session-${session}` } : {} }, res);
    return out;
  }

  return {
    row: (id = "u-wren") => byId.get(id),
    letters,
    redeem: (body: any, session?: string) => call("POST /api/auth/verify-email", body, session),
    resend: (session?: string) => call("POST /api/auth/verify-email/send", {}, session),
  };
}

const link = (now = Date.now()) => makeEmailVerifyToken(SECRET, "u-wren", EMAIL, now);

describe("redeeming the address-proof link", () => {
  afterEach(() => vi.restoreAllMocks());

  it("proves the address once, with the member's own session, and the same link cannot prove it again", async () => {
    const v = mount([member()]);
    const token = link();

    const first = await v.redeem({ token }, "u-wren");
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const provedAt = v.row().emailVerifiedAt;
    expect(provedAt, "the address is still unproved").toBeTruthy();

    const replay = await v.redeem({ token }, "u-wren");
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe(EMAIL_VERIFY_REFUSAL.used);
    expect(v.row().emailVerifiedAt, "a second redemption moved the proof").toBe(provedAt);
  });

  it("proves it with the account's password when this browser holds no session", async () => {
    // A phone's home-screen app keeps its own storage, so the letter opens in
    // a browser that is not signed in. The password stands in for the session.
    const v = mount([member()]);
    const res = await v.redeem({ token: link(), password: "the-right-password" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(v.row().emailVerifiedAt).toBeTruthy();
  });

  it("REFUSES a click from somebody holding neither, which is the owner of a mailbox somebody signed up with", async () => {
    const v = mount([member()]);
    const res = await v.redeem({ token: link() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("credential_required");
    expect(v.row().emailVerifiedAt, "one click proved a password the clicker never set").toBeNull();
  });

  it("refuses a wrong password, and a session belonging to somebody else", async () => {
    const v = mount([member(), member({ id: "u-other", email: "other@example.test" })]);
    const wrong = await v.redeem({ token: link(), password: "a-guess" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("wrong_password");
    const elsewhere = await v.redeem({ token: link() }, "u-other");
    expect(elsewhere.status).toBe(403);
    expect(v.row().emailVerifiedAt).toBeNull();
  });

  it("refuses an expired link and a forged one", async () => {
    const v = mount([member()]);
    const lapsed = await v.redeem({ token: link(Date.now() - EMAIL_VERIFY_TTL_MS - 60_000) }, "u-wren");
    expect(lapsed.status).toBe(400);
    expect(lapsed.body.error).toBe(EMAIL_VERIFY_REFUSAL.invalid);
    const forged = await v.redeem({ token: makeEmailVerifyToken("not-this-village", "u-wren", EMAIL) }, "u-wren");
    expect(forged.status).toBe(400);
    expect(v.row().emailVerifiedAt).toBeNull();
  });

  it("refuses a link for an address the account no longer holds", async () => {
    const v = mount([member({ email: "deleted-u-wren@anonymized.invalid" })]);
    const res = await v.redeem({ token: link() }, "u-wren");
    expect(res.status).toBe(400);
    expect(v.row().emailVerifiedAt).toBeNull();
  });
});

describe("asking for the letter again", () => {
  it("mails a signed-in member with an unproved address a fresh link, and never hands it back", async () => {
    const v = mount([member()]);
    const res = await v.resend("u-wren");
    expect(res.status).toBe(200);
    expect(res.body.emailed).toBe(true);
    expect(v.letters).toHaveLength(1);
    expect(v.letters[0].to).toEqual([EMAIL]);
    const token = decodeURIComponent(/verify-email\?token=([^"<\s]+)/.exec(v.letters[0].html)![1]);
    expect(readEmailVerifyToken(SECRET, token)?.userId).toBe("u-wren");
    // The link reaches the mailbox and nowhere else: the caller is the one
    // party who must not be able to prove an address by asking.
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it("sends nothing once the address is proved, and refuses a stranger", async () => {
    const v = mount([member({ emailVerifiedAt: "2026-10-01T00:00:00.000Z" })]);
    const proved = await v.resend("u-wren");
    expect(proved.status).toBe(200);
    expect(proved.body.already).toBe(true);
    expect(v.letters).toEqual([]);
    expect((await v.resend()).status).toBe(401);
  });
});
