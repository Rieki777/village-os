// @vitest-environment jsdom
/**
 * The apply wizard's seat picker says what each seat pays before it is ticked
 * (Rye, 2026-10-30), from the `/api/org` answer the picker already read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import SeatPicksField from "./SeatPicksField";

vi.mock("@/components/InfoTip", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "u-ana" } }) }));
vi.mock("./pickSources", () => ({
  loadPickOptions: async () => [
    {
      value: "seat-paid",
      label: "Paid seat",
      pay: { value: null, lines: [{ token: "village-voice", name: "Village Voice", amount: 3, voice: true }], source: "own", cadence: "cycle" },
    },
    { value: "seat-plain", label: "Plain seat" },
  ],
}));
vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));

afterEach(cleanup);

const FIELD = { key: "seatIds", label: "The seats", kind: "seatPicks", required: true } as any;

describe("the seat picker's pay", () => {
  it("draws the pay on the seat that carries it and nothing on the one that does not", async () => {
    render(<SeatPicksField field={FIELD} value={[]} onChange={() => {}} invalid={false} footerNode={null} />);
    const paid = (await screen.findByLabelText(/Paid seat/)).closest("label")!;
    expect(paid.textContent).toContain("3 Village Voice each cycle");
    const plain = screen.getByLabelText(/Plain seat/).closest("label")!;
    expect(plain.querySelector("[data-work-pay]")).toBeNull();
  });
});
