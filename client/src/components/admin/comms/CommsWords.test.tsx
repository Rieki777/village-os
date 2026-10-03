// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommsWords from "@/components/admin/comms/CommsWords";

/**
 * The Words screen, rendered against a stubbed server: the list, the editor,
 * the server's own preview in a sandboxed frame, the live voice check, the
 * field picker, saving, restoring, the side-by-side compare and the test send.
 * The routes behind it have their own tests (server/routes/commsWords.test.ts).
 */

type Call = { url: string; method: string; body: any; auth: string | null };

const LIST = {
  postalAddressSet: true,
  groups: [
    {
      id: "gathering.going",
      title: "Saying yes to a gathering",
      journeyKey: "gathering.going",
      items: [
        { key: "gathering.confirm", label: "Confirmation", kind: "events", subject: "You're coming to {{gathering.title}}", source: "platform", version: 1, platformVersion: 1, upgradeAvailable: false },
        { key: "gathering.reminder_day", label: "The day before", kind: "events", subject: "Tomorrow: {{gathering.title}}", source: "village", version: 3, platformVersion: 0, upgradeAvailable: true },
      ],
    },
  ],
};

const FIELDS = [
  { key: "person.firstName", group: "common", groupLabel: "Every email", type: "text", label: "First name", hint: "The reader's first name.", optional: false },
  { key: "gathering.whenLocal", group: "gathering", groupLabel: "The gathering", type: "text", label: "When, reader's time", hint: "Their zone.", optional: true },
];

const detail = (over: Record<string, unknown> = {}) => ({
  key: "gathering.confirm",
  label: "Confirmation",
  kind: "events",
  live: { subject: "You're coming to {{gathering.title}}", preheader: "Details inside.", bodyMd: "Hi {{person.firstName}},\n\nSee you there.", version: 1, source: "platform", platformVersion: 1 },
  platform: { subject: "You're coming to {{gathering.title}}", preheader: "Details inside.", bodyMd: "Hi {{person.firstName}},\n\nSee you there.", version: 1, source: "platform", platformVersion: 1 },
  upgradeAvailable: false,
  versions: [],
  fields: FIELDS,
  ...over,
});

const PREVIEW = {
  subject: "You're coming to Community supper",
  preheader: "Details inside.",
  html: "<!DOCTYPE html><html><body><p>Preview body from the server</p></body></html>",
  text: "Hi Ada,\n\nSee you there.",
  version: 1,
  source: "platform",
  kind: "events",
  missing: [],
  omitted: ["gathering.whenLocal"],
  unknown: [],
  problems: [],
  voice: [],
};

function stub(calls: Call[], details: Record<string, any> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      const method = String(init?.method ?? "GET");
      calls.push({ url: u, method, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization ?? null });
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      const key = decodeURIComponent(u.split("/comms/words/")[1]?.split("/")[0] ?? "");
      const current = details[key] ?? detail({ key });
      if (method === "GET" && u.endsWith("/admin/comms/words")) return ok(LIST);
      if (method === "GET") return ok(current);
      if (u.endsWith("/preview")) return ok(PREVIEW);
      if (u.endsWith("/test")) return ok({ status: "sent", reason: null, messageId: "msg_1", sentTo: "ada@village.example" });
      if (u.endsWith("/restore")) return ok({ restored: 1, detail: { ...current, live: { ...current.live, version: 1 } } });
      if (u.endsWith("/adopt")) return ok({ adopted: 4, detail: { ...current, upgradeAvailable: false, live: { ...current.platform, version: 4, source: "village" } } });
      if (method === "PUT") {
        const sent = JSON.parse(init.body);
        return ok({ saved: 2, detail: { ...current, live: { ...current.live, ...sent, version: 2, source: "village" } } });
      }
      return { ok: false, status: 404, json: async () => ({ error: "nothing here" }) };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the Words screen", () => {
  it("lists the emails by journey and opens the first with the server's own preview in a sandboxed frame", async () => {
    const calls: Call[] = [];
    stub(calls);
    render(<CommsWords password="tok" />);
    expect(await screen.findByText("Saying yes to a gathering")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Confirmation" })).toBeTruthy();
    const frame = (await screen.findByTitle(/The email at phone width/)) as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("Preview body from the server");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(screen.getByText(/Left out when we don't know them/)).toBeTruthy();
    expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/admin/comms/words/gathering.confirm/preview"))).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expect(screen.getByTitle(/The email at desktop width/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Plain text" }));
    expect(screen.getByText(/Hi Ada,/)).toBeTruthy();
  });

  it("runs the voice check as the words are typed", async () => {
    stub([]);
    render(<CommsWords password="tok" />);
    const body = await screen.findByLabelText("The email");
    expect(screen.getByText(/Clean: no dashes/)).toBeTruthy();
    fireEvent.change(body, { target: { value: "We leverage the land." } });
    expect(await screen.findByText("Filler word")).toBeTruthy();
  });

  it("puts a field in from the picker, and saves the words as a new version", async () => {
    const calls: Call[] = [];
    stub(calls);
    render(<CommsWords password="tok" />);
    const subject = (await screen.findByLabelText("Subject")) as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "Hello " } });
    subject.focus();
    subject.setSelectionRange(6, 6);
    fireEvent.focus(subject);
    await userEvent.click(screen.getByRole("button", { name: "First name" }));
    expect(subject.value).toBe("Hello {{person.firstName}}");

    await userEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    expect(await screen.findByText(/Saved as version 2/)).toBeTruthy();
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/\/admin\/comms\/words\/gathering\.confirm$/);
    expect(put.body).toEqual({ subject: "Hello {{person.firstName}}", preheader: "Details inside.", bodyMd: "Hi {{person.firstName}},\n\nSee you there." });
  });

  it("brings an old version back", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "gathering.confirm": detail({
        live: { subject: "Second", preheader: null, bodyMd: "Two", version: 2, source: "village", platformVersion: 1 },
        versions: [
          { version: 2, state: "live", subject: "Second", preheader: null, bodyMd: "Two", platformVersion: 1, editedBy: "u1", editedByName: "Robin", createdAt: 1_790_000_000 },
          { version: 1, state: "retired", subject: "First", preheader: null, bodyMd: "One", platformVersion: 1, editedBy: null, editedByName: null, createdAt: 1_780_000_000 },
        ],
      }),
    });
    render(<CommsWords password="tok" />);
    const versions = await screen.findByRole("region", { name: "Versions" });
    expect(within(versions).getByText("Live")).toBeTruthy();
    await userEvent.click(within(versions).getByRole("button", { name: "Bring back version 1" }));
    expect(await screen.findByText("Version 1 is live again.")).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith("/restore"))?.body).toEqual({ version: 1 });
  });

  it("offers the platform's improved words side by side only when they are newer, and takes them in one click", async () => {
    const calls: Call[] = [];
    stub(calls, {
      "gathering.reminder_day": detail({
        key: "gathering.reminder_day",
        label: "The day before",
        upgradeAvailable: true,
        live: { subject: "Our tomorrow", preheader: null, bodyMd: "Ours", version: 3, source: "village", platformVersion: 0 },
        platform: { subject: "Tomorrow: {{gathering.title}}", preheader: "Platform", bodyMd: "Theirs", version: 1, source: "platform", platformVersion: 1 },
      }),
    });
    render(<CommsWords password="tok" />);
    await screen.findByRole("heading", { name: "Confirmation" });
    expect(screen.queryByText(/An improved version of these words/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /The day before/ }));
    expect(await screen.findByText(/An improved version of these words/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Compare side by side" }));
    expect(screen.getByText("Yours, version 3")).toBeTruthy();
    expect(screen.getByText("The platform's new words, version 1")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Take the new words" }));
    expect(await screen.findByText("The platform's words are live as version 4.")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/gathering.reminder_day/adopt"))).toBe(true);
  });

  it("sends a test to the signed-in admin and says where it went", async () => {
    const calls: Call[] = [];
    stub(calls);
    render(<CommsWords password="tok" />);
    await screen.findByRole("heading", { name: "Confirmation" });
    await userEvent.click(screen.getByRole("button", { name: "Send me a test" }));
    expect(await screen.findByText(/Sent to ada@village\.example/)).toBeTruthy();
    // Nothing was changed, so the test sends the saved words: no draft rides along.
    expect(calls.find((c) => c.url.endsWith("/test"))?.body).toEqual({});
  });

  it("says when the footer has no postal address to carry", async () => {
    stub([]);
    vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({ ...LIST, postalAddressSet: false }) }) as any);
    render(<CommsWords password="tok" />);
    expect(await screen.findByText(/none is set yet/)).toBeTruthy();
  });
});
