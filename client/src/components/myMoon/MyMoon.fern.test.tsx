// @vitest-environment jsdom
/**
 * A FERN UNFURLS ONCE WHEN A RECAP IS SENT (batch 157, C2 Q2), claimed once
 * per recap through `claimMoment`, the way LevelUpMoment's crossing is: a take
 * back and a second send of the same recap never plays it again, and a failed
 * send plays nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MOON_WORDS, MY_MOON_WORDS } from "@shared/moonRecap";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

const sendRecap = vi.fn();
vi.mock("./moonApi", async (orig) => ({ ...(await orig<typeof import("./moonApi")>()), sendRecap: (...a: unknown[]) => sendRecap(...a) }));

import { MyMoonView, recapSentMoment } from "./MyMoon";
import { myMoon } from "./myMoon.fixture";

beforeEach(() => {
  window.localStorage.clear();
  sendRecap.mockReset();
});
afterEach(cleanup);

function renderEditable() {
  const data = myMoon();
  const editable = { ...data, recap: data.recap ? { ...data.recap, status: "draft" as const } : null };
  render(<MyMoonView data={editable as typeof data} villageRoles={[]} onCycle={() => {}} reload={async () => null} />);
}

const send = () => fireEvent.click(screen.getByRole("button", { name: MOON_WORDS.sendRecap }));

describe("the fern on a sent recap", () => {
  it("unfurls the first time a recap is sent", async () => {
    sendRecap.mockResolvedValue({ ok: true, data: { recap: { id: "rc-1" }, tensionsRaised: 0 } });
    renderEditable();
    send();
    await waitFor(() => expect(screen.getByText(MY_MOON_WORDS.sent)).toBeTruthy());
    expect(screen.getByTestId("recap-fern")).toBeTruthy();
    expect(window.localStorage.getItem("village.celebrated")).toContain(recapSentMoment("rc-1"));
  });

  it("stays still when the same recap is sent again", async () => {
    sendRecap.mockResolvedValue({ ok: true, data: { recap: { id: "rc-2" }, tensionsRaised: 0 } });
    renderEditable();
    send();
    await waitFor(() => expect(screen.getByTestId("recap-fern")).toBeTruthy());
    cleanup();
    renderEditable();
    send();
    await waitFor(() => expect(screen.getByText(MY_MOON_WORDS.sent)).toBeTruthy());
    expect(screen.queryByTestId("recap-fern")).toBeNull();
  });

  it("plays nothing when the send fails", async () => {
    sendRecap.mockResolvedValue({ ok: false, status: 500, error: "Did not send.", code: null });
    renderEditable();
    send();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Did not send."));
    expect(screen.queryByTestId("recap-fern")).toBeNull();
  });
});
