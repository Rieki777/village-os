// @vitest-environment jsdom
/**
 * Words from a ReGen Civics file reach their own editor, unsaved.
 *
 * The import screen saves no purpose statement and no covenant. It hands the
 * words over (client/src/lib/profilePrefill.ts), and these pin what the two
 * editors do with them: show them in the box, say where they came from, and
 * send nothing until the founder presses that editor's Save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { offerPrefill, takePrefill } from "@/lib/profilePrefill";
import PurposeStatementPanel from "./PurposeStatementPanel";
import ContentEditorTab from "./ContentEditorTab";

let writes: { url: string; body: unknown }[] = [];

beforeEach(() => {
  writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      writes.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }
    if (url === "/api/admin/purpose") return { ok: true, status: 200, json: async () => ({ statement: "The words we saved.", founderHoldsPen: true }) };
    if (url === "/api/content/covenant") return { ok: true, status: 200, json: async () => ({ opening: "Old opening", governance: "How we decide" }) };
    return { ok: false, status: 404, json: async () => ({ error: "Section not found" }) };
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  takePrefill("purpose");
  takePrefill("covenant");
});

describe("the hand-off", () => {
  it("is taken once", () => {
    offerPrefill("covenant", "We keep our word.");
    expect(takePrefill("covenant")).toBe("We keep our word.");
    expect(takePrefill("covenant")).toBeUndefined();
  });
});

describe("the purpose box", () => {
  it("takes the words unsaved, says where they came from, and can put the saved ones back", async () => {
    render(<PurposeStatementPanel password="pw" />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe("The words we saved."));
    act(() => offerPrefill("purpose", { text: "All this is for future generations", fromFirstLine: true }));
    expect(box.value).toBe("All this is for future generations");
    expect(screen.getByText(/This box now holds your first line from ReGen Civics/)).toBeTruthy();
    expect(writes).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Put back what was saved" }));
    expect(box.value).toBe("The words we saved.");
    expect(writes).toEqual([]);
  });
});

describe("the covenant editor", () => {
  it("opens with the covenant as its opening paragraph, keeps the rest, and saves nothing", async () => {
    offerPrefill("covenant", "We tend the land, we keep our word, and we say what is true.");
    render(<ContentEditorTab password="pw" sectionKey="covenant" sectionLabel="Covenant" />);
    const box = () => document.getElementById("content-raw-json") as HTMLTextAreaElement;
    await waitFor(() => expect(box()?.value ?? "").not.toBe(""));
    expect(JSON.parse(box().value)).toEqual({ opening: "We tend the land, we keep our word, and we say what is true.", governance: "How we decide" });
    expect(screen.getByText(/The opening paragraph now holds what a member signs/)).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it("leaves any other section alone", async () => {
    offerPrefill("covenant", "Not for this one.");
    render(<ContentEditorTab password="pw" sectionKey="legal" sectionLabel="Legal" />);
    const box = () => document.getElementById("content-raw-json") as HTMLTextAreaElement;
    await waitFor(() => expect(box()?.value ?? "").not.toBe(""));
    expect(box().value).not.toContain("Not for this one.");
    expect(takePrefill("covenant")).toBe("Not for this one.");
  });
});
