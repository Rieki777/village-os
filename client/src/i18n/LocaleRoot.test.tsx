// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { user: null as null | { id: string; prefs?: { locale?: string } } };
const config = { value: null as null | { defaultLocale?: string } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/lib/gameApi", () => ({ useGameConfig: () => config.value, authToken: () => (auth.user ? "tok" : null) }));

import { LocaleRoot } from "./LocaleRoot";
import { useLocale } from "./LocaleProvider";

function Show() {
  return <p data-testid="loc">{useLocale().locale}</p>;
}

beforeEach(() => {
  localStorage.clear();
  auth.user = null;
  config.value = null;
  vi.stubGlobal("navigator", { ...navigator, languages: ["de-DE"], language: "de-DE" });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ messages: {} }) })));
});

describe("LocaleRoot: the app's sources for the language (spec i18n US1)", () => {
  it("a visitor whose browser names nothing on offer gets the village default", async () => {
    config.value = { defaultLocale: "es" };
    render(<LocaleRoot><Show /></LocaleRoot>);
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("es"));
  });

  it("a member's saved language wins and is mirrored into this browser", async () => {
    auth.user = { id: "1", prefs: { locale: "es" } };
    render(<LocaleRoot><Show /></LocaleRoot>);
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("es"));
    expect(localStorage.getItem("vos_locale")).toBe("es");
  });

  it("with neither, English", async () => {
    render(<LocaleRoot><Show /></LocaleRoot>);
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("en"));
  });
});
