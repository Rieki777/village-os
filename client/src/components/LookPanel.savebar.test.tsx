// @vitest-environment jsdom
/**
 * The Look panel and a gathering's email settings save from the floating bar:
 * the bar appears on the first change, sends only what its panel owns, says
 * Saved only for an answer that was ok, and keeps the change when it was not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LookPanel from "./LookPanel";
import GatheringEmailSettings from "./comms/GatheringEmailSettings";
import { resetUnsavedForTests, unsavedCount } from "@/lib/unsavedChanges";

afterEach(() => { cleanup(); resetUnsavedForTests(); vi.unstubAllGlobals(); });

describe("LookPanel", () => {
  const stub = (putStatus: number) => {
    const puts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === "PUT") { puts.push(JSON.parse(String(init.body))); return new Response("{}", { status: putStatus }); }
      return new Response(JSON.stringify({ brand: { theme: { seed: "#157f7d", character: "", place: "", accent: "" } } }), { status: 200 }); // theme-ok: a fetched brand fixture in a test, never rendered to a village
    }));
    return puts;
  };

  it("offers Save on the first change, sends its four fields, then says Saved", async () => {
    const puts = stub(200);
    render(<LookPanel password="pw" />);
    const place = await screen.findByPlaceholderText(/river valley/);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.change(place, { target: { value: "By the river" } });
    expect(await screen.findByText(/1 change not saved yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(Object.keys((puts[0] as { theme: object }).theme).sort()).toEqual(["accent", "character", "place", "seed"]);
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(unsavedCount()).toBe(0);
  });

  it("keeps the change and says why when the server refuses", async () => {
    stub(403);
    render(<LookPanel password="pw" />);
    fireEvent.change(await screen.findByPlaceholderText(/river valley/), { target: { value: "By the river" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/did not accept/);
    expect(screen.queryByText("Saved")).toBeNull();
    expect(unsavedCount()).toBe(1);
  });
});

describe("GatheringEmailSettings", () => {
  const settings = {
    reminders: { mode: "default" }, effective: { reminderMinutes: [60] }, guests: "default", hostUserId: null,
    village: { reminderMinutes: [60], guests: true }, hostChoices: [],
  };
  it("saves from the bar and says Saved", async () => {
    const puts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === "PUT") { puts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ settings: { ...settings, guests: "on" } }), { status: 200 }); }
      return new Response(JSON.stringify({ settings }), { status: 200 });
    }));
    render(<GatheringEmailSettings eventId="e1" token="t" manages />);
    fireEvent.click(screen.getByRole("button", { name: "Email settings" }));
    fireEvent.change(await screen.findByLabelText("Guests without an account"), { target: { value: "on" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ guests: "on", reminders: { mode: "default" } });
    expect(await screen.findByText("Saved")).toBeTruthy();
  });
});
