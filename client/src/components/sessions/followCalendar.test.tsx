// @vitest-environment jsdom
/**
 * "Follow the calendar" on /sessions: picking circles, and the private
 * address for a calendar app.
 *
 * What each case holds: the circles are read when the panel opens, with how
 * each meets; a save sends what is ticked, or every circle as one choice; the
 * address shows once, with Google's page, the subscription link and a copy;
 * an address made earlier is described, never shown, and can be stopped; a
 * refusal is said in the server's words; and closing gives the focus back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CALENDAR_COPY, googleAddUrl, webcalUrl, type FollowPayload } from "@shared/sessionCalendar";

const state = vi.hoisted(() => ({
  fetch: null as null | ((path: string, init?: RequestInit) => Promise<Response>),
}));
vi.mock("@/lib/gameApi", () => ({ gameFetch: (path: string, init?: RequestInit) => state.fetch!(path, init) }));

import FollowCalendar from "./FollowCalendar";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Call = { path: string; method: string; body: unknown };
let calls: Call[];
let answers: Record<string, () => Response>;

const URL_ = `https://village.example.test/api/calendar/circles.ics?key=${"a".repeat(64)}`;
const payload = (over: Partial<FollowPayload> = {}): FollowPayload => ({
  circles: [
    { id: "garden", name: "Garden", followed: true, rhythm: "Every Thursday at 18:00" },
    { id: "kitchen", name: "Kitchen", followed: false, rhythm: null },
  ],
  all: false,
  address: null,
  ...over,
});

beforeEach(() => {
  calls = [];
  answers = { "GET /api/sessions/circles/following": () => json(payload()) };
  state.fetch = async (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${path}`];
    return answer ? answer() : json({ error: "no answer" }, 500);
  };
});

const openPanel = async () => {
  fireEvent.click(screen.getByRole("button", { name: CALENDAR_COPY.follow }));
  await screen.findByRole("checkbox", { name: /Garden/ });
};

describe("follow the calendar", () => {
  it("reads the circles when it opens, ticking those followed, with how each meets", async () => {
    render(<FollowCalendar />);
    expect(calls).toEqual([]);
    await openPanel();
    expect((screen.getByRole("checkbox", { name: /Garden/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Kitchen/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Every Thursday at 18:00")).toBeInTheDocument();
    expect(screen.getByText(CALENDAR_COPY.noRhythm)).toBeInTheDocument();
  });

  it("saves what is ticked, and every circle as one choice", async () => {
    answers["PUT /api/sessions/circles/following"] = () => json(payload({ circles: payload().circles.map((c) => ({ ...c, followed: true })) }));
    render(<FollowCalendar />);
    await openPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /Kitchen/ }));
    fireEvent.click(screen.getByRole("button", { name: CALENDAR_COPY.save }));
    await waitFor(() => expect(calls.at(-1)).toEqual({ path: "/api/sessions/circles/following", method: "PUT", body: { all: false, circleIds: ["garden", "kitchen"] } }));
    expect(await screen.findByText(CALENDAR_COPY.saved(2, false))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: CALENDAR_COPY.everyCircle }));
    expect((screen.getByRole("checkbox", { name: /Kitchen/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: CALENDAR_COPY.save }));
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ all: true, circleIds: [] }));
  });

  it("shows a new address once, with Google's page, the subscription link and a copy", async () => {
    answers["POST /api/sessions/circles/following/key"] = () => json({ url: URL_ });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<FollowCalendar />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: CALENDAR_COPY.makeAddress }));
    const box = (await screen.findByLabelText(CALENDAR_COPY.addressLabel)) as HTMLInputElement;
    expect(box.value).toBe(URL_);
    expect(screen.getByRole("link", { name: CALENDAR_COPY.addGoogle })).toHaveAttribute("href", googleAddUrl(URL_));
    expect(screen.getByRole("link", { name: CALENDAR_COPY.addApple })).toHaveAttribute("href", webcalUrl(URL_));
    fireEvent.click(screen.getByRole("button", { name: CALENDAR_COPY.copy }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_));
    expect(await screen.findByText(CALENDAR_COPY.copied)).toBeInTheDocument();
  });

  it("describes an address made earlier without showing it, and stops it", async () => {
    answers["GET /api/sessions/circles/following"] = () => json(payload({ address: { madeAt: "2026-10-01T10:00:00.000Z", lastReadAt: null } }));
    answers["DELETE /api/sessions/circles/following/key"] = () => json({ ok: true });
    render(<FollowCalendar />);
    await openPanel();
    expect(screen.queryByLabelText(CALENDAR_COPY.addressLabel)).toBeNull();
    expect(screen.getByText(new RegExp(CALENDAR_COPY.notReadYet))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: CALENDAR_COPY.stopAddress }));
    expect(await screen.findByText(CALENDAR_COPY.stopped)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CALENDAR_COPY.makeAddress })).toBeInTheDocument();
  });

  it("says a refusal in the server's words, and gives the focus back on close", async () => {
    answers["POST /api/sessions/circles/following/key"] = () => json({ error: "You have made enough addresses today. Try again tomorrow." }, 429);
    render(<FollowCalendar />);
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: CALENDAR_COPY.makeAddress }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You have made enough addresses today. Try again tomorrow.");
    fireEvent.click(screen.getByRole("button", { name: CALENDAR_COPY.close }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: CALENDAR_COPY.follow })));
  });
});
