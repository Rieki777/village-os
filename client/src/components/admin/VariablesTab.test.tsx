// @vitest-environment jsdom
/**
 * The move test for the Game Mechanics tab.
 *
 * VariablesTab and the Integrate DAO panel above it came out of
 * client/src/pages/Admin.tsx unchanged, so this file does not re-specify
 * either of them. It pins the four things a move can break silently, all four
 * of which were unaskable while the code sat 9,000 lines into a page with no
 * component test of its own.
 *
 *   1. It still renders. A module boundary is a fresh place for a dropped
 *      import to hide, and a dropped import in JSX throws at render time
 *      rather than at build time.
 *   2. It still reaches the right route with the right credential. API_BASE
 *      and authHeaders now cross a file boundary to get here, so the Bearer
 *      header is the most load-bearing thing to hold down.
 *   3. The stalemate warning still reads the value being TYPED. That warning
 *      is what Wave A added to this tab, it is the reason the page went over
 *      its line baseline, and it is the one line in this file that reaches
 *      into @shared. A move that broke the alias would show a clean dial and
 *      call it agreement.
 *   4. Integrate DAO travelled with the tab. It has one caller and it moved
 *      for that reason, so its absence here would mean a founder integrating
 *      a DAO found an empty screen.
 *
 * `fetch` is stubbed rather than run against a server: what is under test is
 * this component's wiring, and the routes behind it have their own server
 * tests.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import VariablesTab from "./VariablesTab";

/**
 * Two dials, one of them a governance threshold so the warning has something
 * to fire on. The server shape is the categorised one the route actually
 * sends; the flat array it also accepts is a second path this does not need.
 */
const VARIABLES = {
  categories: [
    {
      name: "Governance",
      variables: [
        {
          key: "governance.unity_pct",
          label: "Agreement needed",
          description: "How much of the weight has to agree",
          category: "Governance",
          type: "percentage",
          value: "70",
          default: "70",
          isDefault: true,
          min: 1,
          max: 100,
        },
      ],
    },
    {
      name: "Gratitude",
      variables: [
        {
          key: "gratitude.cap",
          label: "Gratitude cap",
          description: "How much one member may send in a cycle",
          category: "Gratitude",
          type: "int",
          value: "40",
          default: "25",
          isDefault: false,
        },
      ],
    },
  ],
};

/** Routes by path so the tab's loader and the Hypha panel's both get an answer. */
const answer = (url: string) => {
  if (url.includes("/admin/hypha/status")) return { status: 404, ok: false, json: async () => ({}) };
  if (url.includes("/admin/variables")) return { status: 200, ok: true, json: async () => VARIABLES };
  return { status: 200, ok: true, json: async () => ({}) };
};

const calls = () => (globalThis.fetch as unknown as { mock: { calls: any[][] } }).mock.calls;

describe("VariablesTab", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(String(url))));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the tab and every dial the server returned, under its own category", async () => {
    render(<VariablesTab password="secret" />);
    expect(await screen.findByText("Agreement needed")).toBeInTheDocument();
    expect(screen.getByText("Gratitude cap")).toBeInTheDocument();
    expect(screen.getByText("Governance")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Game Mechanics" })).toBeInTheDocument();
  });

  it("asks the variables route for them, carrying the admin token", async () => {
    render(<VariablesTab password="secret" />);
    await screen.findByText("Agreement needed");
    const call = calls().find(([url]) => String(url).includes("/admin/variables"));
    expect(call).toBeDefined();
    expect(call![0]).toBe("/api/admin/variables");
    // The whole reason this assertion exists: API_BASE and authHeaders now
    // live in ./adminApi rather than at the top of the page this came from.
    expect(call![1].headers.Authorization).toBe("Bearer secret");
  });

  it("warns about a stalemate off the number being typed, before anything is saved", async () => {
    render(<VariablesTab password="secret" />);
    const field = (await screen.findByDisplayValue("70")) as HTMLInputElement;
    expect(screen.queryByText(/the risk is a stalemate/)).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "99" } });
    expect(await screen.findByText(/Above 97 the risk is a stalemate/)).toBeInTheDocument();
    // Nothing was saved to earn that warning.
    expect(calls().every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });

  it("leaves a dial that is not a threshold alone however high it goes", async () => {
    render(<VariablesTab password="secret" />);
    await screen.findByText("Gratitude cap");
    const field = screen.getByDisplayValue("40") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "9999" } });
    expect(screen.queryByText(/the risk is a stalemate/)).not.toBeInTheDocument();
  });

  it("saves the typed value to the key's own route", async () => {
    render(<VariablesTab password="secret" />);
    const field = (await screen.findByDisplayValue("70")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "80" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    const put = calls().find(([, init]) => init?.method === "PUT");
    expect(put).toBeDefined();
    expect(put![0]).toBe("/api/admin/variables/governance.unity_pct");
    expect(JSON.parse(put![1].body)).toEqual({ value: "80" });
    expect(put![1].headers.Authorization).toBe("Bearer secret");
  });

  it("carries ONE token panel, not the two that were stacked here", async () => {
    /*
     * THIS TEST ASSERTED THE OPPOSITE and is rewritten rather than deleted,
     * because the thing it was really protecting still needs protecting: this
     * tab is the only caller of whatever token panel it renders, so a panel
     * that quietly disappears from here disappears from the product.
     *
     * What changed is which panel. Rye, on the merged tree: "there looks to be
     * 2 modules for imputing tokens and contracts." IntegrateDaoPanel took a
     * token NAME and wrote an address into a variable with no contract read;
     * the Bridge lists what the account actually holds and reads name, symbol
     * and decimals off the contract before binding, which is what catches a
     * token minted to carry your exact name. The safer one survived.
     */
    render(<VariablesTab password="secret" />);
    expect(await screen.findByRole("heading", { name: "Hypha Bridge" })).toBeInTheDocument();
    // The retired panel's own two marks are gone, which is the half that would
    // otherwise leave a dead second door on the page.
    expect(
      screen.queryByRole("heading", { name: "Integrate DAO: find a token's contract on Base" }),
    ).toBeNull();
    expect(screen.queryByPlaceholderText("Exact on-chain token name")).toBeNull();
  });

  it("still says what the screen is for when the server refuses the load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 401, ok: false, json: async () => ({ error: "auth_required" }) })),
    );
    render(<VariablesTab password="secret" />);
    expect(await screen.findByRole("heading", { name: "Game Mechanics" })).toBeInTheDocument();
    expect(screen.queryByText("Agreement needed")).not.toBeInTheDocument();
  });
});
