// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox } from "lucide-react";
import AdminMobileNav from "./AdminMobileNav";
import type { NavGroup } from "./adminNavGroups";

const groups: NavGroup[] = [
  { title: "Day to day", items: [{ key: "submissions", label: "All Forms", icon: Inbox }] },
  { title: "People", items: [{ key: "players", label: "Players", icon: Inbox }] },
];

describe("phone sections", () => {
  it("opens a bottom sheet and chooses a section with a 44px row", async () => {
    const onSelect = vi.fn();
    render(<AdminMobileNav groups={groups} activeTab="submissions" onSelect={onSelect} />);
    const opener = screen.getByRole("button", { name: /Sections/ });
    expect(opener.className).toContain("min-h-[44px]");
    await userEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    const players = screen.getByRole("button", { name: "Players" });
    expect(players.className).toContain("min-h-[44px]");
    await userEvent.click(players);
    expect(onSelect).toHaveBeenCalledWith("players");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
