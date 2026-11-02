// @vitest-environment jsdom
/**
 * Admin, Pages: "Show this page" at the top of a story page, beside the master
 * switch for all of them.
 *
 *   - it sends one page's switch and nothing else, through the same route as
 *     the master switch;
 *   - it says what happens when the page is off, and what the master switch
 *     does to it;
 *   - a page with no switch of its own (the homepage) shows none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PagesEditor from "./PagesEditor";
import { PAGE_SWITCH_WORDS } from "./PageSwitches";

type Write = { path: string; body: any };
let writes: Write[];
let state: { enabled: boolean; hidden: string[] };
let refuse: string | null;

beforeEach(() => {
  writes = [];
  state = { enabled: true, hidden: [] };
  refuse = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const path = String(url);
      if (path.endsWith("/api/admin/brochure-pages")) {
        if (init?.method === "PUT") {
          const body = JSON.parse(init.body);
          writes.push({ path, body });
          if (refuse) return new Response(JSON.stringify({ error: refuse }), { status: 403 });
          for (const [p, show] of Object.entries(body.pages ?? {})) {
            state.hidden = show ? state.hidden.filter((h) => h !== p) : [...state.hidden, p];
          }
          if (typeof body.enabled === "boolean") state.enabled = body.enabled;
        }
        return new Response(JSON.stringify(state), { status: 200 });
      }
      if (path.endsWith("/api/admin/content")) return new Response("{}", { status: 200 });
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function openPage(id: string) {
  render(<PagesEditor password="pw" />);
  await screen.findByText("Your story pages are showing");
  fireEvent.change(screen.getByLabelText("Page"), { target: { value: id } });
}

describe("Show this page", () => {
  it("is not offered on the homepage, which follows the master switch", async () => {
    render(<PagesEditor password="pw" />);
    await screen.findByText("Your story pages are showing");
    expect(screen.queryByLabelText("Show this page")).toBeNull();
  });

  it("switches one page off, sending that page alone, and says what that does", async () => {
    await openPage("housing");
    const box = (await screen.findByLabelText("Show this page")) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.getByText(new RegExp(PAGE_SWITCH_WORDS.on))).toBeInTheDocument();

    fireEvent.click(box);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ pages: { "/housing": false } });
    await waitFor(() => expect((screen.getByLabelText("Show this page") as HTMLInputElement).checked).toBe(false));
    expect(screen.getByText(new RegExp(PAGE_SWITCH_WORDS.off))).toBeInTheDocument();
    // The master switch did not move.
    expect(screen.getByText("Your story pages are showing")).toBeInTheDocument();
  });

  it("switches it back on", async () => {
    state.hidden = ["/housing"];
    await openPage("housing");
    fireEvent.click(await screen.findByLabelText("Show this page"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ pages: { "/housing": true } });
  });

  it("says the page is hidden with the rest while the master switch is off", async () => {
    state.enabled = false;
    render(<PagesEditor password="pw" />);
    await screen.findByText("Your story pages are hidden");
    fireEvent.change(screen.getByLabelText("Page"), { target: { value: "visit" } });
    expect(await screen.findByText(new RegExp(PAGE_SWITCH_WORDS.allHidden))).toBeInTheDocument();
  });

  it("shows the server's refusal beside the switch, and leaves it where it was", async () => {
    refuse = "You do not hold the power to change what the village says about itself.";
    await openPage("housing");
    fireEvent.click(await screen.findByLabelText("Show this page"));
    expect(await screen.findByRole("alert")).toHaveTextContent(refuse);
    expect((screen.getByLabelText("Show this page") as HTMLInputElement).checked).toBe(true);
  });
});
