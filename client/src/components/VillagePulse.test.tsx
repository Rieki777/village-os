// @vitest-environment jsdom
/**
 * THE PULSE REACHES AS FAR BACK AS ITS SETTING SAYS.
 *
 * The server sends `village.pulse_max_entries` happenings (Admin, Variables,
 * Village Pulse length), and this component cut every answer at eight, so the
 * setting changed nothing a visitor could see. Eight still show first, and
 * "Show more" opens the rest of what the server sent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import VillagePulse from "./VillagePulse";

const events = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `e${i}`, type: "quest", text: `Happening ${i + 1}`, at: new Date().toISOString() }));

const serve = (body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response));

describe("the village pulse", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows eight first, then everything the setting reaches back to", async () => {
    serve(events(30));
    render(<VillagePulse />);
    expect(await screen.findByText("Happening 8")).toBeTruthy();
    expect(screen.queryByText("Happening 9")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Happening 30")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("offers no Show more when everything already shows", async () => {
    serve(events(5));
    render(<VillagePulse />);
    expect(await screen.findByText("Happening 5")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});
