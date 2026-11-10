// @vitest-environment jsdom
/**
 * The Admin helper panel's three states: off (connect steps), ready (a
 * conversation), and proposing a change (a card whose Apply goes to the
 * dial's own admin route). Plus how it opens: the header menu row and Ctrl+/.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import AdminHelperPanel from "./AdminHelperPanel";
import AdminHelperHost, { isHelperShortcut } from "./AdminHelperHost";
import AdminHeader from "./AdminHeader";
import type { NavGroup } from "./adminNavGroups";
import type { HelperAnswer } from "@shared/adminHelper";

const GROUPS = [
  { title: "Today", items: [{ key: "home", label: "Home", icon: (() => null) as any }] },
  { title: "What your village runs", items: [{ key: "variables", label: "Game Mechanics", icon: (() => null) as any }] },
] as NavGroup[];

function panel(over: Partial<Parameters<typeof AdminHelperPanel>[0]> = {}) {
  const onOpenTab = vi.fn();
  render(
    <AdminHelperPanel password="pw" groups={GROUPS} tab="home" top={88} onClose={vi.fn()} onOpenTab={onOpenTab} {...over} />,
  );
  return { onOpenTab };
}

function mockFetch(routes: Record<string, (init: any) => { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const key = `${init.method ?? "GET"} ${url}`;
    const hit = routes[key];
    if (!hit) throw new Error(`unexpected ${key}`);
    const { status = 200, body } = hit(init);
    return { ok: status < 400, status, json: async () => body } as any;
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("the Admin helper panel", () => {
  it("OFF: asks the server, then shows plain steps to connect Claude and no question box", async () => {
    const calls = mockFetch({ "GET /api/admin/helper": () => ({ body: { on: false, guide: "Maia", off: "key", provider: null, available: [], names: {} } }) });
    panel();
    expect(await screen.findByText("Connect Claude to turn on your helper")).toBeTruthy();
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeTruthy();
    expect(screen.getByText(/^Open Integrations, find "Anthropic, the AI guide"/)).toBeTruthy();
    expect(screen.getByText(/turns the helper on/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("heading", { name: "Maia" })).toBeTruthy();
    expect(calls[0].init.headers.Authorization).toBe("Bearer pw");
  });

  it("OFF BY THE VILLAGE'S SWITCH: says it is switched off and where the village turns it on", async () => {
    mockFetch({ "GET /api/admin/helper": () => ({ body: { on: false, guide: "Maia", off: "switch", provider: null, available: [], names: {} } }) });
    panel();
    expect(await screen.findByText("Your helper is switched off")).toBeTruthy();
    expect(screen.getByText(/The guide's helper in Admin/)).toBeTruthy();
    expect(screen.queryByText("Connect Claude to turn on your helper")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("OFF: Open Integrations goes to the page where the key is pasted", async () => {
    const { onOpenTab } = panel({ initialStatus: { on: false, guide: "Maia", off: "key", provider: null, available: [], names: {} } });
    await userEvent.click(screen.getByRole("button", { name: "Open Integrations" }));
    expect(onOpenTab).toHaveBeenCalledWith("integrations");
  });

  it("READY: says who answers, Claude or Sera", () => {
    panel({ initialStatus: { on: true, guide: "Sera", off: null, provider: "sera", available: ["sera"], names: { sera: "Sera" } } });
    expect(screen.getByText(/Answers come from Sera/)).toBeTruthy();
  });

  it("READY: offers Claude or Sera when both are connected, and sends the pick", async () => {
    const calls = mockFetch({ "POST /api/admin/helper/ask": () => ({ body: { reply: "Hi from Sera.", open: null, proposal: null, refused: null, consulted: [] } }) });
    localStorage.clear();
    panel({ initialStatus: { on: true, guide: "Maia", off: null, provider: "anthropic", available: ["anthropic", "sera"], names: { anthropic: "Maia", sera: "Sera" } } });
    expect(screen.getByRole("heading", { name: "Maia" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Claude" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("radio", { name: "Sera" }));
    expect(screen.getByRole("heading", { name: "Sera" })).toBeTruthy();
    expect(screen.getByText(/Answers come from Sera/)).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "hi{Enter}");
    expect(await screen.findByText("Hi from Sera.")).toBeTruthy();
    expect(JSON.parse(calls[0].init.body).provider).toBe("sera");
    expect(localStorage.getItem("admin-helper-provider")).toBe("sera");
  });

  it("READY: shows no choice when only one AI is connected", () => {
    panel({ initialStatus: { on: true, guide: "Maia", off: null, provider: "anthropic", available: ["anthropic"], names: { anthropic: "Maia" } } });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("READY: says what it never reads before the first question", () => {
    panel({ initialStatus: { on: true, guide: "Maia", off: null, provider: "anthropic", available: ["anthropic"], names: { anthropic: "Maia" } } });
    expect(screen.getByText(/never read applications, proposals, interviews, terms or pay/)).toBeTruthy();
    expect(screen.getByText(/can't help with choosing people for roles/)).toBeTruthy();
  });

  it("READY: sends the question with the Admin map, shows the answer, and opens the page it names", async () => {
    const answer: HelperAnswer = { reply: "Game Mechanics holds every rule.", open: { key: "variables", label: "Game Mechanics" }, proposal: null, refused: null, consulted: ["admin.find"] };
    const calls = mockFetch({ "POST /api/admin/helper/ask": () => ({ body: answer }) });
    const { onOpenTab } = panel({ initialStatus: { on: true, guide: "Sera", off: null, provider: "anthropic", available: ["anthropic"], names: { anthropic: "Sera" } } });
    expect(screen.getByRole("heading", { name: "Sera" })).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "where are the rules?{Enter}");
    expect(await screen.findByText("Game Mechanics holds every rule.")).toBeTruthy();
    const sent = JSON.parse(calls[0].init.body);
    expect(sent.messages).toEqual([{ role: "user", content: "where are the rules?" }]);
    expect(sent.tab).toBe("home");
    expect(sent.tabs.map((t: any) => `${t.group}/${t.key}`)).toEqual(["Today/home", "What your village runs/variables"]);
    await userEvent.click(screen.getByRole("button", { name: /Open Game Mechanics/ }));
    expect(onOpenTab).toHaveBeenCalledWith("variables");
  });

  it("PROPOSING: draws the change as a card, and Apply goes through the dial's own route", async () => {
    const answer: HelperAnswer = {
      reply: "I can switch that for you.",
      open: null,
      proposal: { key: "feed.show_birthdays", label: "Show birthdays", category: "Feed", from: "false", to: "true", why: "You asked for it.", applyPath: "/api/admin/variables/feed.show_birthdays" },
      refused: null,
      consulted: [],
    };
    const calls = mockFetch({
      "POST /api/admin/helper/ask": () => ({ body: answer }),
      "PUT /api/admin/variables/feed.show_birthdays": () => ({ body: { success: true, message: "Saved. The rule is live" } }),
    });
    panel({ initialStatus: { on: true, guide: "Maia", off: null, provider: "anthropic", available: ["anthropic"], names: { anthropic: "Maia" } } });
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "show birthdays{Enter}");
    const card = await screen.findByTestId("helper-proposal");
    expect(card.textContent).toContain("Show birthdays");
    expect(card.textContent).toContain("false");
    expect(card.textContent).toContain("true");
    // Nothing is written until the admin presses Apply.
    expect(calls.filter((c) => c.init.method === "PUT")).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByText(/Applied\./)).toBeTruthy());
    const put = calls.find((c) => c.init.method === "PUT")!;
    expect(put.url).toBe("/api/admin/variables/feed.show_birthdays");
    expect(JSON.parse(put.init.body)).toEqual({ value: "true" });
    expect(put.init.headers.Authorization).toBe("Bearer pw");
  });

  it("PROPOSING: shows the route's own refusal when Apply is refused, and Not now leaves it", async () => {
    const answer: HelperAnswer = {
      reply: "Here you go.",
      open: null,
      proposal: { key: "feed.x", label: "X", category: "Feed", from: "1", to: "2", why: "", applyPath: "/api/admin/variables/feed.x" },
      refused: null,
      consulted: [],
    };
    mockFetch({
      "POST /api/admin/helper/ask": () => ({ body: answer }),
      "PUT /api/admin/variables/feed.x": () => ({ status: 403, body: { error: "This needs a village vote" } }),
    });
    panel({ initialStatus: { on: true, guide: "Maia", off: null, provider: "anthropic", available: ["anthropic"], names: { anthropic: "Maia" } } });
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "x{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
    expect(await screen.findByText("This needs a village vote")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByText("Left as it was.")).toBeTruthy();
  });

  it("turns itself off when the server says the key went away", async () => {
    mockFetch({ "POST /api/admin/helper/ask": () => ({ status: 503, body: { error: "helper-off", off: "key", provider: null, available: [], names: {} } }) });
    panel({ initialStatus: { on: true, guide: "Maia", off: null, provider: "anthropic", available: ["anthropic"], names: { anthropic: "Maia" } } });
    await userEvent.type(screen.getByRole("textbox", { name: "Your question" }), "hi{Enter}");
    expect(await screen.findByText("Connect Claude to turn on your helper")).toBeTruthy();
  });

  it("docks below the header it was handed", () => {
    panel({ initialStatus: { on: false, guide: "", off: "key", provider: null, available: [], names: {} } });
    expect((screen.getByTestId("admin-helper") as HTMLElement).style.top).toBe("88px");
    // An unnamed guide is never hidden.
    expect(screen.getByRole("heading", { name: "Your village guide" })).toBeTruthy();
  });
});

describe("opening the helper", () => {
  it("is Ctrl+/ or Cmd+/ and nothing else", () => {
    expect(isHelperShortcut({ key: "/", ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(isHelperShortcut({ key: "/", ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
    expect(isHelperShortcut({ key: "/", ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    expect(isHelperShortcut({ key: "?", ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
  });

  it("opens from the header's corner menu and from the shortcut, lazily", async () => {
    mockFetch({ "GET /api/admin/helper": () => ({ body: { on: false, guide: "Maia", off: "key", provider: null, available: [], names: {} } }) });
    function Page() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <AdminHeader villageName="North Wind" siteUrl="" tab="home" userName="Rye" night={false} onNight={vi.fn()} onSignOut={vi.fn()} onHelper={() => setOpen(true)} />
          <AdminHelperHost open={open} setOpen={setOpen} password="pw" groups={GROUPS} tab="home" onOpenTab={vi.fn()} />
        </>
      );
    }
    render(<Page />);
    expect(screen.queryByTestId("admin-helper")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Your settings/ }));
    await userEvent.click(screen.getByRole("button", { name: /Ask your guide/ }));
    expect(await screen.findByTestId("admin-helper")).toBeTruthy();
    // The shortcut toggles it closed again.
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", ctrlKey: true }));
    });
    await waitFor(() => expect(screen.queryByTestId("admin-helper")).toBeNull());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", ctrlKey: true }));
    });
    expect(await screen.findByTestId("admin-helper")).toBeTruthy();
  });
});
