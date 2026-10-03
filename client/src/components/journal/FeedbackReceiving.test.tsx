// @vitest-environment jsdom
/**
 * A failed read of the member's feedback settings never poses as their
 * settings.
 *
 * The form starts on defaults (closed, gentle, no note). When the read
 * failed, it used to switch on with those defaults and no word said, so a
 * member who had said Yes and tapped Save to change only the style was closed
 * to feedback, dropped from every recipient list and had their note erased.
 * Now the read failing says so, offers Retry, and Save stays off until the
 * real settings are on the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TOKEN_KEY } from "@/lib/gameApi";
import FeedbackReceiving from "./FeedbackReceiving";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const PREFS = "/api/journal/feedback/prefs";
let fetchMock: ReturnType<typeof vi.fn>;
let prefsAnswers: Array<() => Response>;

beforeEach(() => {
  const map = new Map<string, string>([[TOKEN_KEY, "tok-wren"]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === PREFS && (init?.method ?? "GET") === "GET") return (prefsAnswers.shift() ?? (() => json(null)))();
    if (url === PREFS && init?.method === "PUT") return json({ ok: true });
    if (url === "/api/journal/feedback/received") return json([]);
    return json({ error: "not-here" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const puts = () => fetchMock.mock.calls.filter(([url, init]) => url === PREFS && (init as RequestInit | undefined)?.method === "PUT");

describe("reading the member's feedback settings", () => {
  it("says the read failed, keeps Save off, and shows the real settings after Retry", async () => {
    prefsAnswers = [
      () => json({ error: "internal" }, 500),
      () => json({ open: true, style: "direct", note: "Tell me straight." }),
    ];
    render(<FeedbackReceiving />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Your feedback settings could not be read just now");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    // The defaults are not on the page dressed as this member's answer.
    expect(screen.queryByRole("radio", { name: "Not now" })).toBeNull();

    // A submit cannot reach the server either.
    fireEvent.submit(save.closest("form")!);
    expect(puts()).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });

    await waitFor(() => expect(screen.getByRole("radio", { name: "Yes" })).toBeChecked());
    expect(screen.getByLabelText("How should it be written?")).toHaveValue("direct");
    expect(screen.getByLabelText("How I like to receive feedback")).toHaveValue("Tell me straight.");
    expect(screen.queryByText(/could not be read just now/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("treats no saved row as the member's real settings and lets them save", async () => {
    prefsAnswers = [() => json(null)];
    render(<FeedbackReceiving />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(screen.getByRole("radio", { name: "Not now" })).toBeChecked();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
