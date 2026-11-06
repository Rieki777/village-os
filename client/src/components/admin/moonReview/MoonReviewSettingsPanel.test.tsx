// @vitest-environment jsdom
/**
 * The moon review's settings on the Cash payouts desk (decision 22), against
 * the payloads the doors send. What each case pins:
 *
 *   1. A fresh install shows "Name who you pay first", and the settings tab
 *      names the host country and the acknowledgement as missing.
 *   2. Saving sends the whole document, with typed lists turned into lists
 *      and a VAT percent turned into basis points, and shows what changed.
 *   3. A refusal from the server's parser is shown as its sentence.
 *   4. With the module off (every door answers 404) nothing renders.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MoonReviewSettingsPanel from "./MoonReviewSettingsPanel";
import { ADMIN_WORDS } from "@shared/moonRecap";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EMPTY_SETTINGS = { hostCountry: null, hostVatRateBp: null, hostRateSource: null, hostCurrency: null, pilotAck: null, taxForms: [], taxFormRoutes: [], holds: [] };

function routes(map: Record<string, { status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const hit = map[`${method} ${url}`] ?? { status: 404, body: { error: "no route" } };
    return { ok: hit.status < 300, status: hit.status, json: async () => hit.body };
  }));
  return calls;
}

describe("the moon review settings panel", () => {
  it("asks a fresh install to name who it pays, and saves a payer with its lists", async () => {
    const calls = routes({
      "GET /api/moon-review/payers": { status: 200, body: { document: { payers: [] }, gaps: [{ key: "payer", words: "Name who you pay" }] } },
      "PUT /api/moon-review/payers": { status: 200, body: { document: { payers: [] }, gaps: [], changed: 1 } },
    });
    render(<MoonReviewSettingsPanel password="tok" />);
    expect((await screen.findByTestId("payers-gap")).textContent).toBe(ADMIN_WORDS.payers.empty);
    fireEvent.click(screen.getByText(ADMIN_WORDS.payers.add));
    fireEvent.change(screen.getByLabelText(ADMIN_WORDS.payers.legalName), { target: { value: "Example Payer" } });
    fireEvent.change(screen.getByLabelText(ADMIN_WORDS.payers.currencies), { target: { value: "usd, crc" } });
    fireEvent.change(screen.getByLabelText(ADMIN_WORDS.payers.invoiceCc), { target: { value: "one@example.org, two@example.org" } });
    fireEvent.click(screen.getByLabelText(ADMIN_WORDS.payers.invoicing));
    fireEvent.click(screen.getByText(ADMIN_WORDS.save));
    expect((await screen.findByRole("status")).textContent).toBe(ADMIN_WORDS.saved(1));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body.document.payers[0]).toMatchObject({ legalName: "Example Payer", currencies: ["USD", "CRC"], invoiceCc: ["one@example.org", "two@example.org"], invoicing: true });
  });

  it("names the missing host country and acknowledgement, and sends a VAT percent as basis points", async () => {
    const calls = routes({
      "GET /api/moon-review/payers": { status: 200, body: { document: { payers: [] }, gaps: [] } },
      "GET /api/moon-review/settings": { status: 200, body: { document: EMPTY_SETTINGS, gaps: [{ key: "country", words: "" }, { key: "pilotAck", words: "" }] } },
      "PUT /api/moon-review/settings": { status: 200, body: { document: EMPTY_SETTINGS, gaps: [], changed: 2 } },
    });
    render(<MoonReviewSettingsPanel password="tok" />);
    fireEvent.click(await screen.findByRole("tab", { name: ADMIN_WORDS.tabs.settings }));
    expect((await screen.findByTestId("country-gap")).textContent).toBe(ADMIN_WORDS.settings.hostMissing);
    expect(screen.getByTestId("ack-gap").textContent).toBe(ADMIN_WORDS.settings.ackMissing);
    fireEvent.change(screen.getByLabelText(ADMIN_WORDS.settings.hostCode), { target: { value: "xx" } });
    fireEvent.change(screen.getByLabelText(ADMIN_WORDS.settings.hostName), { target: { value: "Examplia" } });
    fireEvent.change(screen.getByLabelText(ADMIN_WORDS.settings.vat), { target: { value: "13" } });
    fireEvent.click(screen.getByText(ADMIN_WORDS.save));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body.document).toMatchObject({ hostCountry: { code: "XX", name: "Examplia" }, hostVatRateBp: 1300, pilotAck: null });
  });

  it("shows the parser's sentence when a save is refused", async () => {
    routes({
      "GET /api/moon-review/payers": { status: 200, body: { document: { payers: [] }, gaps: [] } },
      "GET /api/moon-review/rhythm": { status: 200, body: { document: { sendHour: 9, guideUrl: "", cycles: {} } } },
      "PUT /api/moon-review/rhythm": { status: 400, body: { error: "The guide link starts with https:// and has no # in it.", field: "guideUrl" } },
    });
    render(<MoonReviewSettingsPanel password="tok" />);
    fireEvent.click(await screen.findByRole("tab", { name: ADMIN_WORDS.tabs.rhythm }));
    expect(await screen.findByText(ADMIN_WORDS.rhythm.guideEmpty)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(ADMIN_WORDS.rhythm.guideUrl), { target: { value: "http://example.org" } });
    fireEvent.click(screen.getByText(ADMIN_WORDS.save));
    expect((await screen.findByRole("alert")).textContent).toBe("The guide link starts with https:// and has no # in it.");
  });

  it("renders no editor when the module is off", async () => {
    const calls = routes({});
    render(<MoonReviewSettingsPanel password="tok" />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByText(ADMIN_WORDS.save)).toBeNull();
  });
});
