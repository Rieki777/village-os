// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import CommsSentMail from "@/components/admin/comms/CommsSentMail";

/**
 * Sent mail reads the post office's record and acts on one email at a time
 * (server/routes/commsSent.ts). These hold the screen to the routes it calls,
 * to the sandbox an email's words render in, and to the retry it offers.
 */

type Call = { url: string; method: string; auth: string | null };

const row = {
  id: "msg_failed",
  createdAt: "2026-10-02T09:00:00.000Z",
  sentAt: null,
  toEmail: "ana@example.test",
  kind: "letters",
  origin: "letter",
  subject: "News from the village",
  status: "failed",
  skipReason: null,
  attempts: 6,
  lastError: "Resend answered 500",
  rehearsalTo: null,
  hasBody: true,
};

const detail = {
  message: {
    ...row,
    replyTo: null,
    bodyHtml: "<p>Hello <script>alert(1)</script></p>",
    bodyText: "Hello",
    attachments: [],
    templateKey: null,
    journeyKey: null,
    stepKey: null,
    provider: "resend",
    providerMessageId: null,
    sendAfter: null,
    nextAttemptAt: null,
    expiresAt: null,
    deliveredAt: null,
    bouncedAt: null,
    complainedAt: null,
    wordsNote: null,
  },
  reports: [],
  canRetry: true,
  canCancel: false,
};

function stubFetch(calls: Call[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      calls.push({ url: u, method: String(init?.method ?? "GET"), auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
      if (u.endsWith("/retry")) return { ok: true, status: 200, json: async () => ({ ok: true, status: "queued", message: "It is back in the queue, and goes with the next send." }) };
      if (/\/admin\/comms\/messages\/msg_failed$/.test(u)) return { ok: true, status: 200, json: async () => detail };
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [row], total: 1, page: 0, pageSize: 50, origins: [{ origin: "letter", count: 1 }] }),
      };
    }),
  );
}

describe("Sent mail", () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lists the record from the post office's route, with each email's status in words", async () => {
    stubFetch(calls);
    render(<CommsSentMail password="secret" />);
    const item = await screen.findByRole("button", { name: /News from the village/ });
    // The row carries the status in words, beside who it was for and what wrote it.
    expect(item.textContent).toContain("Failed");
    expect(item.textContent).toContain("ana@example.test");
    expect(calls[0]).toMatchObject({ url: expect.stringMatching(/\/api\/admin\/comms\/messages$/), method: "GET" });
    expect(calls[0].auth).toBe("Bearer secret");
  });

  it("sends the filters as a query", async () => {
    stubFetch(calls);
    render(<CommsSentMail password="secret" />);
    await screen.findByText("News from the village");
    await userEvent.selectOptions(screen.getByLabelText("What became of it"), "failed");
    await userEvent.type(screen.getByLabelText("Address contains"), "ana@");
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("status=failed") && c.url.includes("q=ana%40"))).toBe(true));
  });

  it("renders an email's words in a sandbox that allows nothing, and tries a failed one again", async () => {
    stubFetch(calls);
    const { container } = render(<CommsSentMail password="secret" />);
    await userEvent.click(await screen.findByText("News from the village"));
    const frame = await waitFor(() => {
      const f = container.querySelector("iframe");
      if (!f) throw new Error("no frame yet");
      return f;
    });
    // `sandbox` present and empty: no scripts, no forms, no reaching this page.
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("<script>");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/admin/comms/messages/msg_failed/retry"))).toBe(true));
    expect(toast.success).toHaveBeenCalledWith("It is back in the queue, and goes with the next send.");
  });
});
