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
 * WHY THE CONTROL IS A LIST OF NAMES NOW (Rye, 2026-10-22: "I can't set
 * Colones"). It was free text with bare codes as suggestions, because the
 * daily ECB table then carried fourteen codes and CRC was not among them, so a
 * closed list would have made the first village's own currency unreachable.
 * The route always took CRC; the screen never said which code colones are. A
 * browser narrows suggestions to what is already in the box, so a box holding
 * USD suggested USD alone, and a name typed into it was cut to "COL", another
 * code. The daily source now carries 166 codes, CRC among them, so the field
 * lists every one by name, keeps any code already stored, and keeps "Another
 * code" for the rest, so it is still open.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultDisplayCurrency } from "@shared/money";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SetupWizard } from "./Admin";

const IMAGE_KEYS = [
  "hero", "investorHero", "residentHero", "stewardHero", "prosperityHero",
  "masterPlanHero", "logo", "heartLogo", "favicon",
];

/**
 * A currency the STUBBED rate table below does not carry. The live source has
 * carried CRC since 2026-09-25; this stub leaves it out so the unconverted
 * warning has a code to speak about. It is also the first village's real
 * currency, the one Rye could not set.
 */
const UNCOVERED_CODE = "CRC";

const emptyProject = () => ({
  name: "", tagline: "", memberName: "", location: "", country: "",
  fiatCurrency: "", siteUrl: "", eventsUrl: "", contactEmail: "", footerBlurb: "",
});

const stub = (storedCurrency = "") => {
  // The village's record, written by PUT the way the real route writes it, so
  // a later read sees what a save actually stored.
  const current: any = { project: { ...emptyProject(), fiatCurrency: storedCurrency }, currency: { name: "", nameLower: "" }, images: Object.fromEntries(IMAGE_KEYS.map((k) => [k, ""])), setup: {} };
  const puts: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const path = String(url);
      if (path.includes("/fx/rates")) {
        // The shape /api/fx/rates really answers with, short: CRC is left out
        // so the unconverted warning has something to say.
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

const field = () => document.getElementById("project-fiat-currency") as HTMLSelectElement;
const another = () => document.getElementById("project-fiat-currency-other") as HTMLInputElement | null;

describe("the founder can set the village's own currency", () => {
  let ctx: ReturnType<typeof stub>;
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  const open = async (stored = "") => {
    ctx = stub(stored);
    render(<SetupWizard password="secret" onOpenTab={() => {}} />);
    await waitFor(() => expect(field()).toBeTruthy());
  };
  const save = async (user: ReturnType<typeof userEvent.setup>) => {
    // Anchored, because "Save identity pack" is a different button in a
    // different section of the same wizard.
    await user.click(screen.getByRole("button", { name: /^Save identity$/i }));
    await waitFor(() => expect(ctx.puts.length).toBeGreaterThan(0));
  };

  it("lists every currency by its name, so colones are found without knowing the code", async () => {
    await open();
    const options = Array.from(field().options);
    const colones = options.find((o) => o.value === "CRC");
    expect(colones?.textContent, "colones are not findable by name").toMatch(/Costa Rican Col[oó]n \(CRC\)/i);
    // The daily source's whole list, never the stubbed table's four: the
    // offer is what a village may count in, and a rate is a separate fact.
    expect(options.length).toBeGreaterThan(160);
    expect(options.map((o) => o.value)).toEqual(expect.arrayContaining(["USD", "EUR", "CHF", "GBP"]));
  });

  it("changes a stored USD to colones, and the saved village then renders money in it", async () => {
    // Rye's exact state on 2026-10-22: USD stored, colones wanted.
    const user = userEvent.setup();
    await open("USD");
    expect(field().value).toBe("USD");
    await user.selectOptions(field(), "CRC");
    // The pick lands only on Save identity, so the screen says so until then.
    expect(screen.getByText(/Not saved yet\. Press Save identity below to keep Costa Rican Col[oó]n \(CRC\)/)).toBeTruthy();
    await save(user);
    await waitFor(() => expect(screen.queryByText(/Not saved yet/)).toBeNull());

    expect(ctx.current.project.fiatCurrency).toBe("CRC");
    /*
     * THE OUTCOME. This is the function the member-facing CurrencyPicker
     * calls to label "this village's" currency, so this assertion is about
     * what a member sees, not about a stored string.
     */
    expect(defaultDisplayCurrency(ctx.current.project)).toBe("CRC");
  });

  it("says so when a chosen currency has no daily rate", async () => {
    const user = userEvent.setup();
    await open();
    await user.selectOptions(field(), UNCOVERED_CODE);
    await waitFor(() =>
      expect(screen.getByText(/no daily rate for CRC/i), "a founder was not told their currency shows unconverted").toBeTruthy(),
    );
  });

  it("takes a code the list does not carry, typed by hand and uppercased", async () => {
    const user = userEvent.setup();
    await open();
    await user.selectOptions(field(), "Another code");
    await user.type(another()!, "abc");
    // Typed lowercase on purpose: one village must not be able to store two
    // spellings of the same currency.
    expect(another()!.value).toBe("ABC");
    await save(user);
    expect(ctx.current.project.fiatCurrency).toBe("ABC");
  });

  it("refuses a hand-typed code that is not three letters", async () => {
    const user = userEvent.setup();
    await open();
    await user.selectOptions(field(), "Another code");
    await user.type(another()!, "XX");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("three letter code"));
  });

  it("shows a stored code the list does not carry as the answer, never a different one", async () => {
    await open("ABC");
    expect(field().value).toBe("ABC");
    expect(another()).toBeNull();
  });
});
