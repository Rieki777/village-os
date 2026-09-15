/**
 * The fiat trio's pure surface (S32): rounding and signature verification.
 * No database, no server — these are the properties every fiat module leans
 * on, pinned so they can never drift quietly.
 */
import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { ceilMinor, floorTokens, verifyStripeSignature } from "./lib/payments";
import { ALLOW_NEGATIVE_SOURCES } from "./lib/ledger";

describe("rounding favors the treasury", () => {
  it("ceils what the member pays, floors what the member receives", () => {
    expect(ceilMinor(100.0001)).toBe(101);
    expect(ceilMinor(100)).toBe(100); // exact stays exact — no phantom cent
    expect(floorTokens(9.9999)).toBe(9);
    expect(floorTokens(10)).toBe(10);
  });

  it("PROPERTY: no (rate, quantity) pair lets a round trip extract value", () => {
    // Deterministic pseudo-random sweep (mulberry32) — seeded, so a failure
    // reproduces. For every pair: the member never pays less than the exact
    // price, never receives more than the exact tokens, and the treasury's
    // rounding gain is strictly less than one whole unit on each side.
    let s = 0xa11ce;
    const rand = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 5000; i++) {
      const rate = Math.round(rand() * 100000) / 100; // fractional cents happen
      const qty = 1 + Math.floor(rand() * 365);
      const exact = rate * qty;
      const paid = ceilMinor(exact);
      const received = floorTokens(exact);
      expect(paid).toBeGreaterThanOrEqual(Math.floor(exact));
      expect(paid - exact).toBeLessThan(1 + 1e-9);
      expect(paid - exact).toBeGreaterThanOrEqual(-1e-9); // member NEVER underpays
      expect(received).toBeLessThanOrEqual(exact + 1e-9); // member NEVER over-receives
      expect(exact - received).toBeLessThan(1 + 1e-9);
    }
  });
});

describe("webhook signature verification", () => {
  const SECRET = "whsec_unit";
  const sign = (payload: string, at = Math.floor(Date.now() / 1000), secret = SECRET) =>
    `t=${at},v1=${crypto.createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex")}`;

  it("accepts a fresh, correctly signed payload", () => {
    const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    expect(verifyStripeSignature(payload, sign(payload), SECRET)).toBe(true);
    expect(verifyStripeSignature(Buffer.from(payload), sign(payload), SECRET)).toBe(true);
  });

  it("rejects tampered payloads, wrong secrets, stale timestamps, junk headers", () => {
    const payload = JSON.stringify({ id: "evt_1", amount: 100 });
    const sig = sign(payload);
    expect(verifyStripeSignature(payload.replace("100", "999"), sig, SECRET)).toBe(false);
    expect(verifyStripeSignature(payload, sign(payload, undefined, "whsec_other"), SECRET)).toBe(false);
    expect(verifyStripeSignature(payload, sign(payload, Math.floor(Date.now() / 1000) - 900), SECRET)).toBe(false);
    expect(verifyStripeSignature(payload, undefined, SECRET)).toBe(false);
    expect(verifyStripeSignature(payload, "t=abc,v1=nothex", SECRET)).toBe(false);
    expect(verifyStripeSignature(payload, "garbage", SECRET)).toBe(false);
  });
});

describe("the allow-negative whitelist stays tight", () => {
  it("holds exactly the three debt-creating sources", () => {
    // Growing this set is a deliberate keystone change, never a side effect,
    // and this line is what makes it deliberate: adding a source without
    // coming here and saying why is a failing test, not a quiet widening.
    //
    // `reversal` joined them when `reverse()` in server/lib/economy.ts learned
    // to complete a clawback of value the member had already spent. Refusing
    // that correction left the mistaken credit standing and a hand-written
    // ledger row as the only repair; allowing it puts the member's balance
    // below zero, which is the true statement of what they hold and clears
    // itself as they earn.
    //
    // The ruling is PLAN_TO_A.md section 1 item 5.
    expect(Array.from(ALLOW_NEGATIVE_SOURCES).sort()).toEqual([
      "payment_reversal",
      "reversal",
      "stay_night",
    ]);
  });
});
