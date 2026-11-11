// @vitest-environment jsdom
/**
 * Admin, Paths & Stages: what a founder types is what gets saved, no more.
 *
 *   - every box shows today's word until the village writes its own, says
 *     where it shows, and counts against its limit;
 *   - a save sends only what changed, and Reset hands a box back;
 *   - a box cannot take more than its limit;
 *   - a read that failed is not "nothing saved yet": saving stays off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContentEditorTab from "./ContentEditorTab";
import { PATHS_STAGES_TAB_KEY } from "./contentSections";
import { PATH_LIMITS } from "@shared/villagePaths";
import { contentVersion } from "@shared/pageContent/resolve";

type Write = { path: string; body: any; was?: string };

const MOVED = "These words changed since this page was opened. Reload it to see them, then make your change again.";

function stubFetch(stored: Record<string, unknown> | "fail", writes: Write[], conflict = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const path = String(url);
      if (!path.endsWith("/api/admin/village-paths")) return new Response("{}", { status: 404 });
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body);
        writes.push({ path, body, was: new Headers(init.headers).get("x-content-was") ?? undefined });
        if (conflict) return new Response(JSON.stringify({ error: MOVED }), { status: 409 });
        return new Response(JSON.stringify({ stored: body, words: {} }), { status: 200 });
      }
      if (stored === "fail") return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      return new Response(JSON.stringify({ stored, words: {} }), { status: 200 });
    }),
  );
}

let writes: Write[];
beforeEach(() => {
  writes = [];
});
afterEach(() => vi.unstubAllGlobals());

const open = () => render(<ContentEditorTab password="pw" sectionKey={PATHS_STAGES_TAB_KEY} sectionLabel="Paths & Stages" />);

describe("Admin, Paths & Stages", () => {
  it("is the tab Make it yours routes to, showing today's words, where each shows, and its count", async () => {
    stubFetch({}, writes);
    open();
    const name = (await screen.findByLabelText("Name", { selector: "#ps-path-steward-label" })) as HTMLInputElement;
    expect(name.value).toBe("Village Steward");
    expect(screen.getByText(`15 / ${PATH_LIMITS.label}`)).toBeInTheDocument();
    expect(screen.getAllByText(/Shows on the join form, on each member's profile, and in this path's emails\./)).toHaveLength(4);
    expect((screen.getByLabelText("Name of the ladder") as HTMLInputElement).value).toBe("Path of Growth");
    expect((document.getElementById("ps-stage-member-description") as HTMLInputElement).value).toBe(
      "Signed the {commitment} and joined the community.",
    );
    expect(screen.queryByText(/Reset to default/)).toBeNull();
  });

  it("saves only what changed, and Reset hands a box back to the default", async () => {
    stubFetch({ stages: { sage: { name: "Elder" } } }, writes);
    open();
    const name = (await screen.findByLabelText("Name", { selector: "#ps-path-steward-label" })) as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, "Keeper");

    // The stored stage name shows, and Reset hands it back.
    const sage = document.getElementById("ps-stage-sage-name") as HTMLInputElement;
    expect(sage.value).toBe("Elder");
    const resets = screen.getAllByRole("button", { name: /Reset to default/ });
    expect(resets).toHaveLength(2);
    await userEvent.click(resets[1]);
    expect(sage.value).toBe("Sage");

    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ paths: { steward: { label: "Keeper" } } });
    expect(await screen.findByRole("status")).toHaveTextContent(/Saved/);
  });

  it("stops a box at its limit", async () => {
    stubFetch({}, writes);
    open();
    const name = (await screen.findByLabelText("Name", { selector: "#ps-path-investor-label" })) as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, "x".repeat(PATH_LIMITS.label + 6));
    expect(name.value).toHaveLength(PATH_LIMITS.label);
    expect(screen.getByText(`${PATH_LIMITS.label} / ${PATH_LIMITS.label}`)).toBeInTheDocument();
  });

  it("reads the public config again after a save, so the menu and pages open in this tab show a renamed path at once", async () => {
    stubFetch({}, writes);
    open();
    const name = (await screen.findByLabelText("Name", { selector: "#ps-path-investor-label" })) as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, "Backer");
    const raw = () => (fetch as unknown as { mock: { calls: Array<[unknown, { method?: string }?]> } }).mock.calls;
    const calls = () => raw().map((c) => String(c[0]));
    expect(calls()).not.toContain("/api/game/config");
    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(calls()).toContain("/api/game/config"));
    const put = raw().findIndex((c) => c[1]?.method === "PUT");
    expect(put).toBeGreaterThanOrEqual(0);
    expect(calls().indexOf("/api/game/config"), "after the save, never before it").toBeGreaterThan(put);
    expect(writes).toHaveLength(1);
  });

  it("names the words it was opened on, and on a 409 tells the founder to reload and keeps what they typed", async () => {
    const stored = { stages: { sage: { name: "Elder" } } };
    stubFetch(stored, writes, true);
    open();
    const name = (await screen.findByLabelText("Name", { selector: "#ps-path-steward-label" })) as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, "Keeper");
    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].was).toBe(contentVersion(stored));
    expect(await screen.findByRole("alert")).toHaveTextContent(MOVED);
    expect(name.value, "nothing typed is lost").toBe("Keeper");
  });

  it("keeps saving off when the saved words could not be read", async () => {
    stubFetch("fail", writes);
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Saving is off/);
    expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();
  });
});
