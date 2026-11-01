import { describe, expect, it } from "vitest";
import {
  DRAFT_DOORS,
  DRAFT_KINDS,
  addDays,
  applyEdits,
  carriesContact,
  daysBetweenKeys,
  effectiveCap,
  parseLook,
  questionExpired,
  validateCompanionPayload,
  villageDayKey,
} from "./companionItems";

describe("which kinds have a door", () => {
  it("refuses exactly the three with no door, each by its own sentence", () => {
    const none = DRAFT_KINDS.filter((k) => DRAFT_DOORS[k].way === "none");
    expect(none).toEqual(["cash_payment", "purchase", "ask"]);
    for (const k of none) expect(validateCompanionPayload(k, {})).toBe(DRAFT_DOORS[k].refusal);
  });

  it("gives every kind with a door its On yes line and its button", () => {
    for (const k of DRAFT_KINDS.filter((x) => DRAFT_DOORS[x].way !== "none")) {
      expect(DRAFT_DOORS[k].onYes.length, k).toBeGreaterThan(10);
      expect(DRAFT_DOORS[k].yesLabel.length, k).toBeGreaterThan(2);
    }
  });
});

describe("payloads", () => {
  it("takes a whole amount and refuses a fraction, zero and a string", () => {
    const ok = { tokenType: "credits", amountMinor: 25, toUserId: "u-1" };
    expect(validateCompanionPayload("token_payment", ok)).toBeNull();
    expect(validateCompanionPayload("token_payment", { ...ok, amountMinor: 2.5 })).toMatch(/whole number/);
    expect(validateCompanionPayload("token_payment", { ...ok, amountMinor: 0 })).toMatch(/more than zero/);
    expect(validateCompanionPayload("token_payment", { ...ok, amountMinor: "25" })).toMatch(/number/);
  });

  it("names one recipient, never two and never none", () => {
    expect(validateCompanionPayload("gratitude_note", { amount: 3, message: "thanks" })).toMatch(/one recipient/);
    expect(validateCompanionPayload("gratitude_note", { amount: 3, message: "thanks", toUserId: "a", toRoleId: "b" })).toMatch(/one recipient/);
    expect(validateCompanionPayload("gratitude_note", { amount: 3, message: "thanks", toRoleId: "b" })).toBeNull();
  });

  it("refuses an unknown field and an unknown kind", () => {
    expect(validateCompanionPayload("email", { subject: "a", text: "b", to: "x" })).toMatch(/no field called to/);
    expect(validateCompanionPayload("mint", {})).toMatch(/does not know/);
  });

  it("refuses an address or a phone number in the words, and ignores digits in an id", () => {
    expect(validateCompanionPayload("message", { body: "ring me on +506 8888 1234", toUserId: "u" })).toMatch(/phone number/);
    expect(validateCompanionPayload("message", { body: "write to a@b.co", toUserId: "u" })).toMatch(/email address/);
    expect(validateCompanionPayload("message", { body: "see you then", toUserId: "1234567890123" })).toBeNull();
    expect(carriesContact("on 2026-10-30 at noon")).toBe(false);
  });

  it("lets the member change only a kind's editable fields", () => {
    const p = { tokenType: "credits", amountMinor: 500, toUserId: "u-1" };
    const ok = applyEdits("token_payment", p, { amountMinor: 100 });
    expect(ok).toEqual({ ok: true, payload: { ...p, amountMinor: 100 }, edited: ["amountMinor"] });
    expect(applyEdits("token_payment", p, { toUserId: "me" }).ok).toBe(false);
    expect(applyEdits("token_payment", p, { amountMinor: 500 })).toEqual({ ok: true, payload: p, edited: [] });
  });
});

describe("the day, the cap and the expiry", () => {
  it("reads the village's own day, not UTC", () => {
    const late = new Date("2026-10-31T03:30:00Z");
    expect(villageDayKey(late, "UTC")).toBe("2026-10-31");
    expect(villageDayKey(late, "America/Costa_Rica")).toBe("2026-10-30");
    expect(villageDayKey(late, "Not/AZone")).toBe("2026-10-31");
  });

  it("takes the lowest cap, never above three, and fails closed", () => {
    expect(effectiveCap(3, 3)).toBe(3);
    expect(effectiveCap(5, 9)).toBe(3);
    expect(effectiveCap(1, 3)).toBe(1);
    expect(effectiveCap(3, 0)).toBe(0);
    expect(effectiveCap("x", 3)).toBe(0);
    expect(effectiveCap(-2, 3)).toBe(0);
  });

  it("expires at seven days, not six", () => {
    expect(questionExpired("2026-10-01", "2026-10-07")).toBe(false);
    expect(questionExpired("2026-10-01", "2026-10-08")).toBe(true);
    expect(daysBetweenKeys("2026-10-30", addDays("2026-10-30", 3))).toBe(3);
  });
});

describe("the look", () => {
  it("reads a chosen pet and a portrait, and drops anything else", () => {
    expect(parseLook({ source: "choose", pet: "horns", tint: "gold" })).toEqual({ source: "choose", pet: "horns", tint: "gold" });
    expect(parseLook('{"source":"upload","portraitKey":"builder"}')).toEqual({ source: "upload", portraitKey: "builder" });
    expect(parseLook({ source: "choose", pet: "dragon", tint: "gold" })).toBeNull();
    expect(parseLook({ source: "forge", portraitKey: "../etc" })).toBeNull();
    expect(parseLook("not json")).toBeNull();
  });
});
