// @vitest-environment jsdom
/**
 * What a role's history says about the people who held it (lead, 12 Nov 2026:
 * "we can keep names on record"). A member who leaves keeps their name, so the
 * card names them after "This role has been held by:". Only an erasure, at the
 * person's request, takes a name off, and then the card says that plainly and
 * never that nobody held the role.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SeatSeating } from "./SeatHistory";

const rows = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => "token",
  gameFetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(rows.value) }),
  useRoleWord: () => ({ name: "Role" }),
}));

import SeatHistory from "./SeatHistory";

const seating = (over: Partial<SeatSeating> & { id: string }): SeatSeating => ({
  name: "Ada",
  kind: "member",
  focus: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: null,
  endedReason: null,
  ...over,
});

afterEach(cleanup);

describe("who has held this role", () => {
  it("names the people who held it after 'This role has been held by:', a leaver among them", async () => {
    rows.value = [
      seating({ id: "a", name: "Ada", endedAt: "2026-03-01T00:00:00.000Z", endedReason: "member left the village" }),
      seating({ id: "b", name: "Wren", startedAt: "2026-03-02T00:00:00.000Z" }),
    ];
    render(<SeatHistory roleId="kitchen" canSeePeople />);
    expect(await screen.findByText("This role has been held by: Ada, then Wren.")).toBeInTheDocument();
    expect(document.body.textContent).toContain("one of the many reasons our village writes its roles down");
    expect(document.body.textContent).not.toMatch(/removed|taken off/);
  });

  it("says plainly when the names were removed at the holders' request, and never that nobody held it", async () => {
    rows.value = [
      seating({ id: "a", name: null, endedAt: "2026-03-01T00:00:00.000Z" }),
      seating({ id: "b", name: null, startedAt: "2026-03-02T00:00:00.000Z" }),
    ];
    render(<SeatHistory roleId="kitchen-erased" canSeePeople />);
    expect(
      await screen.findByText("This role has been held. The people who held it asked for their names to be removed, so its record keeps the dates below."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Name removed at their request")).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/Nobody|nobody/);
  });

  it("control: a role with no rows at all is the one that has not been held yet", async () => {
    rows.value = [];
    render(<SeatHistory roleId="kitchen-new" canSeePeople />);
    expect(await screen.findByText(/Nobody has been recorded in this role yet/)).toBeInTheDocument();
  });
});
