// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomeBase from "./HomeBase";
import type { NavGroup } from "./adminNavGroups";

const groups = [{ title: "Day to day", items: [{ key: "submissions", label: "All Forms", icon: (() => null) as unknown as NavGroup["items"][number]["icon"] }] }] as NavGroup[];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/submissions")) return { ok: true, json: async () => [{ id: "1" }, { id: "2" }, { id: "3" }] };
    return { ok: true, json: async () => ({ blockingOpen: 1 }) };
  }));
});

describe("home", () => {
  it("says what is waiting, in words, and can open the form list", async () => {
    const onOpenTab = vi.fn();
    render(<HomeBase password="tok" onOpenTab={onOpenTab} groups={groups} />);
    expect(await screen.findByText("3 requests are waiting.")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(await screen.findByText(/Updated /)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Inbox/ }));
    await userEvent.click(screen.getByRole("button", { name: /All forms/ }));
    expect(onOpenTab).toHaveBeenCalledWith("submissions");
    await userEvent.click(screen.getByRole("checkbox", { name: "Start on the form list instead" }));
    expect(localStorage.getItem("admin.homeBase")).toBe("0");
    expect(onOpenTab).toHaveBeenCalledWith("submissions");
  });

  it("does not count a form that has already been accepted", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/submissions")) {
        return { ok: true, json: async () => [{ id: "1", status: "new" }, { id: "2", status: "accepted" }, { id: "3", status: "declined" }] };
      }
      return { ok: true, json: async () => ({}) };
    }));
    render(<HomeBase password="tok" onOpenTab={vi.fn()} groups={groups} />);
    expect(await screen.findByText("1 request is waiting.")).toBeTruthy();
  });
});
