// @vitest-environment jsdom
/**
 * The registry page, rendered, because "one page names every token" is a claim
 * about what a founder SEES and nothing else in this tree could be asked it.
 *
 * Three things are pinned here that no unit test can reach:
 *
 *   1. Every listed token carries its plain sentence and its slug marked
 *      FIXED. Those two are the whole reason the Setup Wizard's rival naming
 *      boxes could be deleted: a registry that prints a slug and a kind never
 *      told anybody what a token was for, so the wrong box looked as
 *      authoritative as the right one.
 *   2. A module's token is absent while its module is off, and an issued one
 *      stays with its module named. That is the founder's ruling in the one
 *      place a steward would go looking for a balance.
 *   3. Governance reads as where the token is MINTED, in words, so a
 *      read-only Base mirror cannot be mistaken for something this platform
 *      can issue.
 *
 * `fetch` is stubbed: what is under test is this component, and the routes
 * behind it have their own server tests.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ModuleLifecycle } from "@shared/modules";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import TokensTab from "./TokensTab";

const TOKENS = [
  { slug: "gratitude", name: "Gratitude", kind: "recognition", governance: "platform", transferable: true, active: true, issuedBy: {} },
  { slug: "credits", name: "Village Credits", kind: "credit", governance: "platform", transferable: true, active: true, issuedBy: {} },
  { slug: "stay-credit", name: "Stay Credits", kind: "credit", governance: "platform", transferable: false, active: true, issuedBy: {} },
  { slug: "library-credit", name: "Library Credits", kind: "credit", governance: "platform", transferable: false, active: true, issuedBy: { "sys:mint": 12 } },
  // Slug deliberately not the one drizzle/0006 seeds: that literal is one
  // village's own name and scripts/check-brand-refs.mjs fails a build for it.
  { slug: "village-equity", name: "Village Equity", kind: "equity", governance: "hypha", transferable: false, active: true, issuedBy: {} },
];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/admin/tokens")) {
        return { ok: true, json: async () => ({ tokens: TOKENS, mintCapPerCycle: 500 }) };
      }
      if (String(url).includes("/admin/mint-requests")) {
        return { ok: true, json: async () => ({ requests: [], cosignOver: 0 }) };
      }
      return { ok: true, json: async () => [] };
    }),
  );
}

/* Scoped to the registry TABLE on purpose: a token's name also appears in the
   mint picker below it, so an unscoped query finds two of everything. */
const table = () => screen.getByRole("table");
const rowFor = (name: string) => within(table()).getByText(name).closest("tr")!;
const inTable = (name: string) => within(table()).queryByText(name);

/** The table only exists once the first load resolves. */
const loaded = async () => {
  await screen.findByRole("table");
};

const renderTab = (lifecycles: Record<string, ModuleLifecycle> | null) =>
  render(<TokensTab password="secret" lifecycles={lifecycles} />);

describe("TokensTab", () => {
  beforeEach(stubFetch);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("says what each token is and marks its slug fixed", async () => {
    renderTab({ stays: "members", library: "members" });
    await loaded();
    const row = within(rowFor("Gratitude"));
    expect(row.getByText(/Members send it to each other/)).toBeInTheDocument();
    expect(row.getByText(/fixed for good/)).toBeInTheDocument();
    expect(row.getByText("gratitude")).toBeInTheDocument();
  });

  it("calls a Base token a read-only mirror rather than a governance word", async () => {
    renderTab({ stays: "members", library: "members" });
    await loaded();
    expect(within(rowFor("Village Equity")).getByText("Base mirror, read only")).toBeInTheDocument();
    expect(within(rowFor("Gratitude")).getByText("Minted here")).toBeInTheDocument();
    // A read-only mirror carries no rename control: its name is a fact about
    // Base, and the server refuses the rename anyway.
    expect(within(rowFor("Village Equity")).queryByText("rename")).toBeNull();
  });

  it("drops a module's token when the module is off, and keeps one somebody holds", async () => {
    renderTab({ stays: "off", library: "off" });
    await loaded();
    expect(inTable("Gratitude")).toBeInTheDocument();
    // Nothing was ever issued in stay credits, so the row leaves with stays.
    expect(inTable("Stay Credits")).toBeNull();
    // Library credits have been issued: the row stays and names the module.
    expect(inTable("Library Credits")).toBeInTheDocument();
    expect(within(rowFor("Library Credits")).getByText(/library module is off/)).toBeInTheDocument();
  });

  it("shows both module tokens while their modules are on", async () => {
    renderTab({ stays: "public", library: "public" });
    await loaded();
    expect(inTable("Stay Credits")).toBeInTheDocument();
    expect(inTable("Library Credits")).toBeInTheDocument();
    expect(within(rowFor("Stay Credits")).queryByText(/module is off/)).toBeNull();
  });

  it("shows the whole registry before the modules payload arrives", async () => {
    renderTab(null);
    await loaded();
    expect(inTable("Stay Credits")).toBeInTheDocument();
    expect(inTable("Library Credits")).toBeInTheDocument();
  });

  it("does not offer to mint into a token it left off its own list", async () => {
    renderTab({ stays: "off", library: "off" });
    await loaded();
    // The mint picker is the select whose placeholder option says "Token…".
    const picker = screen
      .getAllByRole("combobox")
      .find((el) => within(el).queryByText("Token…"))!;
    const options = within(picker).getAllByRole("option").map((o) => o.textContent);
    expect(options).not.toContain("Stay Credits");
    expect(options).toContain("Gratitude");
    // Library credits are held by somebody, so they stay listed and stay
    // mintable: the row is still real and a steward may still need to grant.
    expect(options).toContain("Library Credits");
  });

  it("reaches the registry with the admin credential", async () => {
    renderTab({ stays: "members", library: "members" });
    await loaded();
    const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => c);
    const tokensCall = calls.find((c: any[]) => String(c[0]).includes("/admin/tokens"));
    expect(tokensCall).toBeTruthy();
    expect(tokensCall[1].headers.Authorization ?? tokensCall[1].headers["X-Admin-Password"]).toBeTruthy();
  });

});

/**
 * THE SCALE OF EVERY NUMBER ON THIS SCREEN.
 *
 * When this was written Voice carried 3 decimals and every other token carried
 * 0, so this tab showed a grant of 10 Voice as "10,000" and its Amount box
 * minted 0.010 Voice to a steward who typed 10. The box and the numbers beside
 * it are one pair, and a screen that divides one half is worse than one that
 * divides neither, because both raw at least agree. These tests fail if either
 * half is left behind.
 *
 * THE FIXTURE'S `decimals` IS DELIBERATELY NOT THE REGISTRY'S VALUE, and it
 * must stay that way. Rye has since ruled currency-like tokens to two
 * decimals, Voice among them. If this fixture were set to 2 it would be
 * asserting against the same number the registry serves, and would stop being
 * a control: a regression that hardcoded the live scale would pass. Pinning a
 * scale nothing ships proves the conversion READS the token rather than
 * knowing the answer. Do not "correct" it to match production.
 */
describe("this screen speaks whole tokens", () => {
  const VOICE = { slug: "village-voice", name: "Village Voice", kind: "voice", governance: "platform", transferable: true, active: true, decimals: 3, issuedBy: { "sys:mint": 12345 } }; // 3 on purpose: not the shipped scale, see above
  const GRANT = {
    id: "amr-1", tokenSlug: "village-voice", tokenName: "Village Voice",
    // 10 whole Voice, as the ledger stores it.
    amount: 10000, toUserId: "u1", toName: "Wren", reason: "For the harvest",
    status: "pending", requestedBy: "a1", requestedByName: "Sol", requestedAt: "2026-09-01T00:00:00.000Z",
  };
  let posted: any[];

  beforeEach(() => {
    posted = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (init?.method === "POST") { posted.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ remaining: 9990 }) }; }
      if (String(url).includes("/admin/tokens")) return { ok: true, json: async () => ({ tokens: [...TOKENS, VOICE], mintCapPerCycle: 10000 }) };
      if (String(url).includes("/admin/mint-requests")) return { ok: true, json: async () => ({ requests: [GRANT], cosignOver: 0 }) };
      if (String(url).includes("/admin/players")) return { ok: true, json: async () => [{ id: "u1", name: "Wren" }] };
      return { ok: true, json: async () => [] };
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("renders a grant in whole tokens, not in ledger units", async () => {
    render(<TokensTab password="secret" lifecycles={{} as Record<string, ModuleLifecycle>} />);
    // 10000 minor at 3 decimals is 10 Voice. "10,000" here is the bug.
    expect(await screen.findByText(/10 Village Voice/)).toBeTruthy();
    expect(screen.queryByText(/10,000 Village Voice/)).toBeNull();
  });

  it("renders issued-to-date in whole tokens", async () => {
    render(<TokensTab password="secret" lifecycles={{} as Record<string, ModuleLifecycle>} />);
    await screen.findByRole("table");
    // 12345 minor at 3 decimals is 12.345.
    expect(within(rowFor("Village Voice")).getByText(/12\.345/)).toBeTruthy();
  });

  it("leaves a token with no decimals exactly as it always read", async () => {
    // The other half of the guarantee: gratitude and the credits are at 0
    // decimals, where minor and whole are the same number, and this change
    // must not move them by a digit.
    render(<TokensTab password="secret" lifecycles={{} as Record<string, ModuleLifecycle>} />);
    await screen.findByRole("table");
    expect(within(rowFor("Library Credits")).getByText(/12/)).toBeTruthy();
  });

  it("mints what the steward typed, in the units the ledger moves", async () => {
    /*
     * THE PAIR. This is the assertion that fails if the displays above are
     * divided and the box is left posting minor units: a steward reading "10"
     * in the record, typing 10, and moving 0.010.
     */
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<TokensTab password="secret" lifecycles={{} as Record<string, ModuleLifecycle>} />);
    await screen.findByRole("table");

    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects.find((s) => within(s).queryByText("Village Voice"))!, "village-voice");
    await user.selectOptions(selects.find((s) => s.querySelector('option[value=""]')?.textContent?.includes("Member"))!, "u1");
    await user.type(screen.getByPlaceholderText("Amount"), "10");
    await user.type(screen.getByPlaceholderText(/Reason/i), "For the harvest");
    await user.click(screen.getByRole("button", { name: /^Mint$/ }));

    expect(posted).toHaveLength(1);
    expect(posted[0].amount, "typing 10 Voice must move 10 Voice, not 0.010").toBe(10000);
  });
});
