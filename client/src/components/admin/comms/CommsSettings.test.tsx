// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { DEFAULT_CONSENT_TEXT, DEFAULT_RECAP_QUESTIONS, SETUP_KEYS } from "@shared/comms/settings";
import CommsSettings from "@/components/admin/comms/CommsSettings";

/**
 * Comms Settings (the comms build spec 5.15): the setup checklist with an
 * editor under every item, the dials, and Pause all. It began as the old
 * Email Settings, and that screen's behaviour is held here too: it reads the
 * same document, shows the four inboxes, and saves them back to the same route
 * with the same body.
 */

type Call = { url: string; method: string; body: any; auth: string | null };

const LABELS: Record<string, string> = {
  "api-key": "The Resend API key",
  domain: "Sending domain",
  sender: "Sender name and address",
  "delivery-reports": "Delivery reports",
  "postal-address": "Postal address for the footer",
  "reply-to": "Reply-to inbox for each path",
  "path-contacts": "Who writes back for each path",
  "consent-words": "The words beside the tick-box on public forms",
  "recap-questions": "The two recap questions",
  "who-runs-comms": "Who runs comms",
  "investor-words": "Investor words reviewed",
  "rehearsal-inbox": "Rehearsal inbox",
  "test-email": "A test email to yourself, delivered",
};
const REQUIRED = new Set(["api-key", "domain", "sender", "delivery-reports", "postal-address", "test-email"]);

/** The server's answer, for a village that has done `done` and nothing else. */
function payload(done: string[] = [], over: Record<string, unknown> = {}) {
  return {
    lifecycle: "off",
    ready: Array.from(REQUIRED).every((k) => done.includes(k)),
    checklist: SETUP_KEYS.map((key, i) => ({
      key,
      n: i + 1,
      label: LABELS[key],
      done: done.includes(key),
      required: REQUIRED.has(key),
      detail: `${LABELS[key]} detail`,
      fix: `${LABELS[key]} fix`,
    })),
    settings: {
      senderName: "",
      domain: "",
      domainId: "",
      domainStatus: "none",
      domainCheckedAt: null,
      domainConfirmedBy: null,
      postalAddress: "",
      consentText: DEFAULT_CONSENT_TEXT,
      recapQuestions: [...DEFAULT_RECAP_QUESTIONS],
      pathContacts: {},
      investorWordsReviewed: null,
      rehearsalTo: [],
      paused: false,
      webhookConnectedAt: null,
      webhookConnectedBy: null,
      webhookId: null,
    },
    key: { configured: false, source: "none", last4: null, setAt: null, setBy: null },
    webhook: {
      configured: false,
      source: "none",
      url: "https://village.example.test/api/comms/webhooks/resend",
      events: ["email.sent", "email.delivered"],
      connectedAt: null,
      connectedBy: null,
      byHand: false,
      lastReportAt: null,
    },
    sender: { line: "", source: "none", name: "", address: "" },
    paths: [
      { id: "investor", label: "Investor", inbox: "investor" },
      { id: "resident", label: "Resident", inbox: "resident" },
    ],
    members: [{ id: "u1", name: "Ada" }],
    holders: [],
    admins: ["founder@example.test"],
    testEmail: null,
    me: { email: "founder@example.test" },
    secretsKeySet: true,
    ...over,
  };
}

let calls: Call[];
let current: any;
let inboxes: Record<string, string>;

const stubFetch = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      const method = String(init?.method ?? "GET");
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ url: u, method, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
      const answer = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json });
      if (u.endsWith("/admin/email-config")) return method === "PUT" ? answer(200, { success: true }) : answer(200, inboxes);
      if (u.endsWith("/admin/variables")) return answer(200, { categories: [] });
      if (u.endsWith("/admin/integrations/resend_api_key")) return answer(200, { success: true, secrets: [] });
      if (u.endsWith("/admin/comms/settings") && method === "PUT") {
        if (body && "postalAddress" in body) {
          current = payload(["postal-address"], { settings: { ...current.settings, postalAddress: body.postalAddress } });
        }
        if (body && "paused" in body) current = { ...current, settings: { ...current.settings, paused: body.paused } };
        return answer(200, current);
      }
      if (u.endsWith("/admin/comms/settings")) return answer(200, current);
      return answer(404, { error: "not stubbed" });
    }),
  );
};

const row = (key: string) => screen.getByRole("heading", { name: new RegExp(`^\\d+\\. ${LABELS[key]}`) }).closest("li") as HTMLElement;

describe("Comms Settings", () => {
  beforeEach(() => {
    calls = [];
    current = payload(["consent-words", "recap-questions", "rehearsal-inbox"]);
    inboxes = { investor: "invest@example.test", steward: "", resident: "home@example.test", prosperity: "" };
    stubFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lists all thirteen items with how many required steps are done, and opens the required ones still to do", async () => {
    render(<CommsSettings password="secret" openIntegrations={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "Comms Settings" })).toBeTruthy();
    for (const key of SETUP_KEYS) expect(row(key), key).toBeTruthy();
    expect(screen.getByText("0 of 6 required steps done.")).toBeTruthy();
    // Required and not done: open, showing its editor.
    expect(within(row("postal-address")).getByLabelText("Postal address")).toBeTruthy();
    // Optional, or done: closed until somebody presses Change.
    expect(within(row("consent-words")).queryByLabelText("The words beside the box")).toBeNull();
    expect(within(row("consent-words")).getByRole("button", { name: /Change/ })).toBeTruthy();
    expect(calls[0]).toMatchObject({ url: expect.stringMatching(/\/admin\/comms\/settings$/), method: "GET", auth: "Bearer secret" });
  });

  it("reads the email-config document and shows each inbox, behind the reply-to item", async () => {
    render(<CommsSettings password="secret" openIntegrations={() => undefined} />);
    await screen.findByRole("heading", { name: "Comms Settings" });
    await userEvent.click(within(row("reply-to")).getByRole("button", { name: /Set up/ }));
    expect(await screen.findByDisplayValue("invest@example.test")).toBeTruthy();
    expect(screen.getByDisplayValue("home@example.test")).toBeTruthy();
    const read = calls.find((c) => /\/admin\/email-config$/.test(c.url));
    expect(read).toMatchObject({ method: "GET", auth: "Bearer secret" });
  });

  it("saves the four inboxes back to the same route with the same body", async () => {
    inboxes = { investor: "", steward: "", resident: "", prosperity: "" };
    render(<CommsSettings password="secret" openIntegrations={() => undefined} />);
    await screen.findByRole("heading", { name: "Comms Settings" });
    await userEvent.click(within(row("reply-to")).getByRole("button", { name: /Set up/ }));
    await userEvent.type(await screen.findByLabelText("Core Team (Steward)"), "core@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Save inboxes" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && /\/admin\/email-config$/.test(c.url))).toBe(true));
    const put = calls.find((c) => c.method === "PUT" && /\/admin\/email-config$/.test(c.url))!;
    expect(put.body).toEqual({ investor: "", steward: "core@example.test", resident: "", prosperity: "" });
    expect(toast.success).toHaveBeenCalledWith("Email settings saved");
  });

  it("saves the postal address through the settings route and redraws the item from the answer", async () => {
    render(<CommsSettings password="secret" openIntegrations={() => undefined} />);
    await screen.findByRole("heading", { name: "Comms Settings" });
    await userEvent.type(within(row("postal-address")).getByLabelText("Postal address"), "1 Orchard Lane");
    await userEvent.click(within(row("postal-address")).getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(screen.getByText("1 of 6 required steps done.")).toBeTruthy());
    const put = calls.find((c) => c.method === "PUT" && /\/admin\/comms\/settings$/.test(c.url))!;
    // Only the field that changed travels, so the village's document never
    // freezes the platform's defaults into itself.
    expect(put.body).toEqual({ postalAddress: "1 Orchard Lane" });
    expect(toast.success).toHaveBeenCalledWith("Postal address saved");
  });

  it("saves the provider key through the existing secrets route, then reads the checklist again", async () => {
    render(<CommsSettings password="secret" openIntegrations={() => undefined} />);
    await screen.findByRole("heading", { name: "Comms Settings" });
    await userEvent.type(within(row("api-key")).getByLabelText("Resend API key"), "re_test_key");
    await userEvent.click(within(row("api-key")).getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(calls.some((c) => /\/admin\/integrations\/resend_api_key$/.test(c.url))).toBe(true));
    const put = calls.find((c) => /\/admin\/integrations\/resend_api_key$/.test(c.url))!;
    expect(put).toMatchObject({ method: "PUT", body: { value: "re_test_key" }, auth: "Bearer secret" });
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && /\/admin\/comms\/settings$/.test(c.url)).length).toBe(2));
  });

  it("presses Pause all through the settings route", async () => {
    render(<CommsSettings password="secret" openIntegrations={() => undefined} />);
    await screen.findByRole("heading", { name: "Comms Settings" });
    await userEvent.click(screen.getByRole("button", { name: "Pause all automated email" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Let email flow again" })).toBeTruthy());
    const put = calls.find((c) => c.method === "PUT" && /\/admin\/comms\/settings$/.test(c.url))!;
    expect(put.body).toEqual({ paused: true });
  });

  it("says why the screen could not be read, in the server's words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "Running the village's email is an appointment" }) })),
    );
    render(<CommsSettings password="secret" openIntegrations={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Running the village's email is an appointment");
  });
});
