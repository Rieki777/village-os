// @vitest-environment jsdom
/**
 * A VALUE IS TYPED IN THE VILLAGE'S CURRENCY TODAY, AND AN OLD ONE IS KEPT.
 *
 * The server stamps the village's current currency on every value it saves
 * (server/routes/quests.ts `checkedQuestValue`, server/routes/org.ts). The
 * editors labelled a quest or role in the currency it was saved in, so the
 * day a village moved from USD to colones (Rye, 2026-10-22) an edit of a role
 * worth 50 USD, even one touching only its tokens, would have sent 5000 minor
 * units back and stored 50 CRC.
 *
 * The property: a record valued in another currency opens with the value box
 * empty and its old value said beside it; left empty, the save carries no
 * value at all, which the route reads as "leave it"; a typed figure is the
 * village's currency.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import WorkValueEditor, { draftFrom, draftToBody, type PayOption } from "./WorkValueEditor";

const offered: PayOption[] = [{ token: "village-credits", name: "Village Credits", standard: 25, decimals: 0 }];
const oldRole = { valueMinor: 5000, valueCurrency: "USD", valueTokens: [{ token: "village-credits", amount: 40 }] };

describe("the cash a piece of work pays (0285)", () => {
  it("opens on the stored cash and saves a typed figure in the village's currency", () => {
    const draft = draftFrom({ ...oldRole, valueCurrency: "CRC", cashMinor: 2_000_000, cashCurrency: "CRC" }, offered, "CRC");
    expect(draft.cash).toBe("20000");
    const body = draftToBody({ ...draft, cash: "15000" }, offered, "CRC", { required: false });
    expect(body.ok && body.cashMinor).toBe(1_500_000);
  });

  it("leaves the stored cash alone for a record that never carried the field", () => {
    const draft = draftFrom(oldRole, offered, "CRC");
    expect(draft.cash).toBeUndefined();
    const body = draftToBody(draft, offered, "CRC", { required: false });
    expect(body.ok && body.cashMinor).toBeUndefined();
  });

  it("clears it on an empty box, and labels the box with the cadence", () => {
    const draft = draftFrom({ ...oldRole, valueCurrency: "CRC", cashMinor: 500, cashCurrency: "CRC" }, offered, "CRC");
    const body = draftToBody({ ...draft, cash: "" }, offered, "CRC", { required: false });
    expect(body.ok && body.cashMinor).toBeNull();
    render(<WorkValueEditor draft={draft} onChange={() => {}} offered={offered} currency="CRC" cadence="cycle" inputClassName="" />);
    expect(screen.getByText(/Cash it pays each holder, every cycle/)).toBeTruthy();
  });
});

describe("a value saved in a currency the village has since left", () => {
  it("opens with the box empty and the old value held", () => {
    const draft = draftFrom(oldRole, offered, "CRC");
    expect(draft.value).toBe("");
    expect(draft.held).toEqual({ minor: 5000, currency: "USD" });
    expect(draft.tokens["village-credits"]).toBe("40");
  });

  it("left empty, saves no value, so the stored 50 USD stays 50 USD", () => {
    const draft = draftFrom(oldRole, offered, "CRC");
    const body = draftToBody({ ...draft, tokens: { "village-credits": "60" } }, offered, "CRC", { required: false });
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.valueMinor).toBeUndefined();
    // What reaches the route: no valueMinor key at all, so nothing is restamped.
    expect(JSON.parse(JSON.stringify({ valueMinor: body.valueMinor, valueTokens: body.valueTokens }))).toEqual({
      valueTokens: [{ token: "village-credits", amount: 60 }],
    });
  });

  it("takes a typed figure in the village's currency", () => {
    const draft = draftFrom(oldRole, offered, "CRC");
    const body = draftToBody({ ...draft, value: "25000" }, offered, "CRC", { required: false });
    expect(body.ok && body.valueMinor).toBe(2_500_000);
  });

  it("says the old value and labels the box in the village's currency", () => {
    const draft = draftFrom(oldRole, offered, "CRC");
    render(<WorkValueEditor draft={draft} onChange={() => {}} offered={offered} currency="CRC" cadence="cycle" inputClassName="" />);
    expect(screen.getByText(/What it is worth, in CRC/)).toBeTruthy();
    expect(screen.getByText(/Valued at 50 USD before this village changed its currency/)).toBeTruthy();
  });

  it("holds nothing when the record is already in the village's currency", () => {
    const draft = draftFrom({ ...oldRole, valueCurrency: "CRC" }, offered, "CRC");
    expect(draft.value).toBe("50");
    expect(draft.held).toBeUndefined();
    const body = draftToBody({ ...draft, value: "" }, offered, "CRC", { required: false });
    // Emptied on purpose, with nothing held: the value is cleared, as before.
    expect(body.ok && body.valueMinor).toBeNull();
  });
});
