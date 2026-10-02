import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { LINK_KEY_LABEL, linkKey, signLink, verifyLink } from "./links";

/**
 * Signed links (docs/comms/BUILD_SPEC.md 5.4). Every case that refuses sits
 * beside a case the same key and clock accept, so a verifier that refused
 * everything fails here as loudly as one that refused nothing.
 */

const KEY = crypto.randomBytes(32);
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const DAY_MS = 86_400_000;

/** Flip one character of a string at position `at`, to a different one from the same alphabet. */
const flip = (s: string, at: number): string => {
  const c = s[at];
  const swapped = c === "A" ? "B" : "A";
  return s.slice(0, at) + swapped + s.slice(at + 1);
};

describe("a signed link", () => {
  it("round-trips its payload for the purpose and the key it was signed with", () => {
    const token = signLink("unsubscribe", { c: "ct_abc123", k: "letters" }, 365, { now: NOW, key: KEY });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyLink("unsubscribe", token, { now: NOW, key: KEY })).toEqual({ c: "ct_abc123", k: "letters" });
  });

  it("refuses a tampered body, and a tampered signature, and accepts the original", () => {
    const token = signLink("cant_make_it", { e: "ev-1", p: "user-1" }, 30, { now: NOW, key: KEY });
    const [body, sig] = token.split(".");
    expect(verifyLink("cant_make_it", token, { now: NOW, key: KEY })).not.toBeNull();
    // A body that decodes to someone else's id, re-encoded, with the old signature.
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), d: { e: "ev-1", p: "user-2" } }),
    ).toString("base64url");
    expect(verifyLink("cant_make_it", `${forged}.${sig}`, { now: NOW, key: KEY })).toBeNull();
    // One character of the body, and one of the signature.
    expect(verifyLink("cant_make_it", `${flip(body, 3)}.${sig}`, { now: NOW, key: KEY })).toBeNull();
    expect(verifyLink("cant_make_it", `${body}.${flip(sig, 5)}`, { now: NOW, key: KEY })).toBeNull();
    // A truncated signature is refused on length, never thrown.
    expect(verifyLink("cant_make_it", `${body}.${sig.slice(0, 10)}`, { now: NOW, key: KEY })).toBeNull();
  });

  it("expires: good the second before, refused at the second it ends and after", () => {
    const token = signLink("guest_confirm", { r: "gr_1" }, 2, { now: NOW, key: KEY });
    expect(verifyLink("guest_confirm", token, { now: NOW + 2 * DAY_MS - 1000, key: KEY })).toEqual({ r: "gr_1" });
    expect(verifyLink("guest_confirm", token, { now: NOW + 2 * DAY_MS, key: KEY })).toBeNull();
    expect(verifyLink("guest_confirm", token, { now: NOW + 30 * DAY_MS, key: KEY })).toBeNull();
  });

  it("verifies for its own purpose and for no other", () => {
    const token = signLink("time_vote", { o: "opt_1", p: "guest:ct_9" }, 7, { now: NOW, key: KEY });
    expect(verifyLink("time_vote", token, { now: NOW, key: KEY })).toEqual({ o: "opt_1", p: "guest:ct_9" });
    for (const other of ["unsubscribe", "preferences", "cant_make_it", "rsvp_next"] as const) {
      expect(verifyLink(other, token, { now: NOW, key: KEY }), other).toBeNull();
    }
  });

  it("verifies only under the key it was signed with", () => {
    const token = signLink("preferences", { c: "ct_1" }, 30, { now: NOW, key: KEY });
    expect(verifyLink("preferences", token, { now: NOW, key: crypto.randomBytes(32) })).toBeNull();
  });

  it("carries ids only, and refuses an address or a name at signing time", () => {
    expect(() => signLink("preferences", { c: "ana@example.test" }, 30, { key: KEY })).toThrow(/ids only/);
    expect(() => signLink("preferences", { n: "Ana Gardener" }, 30, { key: KEY })).toThrow(/ids only/);
    expect(() => signLink("preferences", { n: 1.5 }, 30, { key: KEY })).toThrow(/whole number/);
    expect(() => signLink("preferences", { c: "ct_1" }, 0, { key: KEY })).toThrow(RangeError);
    // Ids, guest person keys and whole numbers are all fine.
    expect(() => signLink("rsvp_next", { e: "ev-1", p: "guest:ct_1", n: 3 }, 30, { key: KEY })).not.toThrow();
  });

  it("answers null for anything that is not a link, and never throws", () => {
    for (const junk of ["", ".", "a.b.c", "notalink", "%%%.%%%", "a".repeat(5000), `${"x".repeat(10)}.`]) {
      expect(verifyLink("unsubscribe", junk, { now: NOW, key: KEY }), junk.slice(0, 12)).toBeNull();
    }
    // A correctly signed body that is not the shape of a link.
    const body = Buffer.from(JSON.stringify(["not", "a", "link"])).toString("base64url");
    const sig = crypto.createHmac("sha256", KEY).update(body).digest("base64url");
    expect(verifyLink("unsubscribe", `${body}.${sig}`, { now: NOW, key: KEY })).toBeNull();
  });
});

describe("the link key", () => {
  it("is derived from VILLAGE_SECRETS_KEY under its own label, so the same root gives the same key", () => {
    const root = crypto.randomBytes(32).toString("hex");
    const a = linkKey({ VILLAGE_SECRETS_KEY: root } as NodeJS.ProcessEnv);
    const b = linkKey({ VILLAGE_SECRETS_KEY: root } as NodeJS.ProcessEnv);
    expect(a.equals(b)).toBe(true);
    expect(a).toHaveLength(32);
    // The root itself is never the key: the label separates the two uses.
    expect(a.equals(Buffer.from(root, "hex"))).toBe(false);
    const expected = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(root, "hex"), Buffer.alloc(0), LINK_KEY_LABEL, 32));
    expect(a.equals(expected)).toBe(true);
  });

  it("falls back to one key for the life of the process when there is no root", () => {
    const a = linkKey({} as NodeJS.ProcessEnv);
    const b = linkKey({} as NodeJS.ProcessEnv);
    expect(a.equals(b)).toBe(true);
    // And a link signed under it verifies under it, within this process.
    const token = signLink("preferences", { c: "ct_1" }, 1, { key: a });
    expect(verifyLink("preferences", token, { key: b })).toEqual({ c: "ct_1" });
  });
});
