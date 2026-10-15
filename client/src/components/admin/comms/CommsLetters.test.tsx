// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CommsLetters from "@/components/admin/comms/CommsLetters";
import JourneyOutcomes from "@/components/admin/comms/JourneyOutcomes";

/**
 * The Letters screen and the outcomes table, held to the routes they call
 * (server/routes/commsLetters.ts): History with its numbers, writing and
 * previewing a letter, one send key per preview, a refusal in words, and a
 * scheduled letter's Cancel.
 */

type Call = { url: string; method: string; body: any };

const numbers = { posted: 3, sent: 3, delivered: 2, bounced: 1, complained: 0, skipped: 1, waiting: 0, failed: 0, rehearsed: 0 };
const SENT = {
  id: "ltr_000000000000000000000001",
  subject: "The well is finished",
  preheader: null,
  bodyMd: "The water tested clean.",
  layout: "plain",
  audience: { kind: "everyone" },
  audienceLabel: "Everyone who said yes to letters",
  state: "sent",
  createdAt: "2026-10-08T09:00:00.000Z",
  scheduledFor: null,
  sentAt: "2026-10-08T09:05:00.000Z",
  recipientCount: 4,
  numbers,
};
const SCHEDULED = { ...SENT, id: "ltr_000000000000000000000002", subject: "Harvest supper", state: "scheduled", sentAt: null, scheduledFor: "2026-10-20T17:00:00.000Z", numbers: { ...numbers, posted: 0, sent: 0, delivered: 0, bounced: 0, skipped: 0 } };

const LIST = {
  letters: [SCHEDULED, SENT],
  choices: { paths: [{ id: "resident", label: "Resident" }], gatherings: [{ id: "ev-1", title: "Supper", startsAt: "2026-10-03 18:00" }] },
  limit: { perDay: 3, today: 1, minutesSinceLast: 60 },
  ready: true,
};

const PREVIEW = {
  count: 7,
  names: ["Ada", "Ben", "Cleo", "Dev", "Eli"],
  inGroup: 9,
  leftOut: 2,
  note: null,
  sampleFor: "Ada",
  subject: "Bring a cup",
  preheader: "",
  html: "<p>Bring a cup</p>",
  text: "Bring a cup",
  voice: [],
  confirmToken: "tok.sig",
  expiresAt: Date.now() + 900_000,
};

function stub(calls: Call[], opts: { sendError?: string } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      const method = String(init?.method ?? "GET");
      calls.push({ url: u, method, body: init?.body ? JSON.parse(init.body) : null });
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (u.endsWith("/admin/comms/letters") && method === "GET") return ok(LIST);
      if (u.endsWith("/admin/comms/letters") && method === "POST") return ok({ letter: { id: "ltr_000000000000000000000003", state: "draft" } });
      if (u.endsWith("/ltr_000000000000000000000003") && method === "PUT") return ok({ letter: { id: "ltr_000000000000000000000003", state: "draft" } });
      if (u.endsWith("/preview")) return ok(PREVIEW);
      if (u.endsWith("/send")) {
        if (opts.sendError) return { ok: false, status: 409, json: async () => ({ error: opts.sendError }) };
        return ok({ state: "sent", duplicate: false, counts: { posted: 7, skipped: 0, pending: 0 }, scheduledFor: null });
      }
      if (u.endsWith("/cancel")) return ok({ state: "cancelled" });
      if (u.includes("/admin/comms/outcomes/")) {
        return ok({
          journeyKey: "path.resident",
          windowDays: 7,
          goals: ["resident_reserved"],
          nextStepRule: "resident_first_step_done",
          steps: [
            { stepKey: "welcome", sent: 10, delivered: 9, bounced: 1, unsubscribed: 2, rsvpd: 3, came: 2, reachedGoal: 1, tookNextStep: 4, askedNextStep: 10 },
            { stepKey: "first_step", sent: 0, delivered: 0, bounced: 0, unsubscribed: 0, rsvpd: 0, came: 0, reachedGoal: 0, tookNextStep: null, askedNextStep: 0 },
          ],
        });
      }
      return { ok: false, status: 404, json: async () => ({ error: "not here" }) };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function writeAndPreview() {
  fireEvent.click(await screen.findByRole("button", { name: "Write a letter" }));
  fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "Bring a cup" } });
  fireEvent.change(screen.getByLabelText(/The letter/), { target: { value: "Saturday at the well." } });
  fireEvent.click(screen.getByRole("button", { name: "Preview and choose when" }));
  return screen.findByText("It goes to 7 people: Ada, Ben, Cleo, Dev, Eli and 2 more.");
}

describe("the Letters screen", () => {
  it("lists every letter with what became of it, and today's limit", async () => {
    stub([]);
    render(<CommsLetters password="pw" />);
    expect(await screen.findByText("The well is finished")).toBeTruthy();
    expect(screen.getByText(/At most 3 a day, ten minutes apart/)).toBeTruthy();
    const sent = screen.getAllByLabelText("Numbers")[0];
    expect(sent.textContent).toContain("Delivered2");
    expect(sent.textContent).toContain("Bounced1");
    expect(sent.textContent).toContain("Skipped1");
  });

  it("saves, previews with the count and the first names, and sends with one key however often it is pressed", async () => {
    const calls: Call[] = [];
    stub(calls);
    render(<CommsLetters password="pw" />);
    await writeAndPreview();
    expect(screen.getByText(/2 more in this group are left out/)).toBeTruthy();
    const created = calls.find((c) => c.method === "POST" && c.url.endsWith("/admin/comms/letters"));
    expect(created?.body).toEqual({ subject: "Bring a cup", preheader: "", bodyMd: "Saturday at the well.", layout: "plain", audience: { kind: "members" } });
    const sample = screen.getByTitle("The letter as it arrives");
    expect(sample.getAttribute("sandbox")).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Send it now to 7" }));
    await waitFor(() => expect(screen.getByText(/Sent. 7 handed to the post office/)).toBeTruthy());
    const sends = calls.filter((c) => c.url.endsWith("/send"));
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toMatchObject({ confirmToken: "tok.sig", scheduledFor: null });
    expect(String(sends[0].body.idempotencyKey)).toMatch(/^send:/);
  });

  it("shows a refusal in words, and keeps the same key for a second try of the same preview", async () => {
    const calls: Call[] = [];
    stub(calls, { sendError: "Letters go at least 10 minutes apart. Try again in 4 minutes." });
    render(<CommsLetters password="pw" />);
    await writeAndPreview();
    fireEvent.click(screen.getByRole("button", { name: "Send it now to 7" }));
    expect(await screen.findByText("Letters go at least 10 minutes apart. Try again in 4 minutes.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send it now to 7" }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(2));
    const [a, b] = calls.filter((c) => c.url.endsWith("/send"));
    expect(a.body.idempotencyKey).toBe(b.body.idempotencyKey);
  });

  it("cancels a scheduled letter", async () => {
    const calls: Call[] = [];
    stub(calls);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CommsLetters password="pw" />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/ltr_000000000000000000000002/cancel"))).toBe(true));
    expect(await screen.findByText(/Cancelled. Open it to change it/)).toBeTruthy();
  });
});

describe("a journey's outcomes", () => {
  it("shows each step's numbers with the goal and the first step, and says when one is not measured", async () => {
    stub([]);
    render(<JourneyOutcomes password="pw" journeyKey="path.resident" labels={{ welcome: "Welcome" }} />);
    const row = (await screen.findByText("Welcome")).closest("tr")!;
    expect(Array.from(row.querySelectorAll("td")).map((td) => td.textContent)).toEqual(["Welcome", "10", "9", "1", "2", "3", "2", "4", "1"]);
    expect(screen.getByText(/The goal: their home was reserved/)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Took the first step" })).toBeTruthy();
  });
});
