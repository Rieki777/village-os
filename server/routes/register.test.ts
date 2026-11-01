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

function signUp() {
  const added: any[] = [];
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
    async post(email: string) {
      const out: { status: number; body: any } = { status: 200, body: null };
      const res: any = {
        status: (s: number) => ((out.status = s), res),
        json: (b: any) => ((out.body = b), res),
      };
      await handler!({ body: { name: "Mallory", email, password: "a long passphrase", paths: [] }, headers: {} }, res);
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
