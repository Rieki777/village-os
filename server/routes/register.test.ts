/**
 * Sign-up refuses the domain closed accounts are written at (round 2, finding 5).
 *
 * The erasure writes a departing member's address as
 * `deleted-<id>@anonymized.invalid` in the same update that ends their
 * sessions. Sign-up never looked at the address, so anybody who could read a
 * member's id could take that address first, and the tombstone then failed on
 * the duplicate key every time it ran. The tombstone now answers a taken
 * address itself (server/lib/erasure.ts, `writeTombstone`); this is the door
 * that stops a new account being made there at all.
 *
 * No database: every dependency the route takes is handed to it, so the case
 * is about the route's own refusal and the account it never adds.
 */
import { describe, expect, it } from "vitest";
import { register } from "./register";
import { ACCOUNT_WORDS, NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from "../../shared/accountRules";

function signUp(mailed: { sent: boolean; reason?: string } = { sent: true }) {
  const added: any[] = [];
  const letters: any[] = [];
  let handler: ((req: any, res: any) => Promise<unknown>) | null = null;
  const app = { post: (_path: string, h: any) => void (handler = h) } as any;
  register(app, {
    overLimit: async () => false,
    clientIp: () => "127.0.0.1",
    members: { existsByEmail: async () => false, add: async (m: any) => void added.push(m) },
    hashPassword: async (p: string) => `hashed:${p}`,
    makeHandle: async () => "wren",
    joined: async () => undefined,
    encodeToken: () => "token",
    publicUser: (m: any) => ({ id: m.id }),
    sendVerification: async (m: any) => (letters.push({ id: m.id, email: m.email }), mailed),
    invites: {
      required: () => false,
      resolve: async () => ({ ok: false, error: "none" }) as any,
      claim: async () => null,
      release: async () => undefined,
      welcome: async () => undefined,
    },
  });
  return {
    added,
    letters,
    async post(email: string, over: Record<string, unknown> = {}) {
      const out: { status: number; body: any } = { status: 200, body: null };
      const res: any = {
        status: (s: number) => ((out.status = s), res),
        json: (b: any) => ((out.body = b), res),
      };
      await handler!({ body: { name: "Mallory", email, password: "a long passphrase", paths: [], ...over }, headers: {} }, res);
      return out;
    },
  };
}

describe("sign-up and the address closed accounts are written at", () => {
  for (const email of ["deleted-user-1700000000000-1a2b3c4d@anonymized.invalid", "DELETED-x@Anonymized.Invalid", " someone@anonymized.invalid "]) {
    it(`refuses ${JSON.stringify(email)} and makes no account`, async () => {
      const door = signUp();
      const res = await door.post(email);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cannot hold an account/);
      expect(door.added, "an account was made at the tombstone domain").toEqual([]);
    });
  }

  it("still makes the account for an ordinary address", async () => {
    const door = signUp();
    const res = await door.post("wren@example.test");
    expect(res.status).toBe(200);
    expect(door.added.map((m) => m.email)).toEqual(["wren@example.test"]);
  });
});

/*
 * READINESS R117 (S3): the email sign-up door took any password, one character
 * included, and stored the name exactly as sent. Its sibling door,
 * /api/auth/set-password, has asked for 8 characters all along. The same rules
 * now hold at both, and the name is trimmed and capped as the claim door caps it.
 */
describe("sign-up holds the password and the name to the rules the other doors keep (R117)", () => {
  it.each([
    ["one character", "x"],
    ["seven characters", "abcdefg"],
    ["blank", "        "],
    ["a number", 12345678],
    ["a list", ["a long passphrase"]],
  ])("refuses a password that is %s, and makes no account", async (_label, password) => {
    const door = signUp();
    const res = await door.post("wren@example.test", { password });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: ACCOUNT_WORDS.passwordShort, field: "password" });
    expect(door.added).toEqual([]);
  });

  it("refuses a password past the cap, and takes one at the floor and one at the cap", async () => {
    const long = signUp();
    const res = await long.post("wren@example.test", { password: "x".repeat(PASSWORD_MAX + 1) });
    expect(res).toEqual({ status: 400, body: { error: ACCOUNT_WORDS.passwordLong, field: "password" } });
    expect(long.added).toEqual([]);
    for (const password of ["x".repeat(PASSWORD_MIN), "y".repeat(PASSWORD_MAX)]) {
      const door = signUp();
      expect((await door.post("wren@example.test", { password })).status).toBe(200);
      expect(door.added).toHaveLength(1);
    }
  });

  it("stores the name trimmed, refuses one that is blank or past the cap, and takes one at the cap", async () => {
    const door = signUp();
    expect((await door.post("wren@example.test", { name: "  Wren   Field  " })).status).toBe(200);
    expect(door.added[0].name).toBe("Wren   Field");

    for (const [name, error] of [
      ["   ", ACCOUNT_WORDS.nameNeeded],
      [["Wren"], ACCOUNT_WORDS.nameNeeded],
      ["n".repeat(NAME_MAX + 1), ACCOUNT_WORDS.nameLong],
    ] as const) {
      const refused = signUp();
      const res = await refused.post("wren@example.test", { name });
      expect(res, JSON.stringify(name).slice(0, 40)).toEqual({ status: 400, body: { error, field: "name" } });
      expect(refused.added).toEqual([]);
    }
    const atCap = signUp();
    expect((await atCap.post("wren@example.test", { name: "n".repeat(NAME_MAX) })).status).toBe(200);
  });
});

describe("sign-up and the address nobody has proved yet (R104)", () => {
  it("makes the account unproved and mails the address a link to prove it", async () => {
    const door = signUp();
    const res = await door.post("wren@example.test");
    expect(res.status).toBe(200);
    const [made] = door.added;
    expect(made.emailVerifiedAt, "an address was taken as proved because somebody typed it").toBeNull();
    expect(door.letters, "the address was never asked to prove itself").toEqual([{ id: made.id, email: "wren@example.test" }]);
    // The proof goes to the mailbox only. Handing it back to whoever typed
    // the address would let them prove an address they do not own.
    expect(JSON.stringify(res.body)).not.toMatch(/verify-email/);
  });

  it("still makes the account on a village with no email set up, which simply stays unproved", async () => {
    const door = signUp({ sent: false, reason: "no_api_key" });
    const res = await door.post("wren@example.test");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(door.added).toHaveLength(1);
    expect(door.added[0].emailVerifiedAt).toBeNull();
  });
});
