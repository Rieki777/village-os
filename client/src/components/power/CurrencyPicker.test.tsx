// @vitest-environment jsdom
/**
 * The display-currency picker names the village's own currency only once the
 * village has said it.
 *
 * It started as "CHF" and held that until /api/game/config answered, and for
 * good when the request failed, so the live map (whose config says CRC) first
 * told a visitor their village traded in Swiss francs. These pin the honest
 * order: no name before the config, the declared one after it, no guess when
 * the request fails, and the platform's own CHF only for a village that
 * declares nothing.
 *
 * The config comes through `fetchConfigCached`, which caches module-wide, so
 * every test imports the component fresh after stubbing fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

type ConfigAnswer = { project: Record<string, unknown> } | "pending" | "fails";

async function picker(config: ConfigAnswer) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown) => {
      const u = String(url);
      if (u === "/api/game/config") {
        if (config === "pending") return new Promise(() => {});
        if (config === "fails") return Promise.reject(new Error("offline"));
        return Promise.resolve({ ok: true, json: async () => config });
      }
      if (u === "/api/fx/rates") {
        return Promise.resolve({ ok: true, json: async () => ({ base: "EUR", asOf: null, rates: { CHF: 0.94, USD: 1.1 } }) });
      }
      return Promise.resolve({ ok: false, json: async () => null });
    }),
  );
  const { default: CurrencyPicker } = await import("./CurrencyPicker");
  const onChange = vi.fn();
  render(<CurrencyPicker onChange={onChange} />);
  const villageOption = () => (screen.getByRole("combobox") as HTMLSelectElement).options[0].textContent;
  return { onChange, villageOption };
}

describe("the display currency picker", () => {
  it("names no currency before the village has said one", async () => {
    const { onChange, villageOption } = await picker("pending");
    expect(villageOption()).toBe("This village's own");
    // Nothing to report yet, and above all not a guessed CHF.
    await new Promise((r) => setTimeout(r, 20));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("names the village's own currency once the config lands", async () => {
    const { onChange, villageOption } = await picker({ project: { name: "A village", fiatCurrency: "CRC" } });
    await waitFor(() => expect(villageOption()).toBe("CRC (this village's)"));
    // The currency each call reported. A village in colones is never, even
    // for one render, reported as Swiss francs.
    const reported = onChange.mock.calls.map((c) => c[0]);
    expect(reported).toContain("CRC");
    expect(reported).not.toContain("CHF");
  });

  it("keeps no guess when the config request fails", async () => {
    const { onChange, villageOption } = await picker("fails");
    await new Promise((r) => setTimeout(r, 20));
    expect(villageOption()).toBe("This village's own");
    expect(onChange).not.toHaveBeenCalled();
    // CHF is still there to choose, as one currency among the others.
    const codes = Array.from((screen.getByRole("combobox") as HTMLSelectElement).options).map((o) => o.value);
    expect(codes).toContain("CHF");
  });

  it("gives a village that declares no currency the platform's own CHF", async () => {
    const { onChange, villageOption } = await picker({ project: { name: "A village" } });
    await waitFor(() => expect(villageOption()).toBe("CHF (this village's)"));
    expect(onChange.mock.calls.map((c) => c[0])).toContain("CHF");
  });
});
