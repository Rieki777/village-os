// @vitest-environment jsdom
/**
 * /admin/proposals. Pinned:
 *   1. Each change shows field by field, live beside proposed, as boxes and lines, never raw JSON.
 *   2. An edit is sent to the server as a draft.
 *   3. Accept checks first; a problem shows on its own field and nothing is accepted.
 *   4. Accept sends exactly the edited body, and a failed one is reported while the rest landed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ loading: false, user: { id: "u1" } }) }));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "t" }));

import ProposedChanges from "./ProposedChanges";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROLE = {
  id: "pc_role",
  batchId: "pcb_1",
  kind: "role_card",
  targetLabel: "Lead Finance Steward card",
  route: { method: "POST", path: "/api/org/role-edit/fin" },
  summary: "Give the card a clearer aim.",
  body: { words: { aim: "Hold the money.", accountabilities: ["Books each moon"] } },
  draft: null,
  live: { words: { aim: "Keep the books.", accountabilities: ["Pay bills"] } },
  labels: { "words.aim": "Aim", "words.accountabilities": "What you can count on me for" },
  status: "proposed",
  error: null,
  by: "Fern",
  byKind: "agent",
  at: "2026-11-12T10:00:00.000Z",
};
const PAGE = { ...ROLE, id: "pc_page", kind: "page_content", targetLabel: "Home page", summary: "Reword the headline.", body: { hero: { headline: "A home" } }, live: { hero: { headline: "Welcome" } }, labels: { "hero.headline": "Top: Headline" } };

function stub(opts: { check?: unknown[]; accept?: unknown[] } = {}) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
      if (url === "/api/admin/proposals" && method === "GET") return json({ batches: [{ id: "pcb_1", title: "Phase A content", by: "Fern", at: "2026-11-12T10:00:00.000Z" }], changes: [ROLE, PAGE], decided: [] });
      if (String(url).endsWith("/check")) return json({ results: opts.check ?? [] });
      if (String(url).endsWith("/accept")) return json({ results: opts.accept ?? [] });
      return json({ success: true });
    }),
  );
  return calls;
}

describe("the review page", () => {
  it("shows each change field by field, live beside proposed, and no JSON until asked", async () => {
    stub();
    render(<ProposedChanges />);
    await screen.findByText("Phase A content");
    expect(screen.getByRole("heading", { name: "Lead Finance Steward card" })).toBeTruthy();
    const card = screen.getByTestId("proposal-pc_role");
    expect(within(card).getByText("Keep the books.")).toBeTruthy();
    expect((within(card).getByLabelText("Aim") as HTMLTextAreaElement).value).toBe("Hold the money.");
    expect(within(card).getByLabelText(/What you can count on me for, line 1/)).toBeTruthy();
    expect(card.textContent).not.toContain("{");
    fireEvent.click(within(card).getByRole("button", { name: /Show JSON/ }));
    expect(card.textContent).toContain('"aim"');
  });

  it("saves an edit as a draft on the server", async () => {
    const calls = stub();
    render(<ProposedChanges />);
    const box = (await screen.findAllByLabelText("Aim"))[0];
    fireEvent.change(box, { target: { value: "Hold the village's money with care." } });
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/pc_role/draft"))).toBe(true), { timeout: 3000 });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body.body.words.aim).toBe("Hold the village's money with care.");
  });

  it("checks before accepting: a problem shows on its own field and nothing is accepted", async () => {
    const calls = stub({ check: [{ id: "pc_page", ok: false, error: "A headline is needed.", field: "hero.headline" }, { id: "pc_role", ok: true }] });
    render(<ProposedChanges />);
    await screen.findByText("Phase A content");
    fireEvent.click(screen.getByLabelText("Select all"));
    fireEvent.click(screen.getByTestId("accept-selected"));
    const alert = await screen.findByText("A headline is needed.");
    expect(alert.closest("[data-field]")?.getAttribute("data-field")).toBe("hero.headline");
    expect(calls.some((c) => c.url.endsWith("/accept"))).toBe(false);
  });

  it("accepts exactly the edited body, and says which landed and which did not", async () => {
    const calls = stub({ check: [{ id: "pc_role", ok: true }, { id: "pc_page", ok: true }], accept: [{ id: "pc_role", ok: true }, { id: "pc_page", ok: false, error: "This needs a power you do not hold.", field: null }] });
    render(<ProposedChanges />);
    const box = (await screen.findAllByLabelText("Aim"))[0];
    fireEvent.change(box, { target: { value: "Edited aim." } });
    fireEvent.click(screen.getByLabelText("Select all"));
    fireEvent.click(screen.getByTestId("accept-selected"));
    await screen.findByTestId("accept-outcome");
    const acc = calls.find((c) => c.url.endsWith("/accept"))!;
    expect(acc.body.items[0]).toEqual({ id: "pc_role", body: { words: { aim: "Edited aim.", accountabilities: ["Books each moon"] } } });
    expect(screen.getByTestId("accept-outcome").textContent).toMatch(/1 accepted, 1 did not land/);
  });
});
