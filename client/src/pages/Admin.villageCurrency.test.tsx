// @vitest-environment jsdom
/**
 * MAKE THIS YOURS ASKS WHICH CURRENCY THE VILLAGE COUNTS IN.
 *
 * `Admin.fiatCurrency.test.tsx` covers the field itself: the suggestions, the
 * no-daily-rate note, the refusal of a bad code, and that a saved code is what
 * money then renders in. This covers the question BESIDE it, which is a
 * different fact: has anybody here said, or is the village simply inheriting?
 *
 * An empty box behind a placeholder reads like an answered one. Blank means
 * inherit, which is a real state and not an error, so this asks and blocks
 * nothing. It is deliberately a separate file: the picker and its placeholder
 * are another lane's, and this one only ever reads whether a value is stored.
 *
 * Typing is the answer here, so there is no confirm button. The box is empty
 * until somebody types, which is the difference from the timezone, where the
 * inherited value is already showing and agreeing needs a control of its own.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SetupWizard } from "./Admin";

const IMAGE_KEYS = [
  "hero", "investorHero", "residentHero", "stewardHero", "prosperityHero",
  "masterPlanHero", "logo", "heartLogo", "favicon",
];

const emptyProject = () => ({
  name: "", tagline: "", memberName: "", location: "", country: "",
  fiatCurrency: "", siteUrl: "", eventsUrl: "", contactEmail: "", footerBlurb: "",
});

const stub = (storedCurrency: string) => {
  const current: any = {
    project: { ...emptyProject(), fiatCurrency: storedCurrency },
    currency: { name: "", nameLower: "" },
    images: Object.fromEntries(IMAGE_KEYS.map((k) => [k, ""])),
    setup: {},
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const path = String(url);
      if (path.includes("/fx/rates")) {
        return { ok: true, status: 200, json: async () => ({ base: "EUR", asOf: "2026-09-03", rates: { USD: 1.1, CHF: 0.95 } }) };
      }
      if (path.includes("/admin/brand")) {
        if (init?.method === "PUT") {
          const body = JSON.parse(init.body);
          for (const [k, v] of Object.entries(body)) Object.assign(current[k] ?? (current[k] = {}), v as any);
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            brand: current,
            defaults: { project: { ...emptyProject(), fiatCurrency: "CHF" }, images: Object.fromEntries(IMAGE_KEYS.map((k) => [k, ""])) },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
};

const field = () => document.getElementById("project-fiat-currency") as HTMLInputElement;

describe("the currency question", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/admin?tab=setup");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const open = async () => {
    render(<SetupWizard password="secret" onOpenTab={() => {}} />);
    await waitFor(() => expect(field()).toBeTruthy());
  };

  it("asks while nothing is stored", async () => {
    stub("");
    await open();
    expect(await screen.findByText(/Needs your answer/)).toBeInTheDocument();
  });

  it("names no currency code in the question", async () => {
    // The platform's own code is shown beside the box already, and it is
    // about to change from CRC to CHF in another lane. A code written into
    // this sentence would be a second copy, wrong the day that lands.
    stub("");
    await open();
    const ask = (await screen.findByText(/Needs your answer/)).textContent ?? "";
    expect(ask).not.toMatch(/\b(CRC|CHF|USD|EUR)\b/);
  });

  it("stops asking once a code is stored, even the platform's own", async () => {
    // A village may count in the same currency the platform ships. Typing it
    // is the answer; that is the whole difference between stored and
    // inherited.
    stub("CHF");
    await open();
    expect(screen.queryByText(/Needs your answer/)).toBeNull();
  });

  it("counts CRC as answered, though it has no daily rate", async () => {
    /*
     * AMORA'S EXACT STATE, and the case most likely to be got wrong later.
     *
     * Rye set CRC in Make This Yours himself, and the ECB daily list does not
     * carry it (measured 2026-08-21). So this village is ANSWERED and
     * UNCONVERTIBLE at once, and the two facts must stay independent: his
     * ruling is "flagged not blocked", so the missing rate is a note beside
     * the box and never a reason to call the question unanswered, to refuse
     * the code, or to keep asking somebody who has already told us.
     */
    stub("CRC");
    await open();
    expect(screen.queryByText(/Needs your answer/)).toBeNull();
    expect(field().value).toBe("CRC");
    // The live note still speaks, because it is about rates and not about
    // whether the village has answered.
    expect(await screen.findByText(/no daily rate for CRC/)).toBeInTheDocument();
  });

  it("treats a stored value of spaces as unanswered", async () => {
    // Whitespace was storable before this build, and it read as non-empty to
    // anything asking "has this village said?" while every renderer trimmed it
    // away. Once the platform default is CHF, that mismatch is invisible on
    // every screen, and this is what still catches it.
    stub("   ");
    await open();
    expect(await screen.findByText(/Needs your answer/)).toBeInTheDocument();
  });

  it("lands on the box when the checklist sends somebody here, and clears the address", async () => {
    window.history.replaceState({}, "", "/admin?tab=setup&setting=project.fiatCurrency");
    stub("");
    await open();
    await waitFor(() => expect((document.activeElement as HTMLElement)?.id).toBe("project-fiat-currency"));
    await waitFor(() => expect(window.location.search).toBe("?tab=setup"));
  });

  it("still lets the founder type a code, which is the answer", async () => {
    stub("");
    await open();
    fireEvent.change(field(), { target: { value: "chf" } });
    expect(field().value).toBe("CHF");
  });
});
