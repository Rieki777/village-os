// @vitest-environment jsdom
/**
 * The end date field, rendered against a served season list.
 *
 * What is pinned is what a person sees while choosing: the season's end when
 * they have picked nothing, the caution arriving the moment a date runs long,
 * and a steward's cap arriving as the server's own sentence. The rule is
 * tested on its own in seatTermPreview.test.ts; this is the proof that the
 * form actually says it.
 */
import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SeatTermField from "./SeatTermField";

const NOW = new Date("2026-09-14T12:00:00Z");
const SEASON = {
  current: { id: "autumn", name: "Autumn", startsOn: "2026-09-01", endsOn: "2026-12-21" },
  upcoming: null,
  seasons: [{ id: "autumn", name: "Autumn", startsOn: "2026-09-01", endsOn: "2026-12-21" }],
  timezone: "UTC",
  today: "2026-09-14",
};

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => SEASON })),
  );
});
afterAll(() => {
  vi.unstubAllGlobals();
});

function Harness({ steward = false }: { steward?: boolean }) {
  const [value, setValue] = useState("");
  return <SeatTermField value={value} onChange={setValue} capAtSeasonEnd={steward} label="End date" now={NOW} />;
}

describe("SeatTermField", () => {
  it("says the seat ends with the season before anything is picked", async () => {
    render(<Harness />);
    expect(await screen.findByText(/Ends with the season on 2026-12-21\./)).toBeTruthy();
    const input = screen.getByLabelText("End date") as HTMLInputElement;
    expect(input.min).toBe("2026-09-15");
    expect(input.max).toBe("");
  });

  it("shows the caution the moment a date runs long, and offers the way back to the season", async () => {
    render(<Harness />);
    await screen.findByText(/Ends with the season/);
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2031-01-01" } });
    expect(await screen.findByText(/Ends on 2031-01-01\./)).toBeTruthy();
    expect(screen.getByText(/more than thirteen moons/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "End it with the season instead" }));
    expect(await screen.findByText(/Ends with the season on 2026-12-21\./)).toBeTruthy();
    expect(screen.queryByText(/more than thirteen moons/)).toBeNull();
  });

  it("caps a steward's picker at the season's end and says so in the server's words when a date goes past it", async () => {
    render(<Harness steward />);
    await screen.findByText(/Ends with the season/);
    const input = screen.getByLabelText("End date") as HTMLInputElement;
    expect(input.max).toBe("2026-12-21");
    fireEvent.change(input, { target: { value: "2027-01-15" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This season ends on 2026-12-21, so pick that date or an earlier one.");
  });
});
