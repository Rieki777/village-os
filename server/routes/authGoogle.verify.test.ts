/**
 * R104: a Google sign-in onto an account whose address was never proved.
 *
 * Email sign-up never checked that the person typing an address owns it. So
 * anybody could make a password account at the address a future member (or
 * the founder) would later bring to Google, and the Google sign-in then linked
 * to that row and left the planted password and every session minted from it
 * standing. The member landed in an account somebody else still held the key
 * to, and FOUNDER_EMAILS could make that account the founder.
 *
 * The fix this pins: a Google sign-in that lands on a row holding a password
 * nobody proved belongs to the address ENDS that password, in the same locked
 * update that writes the link: the hash is cleared, tokenVersion moves (every
 * earlier session dies), and the agent reach that session could have left
 * (tokens, feeds, inbox, key, invitations, delegation) is ended around the
 * write. Google verified the address, so the row records that proof.
 *
 * No database: the members are an in-memory store whose `update` behaves like
 * the repository's (the mutator sees the row, the row is written back).
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./authGoogle";
import { OAUTH_HANDOFF_COOKIE, makeOAuthState, readOAuthState } from "../lib/oauthGoogle";
import { makeGoogleLink, readGoogleLink } from "../lib/oauthAccounts";

const SECRET = randomBytes(24).toString("hex");
const CLIENT_ID = "client-id.apps.example";
const EMAIL = "wren@example.test";
const SUB = "google-sub-wren";
const PROVED = "2026-10-01T00:00:00.000Z";

/** The password account somebody made at Wren's address before Wren arrived. */
const planted = (over: Record<string, unknown> = {}) => ({
  id: "u-wren",
  name: "Wren Halloway",
  email: EMAIL,
  passwordHash: "hash-of-a-password-somebody-else-typed",
  tokenVersion: 3,
  emailVerifiedAt: null as string | null,
  prefs: {} as Record<string, any>,
  role: "member",
  ...over,
});

function idToken(nonce: string, email = EMAIL): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    part({ alg: "none" }),
    part({ iss: "https://accounts.google.com", aud: CLIENT_ID, exp: now + 600, nonce, sub: SUB, email, email_verified: true, name: "Wren Halloway" }),
    "sig",
  ].join(".");
}

/** An in-memory members repository. `update` hands the mutator the stored row and keeps what it wrote. */
function store(rows: any[]) {
  const byId = new Map<string, any>(rows.map((r) => [r.id, structuredClone(r)]));
  const copy = (r: any) => (r ? structuredClone(r) : null);
  return {
    rows: byId,
    all: async () => [...byId.values()].map(copy),
    byId: async (id: string) => copy(byId.get(id)),
    byEmail: async (email: string) => copy([...byId.values()].find((r) => r.email.toLowerCase() === email.toLowerCase())),
    add: async (m: any) => (byId.set(m.id, structuredClone(m)), m),
    update: async (id: string, mutate: (u: any) => void) => {
      const r = byId.get(id);
      if (!r) return null;
      const next = structuredClone(r);
      mutate(next);
      byId.set(id, next);
      return copy(next);
    },
  };
}

function mount(members: any) {
  const routes = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const app = {
    get: (p: string, h: any) => routes.set(`GET ${p}`, h),
    post: (p: string, h: any) => routes.set(`POST ${p}`, h),
  } as any;
  const minted: Array<{ userId: string; v: number }> = [];
  const reachEnded: string[] = [];
  const told: string[] = [];
  const audit: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  register(app, {
    authSecret: SECRET,
    availability: () => ({ available: true, config: { clientId: CLIENT_ID, clientSecret: "s", redirectUri: "http://localhost/api/auth/google/callback" } }),
    members,
    encodeToken: (userId: string, _email: string, v: number) => {
      minted.push({ userId, v });
      return `session-for-${userId}`;
    },
    publicUser: (u: any) => u,
    makeHandle: async () => "h",
    overLimit: async () => false,
    clientIp: () => "127.0.0.1",
    recordAudit: (text: string) => void audit.push(text),
    onMemberJoined: () => {},
    endReachAround: async <T,>(userId: string, change: () => Promise<T>) => {
      reachEnded.push(userId);
      return change();
    },
    onPasswordEnded: (u: any) => void told.push(u.id),
    invites: {
      required: () => false,
      resolve: async () => ({ ok: false, error: "" }),
      claim: async () => null,
      release: async () => {},
      welcome: async () => {},
    } as any,
  } as any);
  log.mockRestore();

  const respond = () => {
    const out: { status: number; redirect: string | null; cookies: Record<string, string>; body: any } = {
      status: 200,
      redirect: null,
      cookies: {},
      body: null,
    };
    const res: any = {
      status: (s: number) => ((out.status = s), res),
      json: (b: any) => ((out.body = b), res),
      redirect: (s: number, url: string) => ((out.status = s), (out.redirect = url), res),
      cookie: (name: string, value: string) => ((out.cookies[name] = value), res),
      clearCookie: () => res,
    };
    return { out, res };
  };

  return {
    minted,
    reachEnded,
    told,
    audit,
    async callback(email = EMAIL) {
      const state = makeOAuthState(SECRET, "/profile");
      const nonce = readOAuthState(SECRET, state)!.nonce;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id_token: idToken(nonce, email) }), { status: 200, headers: { "content-type": "application/json" } }),
      );
      const { out, res } = respond();
      await routes.get("GET /api/auth/google/callback")!({ query: { code: "code-1", state }, headers: {} }, res);
      return out;
    },
    async exchange(handoff: string) {
      const { out, res } = respond();
      await routes.get("POST /api/auth/google/exchange")!(
        { headers: { cookie: `${OAUTH_HANDOFF_COOKIE}=${encodeURIComponent(handoff)}` } },
        res,
      );
      return out;
    },
  };
}

describe("a Google sign-in onto an account whose address was never proved (R104)", () => {
  const founders = process.env.FOUNDER_EMAILS;
  beforeEach(() => {
    delete process.env.FOUNDER_EMAILS;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    if (founders === undefined) delete process.env.FOUNDER_EMAILS;
    else process.env.FOUNDER_EMAILS = founders;
    vi.restoreAllMocks();
  });

  it("links only by ending the planted password and every session minted from it", async () => {
    const members = store([planted()]);
    const flow = mount(members);

    const out = await flow.callback();
    expect(out.redirect).toBe("/login?oauth=complete&next=%2Fprofile");

    const row = members.rows.get("u-wren");
    expect(row.passwordHash, "the planted password still opens the account").toBe("");
    expect(row.tokenVersion, "sessions minted from the planted password survive").toBe(4);
    expect(flow.reachEnded, "an agent token minted from the planted session survives").toEqual(["u-wren"]);
    expect(row.emailVerifiedAt, "Google proved the address and the row does not say so").toBeTruthy();
    expect(readGoogleLink(SECRET, row)).toBe(SUB);
    expect(flow.told, "the member is never told their password was removed").toEqual(["u-wren"]);

    // The one session that exists afterwards is the Google holder's.
    const exchanged = await flow.exchange(out.cookies[OAUTH_HANDOFF_COOKIE]);
    expect(exchanged.status).toBe(200);
    expect(flow.minted).toEqual([{ userId: "u-wren", v: 4 }]);
  });

  it("leaves a PROVED account's password and sessions exactly as they were", async () => {
    const members = store([planted({ emailVerifiedAt: PROVED })]);
    const flow = mount(members);

    const out = await flow.callback();
    expect(out.redirect).toBe("/login?oauth=complete&next=%2Fprofile");

    const row = members.rows.get("u-wren");
    expect(row.passwordHash).toBe("hash-of-a-password-somebody-else-typed");
    expect(row.tokenVersion).toBe(3);
    expect(row.emailVerifiedAt).toBe(PROVED);
    expect(flow.reachEnded).toEqual([]);
    expect(flow.told).toEqual([]);
    expect(readGoogleLink(SECRET, row)).toBe(SUB);
  });

  it("links an account with NO password (bootstrap's founder) and records the proof, with nothing to end", async () => {
    const members = store([planted({ passwordHash: "", tokenVersion: 0 })]);
    const flow = mount(members);

    await flow.callback();

    const row = members.rows.get("u-wren");
    expect(row.tokenVersion).toBe(0);
    expect(flow.reachEnded).toEqual([]);
    expect(row.emailVerifiedAt).toBeTruthy();
    expect(readGoogleLink(SECRET, row)).toBe(SUB);
  });

  it("takes over an account linked BEFORE the fix that still holds a password nobody proved", async () => {
    // The old code wrote this link onto a planted account and left the
    // password standing. The subject match is the Google holder coming back.
    const members = store([planted({ prefs: { googleLink: makeGoogleLink(SECRET, "u-wren", SUB) } })]);
    const flow = mount(members);

    const out = await flow.callback();
    expect(out.redirect).toBe("/login?oauth=complete&next=%2Fprofile");

    const row = members.rows.get("u-wren");
    expect(row.passwordHash).toBe("");
    expect(row.tokenVersion).toBe(4);
    expect(flow.reachEnded).toEqual(["u-wren"]);
    expect(row.emailVerifiedAt).toBeTruthy();
  });

  it("ends the password on a subject match whose Google address moved, and proves nothing about the old address", async () => {
    // Google verified a DIFFERENT address, so the row's own address is still
    // unproved. The password nobody proved still goes.
    const members = store([planted({ email: "old-wren@example.test", prefs: { googleLink: makeGoogleLink(SECRET, "u-wren", SUB) } })]);
    const flow = mount(members);

    await flow.callback(EMAIL);

    const row = members.rows.get("u-wren");
    expect(row.passwordHash).toBe("");
    expect(row.tokenVersion).toBe(4);
    expect(row.emailVerifiedAt, "an address Google never saw was marked proved").toBeNull();
  });

  it("makes the founder only once the planted password is gone", async () => {
    process.env.FOUNDER_EMAILS = EMAIL;
    const members = store([planted()]);
    const flow = mount(members);

    await flow.callback();

    const row = members.rows.get("u-wren");
    expect(row.role).toBe("founder");
    expect(row.passwordHash, "the founder role went to a row whose planted password still works").toBe("");
  });

  it("refuses, writing nothing, when the row under the lock holds a password the plain read did not see", async () => {
    // Read: proved, nothing to end. Lock: a password nobody proved. Never
    // reached by any path today, so it fails closed instead of linking.
    const members = store([planted()]);
    const proved = { ...planted({ emailVerifiedAt: PROVED }) };
    const flow = mount({ ...members, all: async () => [proved], byEmail: async () => structuredClone(proved) });

    const out = await flow.callback();

    expect(out.cookies[OAUTH_HANDOFF_COOKIE]).toBeUndefined();
    expect(out.redirect).toBe("/login?oauth=error&reason=account_changed");
    const row = members.rows.get("u-wren");
    expect(readGoogleLink(SECRET, row), "a link was written onto a row the decision never saw").toBeNull();
    expect(row.passwordHash).toBe("hash-of-a-password-somebody-else-typed");
  });

  it("refuses a row the database matched only by folding accents, and touches nothing on it", async () => {
    // `users.email` compares under utf8mb4_0900_ai_ci on MySQL 8, so a lookup
    // for `wrén@` returns the row at `wren@`, which is somebody else's
    // mailbox. Linking it would end THEIR password and hand their account to
    // whoever reads the lookalike address.
    const members = store([planted()]);
    const folded = { ...members, byEmail: async () => structuredClone(members.rows.get("u-wren")) };
    const flow = mount(folded);

    const out = await flow.callback("wrén@example.test");

    expect(out.cookies[OAUTH_HANDOFF_COOKIE]).toBeUndefined();
    expect(out.redirect).toBe("/login?oauth=error&reason=account_unavailable");
    const row = members.rows.get("u-wren");
    expect(row.passwordHash, "a lookalike address ended the real owner's password").toBe("hash-of-a-password-somebody-else-typed");
    expect(readGoogleLink(SECRET, row)).toBeNull();
    expect(flow.reachEnded).toEqual([]);
  });

  it("records the proof on an account Google makes", async () => {
    const members = store([]);
    const flow = mount(members);

    const out = await flow.callback();
    expect(out.redirect).toBe("/login?oauth=complete&next=%2Fprofile");

    const [row] = [...members.rows.values()];
    expect(row.email).toBe(EMAIL);
    expect(row.emailVerifiedAt).toBeTruthy();
    expect(flow.reachEnded).toEqual([]);
  });
});
