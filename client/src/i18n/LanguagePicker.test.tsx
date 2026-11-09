// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguagePicker } from "./LanguagePicker";
import { LocaleProvider, LOCALE_STORAGE_KEY } from "./LocaleProvider";

function setup(onChoose = vi.fn()) {
  const fetchCatalog = vi.fn(async () => ({ messages: {} }));
  render(
    <LocaleProvider sources={{ browser: ["en"], villageDefault: null }} fetchCatalog={fetchCatalog} onChoose={onChoose}>
      <LanguagePicker />
    </LocaleProvider>,
  );
  return { onChoose, fetchCatalog };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "en";
});

describe("LanguagePicker (spec i18n US2, §8 R37, R38)", () => {
  it("names the current language and its code in its accessible name (WCAG 2.5.3)", async () => {
    setup();
    const trigger = await screen.findByRole("button", { name: /Language: English \(EN\)/ });
    expect(trigger.textContent).toContain("EN");
  });

  it("lists each language in its own words, with its own lang attribute, and the browser option first", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /Language/ }));
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toMatch(/browser/i);
    const es = options.find((o) => o.textContent?.includes("Español"))!;
    expect(es.getAttribute("lang")).toBe("es");
    expect(es.getAttribute("dir")).toBe("ltr");
    expect(options.some((o) => o.textContent?.includes("English"))).toBe(true);
  });

  it("filters by the language's own name, its English name, or its code, ignoring accents", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /Language/ }));
    const box = screen.getByRole("combobox");
    for (const q of ["espanol", "spanish", "es"]) {
      fireEvent.change(box, { target: { value: q } });
      const names = screen.getAllByRole("option").map((o) => o.textContent);
      expect(names.some((n) => n?.includes("Español")), q).toBe(true);
      expect(names.some((n) => n?.includes("English")), q).toBe(false);
    }
  });

  it("keyboard: arrows move, Enter chooses, focus returns to the trigger, the choice is saved and announced", async () => {
    const { onChoose } = setup();
    const trigger = await screen.findByRole("button", { name: /Language/ });
    fireEvent.click(trigger);
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "esp" } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(box, { key: "Enter" }); });
    expect(onChoose).toHaveBeenCalledWith("es");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /\(ES\)/ }));
    expect(screen.getByRole("status").textContent).toMatch(/Español/);
  });

  it("Escape closes without choosing and returns focus", async () => {
    const { onChoose } = setup();
    const trigger = await screen.findByRole("button", { name: /Language/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("'use my browser's language' forgets the saved choice", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "es");
    const { onChoose } = setup();
    fireEvent.click(await screen.findByRole("button", { name: /\(ES\)/ }));
    await act(async () => { fireEvent.click(screen.getAllByRole("option")[0]); });
    expect(onChoose).toHaveBeenCalledWith(null);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it("the sheet has a close button for touch, which closes without choosing and returns focus", async () => {
    const { onChoose } = setup();
    const trigger = await screen.findByRole("button", { name: /Language/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onChoose).not.toHaveBeenCalled();
  });
});
