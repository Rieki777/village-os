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

type Write = { path: string; body: any };

function stubFetch(stored: Record<string, unknown> | "fail", writes: Write[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const path = String(url);
      if (!path.endsWith("/api/admin/village-paths")) return new Response("{}", { status: 404 });
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body);
        writes.push({ path, body });
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

  it("keeps saving off when the saved words could not be read", async () => {
    stubFetch("fail", writes);
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Saving is off/);
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled();
  });
});
