// @vitest-environment jsdom
/**
 * Admin, Pages: what a founder types is what gets saved, no more and no less.
 *
 * The four things that would hurt a village if they broke:
 *   - a save writes ONLY what changed, so untouched boxes keep following the
 *     platform's defaults;
 *   - a box cannot take more than its limit, and the save route's own check
 *     is the one the editor runs;
 *   - a read that failed is not "nothing saved yet": saving stays off;
 *   - "Keep these words as ours" writes every box out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PagesEditor from "./PagesEditor";
import { HOME_PAGE } from "@shared/pageContent/home";
import { adoptedDocument, contentVersion } from "@shared/pageContent/resolve";

type Write = { path: string; body: any; was?: string };

function stubFetch(stored: Record<string, unknown> | "fail", writes: Write[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const path = String(url);
      if (init?.method === "PUT") {
        writes.push({ path, body: JSON.parse(init.body), was: new Headers(init.headers).get("x-content-was") ?? undefined });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (path.endsWith("/api/admin/content")) {
        if (stored === "fail") return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        return new Response(JSON.stringify(stored), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

let writes: Write[];
beforeEach(() => {
  writes = [];
});
afterEach(() => vi.unstubAllGlobals());

const headlineBox = () => screen.findByLabelText("Headline");

describe("Admin, Pages", () => {
  it("names the saved words it was opened on, so a save never writes over words that moved since", async () => {
    const stored = { "page-home": { hero: { badge: "Ours" } } };
    stubFetch(stored, writes);
    render(<PagesEditor password="pw" />);
    const box = (await headlineBox()) as HTMLInputElement;
    await userEvent.clear(box);
    await userEvent.type(box, "A valley that remembers");
    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].was).toBe(contentVersion(stored["page-home"]));
  });

  it("shows the default until a village writes its own, and saves only what changed", async () => {
    stubFetch({}, writes);
    render(<PagesEditor password="pw" />);

    const box = (await headlineBox()) as HTMLInputElement;
    expect(box.value).toBe("{tagline}");

    await userEvent.clear(box);
    await userEvent.type(box, "A valley that remembers");
    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].path).toBe("/api/admin/content/page-home");
    expect(writes[0].body).toEqual({ hero: { headline: "A valley that remembers" } });
  });

  it("stops a box at its limit and says how full it is", async () => {
    stubFetch({}, writes);
    render(<PagesEditor password="pw" />);
    const box = (await headlineBox()) as HTMLInputElement;
    const max = HOME_PAGE.sections[0].fields.find((f) => f.key === "headline")!.max;

    fireEvent.change(box, { target: { value: "x".repeat(max + 20) } });

    expect(box.value).toHaveLength(max);
    expect(screen.getByText(`${max} / ${max}`)).toBeInTheDocument();
  });

  it("hands a box back to the default with Reset", async () => {
    stubFetch({ "page-home": { hero: { headline: "Ours" } } }, writes);
    render(<PagesEditor password="pw" />);
    const box = (await headlineBox()) as HTMLInputElement;
    expect(box.value).toBe("Ours");

    await userEvent.click(screen.getAllByRole("button", { name: /Reset to default/ })[0]);
    expect(box.value).toBe("{tagline}");
    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({});
  });

  it("saves a hidden section as hidden", async () => {
    stubFetch({}, writes);
    render(<PagesEditor password="pw" />);
    await headlineBox();

    const toggles = screen.getAllByRole("checkbox", { name: "Show this section" });
    await userEvent.click(toggles[toggles.length - 1]);
    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ cta: { hidden: true } });
  });

  it("refuses to save when the saved words could not be read", async () => {
    stubFetch("fail", writes);
    render(<PagesEditor password="pw" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Saving is off/);
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep these words as ours" })).toBeDisabled();
  });

  it("keeps every box as the village's own when asked", async () => {
    stubFetch({ "page-home": { hero: { headline: "Ours" } } }, writes);
    render(<PagesEditor password="pw" />);
    await headlineBox();

    await userEvent.click(screen.getByRole("button", { name: "Keep these words as ours" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual(adoptedDocument(HOME_PAGE, { hero: { headline: "Ours" } }));
  });
});
