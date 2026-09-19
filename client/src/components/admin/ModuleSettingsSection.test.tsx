// @vitest-environment jsdom
/**
 * The module card's settings section: what a founder can reach, and what the
 * server gets to decide.
 *
 * FOUR THINGS ARE PINNED HERE, and each one is a way this could go quietly
 * wrong:
 *
 *   1. A module that is OFF still shows its settings, and says so in words.
 *      That is the whole ruling: a village sets a module up before it turns it
 *      on, and a section that hid itself while off would be the old defect
 *      wearing a new coat.
 *   2. The save goes to the SAME route Game Mechanics has always used. A
 *      second write path would be a second set of rules about rings and
 *      bounds, and the two would disagree on a Tuesday.
 *   3. A refusal from the server is shown ON the dial, in the server's own
 *      words. A founder-ring dial refused to a capability holder is the case
 *      that matters, because the toast has faded by the time they ask why.
 *   4. A dial two modules own says which other module moves with it.
 *
 * `fetch` is stubbed. What is under test is this component's wiring; the ring
 * enforcement behind the route has its own server tests.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ModuleSettingsSection from "./ModuleSettingsSection";

const VARIABLES = {
  categories: [
    {
      name: "Stays",
      variables: [
        {
          key: "stay.grace_nights",
          label: "Grace nights",
          description: "Nights a guest may stay past an empty balance",
          category: "Stays",
          type: "integer",
          value: "2",
          default: "2",
          isDefault: true,
          ring: "open",
          applyTiming: "instant",
          modules: ["stays"],
        },
        {
          key: "payments.purchase_limit_30d_usd",
          label: "Thirty day purchase limit",
          description: "What one member may buy in a month",
          category: "Payments",
          type: "integer",
          value: "3000",
          default: "3000",
          isDefault: true,
          ring: "founder",
          applyTiming: "instant",
          modules: ["stays", "exchange"],
        },
        {
          key: "forum.report_hide_threshold",
          label: "Report hide threshold",
          description: "Another module's dial",
          category: "Forum",
          type: "integer",
          value: "3",
          default: "3",
          isDefault: true,
          ring: "open",
          applyTiming: "instant",
          modules: ["forum"],
        },
      ],
    },
  ],
};

const NAMES = { stays: "Stays", exchange: "Exchange", forum: "Forum & Decisions" };

let putAnswer: { status: number; body: any } = { status: 200, body: { ok: true } };

const answer = (url: string, init?: any) => {
  if (init?.method === "PUT") {
    return { status: putAnswer.status, ok: putAnswer.status < 400, json: async () => putAnswer.body };
  }
  if (url.includes("/admin/variables")) return { status: 200, ok: true, json: async () => VARIABLES };
  // The config panels and the Hypha panel read their own routes.
  return { status: 404, ok: false, json: async () => ({}) };
};

const calls = () => (globalThis.fetch as unknown as { mock: { calls: any[][] } }).mock.calls;

const renderSection = (props: Partial<Parameters<typeof ModuleSettingsSection>[0]> = {}) =>
  render(
    <ModuleSettingsSection
      moduleId="stays"
      moduleName="Stays"
      lifecycle="off"
      moduleNames={NAMES}
      password="secret"
      {...props}
    />,
  );

describe("ModuleSettingsSection", () => {
  beforeEach(() => {
    putAnswer = { status: 200, body: { ok: true } };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => answer(String(url), init)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows the module's own settings while the module is OFF, and says what that means", async () => {
    renderSection();
    expect(await screen.findByText("Grace nights")).toBeInTheDocument();
    expect(screen.getByText(/Stays is off\. You can set it up now/)).toBeInTheDocument();
  });

  it("shows no dial that belongs to another module", async () => {
    renderSection();
    await screen.findByText("Grace nights");
    expect(screen.queryByText("Report hide threshold")).toBeNull();
  });

  it("names the other module on a shared dial", async () => {
    renderSection();
    await screen.findByText("Grace nights");
    expect(screen.getByText(/Shared with Exchange/)).toBeInTheDocument();
  });

  it("saves through the same route Game Mechanics uses, with the admin token", async () => {
    renderSection();
    const field = (await screen.findByDisplayValue("2")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "5" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() => expect(calls().some(([, init]) => init?.method === "PUT")).toBe(true));
    const put = calls().find(([, init]) => init?.method === "PUT")!;
    expect(put[0]).toBe("/api/admin/variables/stay.grace_nights");
    expect(JSON.parse(put[1].body)).toEqual({ value: "5" });
    expect(put[1].headers.Authorization).toBe("Bearer secret");
  });

  it("shows the server's refusal on the dial it refused, in the server's words", async () => {
    // The founder-ring refusal, as PUT /api/admin/variables/:key phrases it to
    // a holder of dial.set who is not acting as an admin.
    putAnswer = {
      status: 403,
      body: { error: "This dial is not one the village governs. It belongs to whoever runs the deployment, and it stays with them." },
    };
    renderSection();
    const field = (await screen.findByDisplayValue("3000")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "9000" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);
    const shown = await screen.findByRole("alert");
    expect(shown.textContent).toContain("not one the village governs");
  });

  it("marks a founder-held dial as one", async () => {
    renderSection();
    await screen.findByText("Thirty day purchase limit");
    expect(screen.getByText("founder held")).toBeInTheDocument();
  });

  /**
   * Ruling 11: warn loudly, never refuse. `redemption.process_text` ships
   * empty and an empty one shows a member no card at all, so a live
   * redemption module with nothing written is a member asking to cash out and
   * reading no instructions anywhere. The dial that fixes it is on this card,
   * so the warning belongs on this card.
   */
  const REDEMPTION = (processText: string) => ({
    categories: [
      {
        name: "Ledger",
        variables: [
          {
            key: "redemption.process_text",
            label: "How redemption works here",
            description: "The village's own words for what happens after a member asks",
            category: "Ledger",
            type: "longtext",
            value: processText,
            default: "",
            isDefault: processText === "",
            ring: "founder",
            applyTiming: "instant",
            modules: ["redemption"],
          },
        ],
      },
    ],
  });

  const withRedemption = (processText: string) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: any) => {
        if (init?.method === "PUT") return { status: 200, ok: true, json: async () => ({ ok: true }) };
        if (String(url).includes("/admin/variables")) {
          return { status: 200, ok: true, json: async () => REDEMPTION(processText) };
        }
        return { status: 404, ok: false, json: async () => ({}) };
      }),
    );
  };

  it("warns when redemption is live and nobody has written how a member gets paid", async () => {
    withRedemption("");
    renderSection({ moduleId: "redemption", moduleName: "Redemption", lifecycle: "members" });
    const warned = await screen.findByText(/shown no instructions at all/);
    expect(warned).toBeInTheDocument();
    // A warning and never a refusal. It is a status rather than an alert, and
    // the dial it is about is still there and still editable: nothing on this
    // card is withheld because the value is empty.
    expect(warned).toHaveAttribute("role", "status");
    expect(screen.getByText("How redemption works here")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).not.toBeDisabled();
  });

  it("does not warn once the process is written", async () => {
    withRedemption("Ask Suzy in the office, bring your bank details.");
    renderSection({ moduleId: "redemption", moduleName: "Redemption", lifecycle: "members" });
    await screen.findByText("How redemption works here");
    expect(screen.queryByText(/shown no instructions at all/)).toBeNull();
  });

  it("does not warn while redemption is still off, because the off notice already says it", async () => {
    withRedemption("");
    renderSection({ moduleId: "redemption", moduleName: "Redemption", lifecycle: "off" });
    await screen.findByText("How redemption works here");
    expect(screen.queryByText(/shown no instructions at all/)).toBeNull();
    expect(screen.getByText(/Redemption is off\. You can set it up now/)).toBeInTheDocument();
  });

  it("says plainly when a module has no settings of its own", async () => {
    renderSection({ moduleId: "network", moduleName: "Village Network", lifecycle: "public" });
    expect(await screen.findByText("Village Network has no settings of its own.")).toBeInTheDocument();
  });
});
