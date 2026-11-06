/**
 * The one reader of a quest's and a role's value columns (0265), and the one
 * check on what a steward types. Absent and zero are different facts here,
 * three times over, so most of these cases are about telling them apart.
 */
import { describe, expect, it } from "vitest";
import {
  GRATITUDE_NEVER_PAYS,
  readValueTokens,
  readWorkValue,
  readWorkValueInput,
  TOKEN_AMOUNT_MAX,
  VALUE_TOKENS_MAX,
  valueTokensToStore,
} from "./workValue";

const anyPayable = () => null;

describe("reading the stored list", () => {
  it("keeps NULL as no list of its own, which is not the same as an empty list", () => {
    expect(readValueTokens(null)).toBeNull();
    expect(readValueTokens(undefined)).toBeNull();
    expect(readValueTokens("[]")).toEqual([]);
  });

  it("reads a JSON string and an already parsed array alike", () => {
    const list = [{ token: "credits", amount: 40 }, { token: "village-voice", amount: 5 }];
    expect(readValueTokens(JSON.stringify(list))).toEqual(list);
    expect(readValueTokens(list)).toEqual(list);
  });

  it("reads junk as a list that pays nothing, never as a list somebody wrote", () => {
    expect(readValueTokens("{not json")).toEqual([]);
    expect(readValueTokens('{"token":"credits"}')).toEqual([]);
    expect(readValueTokens([{ token: "", amount: 3 }, { token: "credits", amount: -1 }, { token: "credits", amount: "x" }])).toEqual([]);
  });

  it("keeps the first line for a token named twice", () => {
    expect(readValueTokens([{ token: "credits", amount: 4 }, { token: "credits", amount: 9 }])).toEqual([{ token: "credits", amount: 4 }]);
  });

  it("round trips through what is stored", () => {
    const list = [{ token: "credits", amount: 12.5 }];
    expect(readValueTokens(valueTokensToStore(list))).toEqual(list);
    expect(valueTokensToStore(null)).toBeNull();
    expect(valueTokensToStore([])).toBe("[]");
  });
});

describe("reading the stored value", () => {
  it("needs both halves", () => {
    expect(readWorkValue(2500000, "CRC")).toEqual({ minor: 2500000, currency: "CRC" });
    expect(readWorkValue(2500000, null)).toBeNull();
    expect(readWorkValue(null, "CRC")).toBeNull();
  });

  it("keeps a value of zero, which somebody decided, apart from no value", () => {
    expect(readWorkValue(0, "usd")).toEqual({ minor: 0, currency: "USD" });
    expect(readWorkValue("", "USD")).toBeNull();
  });

  it("refuses a negative value and a currency that is not three letters", () => {
    expect(readWorkValue(-5, "USD")).toBeNull();
    expect(readWorkValue(5, "DOLLARS")).toBeNull();
  });
});

describe("checking what a steward typed", () => {
  it("leaves both fields alone when the body carries neither", () => {
    expect(readWorkValueInput({ title: "Weed the beds" }, anyPayable)).toEqual({ ok: true, valueMinor: undefined, tokens: undefined });
  });

  it("clears a field on an explicit null", () => {
    expect(readWorkValueInput({ valueMinor: null, valueTokens: null }, anyPayable)).toEqual({ ok: true, valueMinor: null, tokens: null });
  });

  it("takes a value without touching the list, and the reverse", () => {
    expect(readWorkValueInput({ valueMinor: 2500000 }, anyPayable)).toEqual({ ok: true, valueMinor: 2500000, tokens: undefined });
    const tokens = [{ token: "credits", amount: 40 }];
    expect(readWorkValueInput({ valueTokens: tokens }, anyPayable)).toEqual({ ok: true, valueMinor: undefined, tokens });
  });

  it("reads the cash a piece of work pays on its own, and stores none for zero (0285)", () => {
    expect(readWorkValueInput({ cashMinor: 2000000 }, anyPayable)).toEqual({ ok: true, valueMinor: undefined, tokens: undefined, cashMinor: 2000000 });
    // Zero and null both pay no cash, so both store nothing.
    expect(readWorkValueInput({ cashMinor: 0 }, anyPayable)).toMatchObject({ ok: true, cashMinor: null });
    expect(readWorkValueInput({ cashMinor: null }, anyPayable)).toMatchObject({ ok: true, cashMinor: null });
    // A body that does not carry it leaves the stored cash alone.
    expect(readWorkValueInput({ valueMinor: 5 }, anyPayable)).toMatchObject({ ok: true, cashMinor: undefined });
    for (const [cashMinor, error] of [[2.5, /whole number/], [-1, /zero or more/], ["lots", /whole number/], [1e15, /larger than/]] as const) {
      const out = readWorkValueInput({ cashMinor }, anyPayable);
      expect(out.ok, String(cashMinor)).toBe(false);
      if (!out.ok) expect(out.error).toMatch(error);
    }
  });

  it("refuses Gratitude by name before asking anything else", () => {
    let asked = 0;
    const out = readWorkValueInput({ valueTokens: [{ token: "gratitude", amount: 40 }] }, () => {
      asked++;
      return null;
    });
    expect(out).toEqual({ ok: false, error: GRATITUDE_NEVER_PAYS });
    expect(asked).toBe(0);
  });

  it("asks the server about every token, and says its answer", () => {
    const out = readWorkValueInput({ valueTokens: [{ token: "voice", amount: 1 }] }, (slug) => (slug === "voice" ? "Voice is governed on Hypha." : null));
    expect(out).toEqual({ ok: false, error: "Voice is governed on Hypha." });
  });

  it("drops a line of zero, which is a decision to pay none of that token", () => {
    expect(readWorkValueInput({ valueTokens: [{ token: "credits", amount: 0 }, { token: "village-voice", amount: 5 }] }, anyPayable)).toEqual({
      ok: true,
      valueMinor: undefined,
      tokens: [{ token: "village-voice", amount: 5 }],
    });
  });

  it("refuses what no steward meant", () => {
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ valueMinor: 2.5 }, /whole number/],
      [{ valueMinor: -1 }, /zero or more/],
      [{ valueMinor: "lots" }, /whole number/],
      [{ valueMinor: 1e15 }, /larger than/],
      [{ valueTokens: "credits" }, /a list/],
      [{ valueTokens: [{ amount: 3 }] }, /names its token/],
      [{ valueTokens: [{ token: "credits", amount: -3 }] }, /zero or more/],
      [{ valueTokens: [{ token: "credits", amount: "x" }] }, /not a number/],
      [{ valueTokens: [{ token: "credits", amount: TOKEN_AMOUNT_MAX + 1 }] }, /larger than/],
      [{ valueTokens: [{ token: "credits", amount: 1 }, { token: "credits", amount: 2 }] }, /named twice/],
      [{ valueTokens: Array.from({ length: VALUE_TOKENS_MAX + 1 }, (_, i) => ({ token: `t${i}`, amount: 1 })) }, /at most/],
    ];
    for (const [body, error] of bad) {
      const out = readWorkValueInput(body, anyPayable);
      expect(out.ok, JSON.stringify(body)).toBe(false);
      if (!out.ok) expect(out.error, JSON.stringify(body)).toMatch(error);
    }
  });

  it("never reads a currency from the body", () => {
    const out = readWorkValueInput({ valueMinor: 100, valueCurrency: "XXX" }, anyPayable);
    expect(out).toEqual({ ok: true, valueMinor: 100, tokens: undefined });
  });
});
