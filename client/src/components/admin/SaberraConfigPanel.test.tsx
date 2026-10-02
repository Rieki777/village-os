// @vitest-environment jsdom
/**
 * Organisational Memory's setup panel: where its readiness link lands.
 *
 * WHAT IS PINNED, and the way each one went wrong or could:
 *
 *   1. An https address saves through the ONE config route, and an http one is
 *      refused in the browser by the same validator the server runs, before a
 *      byte is sent. The refusal test carries its own control: the same flow
 *      with an https address does send.
 *   2. Sync now shows what came back, every failure by kind in the service's
 *      own words, and a link to the queue the suggestions landed in.
 *   3. While the module is off, the panel says when the connection can be
 *      checked and asks the server nothing about it. The control is the
 *      preview case, where it does ask.
 *   4. The key is never on this screen, not even its last four characters.
 *
 * `fetch` is stubbed. The routes behind it have their own server tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SaberraConfigPanel from "./SaberraConfigPanel";

type Answer = { status: number; body: unknown };

let lifecycle = "preview";
let status: Answer;
let sync: Answer;

const READY = {
  connection: { state: "ready", sentence: "Connected. The key is set in the admin panel. It ends 9f2a.", mayCall: true },
  held: 7,
  addressSet: true,
};

const calls = () => (globalThis.fetch as unknown as { mock: { calls: [string, any][] } }).mock.calls;
const callsTo = (path: string, method = "GET") =>
  calls().filter(([url, init]) => String(url) === path && (init?.method ?? "GET") === method);

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      const method = init?.method ?? "GET";
      const reply = (a: Answer) => ({ status: a.status, ok: a.status < 400, json: async () => a.body });
      if (url === "/api/admin/modules" && method === "GET") {
        return reply({
          status: 200,
          body: { modules: [{ id: "saberra", served: lifecycle, config: { apiUrl: "", dashboardUrl: "" } }] },
        });
      }
      if (url === "/api/admin/modules/saberra/config" && method === "PUT") {
        return reply({ status: 200, body: { success: true, config: JSON.parse(init.body).config } });
      }
      if (url === "/api/saberra/status") return reply(status);
      if (url === "/api/saberra/sync" && method === "POST") return reply(sync);
      return reply({ status: 404, body: {} });
    }),
  );
}

const renderPanel = () => render(<SaberraConfigPanel password="secret" />);
const serviceField = () => screen.findByLabelText(/Service address/);

beforeEach(() => {
  lifecycle = "preview";
  status = { status: 200, body: READY };
  sync = { status: 200, body: { landed: 0, facts: 0, failures: [], truncated: [], notOffered: [] } };
  stub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the address", () => {
  it("SAVES AN HTTPS ADDRESS through the module config route, with the admin token", async () => {
    const saved = vi.fn();
    window.addEventListener("module:saved", saved);
    renderPanel();
    fireEvent.change(await serviceField(), { target: { value: " https://village.example.org/mcp " } });
    fireEvent.click(screen.getByRole("button", { name: "Save addresses" }));
    await waitFor(() => expect(callsTo("/api/admin/modules/saberra/config", "PUT")).toHaveLength(1));
    const [, init] = callsTo("/api/admin/modules/saberra/config", "PUT")[0]!;
    expect(JSON.parse(init.body).config.apiUrl).toBe("https://village.example.org/mcp");
    expect(init.headers.Authorization).toBe("Bearer secret");
    // The readiness cards listen for this, and an address is what flips them.
    await waitFor(() => expect(saved).toHaveBeenCalled());
    window.removeEventListener("module:saved", saved);
  });

  it("REFUSES AN HTTP ADDRESS IN THE BROWSER, and sends nothing until it is https", async () => {
    renderPanel();
    fireEvent.change(await serviceField(), { target: { value: "http://village.example.org/mcp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save addresses" }));
    const shown = await screen.findByRole("alert");
    // The server's own sentence, from the validator the save route runs.
    expect(shown.textContent).toBe("The service address has to be an https link.");
    expect(callsTo("/api/admin/modules/saberra/config", "PUT")).toHaveLength(0);

    // The control: the same field and button, with https, does send.
    fireEvent.change(await serviceField(), { target: { value: "https://village.example.org/mcp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save addresses" }));
    await waitFor(() => expect(callsTo("/api/admin/modules/saberra/config", "PUT")).toHaveLength(1));
  });

  it("refuses an http dashboard address the same way", async () => {
    renderPanel();
    fireEvent.change(await screen.findByLabelText(/Dashboard address/), { target: { value: "http://dash.example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Save addresses" }));
    expect((await screen.findByRole("alert")).textContent).toContain("dashboard address has to be an https link");
    expect(callsTo("/api/admin/modules/saberra/config", "PUT")).toHaveLength(0);
  });
});

describe("the connection", () => {
  it("says what is set, in words, and never shows any of the key", async () => {
    renderPanel();
    expect(await screen.findByText(/A sync calls the service address above/)).toBeInTheDocument();
    expect(screen.getByText("7 facts from the service.")).toBeInTheDocument();
    expect(screen.getByText("set.")).toBeInTheDocument();
    // The status reading carries the last four characters. They stay off
    // this screen; "set" is the whole answer a founder needs here.
    expect(document.body.textContent).not.toContain("9f2a");
  });

  it("LINKS TO INTEGRATIONS when no key is set", async () => {
    status = {
      status: 200,
      body: { ...READY, connection: { state: "not-connected", sentence: "No key is set for this service yet.", mayCall: false } },
    };
    renderPanel();
    const link = await screen.findByRole("link", { name: "Add the key in Integrations" });
    expect(link).toHaveAttribute("href", "/admin?tab=integrations");
    expect(screen.getByText(/No key is set for this service yet/)).toBeInTheDocument();
  });

  it("says a status it cannot read is unreadable, instead of crashing the card", async () => {
    // Found while building this: a 200 with no connection reading threw on
    // render and took the whole card, address fields included, with it.
    status = { status: 200, body: {} };
    renderPanel();
    expect((await screen.findByRole("alert")).textContent).toContain("cannot read");
    expect(await serviceField()).toBeInTheDocument();
  });

  it("asks for the connection while the module is in preview, which is the control for the next test", async () => {
    lifecycle = "preview";
    renderPanel();
    expect(await screen.findByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(callsTo("/api/saberra/status").length).toBeGreaterThan(0);
  });

  it("SAYS PLAINLY WHEN THE MODULE IS OFF, and asks the server nothing about the connection", async () => {
    lifecycle = "off";
    renderPanel();
    expect(
      await screen.findByText(/The connection can be checked and a sync run once the module is on, and preview is enough/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    expect(callsTo("/api/saberra/status")).toHaveLength(0);
    // The address can still be set while off: setup happens before going live.
    expect(await serviceField()).not.toBeDisabled();
  });
});

describe("Sync now", () => {
  it("SHOWS WHAT REACHED THE QUEUE, the facts held, and a link to the queue", async () => {
    sync = {
      status: 200,
      body: {
        landed: 2,
        facts: 5,
        failures: [],
        truncated: [],
        notOffered: ["tension: not offered by the service yet", "risk: not offered by the service yet"],
      },
    };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByText(/2 suggestions reached the review queue/)).toBeInTheDocument();
    expect(screen.getByText("This sync stored 5 facts from the service.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the review queue" })).toHaveAttribute("href", "/review");
    expect(screen.getByText("tension: not offered by the service yet")).toBeInTheDocument();
    expect(callsTo("/api/saberra/sync", "POST")[0]![1].headers.Authorization).toBe("Bearer secret");
  });

  it("NAMES EACH FAILURE BY KIND in the service's own words, and a kind cut short", async () => {
    sync = {
      status: 200,
      body: {
        landed: 1,
        facts: 3,
        failures: [
          { kind: "roleAssignment", label: "role assignment", why: "vendor-error", detail: "scope does not permit this tool" },
        ],
        truncated: ["role"],
        notOffered: [],
      },
    };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(
      await screen.findByText("role assignment: the service said no (scope does not permit this tool)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/role: cut short/)).toBeInTheDocument();
  });

  it("says so when the sync answers in a shape it cannot read, instead of printing undefined counts", async () => {
    sync = { status: 200, body: { somethingElse: true } };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot read");
    expect(document.body.textContent).not.toContain("undefined");
  });

  it("shows the server's refusal when the sync cannot run", async () => {
    sync = {
      status: 409,
      body: {
        error: "This village has no https address for the service yet. Set it on the module before syncing.",
        state: "not-connected",
      },
    };
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no https address for the service yet");
  });
});
