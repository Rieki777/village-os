import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { signLink } from "./links";
import { letterHash, signConfirm, verifyConfirm } from "./letters";

/**
 * The letter confirmation (the comms build spec 5.12): bound to a letter, a
 * hash and a count, good for fifteen minutes, and impossible to forge or to
 * swap for any signed email link.
 */
const KEY = crypto.randomBytes(32);
const NOW = Date.UTC(2026, 9, 9, 12);
const payload = { l: "ltr_0123456789abcdef01234567", h: "a".repeat(64), n: 3, x: Math.floor(NOW / 1000) + 15 * 60 };

describe("the letter confirmation", () => {
  it("verifies what it signed, until it runs out", () => {
    const token = signConfirm(payload, KEY);
    expect(verifyConfirm(token, NOW, KEY)).toEqual(payload);
    expect(verifyConfirm(token, NOW + 14 * 60_000, KEY)).toEqual(payload);
    expect(verifyConfirm(token, NOW + 15 * 60_000, KEY)).toBe("stale");
  });

  it("refuses a token that was changed, signed under another key, or is not one", () => {
    const token = signConfirm(payload, KEY);
    const [body, sig] = token.split(".");
    const other = Buffer.from(JSON.stringify({ ...payload, n: 300 })).toString("base64url");
    expect(verifyConfirm(`${other}.${sig}`, NOW, KEY)).toBe("invalid");
    expect(verifyConfirm(`${body}.${sig}x`, NOW, KEY)).toBe("invalid");
    expect(verifyConfirm(token, NOW, crypto.randomBytes(32))).toBe("invalid");
    expect(verifyConfirm("", NOW, KEY)).toBe("invalid");
    expect(verifyConfirm(`${token}.more`, NOW, KEY)).toBe("invalid");
  });

  it("never accepts a signed email link in its place", () => {
    const link = signLink("letters_confirm", { c: "ct_1" }, 7, { now: NOW, key: KEY });
    expect(verifyConfirm(link, NOW, KEY)).toBe("invalid");
  });

  it("hashes the words, the frame and the audience", () => {
    const d = { subject: "S", preheader: null, bodyMd: "B", layout: "plain" as const, audience: { kind: "everyone" as const } };
    expect(letterHash(d)).toMatch(/^[a-f0-9]{64}$/);
    expect(letterHash(d)).toBe(letterHash({ ...d }));
    expect(letterHash({ ...d, subject: "S!" })).not.toBe(letterHash(d));
  });
});
