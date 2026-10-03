// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import CommsSettings from "@/components/admin/comms/CommsSettings";

/**
 * Comms Settings began as the old Email Settings, moved out of
 * client/src/pages/Admin.tsx unchanged in behaviour. These hold it to that: it
 * reads the same document, shows the four inboxes, and saves them back to the
 * same route with the same body.
 */

type Call = { url: string; method: string; body: unknown; auth: string | null };

const stubFetch = (calls: Call[], stored: Record<string, string>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      calls.push({
        url: String(url),
        method: String(init?.method ?? "GET"),
        body: init?.body ? JSON.parse(init.body) : null,
        auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
      });
      if (init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ success: true }) };
      return { ok: true, status: 200, json: async () => stored };
    }),
  );
};

describe("Comms Settings, the old Email Settings moved", () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reads the email-config document and shows each inbox", async () => {
    stubFetch(calls, { investor: "invest@example.test", steward: "", resident: "home@example.test", prosperity: "" });
    render(<CommsSettings password="secret" openIntegrations={() => undefined} />);
    expect(await screen.findByDisplayValue("invest@example.test")).toBeTruthy();
    expect(screen.getByDisplayValue("home@example.test")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comms Settings" })).toBeTruthy();
    expect(calls[0]).toMatchObject({ url: expect.stringMatching(/\/admin\/email-config$/), method: "GET" });
    expect(calls[0].auth).toBeTruthy();
  });

  it("saves the four inboxes back to the same route", async () => {
    stubFetch(calls, { investor: "", steward: "", resident: "", prosperity: "" });
    render(<CommsSettings password="secret" openIntegrations={() => undefined} />);
    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
    // The fields render in a fixed order: business, investor, steward, resident.
    const steward = screen.getAllByRole("textbox")[2];
    await userEvent.type(steward, "core@example.test");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/\/admin\/email-config$/);
    expect(put.body).toEqual({ investor: "", steward: "core@example.test", resident: "", prosperity: "" });
    expect(toast.success).toHaveBeenCalledWith("Email settings saved");
  });
});
