// @vitest-environment jsdom
import { Trans } from "@lingui/react/macro";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { compileMessage } from "@lingui/message-utils/compileMessage";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale, LOCALE_STORAGE_KEY } from "./LocaleProvider";

/** A compiled catalog the way the server sends it: id -> compiled message. */
function catalog(pairs: Record<string, string>) {
  const messages: Record<string, unknown> = {};
  for (const [english, spanish] of Object.entries(pairs)) messages[generateMessageId(english)] = compileMessage(spanish);
  return { messages };
}

function Hello() {
  return (
    <p>
      <Trans>Hello there</Trans> <Trans>Nobody translated me</Trans>
    </p>
  );
}

function Switcher() {
  const { setLocale } = useLocale();
  return (
    <>
      <button onClick={() => setLocale("es")}>to-es</button>
      <button onClick={() => setLocale(null)}>to-browser</button>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = `${LOCALE_STORAGE_KEY}=; max-age=0; path=/`;
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});
afterEach(() => vi.useRealTimers());

describe("LocaleProvider", () => {
  it("renders English with no catalog request when English resolves", async () => {
    const fetchCatalog = vi.fn();
    render(
      <LocaleProvider sources={{ browser: ["en-GB"], villageDefault: null }} fetchCatalog={fetchCatalog}>
        <Hello />
      </LocaleProvider>,
    );
    expect(await screen.findByText(/Hello there/)).toBeTruthy();
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe("en");
  });

  it("renders the browser's language from the server catalog, and English for an id the catalog lacks", async () => {
    const fetchCatalog = vi.fn(async () => catalog({ "Hello there": "Hola" }));
    render(
      <LocaleProvider sources={{ browser: ["es-CR", "en"], villageDefault: null }} fetchCatalog={fetchCatalog}>
        <Hello />
      </LocaleProvider>,
    );
    expect(await screen.findByText(/Hola/)).toBeTruthy();
    expect(screen.getByText(/Nobody translated me/)).toBeTruthy();
    expect(fetchCatalog).toHaveBeenCalledWith("es");
    expect(document.documentElement.lang).toBe("es");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("shows nothing of the page while the catalog loads, then English after the timeout, with lang=en", async () => {
    vi.useFakeTimers();
    let release: (v: unknown) => void = () => {};
    const fetchCatalog = vi.fn(() => new Promise((r) => { release = r; }));
    render(
      <LocaleProvider sources={{ browser: ["es"], villageDefault: null }} fetchCatalog={fetchCatalog as never} timeoutMs={1500}>
        <Hello />
      </LocaleProvider>,
    );
    expect(screen.queryByText(/Hello there/)).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText(/Hello there/)).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    // It lands before anyone touched the page: switch to it.
    await act(async () => { release(catalog({ "Hello there": "Hola" })); });
    expect(screen.getByText(/Hola/)).toBeTruthy();
    expect(document.documentElement.lang).toBe("es");
  });

  it("a failed catalog request leaves the page in English, never blank", async () => {
    const fetchCatalog = vi.fn(async () => { throw new Error("offline"); });
    render(
      <LocaleProvider sources={{ browser: ["es"], villageDefault: null }} fetchCatalog={fetchCatalog}>
        <Hello />
      </LocaleProvider>,
    );
    expect(await screen.findByText(/Hello there/)).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("switching saves the choice for this browser, re-renders without a reload, and 'use my browser' clears it", async () => {
    const fetchCatalog = vi.fn(async () => catalog({ "Hello there": "Hola" }));
    render(
      <LocaleProvider sources={{ browser: ["en"], villageDefault: null }} fetchCatalog={fetchCatalog}>
        <Hello />
        <Switcher />
      </LocaleProvider>,
    );
    await screen.findByText(/Hello there/);
    await act(async () => { screen.getByText("to-es").click(); });
    expect(await screen.findByText(/Hola/)).toBeTruthy();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es");
    expect(document.cookie).toContain(`${LOCALE_STORAGE_KEY}=es`);
    await act(async () => { screen.getByText("to-browser").click(); });
    expect(await screen.findByText(/Hello there/)).toBeTruthy();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain(`${LOCALE_STORAGE_KEY}=es`);
  });

  it("a choice saved in this browser beats the browser's languages", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "es");
    const fetchCatalog = vi.fn(async () => catalog({ "Hello there": "Hola" }));
    render(
      <LocaleProvider sources={{ browser: ["en"], villageDefault: null }} fetchCatalog={fetchCatalog}>
        <Hello />
      </LocaleProvider>,
    );
    expect(await screen.findByText(/Hola/)).toBeTruthy();
  });
});
