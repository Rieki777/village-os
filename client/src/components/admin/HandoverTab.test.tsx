// @vitest-environment jsdom
/**
 * The first test any admin tab has ever had.
 *
 * HandoverTab was moved out of client/src/pages/Admin.tsx unchanged, and the
 * point of a move test is not to re-specify the component: it is to prove that
 * the three things a move can silently break did not break. All three were
 * invisible before the move, because an 11,000-line file with no component
 * test could not be asked any of them.
 *
 *   1. It still renders. A module boundary is a new place for a missing import
 *      to hide, and a missing import in JSX throws at render, not at build.
 *   2. It still reaches the right route with the right credential. `API_BASE`
 *      and `authHeaders` now cross a file boundary to get here, so the Bearer
 *      header is the single most load-bearing thing to pin.
 *   3. It still survives a server that says no. The tab's own loader swallows
 *      a failed response into `null` and renders the intro anyway, which is a
 *      deliberate behaviour (a founder who cannot load their powers should
 *      still be told what this screen is for) and exactly the sort of quiet
 *      thing a refactor drops.
 *
 * `fetch` is stubbed rather than run against a server: what is under test is
 * this component's wiring, and the route behind it has its own server tests.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import HandoverTab from "./HandoverTab";

const PAYLOAD = {
  roles: [{ id: "r1", name: "Keeper of the Gate", isExample: false, capabilities: ["membership.admit"] }],
  powers: [
    {
      capability: "membership.admit",
      title: "Who joins the village",
      surface: "The membership queue",
      consequence: "let somebody in",
      heldBy: null,
    },
  ],
};

const renderTab = () => render(<Router><HandoverTab password="secret" /></Router>);

describe("HandoverTab", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => PAYLOAD })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the handover screen and the powers the server returned", async () => {
    renderTab();
    expect(await screen.findByText("The handover")).toBeInTheDocument();
    expect(await screen.findByText("Who joins the village")).toBeInTheDocument();
    expect(await screen.findByText("membership.admit")).toBeInTheDocument();
  });

  it("asks the holding route for this village's powers, carrying the admin token", async () => {
    renderTab();
    await screen.findByText("The handover");
    const calls = (globalThis.fetch as unknown as { mock: { calls: any[][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe("/api/admin/capabilities/holding");
    // The whole reason this assertion exists: API_BASE and authHeaders now
    // live in ./adminApi rather than beside the component.
    expect(init.headers.Authorization).toBe("Bearer secret");
  });

  it("still says what the screen is for when the server refuses the load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "auth_required" }) })),
    );
    renderTab();
    expect(await screen.findByText("The handover")).toBeInTheDocument();
    expect(screen.queryByText("Who joins the village")).not.toBeInTheDocument();
  });

  it("points members at the page that says the same thing in their own words", async () => {
    renderTab();
    const link = await screen.findByRole("link", { name: "What this village looks after" });
    expect(link).toHaveAttribute("href", "/powers");
  });
});

/*
 * RYE'S TWO ASKS OF 2026-09-14, driven through the rendered tab.
 *
 *   5. A power may go to a role nobody holds, and the panel warns. The
 *      warning reads the served `holderCount`, shows only at zero, and never
 *      stops the grant.
 *   6. "Hand it to the village" asks first. The PUT to the holding route is
 *      sent from the confirm button in the dialog and from nowhere else, so
 *      the assertions count WRITES, not renders: a dialog that opened while
 *      the request had already gone would pass any test that only looked.
 *
 * The fake server answers by method and path, and records every call so a
 * test can say exactly which writes happened.
 */
const MOVABLE = {
  roles: [
    { id: "keepers", name: "Keeper of the Gate", isExample: false, capabilities: ["membership.admit"], holderCount: 2 },
    { id: "steward-circle", name: "Steward Circle", isExample: false, capabilities: [], holderCount: 0 },
    { id: "library", name: "Library Keepers", isExample: false, capabilities: ["membership.admit"], holderCount: 0 },
    // A server from before the count was served. No number is not zero.
    { id: "older", name: "Older Server Role", isExample: false, capabilities: [] },
  ],
  powers: [
    {
      capability: "membership.admit",
      title: "Who joins the village",
      surface: "The membership queue",
      consequence: "let somebody in",
      movable: true,
      heldBy: null,
    },
  ],
};

type Call = { url: string; method: string; body: any };

function fakeServer(capabilitiesPut?: (body: any) => { status: number; json: any }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any = {}) => {
      const method = String(init.method ?? "GET");
      calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
      if (method === "GET") return { ok: true, status: 200, json: async () => MOVABLE };
      if (url.endsWith("/capabilities") && capabilitiesPut) {
        const r = capabilitiesPut(init.body ? JSON.parse(init.body) : undefined);
        return { ok: r.status < 400, status: r.status, json: async () => r.json };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }),
  );
  return { writes: () => calls.filter((c) => c.method !== "GET") };
}

async function choose(roleId: string) {
  const user = userEvent.setup();
  renderTab();
  await user.selectOptions(await screen.findByRole("combobox"), roleId);
  return user;
}

describe("HandoverTab: a power for a role nobody holds (ask 5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("warns when the chosen role has nobody in it", async () => {
    fakeServer();
    await choose("steward-circle");
    expect(
      await screen.findByText("Nobody holds Steward Circle yet. The power waits there until someone is appointed."),
    ).toBeInTheDocument();
  });

  it("says nothing about a role somebody holds", async () => {
    fakeServer();
    await choose("keepers");
    await screen.findByRole("button", { name: "Hand it to the village" });
    expect(screen.queryByText(/Nobody holds/)).not.toBeInTheDocument();
  });

  it("says nothing when the server sent no count, because no number is not zero", async () => {
    fakeServer();
    await choose("older");
    await screen.findByRole("button", { name: "Give this role the power" });
    expect(screen.queryByText(/Nobody holds/)).not.toBeInTheDocument();
  });

  it("still grants the power to a role nobody holds", async () => {
    const server = fakeServer();
    const user = await choose("steward-circle");
    await user.click(screen.getByRole("button", { name: "Give this role the power" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    const [put] = server.writes();
    expect(put.method).toBe("PUT");
    expect(put.url).toBe("/api/admin/roles/steward-circle/capabilities");
    expect(put.body.capabilities).toContain("membership.admit");
  });

  it("asks the escalation question in words that fit an OK and a Cancel", async () => {
    // The server's 409 used to be printed verbatim, ending "Tick the ones you
    // mean and send them back", in a box with nothing to tick.
    const server = fakeServer(() => ({
      status: 409,
      json: {
        error: "Words the server wrote for some other client.",
        escalations: [{ capability: "membership.admit", consequence: "let somebody in" }],
        requiresConfirmation: true,
      },
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = await choose("steward-circle");
    await user.click(screen.getByRole("button", { name: "Give this role the power" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const question = String(confirm.mock.calls[0][0]);
    expect(question).toContain("Steward Circle would be the first");
    expect(question).toContain("Anyone in it could let somebody in.");
    expect(question).toContain("OK gives Steward Circle the power. Cancel leaves the role as it is.");
    expect(question).toContain("Nobody holds Steward Circle yet.");
    expect(question).not.toMatch(/\btick\b/i);
    // Cancel on the question: the first, unanswered PUT is the only write.
    expect(server.writes()).toHaveLength(1);
  });
});

describe("HandoverTab: is the village ready to hold this power (ask 6)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const holdingWrites = (server: ReturnType<typeof fakeServer>) =>
    server.writes().filter((c) => c.url.endsWith("/holding"));

  it("sends nothing when Hand it to the village is clicked, only asks", async () => {
    const server = fakeServer();
    const user = await choose("keepers");
    await user.click(screen.getByRole("button", { name: "Hand it to the village" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Is the village ready to hold this power?")).toBeInTheDocument();
    expect(server.writes()).toHaveLength(0);
  });

  it("hands the power over once the person confirms", async () => {
    const server = fakeServer();
    const user = await choose("keepers");
    await user.click(screen.getByRole("button", { name: "Hand it to the village" }));
    await user.click(await screen.findByRole("button", { name: "Yes, hand it over" }));

    await waitFor(() => expect(holdingWrites(server)).toHaveLength(1));
    const [put] = holdingWrites(server);
    expect(put.method).toBe("PUT");
    expect(put.url).toBe("/api/admin/capabilities/membership.admit/holding");
    expect(put.body).toEqual({ roleId: "keepers" });
  });

  it("cancel closes the question and sends no request", async () => {
    const server = fakeServer();
    const user = await choose("keepers");
    await user.click(screen.getByRole("button", { name: "Hand it to the village" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.writes()).toHaveLength(0);
  });

  it("Escape closes the question and sends no request", async () => {
    const server = fakeServer();
    const user = await choose("keepers");
    await user.click(screen.getByRole("button", { name: "Hand it to the village" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.writes()).toHaveLength(0);
  });

  it("says what changes, and says so again when nobody holds the role", async () => {
    fakeServer();
    const user = await choose("library");
    await user.click(screen.getByRole("button", { name: "Hand it to the village" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/Who joins the village\. Whoever holds it can let somebody in\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/being an admin no longer passes for\s+this power/)).toBeInTheDocument();
    expect(within(dialog).getByText(/that is a break-glass/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Nobody holds Library Keepers yet\./)).toBeInTheDocument();
  });

  it("leaves the empty-role line out of the question for a role somebody holds", async () => {
    fakeServer();
    const user = await choose("keepers");
    await user.click(screen.getByRole("button", { name: "Hand it to the village" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/Nobody holds/)).not.toBeInTheDocument();
  });
});

/**
 * ASK 7: BRINGING A POWER BACK IS THE VILLAGE'S DECISION (Rye, 2026-09-23).
 *
 * The server refuses the hand-back and names the `power_return` ballot, and
 * carries on only for a founder seated as a steward with the veto who says
 * they mean to reach past the village. THE PANEL DECIDES NONE OF THAT. It
 * asks, shows what comes back, and offers the glass only when the server says
 * this account has it (`overrideAvailable`). A button that predicted the
 * answer would be a second gate living in the browser, and the one rule this
 * codebase has about gates is that there is one of them.
 */
const HELD = {
  roles: [{ id: "keepers", name: "Keeper of the Gate", isExample: false, capabilities: ["membership.admit"], holderCount: 2 }],
  powers: [
    {
      capability: "membership.admit",
      title: "Who joins the village",
      surface: "The membership queue",
      consequence: "let somebody in",
      movable: true,
      heldBy: { roleId: "keepers", roleName: "Keeper of the Gate", movedAt: "2026-09-01", byBallot: true },
    },
  ],
};

function heldServer(deleteAnswer: (glass: boolean) => { status: number; json: any }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any = {}) => {
      const method = String(init.method ?? "GET");
      const glass = String(init.headers?.["x-capability-override"] ?? "") === "true";
      calls.push({ url, method, body: glass ? { glass: true } : undefined });
      if (method === "GET") return { ok: true, status: 200, json: async () => HELD };
      const r = deleteAnswer(glass);
      return { ok: r.status < 400, status: r.status, json: async () => r.json };
    }),
  );
  return { writes: () => calls.filter((c) => c.method !== "GET") };
}

describe("HandoverTab: bringing a power back (ask 7)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const REFUSAL = {
    error: "Keeper of the Gate looks after this one. Open a power_return ballot.",
    requiresOverride: true,
    overrideAvailable: true,
    holderName: "Keeper of the Gate",
  };

  it("sends the plain request first, carrying no glass", async () => {
    const server = heldServer(() => ({ status: 409, json: REFUSAL }));
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole("button", { name: "Bring it back" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
    const [first] = server.writes();
    expect(first.method).toBe("DELETE");
    expect(first.body, "the first press must not reach past the village").toBeUndefined();
  });

  it("shows the server's sentence and offers the glass only when the server said so", async () => {
    heldServer(() => ({ status: 409, json: REFUSAL }));
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole("button", { name: "Bring it back" }));
    expect(await screen.findByRole("button", { name: "Reach past the village and bring it back" })).toBeInTheDocument();
  });

  it("leaves the button alone when the server says this account has no way through", async () => {
    heldServer(() => ({ status: 409, json: { ...REFUSAL, overrideAvailable: false } }));
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole("button", { name: "Bring it back" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Bring it back" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Reach past the village/ })).not.toBeInTheDocument();
  });

  it("asks before the second press, and only then sends the glass", async () => {
    const server = heldServer((glass) => (glass ? { status: 200, json: { success: true } } : { status: 409, json: REFUSAL }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole("button", { name: "Bring it back" }));
    await user.click(await screen.findByRole("button", { name: "Reach past the village and bring it back" }));

    await waitFor(() => expect(server.writes()).toHaveLength(2));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0][0])).toContain("The village sees this on its own feed");
    expect(server.writes()[1].body).toEqual({ glass: true });
  });

  it("cancelling the second question sends nothing at all", async () => {
    const server = heldServer((glass) => (glass ? { status: 200, json: { success: true } } : { status: 409, json: REFUSAL }));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole("button", { name: "Bring it back" }));
    await user.click(await screen.findByRole("button", { name: "Reach past the village and bring it back" }));
    await waitFor(() => expect(server.writes()).toHaveLength(1));
  });
});
