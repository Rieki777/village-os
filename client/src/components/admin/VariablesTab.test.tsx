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
    {
      name: "Forum",
      variables: [
        {
          key: "forum.report_hide_threshold",
          label: "Report hide threshold",
          description: "How many reports hide a thread",
          category: "Forum",
          type: "int",
          value: "3",
          default: "3",
          isDefault: true,
          // Owned by a module, so this tab leaves it to that module's card.
          modules: ["forum"],
        },
      ],
    },
  ],
  moduleSettings: [
    { id: "forum", name: "Forum & Decisions", core: false, lifecycle: "off", keys: ["forum.report_hide_threshold"] },
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

  it("sends the token panel to the module card it configures, and keeps a door to it", async () => {
    /*
     * THIS TEST HAS NOW ASSERTED THREE THINGS, and what it protects has never
     * changed: the Hypha Bridge panel has exactly one caller, and a panel that
     * silently loses its caller is a panel that leaves the product.
     *
     * It asserted two panels, then one, and now none HERE. The caller moved
     * (Rye, 2026-09-15): a module's settings belong on the module's own card,
     * where a village sets it up before switching it on, so the panel is
     * rendered by ModuleSettingsSection for the hypha card and
     * ModuleSettingsSection.test.tsx holds that end down. What this file
     * protects is the other half: the panel is GONE from Game Mechanics, and
     * this tab still says where it went.
     */
    render(<VariablesTab password="secret" />);
    await screen.findByText("Agreement needed");
    expect(screen.queryByRole("heading", { name: "Hypha Bridge" })).toBeNull();
    // The retired IntegrateDaoPanel's own two marks stay gone as well.
    expect(
      screen.queryByRole("heading", { name: "Integrate DAO: find a token's contract on Base" }),
    ).toBeNull();
    expect(screen.queryByPlaceholderText("Exact on-chain token name")).toBeNull();
  });

  it("leaves a module's own dials to its card, and links there", async () => {
    render(<VariablesTab password="secret" />);
    await screen.findByText("Agreement needed");
    // The server tagged this one as owned by a module, so it is edited there.
    expect(screen.queryByText("Report hide threshold")).toBeNull();
    const link = screen.getByRole("link", { name: "Forum & Decisions" });
    expect(link.getAttribute("href")).toBe("/admin?tab=modules&module=forum");
    expect(screen.getByText(/1 setting, module off/)).toBeInTheDocument();
  });

  it("opens at the one dial a deep link names, scrolled to and marked, and marks no other", async () => {
    // The review queue's "Change the limit" sends an admin here with
    // ?variable=<key>. A link that opened the tab at its top would leave them
    // searching a list of two hundred dials for the one they were sent to.
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    window.history.pushState({}, "", "/admin?tab=variables&variable=gratitude.cap");
    try {
      render(<VariablesTab password="secret" />);
      const named = (await screen.findByText("Gratitude cap")).closest("[id]") as HTMLElement;
      expect(named.id).toBe("variable-gratitude.cap");
      expect(named.getAttribute("aria-current")).toBe("true");
      const other = screen.getByText("Agreement needed").closest("[id]") as HTMLElement;
      expect(other.getAttribute("aria-current")).toBeNull();
      expect(scrolled).toHaveBeenCalled();
      expect(scrolled.mock.contexts[0]).toBe(named);
    } finally {
      Element.prototype.scrollIntoView = original;
      window.history.pushState({}, "", "/");
    }
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
