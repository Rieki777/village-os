// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { filterFromUrl, readSavedViews, rememberView, writeFilterUrl, SAVED_VIEWS_KEY } from "./savedViews";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/admin?tab=submissions");
});

describe("saved views", () => {
  it("keeps the filter in the address and a named preset on this device", () => {
    expect(filterFromUrl("?tab=submissions")).toBe("all");
    expect(filterFromUrl("?tab=submissions&type=visit")).toBe("visit");
    writeFilterUrl("contact");
    expect(window.location.search).toContain("type=contact");
    expect(window.location.search).toContain("tab=submissions");
    writeFilterUrl("all");
    expect(window.location.search).not.toContain("type=");
    expect(rememberView("  Morning  ", "contact").map((view) => view.name)).toEqual(["Morning"]);
    expect(readSavedViews()[0]?.filter).toBe("contact");
    rememberView("Morning", "visit");
    expect(readSavedViews()).toHaveLength(1);
    expect(readSavedViews()[0]?.filter).toBe("visit");
    expect(localStorage.getItem(SAVED_VIEWS_KEY)).toBeTruthy();
  });
});
