// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminHeader from "./AdminHeader";
import { announceHandled } from "./handledToday";
import { NO_FILTER, PlayersFilters } from "./PlayerCard";
import { ADMIN_FILTERS_ID, tabHasFilters } from "./adminFilters";
import { adminNavRailClass } from "@/lib/adminNav";
import { describeFailures, measureText, nightOverlay } from "@/test/tokenContrast";

beforeEach(() => localStorage.clear());

function header({ night = false, tab = "tokens", onNight = vi.fn(), onSignOut = vi.fn() } = {}) {
  return render(
    <AdminHeader
      villageName="North Wind"
      siteUrl="https://north.example"
      tab={tab}
      userName="Rye Cordon"
      night={night}
      onNight={onNight}
      onSignOut={onSignOut}
    />,
  );
}

async function openYou() {
  await userEvent.click(screen.getByRole("button", { name: /^Your settings/ }));
  return screen.getByRole("group", { name: "Your settings" });
}

describe("admin header", () => {
  it("carries the language selector at every width, not inside the phone-hidden extras (spec i18n US2)", () => {
    header();
    const trigger = screen.getByRole("button", { name: /^Language: English \(EN\)/ });
    expect(trigger.closest(".hidden")).toBeNull();
  });

  it("names the open page and its one-line purpose, under the village", () => {
    header({ tab: "tokens" });
    expect(screen.getByRole("heading", { level: 1, name: "Tokens" })).toBeTruthy();
    expect(screen.getByText("The tokens this village uses.")).toBeTruthy();
    expect(screen.getByText(/North Wind admin/)).toBeTruthy();
    expect(screen.getByText("north.example")).toBeTruthy();
  });

  it("offers no filters link on a page that has no filters, and never points at the library", () => {
    expect(tabHasFilters("tokens")).toBe(false);
    header({ tab: "tokens" });
    expect(screen.queryByRole("link", { name: "Change the filters" })).toBeNull();
    expect(document.querySelector('header a[href="/modules"]')).toBeNull();
  });

  it("sends 'Change the filters' to the open page's own filters and puts the cursor in them", async () => {
    expect(tabHasFilters("players")).toBe(true);
    render(
      <>
        <AdminHeader villageName="North Wind" siteUrl="" tab="players" userName="Rye" night={false} onNight={vi.fn()} onSignOut={vi.fn()} />
        <PlayersFilters value={NO_FILTER} onChange={vi.fn()} stages={[]} paths={[]} shown={0} total={0} />
      </>,
    );
    const link = screen.getByRole("link", { name: "Change the filters" });
    expect(link.getAttribute("href")).toBe(`#${ADMIN_FILTERS_ID}`);
    expect(document.getElementById(ADMIN_FILTERS_ID)).toBeTruthy();
    await userEvent.click(link);
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Name, handle or email"));
  });

  it("keeps night look, today's count and sign out together in one menu", async () => {
    const onNight = vi.fn();
    const onSignOut = vi.fn();
    header({ onNight, onSignOut });
    // Closed, the banner carries none of them loose.
    expect(screen.queryByRole("switch", { name: "Night look" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    const menu = await openYou();
    expect(within(menu).getByText("Rye Cordon")).toBeTruthy();
    expect(within(menu).getByText(/Handled today on this device: 0/)).toBeTruthy();
    const nightSwitch = within(menu).getByRole("switch", { name: "Night look" });
    expect(nightSwitch.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(nightSwitch);
    expect(onNight).toHaveBeenCalledWith(true);
    await userEvent.click(within(menu).getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("closes the menu on Escape and hands focus back to its button", async () => {
    header();
    await openYou();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Your settings" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Your settings/ }));
  });

  it("counts a handled item without asking the server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    header();
    await openYou();
    announceHandled();
    expect(await screen.findByText(/Handled today on this device: 1/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps readable text in day and night", async () => {
    const day = header();
    await openYou();
    expect(describeFailures(measureText(day.container, "light"))).toEqual([]);
    day.unmount();
    const night = header({ night: true });
    await openYou();
    expect(describeFailures(measureText(night.container, "light", nightOverlay()))).toEqual([]);
  });
});

describe("the docked admin rail", () => {
  // A flex item honours z-index even when static. The docked rail carried
  // z-40, above the sticky header's z-30, so scrolling slid the menu over the
  // header and cut its title off (Rye, 2026-11-09).
  it("draws no layer above the sticky header once docked", () => {
    expect(adminNavRailClass(true)).toContain("lg:z-auto");
    expect(adminNavRailClass(false)).not.toMatch(/(^|\s)z-\d/);
  });
});
