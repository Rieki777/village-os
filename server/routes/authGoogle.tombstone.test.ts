/**
 * A Google sign-in that races an erasure, and the session it must never mint.
 *
 * The callback decides from a plain read of the member (`byEmail`, or the scan
 * for a linked subject), then writes under the row lock with `members.update`,
 * which hands back the row as it is NOW. A sign-in whose read landed before the
 * tombstone and whose write landed after it got the tombstone back, with the
 * tombstone's bumped tokenVersion, and signed the handoff at that version. The
 * exchange compares against the same version, so it issued a 30-day session to
 * an account the member had asked to be forgotten, and the link it wrote
 * refused that Google account forever after.
 *
 * Each case stands the race up exactly: the read returns the live member and
 * the locked write applies to a tombstoned copy.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./authGoogle";
import { OAUTH_HANDOFF_COOKIE, makeHandoffToken, makeOAuthState, readOAuthState } from "../lib/oauthGoogle";
import { makeGoogleLink, readGoogleLink } from "../lib/oauthAccounts";

/** Any signing key does: these routes are mounted on a stand-in app, so a fresh one per run is all they need. */
const SECRET = randomBytes(24).toString("hex");
const CLIENT_ID = "client-id.apps.example";
const EMAIL = "wren@example.test";
const SUB = "google-sub-wren";

const live = () => ({ id: "u-wren", name: "Wren Halloway", email: EMAIL, passwordHash: "x", tokenVersion: 0, prefs: {}, role: "member" });
const tomb = () => ({
  id: "u-wren",
  name: "A departed member",
  email: "deleted-u-wren@anonymized.invalid",
  passwordHash: "",
  tokenVersion: 1,
  prefs: {} as Record<string, unknown>,
  role: "member",
});

function idToken(nonce: string): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    part({ alg: "none" }),
    part({ iss: "https://accounts.google.com", aud: CLIENT_ID, exp: now + 600, nonce, sub: SUB, email: EMAIL, email_verified: true, name: "Wren Halloway" }),
    "sig",
  ].join(".");
}

/** The routes, mounted on a stand-in app, over the members a case hands in. */
function mount(members: Record<string, any>) {
  const routes = new Map<string, (req: any, res: any) => Promise<unknown>>();
  const app = {
    get: (p: string, h: any) => routes.set(`GET ${p}`, h),
    post: (p: string, h: any) => routes.set(`POST ${p}`, h),
  } as any;
  const minted: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  register(app, {
    authSecret: SECRET,
    availability: () => ({ available: true, config: { clientId: CLIENT_ID, clientSecret: "s", redirectUri: "http://localhost/api/auth/google/callback" } }),
    members: members as any,
    encodeToken: (userId: string) => {
      minted.push(userId);
      return `session-for-${userId}`;
    },
    publicUser: (u: any) => u,
    makeHandle: async () => "h",
    overLimit: async () => false,
    clientIp: () => "127.0.0.1",
    recordAudit: () => {},
    onMemberJoined: () => {},
    endReachAround: (_userId: string, change: () => Promise<any>) => change(),
    onPasswordEnded: () => {},
    invites: {
      required: () => false,
      resolve: async () => ({ ok: false, error: "" }),
      claim: async () => null,
      release: async () => {},
      welcome: async () => {},
    } as any,
  });
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
    async callback() {
      const state = makeOAuthState(SECRET, "/profile");
      const nonce = readOAuthState(SECRET, state)!.nonce;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id_token: idToken(nonce) }), { status: 200, headers: { "content-type": "application/json" } }),
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

describe("a Google sign-in that lands on a tombstone", () => {
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

  it("refuses the link write and hands back no handoff, when the read saw the member and the lock saw the tombstone", async () => {
    const row = tomb();
    const flow = mount({
      all: async () => [live()],
      byEmail: async () => live(),
      byId: async () => row,
      update: async (_id: string, mutate: (u: any) => void) => {
        mutate(row);
        return row;
      },
    });

    const out = await flow.callback();

    expect(out.cookies[OAUTH_HANDOFF_COOKIE], "a handoff was signed for a tombstone").toBeUndefined();
    expect(out.redirect).toBe("/login?oauth=error&reason=account_unavailable");
    // And the tombstone carries no link that would refuse this Google account forever.
    expect(readGoogleLink(SECRET, row), "a Google link was written onto a tombstone").toBeNull();
    expect(row.prefs.googleLink).toBeUndefined();
  });

  it("refuses the founder grant too, when a linked member's row turned into a tombstone under the lock", async () => {
    process.env.FOUNDER_EMAILS = EMAIL;
    const before = { ...live(), prefs: { googleLink: makeGoogleLink(SECRET, "u-wren", SUB) } };
    const row = tomb();
    const flow = mount({
      all: async () => [before],
      byEmail: async () => before,
      byId: async () => row,
      update: async (_id: string, mutate: (u: any) => void) => {
        mutate(row);
        return row;
      },
    });

    const out = await flow.callback();

    expect(out.cookies[OAUTH_HANDOFF_COOKIE], "a handoff was signed for a tombstone").toBeUndefined();
    expect(out.redirect).toBe("/login?oauth=error&reason=account_unavailable");
    expect(row.role, "the founder role was written onto a tombstone").toBe("member");
  });

  it("will not trade a handoff for a session once its member is a tombstone", async () => {
    const row = tomb();
    const flow = mount({ all: async () => [], byEmail: async () => null, byId: async () => row, update: async () => row });

    // A handoff signed at the tombstone's own version: the shape the race produced.
    const out = await flow.exchange(makeHandoffToken(SECRET, row.id, row.tokenVersion));

    expect(out.status).toBe(401);
    expect(flow.minted, "a session was minted for a tombstone").toEqual([]);
  });

  it("still signs a living member in, linking their Google account", async () => {
    const row = live();
    const flow = mount({
      all: async () => [],
      byEmail: async () => live(),
      byId: async () => row,
      update: async (_id: string, mutate: (u: any) => void) => {
        mutate(row);
        return row;
      },
    });

    const out = await flow.callback();
    expect(out.redirect).toBe("/login?oauth=complete&next=%2Fprofile");
    expect(readGoogleLink(SECRET, row)).toBe(SUB);

    const exchanged = await flow.exchange(out.cookies[OAUTH_HANDOFF_COOKIE]);
    expect(exchanged.status).toBe(200);
    expect(flow.minted).toEqual(["u-wren"]);
  });
});
