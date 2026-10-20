// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CommsJourneys from "@/components/admin/comms/CommsJourneys";

/**
 * The Journeys screen, rendered against a stubbed server: the list with each
 * journey's state and count, the open journey's timeline, Turn on, a step
 * edit saved as a new version, a test of a step, Stop for one person, and the
 * walk-through. The routes behind it have their own tests
 * (server/comms.journeys.e2e.test.ts).
 */

type Call = { url: string; method: string; body: any };

const LIST = {
  journeys: [
    { key: "gathering.going", title: "Saying yes to a gathering", kind: "event", emailKind: "events", state: "off", version: 1, own: false, active: 2, steps: [{ key: "confirm", label: "Confirmation", timing: "When they say yes" }, { key: "day", label: "The day before", timing: "1 day before it starts" }] },
    { key: "member.welcome", title: "New members", kind: "member", emailKind: "paths", state: "on", version: 1, own: false, active: 0, steps: [] },
  ],
};

const detail = (over: Record<string, unknown> = {}) => ({
  key: "gathering.going",
  title: "Saying yes to a gathering",
  kind: "event",
  emailKind: "events",
  trigger: "rsvp_going",
  state: "off",
  version: 1,
  own: false,
  followsDials: true,
  active: 2,
  steps: [
    { key: "confirm", label: "Confirmation", templateKey: "gathering.confirm", timing: "When they say yes", anchor: "enrolled", offsetMinutes: 0, window: "any", audience: "all", skipIf: ["time_still_being_voted"], catchUp: "latest", maxLateMinutes: 1440, urgent: true, subject: "You're coming to {{gathering.title}}", words: "platform" },
    { key: "day", label: "The day before", templateKey: "gathering.reminder_day", timing: "1 day before it starts", anchor: "event_start", offsetMinutes: -1440, window: "any", audience: "all", skipIf: [], catchUp: "skip", maxLateMinutes: 360, urgent: false, subject: "Tomorrow: {{gathering.title}}", words: "village" },
  ],
  stops: [{ key: "withdrew", label: "They took their yes back" }],
  conditions: [
    { key: "time_still_being_voted", label: "The time is still being voted on (the email waits)" },
    { key: "signed_up_within_36_hours", label: "They said yes less than 36 hours before" },
  ],
  templates: [
    { key: "gathering.confirm", label: "Confirmation" },
    { key: "gathering.reminder_day", label: "The day before" },
  ],
  versions: [],
  enrollments: [{ id: "enr_1", name: "Ada Lovelace", email: "ada@example.test", subjectRef: "event:ev-1:", version: 1, enrolledAt: 1_790_000_000, nextCheckAt: 1_790_086_400 }],
  ...over,
});

const WALK = {
  journeyKey: "gathering.going",
  version: 1,
  state: "on",
  person: { name: "Ada Lovelace", email: "ada@example.test", timezone: null, madeUp: false },
  subjectRef: "event:ev-1:",
  enrolledAt: "2026-10-05T10:00:00.000Z",
  zone: "UTC",
  stoppedBy: null,
  steps: [
    { key: "confirm", label: "Confirmation", templateKey: "gathering.confirm", timing: "When they say yes", at: "2026-10-05T10:00:00.000Z", sendsAt: null, outcome: "sent", alreadySent: true, reason: null, why: "", subject: "You're coming to Supper" },
    { key: "day", label: "The day before", templateKey: "gathering.reminder_day", timing: "1 day before it starts", at: null, sendsAt: null, outcome: "skipped", alreadySent: false, reason: "condition", why: "They said yes less than 36 hours before", subject: "Tomorrow: Supper" },
  ],
};

function stub(calls: Call[], state: { on: boolean }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      const method = String(init?.method ?? "GET");
      calls.push({ url: u, method, body: init?.body ? JSON.parse(init.body) : null });
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (u.endsWith("/admin/comms/journeys") && method === "GET") return ok(LIST);
      if (u.endsWith("/journeys/gathering.going") && method === "GET") return ok(detail({ state: state.on ? "on" : "off" }));
      if (u.endsWith("/journeys/gathering.going/state")) {
        state.on = true;
        return ok({ key: "gathering.going", state: "on", version: 1, adopted: ["gathering.confirm"], touched: 2 });
      }
      if (u.includes("/steps/day") && method === "PUT") return ok({ key: "gathering.going", version: 2, steps: [] });
      if (u.endsWith("/steps/confirm/test")) return ok({ status: "sent", reason: null, messageId: "msg_1", sentTo: "admin@example.test" });
      if (u.endsWith("/enrollments/enr_1/stop")) return ok({ stopped: "enr_1" });
      if (u.endsWith("/journeys/gathering.going/walk")) return ok(WALK);
      if (u.endsWith("/journeys/gathering.going/subjects")) return ok({ subjects: [] });
      return { ok: false, status: 404, json: async () => ({ error: "not here" }) };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Journeys screen", () => {
  it("lists every journey with its state and how many are on it, and opens the first", async () => {
    stub([], { on: false });
    render(<CommsJourneys password="pw" />);
    expect(await screen.findByRole("button", { name: /New members/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Saying yes to a gathering.*Off.*2 on it/ })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Saying yes to a gathering" })).toBeTruthy();
    expect(screen.getByText("1 day before it starts")).toBeTruthy();
    expect(screen.getByText(/Nobody gets these emails/)).toBeTruthy();
    expect(screen.getByText(/follow the dials in Comms Settings/)).toBeTruthy();
  });

  it("turns a journey on", async () => {
    const calls: Call[] = [];
    stub(calls, { on: false });
    render(<CommsJourneys password="pw" />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy());
    expect(calls.find((c) => c.url.endsWith("/state"))?.body).toEqual({ state: "on" });
  });

  it("saves a step edit as a new version, in minutes, before the start", async () => {
    const calls: Call[] = [];
    stub(calls, { on: true });
    render(<CommsJourneys password="pw" />);
    const edits = await screen.findAllByRole("button", { name: "Edit this step" });
    fireEvent.click(edits[1]);
    fireEvent.change(screen.getByLabelText("How long"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("They said yes less than 36 hours before"));
    fireEvent.click(screen.getByRole("button", { name: "Save as a new version" }));
    await waitFor(() => expect(screen.getByText("Saved as version 2.")).toBeTruthy());
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      offsetMinutes: -2880,
      window: "any",
      audience: "all",
      templateKey: "gathering.reminder_day",
      skipIf: ["signed_up_within_36_hours"],
    });
  });

  it("sends a test of a step, and stops one person's journey", async () => {
    const calls: Call[] = [];
    stub(calls, { on: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CommsJourneys password="pw" />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Send me a test" }))[0]);
    expect(await screen.findByText("Sent to admin@example.test.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/enrollments/enr_1/stop"))).toBe(true));
  });

  it("walks a person on it through the journey, with each email and why one is skipped", async () => {
    const calls: Call[] = [];
    stub(calls, { on: true });
    render(<CommsJourneys password="pw" />);
    fireEvent.click(await screen.findByRole("button", { name: "Walk through" }));
    expect(await screen.findByText("You're coming to Supper")).toBeTruthy();
    expect(screen.getByText("Already sent")).toBeTruthy();
    expect(screen.getByText("Skipped")).toBeTruthy();
    expect(screen.getByText("They said yes less than 36 hours before")).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith("/walk"))?.body).toEqual({ enrollmentId: "enr_1" });
  });
});
