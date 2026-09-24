// @vitest-environment jsdom
/**
 * A founder can say what currency their village's money is in.
 *
 * WHY THIS FIELD DID NOT EXIST, AND WHAT IT COST. `shared/gameConfig.ts`
 * defaulted `project.fiatCurrency` to "CRC" and, until this screen, no file
 * under client/src mentioned the key at all. So every fork of this platform
 * shipped declaring Costa Rican colones, and there was no screen anywhere
 * that let a founder disagree.
 *
 * It also held a guard open. `scripts/check-identity-keys.mjs` carried a
 * known-pending list that had been shrinking since 2026-08-31, and its last
 * remaining entry was this key, recorded with the exit condition that the
 * founder sets it in Admin. The guard was waiting on a screen nobody had
 * built.
 *
 * BOTH ARE CLOSED AS OF 2026-09-23, and the ordering is the point: the founder
 * entered the village's own currency on THIS screen first, so the village held
 * its own copy, and only then did the platform default go blank. Doing it the
 * other way round is the 2026-08-31 outage. `defaultDisplayCurrency` answers
 * CHF for a project that declares nothing, so blank reaches the ruling without
 * writing one country's money into platform code. The pending list is now
 * empty and its ceiling is zero.
 *
 * What made it wait was not what the pending entry claimed. That entry said
 * prices render against the key, which is wrong: `formatMoney` returns the
 * amount's OWN currency when there is no rate. The real reader is
 * `redemptionCurrencies` (server/lib/redemption.ts), which falls back to the
 * merged project currency, so the default decided what a village SETTLES a
 * redemption in. Money leaving, not a label.
 *
 * WHAT THE ASSERTIONS READ. Money, not configuration. The last test runs the
 * saved document back through `defaultDisplayCurrency`, the same shared
 * function the member-facing CurrencyPicker calls to decide what a viewer
 * sees before choosing anything. Asserting that a key was written would pass
 * against a field wired to a value nothing renders, which is the exact defect
 * that removed the two currency boxes that used to sit on this screen (see
 * the comment in the Identity section).
 *
 * WHY THE CONTROL IS NOT A DROPDOWN. The daily ECB rate table carries
 * fourteen codes and CRC is not among them, measured in server/lib/fxRates.ts.
 * A closed list would make the first village's own currency unreachable from
 * the screen built to set it, so the field takes free text with the covered
 * codes offered as suggestions, and says plainly when a chosen code has no
 * daily rate.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultDisplayCurrency } from "@shared/money";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SetupWizard } from "./Admin";

const IMAGE_KEYS = [
  "hero", "investorHero", "residentHero", "stewardHero", "prosperityHero",
  "masterPlanHero", "logo", "heartLogo", "favicon",
];

/**
 * A currency the daily rate table does NOT carry.
 *
 * This was named PLATFORM_DEFAULT and quoted `shared/gameConfig.ts`, because a
 * village shipping it was the whole problem. That default went blank on
 * 2026-09-23, so the old name described history and the tests below would have
 * kept reading as though it were still live.
 *
 * The value stays CRC, and the two uses it has are both about the rate table
 * rather than about any default: the ECB daily list does not carry it
 * (measured 2026-08-21, server/lib/fxRates.ts), which is exactly what makes it
 * the right code for the unconverted warning, and it is the first village's
 * real currency, which is why the field cannot be a closed dropdown.
 */
const UNCOVERED_CODE = "CRC";

const emptyProject = () => ({
  name: "", tagline: "", memberName: "", location: "", country: "",
  fiatCurrency: "", siteUrl: "", eventsUrl: "", contactEmail: "", footerBlurb: "",
});

const stub = () => {
  // The village's record, written by PUT the way the real route writes it, so
  // a later read sees what a save actually stored.
  const current: any = { project: emptyProject(), currency: { name: "", nameLower: "" }, images: Object.fromEntries(IMAGE_KEYS.map((k) => [k, ""])), setup: {} };
  const puts: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const path = String(url);
      if (path.includes("/fx/rates")) {
        // The shape /api/fx/rates really answers with. CRC is absent here for
        // the same reason it is absent from the ECB list.
        return { ok: true, status: 200, json: async () => ({ base: "EUR", asOf: "2026-09-03", rates: { USD: 1.1, CHF: 0.95, GBP: 0.84 } }) };
      }
      if (path.includes("/admin/brand")) {
        if (init?.method === "PUT") {
          const body = JSON.parse(init.body);
          puts.push(body);
          for (const [k, v] of Object.entries(body)) Object.assign(current[k] ?? (current[k] = {}), v as any);
        }
        return {
          ok: true,
          status: 200,
          // `defaults` carries a BLANK currency, which is what the route now
          // serves: the platform default went empty on 2026-09-23. It fed CRC
          // here while that was the shipped default, and leaving it would have
          // meant this stub described a version of the server that no longer
          // exists. Nothing asserts against it (it reaches the placeholder and
          // the "Platform default:" line only), so the accurate value costs
          // nothing and stops the fixture teaching the wrong thing.
          json: async () => ({ brand: current, defaults: { project: emptyProject(), images: Object.fromEntries(IMAGE_KEYS.map((k) => [k, ""])) } }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { current, puts };
};

const field = () => document.getElementById("project-fiat-currency") as HTMLInputElement;

describe("the founder can set the village's own currency", () => {
  let ctx: ReturnType<typeof stub>;
  beforeEach(() => { ctx = stub(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  const open = async () => {
    render(<SetupWizard password="secret" onOpenTab={() => {}} />);
    await waitFor(() => expect(field()).toBeTruthy());
  };

  it("offers the codes the daily rate table actually carries", async () => {
    await open();
    // Array.from, not spread: an HTMLCollection needs downlevelIteration to
    // spread, and this file IS typechecked (tsconfig excludes *.test.ts, and
    // this is .tsx).
    const options = Array.from((document.getElementById("fiat-currency-options") as HTMLDataListElement).options).map((o) => o.value);
    // Read off the stubbed table, never a list typed into the component: a
    // hardcoded list is one that drifts from what the village can convert.
    expect(options).toEqual(["CHF", "EUR", "GBP", "USD"]);
  });

  it("says so when a chosen currency has no daily rate", async () => {
    const user = userEvent.setup();
    await open();
    await user.type(field(), UNCOVERED_CODE);
    await waitFor(() =>
      expect(screen.getByText(/no daily rate for CRC/i), "a founder was not told their currency shows unconverted").toBeTruthy(),
    );
  });

  it("refuses a code that is not three letters", async () => {
    const user = userEvent.setup();
    await open();
    await user.type(field(), "XX");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("three letter code"));
  });

  it("saves the code, and the saved village then renders money in it", async () => {
    const user = userEvent.setup();
    await open();
    await user.type(field(), "chf");

    // Typed lowercase on purpose: one village must not be able to store two
    // spellings of the same currency.
    expect(field().value).toBe("CHF");

    // Anchored, because "Save identity pack" is a different button in a
    // different section of the same wizard.
    await user.click(screen.getByRole("button", { name: /^Save identity$/i }));
    await waitFor(() => expect(ctx.puts.length).toBeGreaterThan(0));

    expect(ctx.current.project.fiatCurrency).toBe("CHF");

    /*
     * THE OUTCOME. This is the function the member-facing CurrencyPicker
     * calls to label "this village's" currency, so this assertion is about
     * what a member sees, not about a stored string. Before the field
     * existed, this same call returned the platform's CRC for every village
     * on earth.
     */
    expect(defaultDisplayCurrency(ctx.current.project)).toBe("CHF");
    expect(defaultDisplayCurrency(ctx.current.project)).not.toBe(UNCOVERED_CODE);
  });
});
