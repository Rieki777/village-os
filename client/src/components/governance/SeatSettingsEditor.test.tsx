// @vitest-environment jsdom
/**
 * THE SETTINGS EDITOR, DRIVEN.
 *
 * The editor's promises a member relies on: picking a preset fills a group,
 * a tweak is marked customised, and Reset to preset puts back exactly what
 * the preset said. A whole seat fills every group. An empty field starts from
 * the platform's default whole seat. The parser's refusals reach the group
 * they belong to.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SETTINGS_GROUPS, type SeatSettings } from "@shared/seatSettings";
import { WHOLE_PRESETS, applyPreset, presetById } from "@shared/seatPresets";
import SeatSettingsEditor, { EDITOR_WORDS } from "./SeatSettingsEditor";

/** The editor is controlled, as the wizard holds it. */
function Harness({ start, seen }: { start: unknown; seen: (s: SeatSettings) => void }) {
  const [value, setValue] = useState<unknown>(start);
  return (
    <SeatSettingsEditor
      value={value}
      onChange={(next) => {
        seen(next);
        setValue(next);
      }}
    />
  );
}

const groupBox = (group: string) => document.querySelector(`[data-settings-group="${group}"]`) as HTMLElement;

describe("SeatSettingsEditor", () => {
  it("restores the preset on Reset to preset, exactly", () => {
    const preset = presetById("platform:three-to-five-done-when-by-consent")!;
    const picked = applyPreset(null, preset);
    const tweaked: SeatSettings = { ...picked, quests: { ...picked.quests!, perMoonMax: 9, agreedHow: "by the steward alone" } };
    const seen = vi.fn();
    render(<Harness start={tweaked} seen={seen} />);

    const box = within(groupBox("quests"));
    expect(box.getByText(EDITOR_WORDS.customised)).toBeInTheDocument();
    fireEvent.click(box.getByRole("button", { name: /Reset to preset/ }));

    const last: SeatSettings = seen.mock.calls.at(-1)![0];
    expect(last.quests).toEqual(preset.values);
    expect(box.queryByText(EDITOR_WORDS.customised)).toBeNull();
    // Control: the mark is about this group only; a group never tweaked has no reset.
    expect(within(groupBox("pay")).queryByRole("button", { name: /Reset to preset/ })).toBeNull();
  });

  it("fills one group from a preset card under Change", () => {
    const seen = vi.fn();
    render(<Harness start={{ v: 1 }} seen={seen} />);
    const box = within(groupBox("pay"));
    const change = box.getByRole("button", { name: /^Change\s*Pay$/ });
    expect(change).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(change);
    expect(change).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(box.getByRole("button", { name: /Stipend range/ }));
    const last: SeatSettings = seen.mock.calls.at(-1)![0];
    expect(last.pay).toEqual({ kind: "range", per: "month" });
    expect(last.presets).toEqual([{ group: "pay", presetId: "platform:stipend-range", presetVersion: 1 }]);
  });

  it("fills every group from a whole seat", () => {
    const seen = vi.fn();
    render(<Harness start={{ v: 1 }} seen={seen} />);
    fireEvent.click(screen.getByRole("button", { name: WHOLE_PRESETS[1].label }));
    const last: SeatSettings = seen.mock.calls.at(-1)![0];
    for (const g of SETTINGS_GROUPS) expect(last[g], g).toBeDefined();
  });

  it("starts an empty field from the default whole seat, once", () => {
    const seen = vi.fn();
    render(
      <SeatSettingsEditor value={undefined} onChange={seen} prefillWholeId="platform:whole-volunteer-seat" />,
    );
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].pay).toEqual({ kind: "none" });
    // Control: a field that already holds terms is never overwritten.
    const kept = vi.fn();
    render(<SeatSettingsEditor value={{ v: 1 }} onChange={kept} prefillWholeId="platform:whole-volunteer-seat" />);
    expect(kept).not.toHaveBeenCalled();
  });

  it("shows the parser's refusal in the group it belongs to", () => {
    render(<Harness start={{ v: 1, pay: { kind: "fixed", note: "Account 12345678" } }} seen={() => {}} />);
    expect(within(groupBox("pay")).getByRole("alert")).toHaveTextContent(/bank or card number/);
    expect(within(groupBox("term")).queryByRole("alert")).toBeNull();
  });

  it("reads an empty group as Not set and carries the money line only where money is recorded", () => {
    render(<Harness start={{ v: 1, pay: { kind: "fixed", per: "month" }, bonus: { kind: "none" } }} seen={() => {}} />);
    expect(within(groupBox("allowance")).getByText("Not set")).toBeInTheDocument();
    expect(within(groupBox("pay")).getByText("Recorded here. Paid outside the platform.")).toBeInTheDocument();
    expect(within(groupBox("allowance")).queryByText("Recorded here. Paid outside the platform.")).toBeNull();
    // No bonus records no money, so it says nothing about paying.
    expect(within(groupBox("bonus")).queryByText("Recorded here. Paid outside the platform.")).toBeNull();
  });

  /*
   * Visual QA, 2026-10-09 (HIGH): typing 12.5 as a dollar amount rewrote the
   * box to 0.125 and the headline to US$0.13 a month, because the decimal was
   * stored as raw minor units and shown divided by 100. What a person types
   * stays in the box exactly, the parser refuses it, and no figure is rescaled.
   */
  it("keeps a decimal amount exactly as typed, refuses it, and never rescales it", () => {
    const seen = vi.fn();
    render(<Harness start={{ v: 1, pay: { kind: "fixed", currency: "USD", per: "month" } }} seen={seen} />);
    const box = within(groupBox("pay"));
    fireEvent.click(box.getByRole("button", { name: /^Edit\s*Pay$/ }));
    const amount = box.getByLabelText("Amount, in USD") as HTMLInputElement;

    fireEvent.change(amount, { target: { value: "12.5" } });
    expect(amount.value).toBe("12.5");
    expect(box.getByRole("alert")).toHaveTextContent("Whole numbers only.");
    expect(groupBox("pay").textContent).not.toMatch(/0\.13|0\.125/);
    const stored: SeatSettings = seen.mock.calls.at(-1)![0];
    expect(typeof stored.pay!.amountMinor).not.toBe("number");

    // Control: a whole amount is scaled to minor units and read back as typed.
    fireEvent.change(amount, { target: { value: "12" } });
    expect(amount.value).toBe("12");
    expect(seen.mock.calls.at(-1)![0].pay.amountMinor).toBe(1200);
    expect(box.getByText("US$12 a month")).toBeInTheDocument();
    expect(box.queryByRole("alert")).toBeNull();
  });

  it("names the opened preset sheet and shows no preview that repeats a card's title", () => {
    render(<Harness start={{ v: 1 }} seen={() => {}} />);
    const box = within(groupBox("pay"));
    fireEvent.click(box.getByRole("button", { name: /^Change\s*Pay$/ }));
    const sheet = box.getByRole("group", { name: "Choose a pay preset" });
    const unpaid = within(sheet).getByRole("button", { name: /Unpaid/ });
    expect(within(unpaid).getAllByText("Unpaid")).toHaveLength(1);
    // Control: a card whose preview says something new still shows it.
    const fixed = within(sheet).getByRole("button", { name: /Fixed monthly stipend/ });
    expect(fixed).toHaveTextContent("A fixed stipend a month, amount not set");
  });
});
