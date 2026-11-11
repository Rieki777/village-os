/**
 * An adopted application's link was mailed to one address. An account made at
 * THAT address through it starts with the address proved and gets no "confirm
 * your address" letter (audit P9). An account made at any other address through
 * the same link proves nothing, so it is mailed the letter as before.
 *
 * No database: every dependency is handed to the route.
 */
import { describe, expect, it } from "vitest";
import { register } from "./register";
import { whenInviteDescribed } from "../lib/inviteDoor";

whenInviteDescribed("p9-", async () => ({ roles: ["Gate Keeper"], name: "Juno", email: "Juno@Example.test" }));

function door() {
  const added: any[] = [];
  const letters: string[] = [];
  let handler: ((req: any, res: any) => Promise<unknown>) | null = null;
  register({ post: (_p: string, h: any) => void (handler = h) } as any, {
    overLimit: async () => false,
    clientIp: () => "127.0.0.1",
    members: { existsByEmail: async () => false, add: async (m: any) => void added.push(m) },
    hashPassword: async (p: string) => `hashed:${p}`,
    makeHandle: async () => "juno",
    joined: async () => undefined,
    encodeToken: () => "token",
    publicUser: (m: any) => ({ id: m.id }),
    sendVerification: async (m: any) => void letters.push(m.email),
    invites: {
      required: () => true,
      resolve: async () => ({ ok: true, id: "p9-link" }) as any,
      claim: async () => "inviter-1",
      release: async () => undefined,
      welcome: async () => undefined,
    },
  });
  return {
    added,
    letters,
    async post(email: string) {
      const res: any = { status: () => res, json: () => res };
      await handler!({ body: { name: "Juno", email, password: "a long passphrase", paths: ["steward"], invite: "tok" }, headers: {} }, res);
    },
  };
}

describe("an invitation mailed to an address proves it (audit P9)", () => {
  it("the account made at that address starts proved and is sent no confirmation letter", async () => {
    const d = door();
    await d.post("juno@example.test");
    expect(d.added[0].emailVerifiedAt).toEqual(expect.any(String));
    expect(d.letters).toEqual([]);
  });

  it("CONTROL: the same link used with a different address proves nothing and sends the letter", async () => {
    const d = door();
    await d.post("somebody-else@example.test");
    expect(d.added[0].emailVerifiedAt).toBeNull();
    expect(d.letters).toEqual(["somebody-else@example.test"]);
  });
});
