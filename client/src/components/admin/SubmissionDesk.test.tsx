// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SubmissionDesk, { Pick } from "./SubmissionDesk";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/admin?tab=submissions");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/hand-targets")) return { ok: true, json: async () => ({ people: [{ id: "u2", name: "Nia" }], roles: [] }) };
    if (String(url).endsWith("/handling")) return { ok: true, json: async () => ({ ok: true, toldSera: false }) };
    if (init?.method === "DELETE") return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({}) };
  }));
});

const rows = [
  { id: "a", type: "contact", data: { name: "Ada" } },
  { id: "b", type: "contact", data: { name: "Bo" } },
];

describe("bulk select and saved views", () => {
  it("saves a named view on this device and in the address", async () => {
    const onFilter = vi.fn();
    render(
      <SubmissionDesk password="tok" filter="contact" onFilter={onFilter} rows={rows} onChanged={vi.fn()}>
        <p>list</p>
      </SubmissionDesk>,
    );
    await userEvent.type(screen.getByPlaceholderText("Name this view"), "Morning");
    await userEvent.click(screen.getByRole("button", { name: "Save this view" }));
    await userEvent.click(screen.getByRole("button", { name: "Morning" }));
    expect(onFilter).toHaveBeenCalledWith("contact");
    expect(localStorage.getItem("admin.savedViews")).toContain("Morning");
  });

  it("uses one reason for every selected request and does not stop at the first", async () => {
    const onChanged = vi.fn();
    render(
      <SubmissionDesk password="tok" filter="all" onFilter={vi.fn()} rows={rows} onChanged={onChanged}>
        <Pick id="a" />
        <Pick id="b" />
      </SubmissionDesk>,
    );
    const boxes = screen.getAllByRole("checkbox", { name: "Select this request" });
    await userEvent.click(boxes[0]);
    await userEvent.click(boxes[1]);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove them" }));
    const handling = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).endsWith("/handling"));
    expect(handling).toHaveLength(2);
    const reasons = handling.map((c) => JSON.parse(String(c[1]?.body)).reason);
    expect(reasons).toEqual(["already_done", "already_done"]);
    expect(onChanged).toHaveBeenCalled();
  });
});
