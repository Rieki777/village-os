// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import CirclePicker from "./CirclePicker";
import CircleName from "./CircleName";

i18n.load("en", {});
i18n.activate("en");
const wrap = (ui: React.ReactElement) => render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

describe("CirclePicker", () => {
  const circles = [
    { id: "f", name: "Seedlings", status: "forming" },
    { id: "a", name: "Hub", status: "active", isAnchor: true },
    { id: "o", name: "Other", status: "active" },
    { id: "d", name: "Dormant one", status: "dormant" },
  ];
  it("lists operating first, the anchor marked, forming in its own group, dormant hidden", () => {
    wrap(<CirclePicker circles={circles} value="" onChange={() => {}} id="p" />);
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["⚓ Hub", "Other", "Seedlings"]);
    expect(document.querySelector("optgroup")?.getAttribute("label")).toBe("Forming");
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
  it("chooses the only operating circle when asked", () => {
    const onChange = vi.fn();
    wrap(<CirclePicker circles={[circles[0], circles[1]]} value="" onChange={onChange} autoDefault />);
    expect(onChange).toHaveBeenCalledWith("a");
  });
  it("shows a search box only above eight circles", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: `Circle ${i}`, status: "active" }));
    wrap(<CirclePicker circles={many} value="" onChange={() => {}} />);
    expect(screen.getByRole("searchbox")).toBeTruthy();
  });
  it("CircleName marks only the circle the data says is the anchor", () => {
    wrap(<><CircleName name="A" anchor /><CircleName name="B" /></>);
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });
});
