// @vitest-environment jsdom
/**
 * The People screen. What it has to do for a founder is answer "what did we
 * send this person, and did it arrive", so the first case opens a person and
 * reads their emails back in words. The others hold the two writes a reviewer
 * would worry about: lifting a stop that came from a spam complaint waits for
 * a reason, and Stop on a journey reaches that journey and no other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommsPeople from "@/components/admin/comms/CommsPeople";

type Call = { url: string; method: string; body: any; auth: string | null };

const row = {
  id: "ct_1",
  email: "pat@example.test",
  name: "Pat Person",
  userId: null,
  firstSource: "resident",
  createdAt: 1_790_000_000,
  messages: 2,
  lastMessageAt: 1_790_100_000,
  suppression: null as string | null,
};

const detail = (suppression: unknown = null) => ({
  person: { id: "ct_1", email: "pat@example.test", name: "Pat Person", userId: null, firstSource: "resident", timezone: "Europe/Lisbon", createdAt: 1_790_000_000 },
  member: null,
  answers: [
    { kind: "events", state: "yes", derived: true, basis: "implied", source: "a yes to a gathering", pausedUntil: null },
    { kind: "paths", state: "yes", derived: false, basis: "asked", source: "resident", pausedUntil: null },
    { kind: "letters", state: "no", derived: true, basis: null, source: null, pausedUntil: null },
    { kind: "notices", state: "no", derived: true, basis: null, source: null, pausedUntil: null },
  ],
  suppression,
  emails: [
    { id: "msg_1", kind: "paths", origin: "journey", subject: "Welcome to the resident path", status: "delivered", skipReason: null, lastError: null, createdAt: 1_790_100_000, sentAt: 1_790_100_010, deliveredAt: 1_790_100_020 },
    { id: "msg_2", kind: "letters", origin: "letter", subject: "Autumn news", status: "skipped", skipReason: "no_permission", lastError: null, createdAt: 1_790_000_100, sentAt: null, deliveredAt: null },
  ],
  journeys: [
    { id: "enr_live", journeyKey: "path.resident", subjectRef: "path:resident", state: "active", stopReason: null, enrolledAt: 1_790_000_000 },
    { id: "enr_done", journeyKey: "gathering.going", subjectRef: "event:ev-1:", state: "stopped", stopReason: "withdrew", enrolledAt: 1_789_000_000 },
  ],
});

let calls: Call[];
let suppression: unknown = null;

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const call: Call = {
        url: String(url),
        method: String(init?.method ?? "GET"),
        body: init?.body ? JSON.parse(init.body) : null,
        auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
      };
      calls.push(call);
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (call.method === "POST") return ok({ ok: true });
      if (/\/admin\/comms\/people\/ct_1$/.test(call.url)) return ok(detail(suppression));
      if (/\/admin\/comms\/people\?/.test(call.url)) return ok({ people: [row], total: 1, limit: 50, offset: 0 });
      return { ok: false, status: 404, json: async () => ({ error: "not here" }) };
    }),
  );
}

async function openPat() {
  render(<CommsPeople password="secret" />);
  await userEvent.click(await screen.findByRole("button", { name: "pat@example.test" }));
  await screen.findByRole("heading", { name: "pat@example.test" });
}

describe("the People screen", () => {
  beforeEach(() => {
    calls = [];
    suppression = null;
    stubFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows a person's emails, what became of each, and what they agreed to", async () => {
    await openPat();
    expect(screen.getByText("Welcome to the resident path")).toBeTruthy();
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(screen.getByText("Autumn news")).toBeTruthy();
    expect(screen.getByText("Not sent: no yes on record")).toBeTruthy();
    expect(screen.getByText(/Their time zone is Europe\/Lisbon/)).toBeTruthy();
    expect(screen.getByText("they said so, resident")).toBeTruthy();
    // Every read carries the admin's credential.
    expect(calls.every((c) => c.auth === "Bearer secret")).toBe(true);
    expect(calls.map((c) => c.url)).toContain("/api/admin/comms/people/ct_1");
  });

  it("waits for a reason before lifting a stop that came from a spam complaint", async () => {
    suppression = { reason: "complained", detail: null, createdBy: null, createdAt: 1_790_000_000 };
    await openPat();
    expect(screen.getByText(/Stopped: Marked our email as spam/)).toBeTruthy();
    const lift = screen.getByRole("button", { name: "Lift the stop" }) as HTMLButtonElement;
    expect(lift.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Why is it right to write to this address again?"), "They asked to come back");
    expect(lift.disabled).toBe(false);
    await userEvent.click(lift);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: "/api/admin/comms/people/ct_1/restore",
      body: { reason: "They asked to come back" },
    });
  });

  it("stops the one journey whose Stop was pressed, and offers no Stop on a journey already ended", async () => {
    await openPat();
    const stops = screen.getAllByRole("button", { name: "Stop" });
    expect(stops).toHaveLength(1);
    await userEvent.click(stops[0]);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.url).toBe("/api/admin/comms/people/ct_1/journeys/enr_live/stop");
  });

  it("stops all email to an address by hand, with the note given", async () => {
    await openPat();
    await userEvent.type(screen.getByLabelText("A note on why (optional)"), "Asked on the phone");
    await userEvent.click(screen.getByRole("button", { name: "Stop all email to this address" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: "/api/admin/comms/people/ct_1/suppress",
      body: { detail: "Asked on the phone" },
    });
  });
});
