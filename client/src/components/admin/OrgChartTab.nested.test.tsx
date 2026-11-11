// @vitest-environment jsdom
/**
 * THE ORG CHART, NESTED (the lead, 2026-11-11): circles first, a circle's roles
 * when it is opened, the whole role when that is opened, each level an address
 * the back button walks; and one save for every circle and role changed on the
 * way, which keeps whatever the server turned down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrgChartTab } from "./OrgChartTab";
import { resetUnsavedForTests, unsavedCount } from "@/lib/unsavedChanges";

const org = {
  circles: [
    { id: "c-land", name: "Land Circle", status: "active", purpose: "", isExample: false },
    { id: "c-hub", name: "Hub", status: "active", purpose: "", isExample: false, isAnchor: true },
    { id: "c-seed", name: "Seed Circle", status: "forming", purpose: "", isExample: false },
  ],
  roles: [
    { id: "r-orchard", name: "Orchard Keeper", circleId: "c-land", seats: 1, state: "open", holders: [], holderCount: 0, accountabilities: [] },
    { id: "r-water", name: "Water Steward", circleId: "c-land", seats: 1, state: "open", holders: [], holderCount: 0, accountabilities: [] },
  ],
};

let puts: { path: string; body: any }[] = [];
let refuse = new Set<string>();

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const path = String(url);
      if (init?.method === "PUT") {
        puts.push({ path, body: JSON.parse(init.body) });
        const no = [...refuse].some((p) => path.endsWith(p));
        return { ok: !no, status: no ? 403 : 200, json: async () => (no ? { error: "forbidden", message: "Not yours to change." } : { ok: true }) };
      }
      const body =
        path.includes("/org/seat-claims") ? []
        : path.includes("/admin/org/expiring") ? []
        : path.includes("/admin/players") ? []
        : /\/org(\?|$)/.test(path) ? org
        : {};
      return { ok: true, status: 200, json: async () => body };
    }),
  );
}

const go = (search: string) => window.history.replaceState({}, "", `/admin${search}`);

describe("the nested org chart", () => {
  beforeEach(() => { puts = []; refuse = new Set(); stub(); go("?tab=org-chart"); window.scrollTo = vi.fn() as any; });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetUnsavedForTests(); });

  it("lists the circles first, operating with the anchor leading, each with its role count", async () => {
    render(<OrgChartTab password="secret" />);
    const links = await screen.findAllByRole("link", { name: /Circle|Hub/ });
    const names = links.map((a) => a.textContent ?? "");
    expect(names[0]).toContain("Hub");
    expect(names[1]).toContain("Land Circle");
    expect(names[1]).toContain("2 roles");
    expect(names[2]).toContain("Seed Circle");
    expect(names[2]).toContain("Forming");
    // No role editor on the first level.
    expect(screen.queryByLabelText("Key accountabilities, one per line")).toBeNull();
  });

  it("opens a circle, then a role, and back walks up", async () => {
    render(<OrgChartTab password="secret" />);
    fireEvent.click(await screen.findByRole("link", { name: /Land Circle/ }));
    expect(new URLSearchParams(window.location.search).get("circle")).toBe("c-land");
    expect(screen.getByLabelText("Circle name")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /Orchard Keeper/ }));
    expect(new URLSearchParams(window.location.search).get("role")).toBe("r-orchard");
    expect(screen.getByLabelText("Key accountabilities, one per line")).toBeTruthy();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toContain("Org chart");
    expect(crumbs.textContent).toContain("Land Circle");
    expect(crumbs.textContent).toContain("Orchard Keeper");
    // The browser's back: the address changes, then popstate.
    await act(async () => { go("?tab=org-chart&circle=c-land"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.queryByLabelText("Key accountabilities, one per line")).toBeNull();
    expect(screen.getByRole("link", { name: /Water Steward/ })).toBeTruthy();
  });

  it("opens straight on a role from a link", async () => {
    go("?tab=org-chart&circle=c-land&role=r-water");
    render(<OrgChartTab password="secret" />);
    await waitFor(() => expect(screen.getByLabelText("Why this role matters")).toBeTruthy());
    expect((screen.getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("Water Steward");
  });

  it("saves changes to a circle and two roles at once, and keeps the one the server refused", async () => {
    go("?tab=org-chart&circle=c-land");
    render(<OrgChartTab password="secret" />);
    fireEvent.change(await screen.findByLabelText("Circle name"), { target: { value: "Land and Water" } });
    fireEvent.click(screen.getByRole("link", { name: /Orchard Keeper/ }));
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Orchard Tender" } });
    fireEvent.click(screen.getByRole("link", { name: /Land Circle|Land and Water/ }));
    fireEvent.click(screen.getByRole("link", { name: /Water Steward/ }));
    fireEvent.change(screen.getByLabelText("Why this role matters"), { target: { value: "The spring." } });
    expect(screen.getByText("3 changes not saved yet")).toBeTruthy();
    expect(unsavedCount()).toBe(3);

    refuse.add("/admin/org/roles/r-water");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });

    expect(puts.map((p) => p.path.replace(/^.*\/api/, ""))).toEqual([
      "/admin/circles/c-land",
      "/admin/org/roles/r-orchard",
      "/admin/org/roles/r-water",
    ]);
    expect(puts[0].body.name).toBe("Land and Water");
    await waitFor(() => expect(document.querySelector("[data-save-bar] [role=alert]")).not.toBeNull());
    const alert = document.querySelector("[data-save-bar] [role=alert]")!;
    expect(alert.textContent).toContain("Water Steward");
    expect(alert.textContent).toContain("Not yours to change.");
    // The refused role is still changed on screen and still counted; the
    // two that landed let go (the reload answers with the old names here,
    // so only the refused draft can still differ).
    expect((screen.getByLabelText("Why this role matters") as HTMLTextAreaElement).value).toBe("The spring.");
    await waitFor(() => expect(screen.getByText("1 change not saved yet")).toBeTruthy());
    expect(unsavedCount()).toBe(1);
  });
});
