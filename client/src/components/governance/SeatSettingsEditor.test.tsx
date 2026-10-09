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

  it("reads an empty group as Not set and carries the money line on set money groups", () => {
    render(<Harness start={{ v: 1, pay: { kind: "none" } }} seen={() => {}} />);
    expect(within(groupBox("allowance")).getByText("Not set")).toBeInTheDocument();
    expect(within(groupBox("pay")).getByText("Recorded here. Paid outside the platform.")).toBeInTheDocument();
    expect(within(groupBox("allowance")).queryByText("Recorded here. Paid outside the platform.")).toBeNull();
  });
});
