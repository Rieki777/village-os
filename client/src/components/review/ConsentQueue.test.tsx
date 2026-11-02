// @vitest-environment jsdom
/**
 * What the consent section shows before anybody presses, and what a press sends.
 *
 * A consent is a yes (Rye, 2026-10-21). There is no amount box: no quest pays
 * Gratitude, and the quest pays what it says (0265). So the steward reads what
 * saying yes releases, from the claim's `pay`, which is the answer the quest's
 * card gives and the consent prices from. A refusal the screen cannot foresee
 * comes back in the server's words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from "sonner";
import type { WorkPay } from "@shared/workValue";
import { forgetDisplayRates } from "@/lib/workPay";
import ConsentQueue, { type ConsentClaim } from "./ConsentQueue";

const valued: WorkPay = {
  value: { minor: 2500000, currency: "CRC" },
  lines: [
    { token: "credits", name: "Village Credits", amount: 40 },
    { token: "village-voice", name: "Village Voice", amount: 5 },
  ],
  source: "own",
  cadence: "once",
};

const claim = (over: Partial<ConsentClaim> = {}): ConsentClaim => ({
  id: "c1",
  questId: "q1",
  questTitle: "Rebuild the garden beds",
  userId: "u2",
  userName: "Ada Moss",
  status: "submitted",
  note: "Beds rebuilt, drip lines in.",
  artifactUrl: "https://example.test/beds",
  amount: null,
  claimedAt: "2026-09-10T10:00:00.000Z",
  submittedAt: "2026-09-12T10:00:00.000Z",
  pay: valued,
  ...over,
});

const onChanged = vi.fn(async () => {});

function show(c: ConsentClaim, extra: Partial<Parameters<typeof ConsentQueue>[0]> = {}) {
  return render(
    <ConsentQueue
      claims={[c]}
      refused={false}
      error={null}
      headers={() => ({ Authorization: "Bearer a-token", "Content-Type": "application/json" })}
      onChanged={onChanged}
      onRetry={() => {}}
      {...extra}
    />,
  );
}

const consentButton = () => screen.getByRole("button", { name: "Consent" }) as HTMLButtonElement;

/** Every request answers this, and the day's rates answer nothing, so no conversion is drawn. */
function answer(status: number, body: unknown) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    String(url).includes("/api/fx/rates")
      ? { ok: false, status: 404, json: async () => null }
      : { ok: status >= 200 && status < 300, status, json: async () => body },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("the consent section: a yes, and what it releases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetDisplayRates();
    answer(200, {});
  });
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows what saying yes releases, and asks for no amount", () => {
    show(claim());
    expect(screen.getByText(/Worth/).textContent).toContain("25,000");
    expect(screen.getByText("40 Village Credits")).toBeTruthy();
    expect(screen.getByText("5 Village Voice")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(consentButton().disabled).toBe(false);
  });

  it("says to inquire for a quest nobody has valued and nothing pays", () => {
    show(claim({ pay: { value: null, lines: [], source: "standard", cadence: "once" } }));
    expect(screen.getByText(/Inquire for payment details/)).toBeTruthy();
  });

  it("a claim whose quest is gone is left to the server to answer", () => {
    show(claim({ pay: null }));
    expect(screen.getByText(/Its quest is gone from the board/)).toBeTruthy();
    expect(consentButton().disabled).toBe(false);
  });

  it("a consent that lands sends a yes and nothing else, and reads the claims again", async () => {
    const fetchMock = answer(200, {});
    show(claim());
    fireEvent.click(consentButton());
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/consent"))!;
    expect(call[0]).toBe("/api/admin/quest-claims/c1/consent");
    expect(JSON.parse(String(call[1]?.body))).toEqual({ approve: true });
    expect(toast.success).toHaveBeenCalledWith("Consented. The work is confirmed.");
  });

  it("a decline sends a no", async () => {
    const fetchMock = answer(200, {});
    show(claim());
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/consent"))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ approve: false });
  });

  it("a refusal it could not foresee comes back in the server's words, nothing says it landed, and the list is read again", async () => {
    // The likeliest refusal is a claim another steward decided first. Reading
    // the list again is what takes it off this screen.
    const refusal =
      'Cannot consent a claim with status "declined". It has already been resolved, so there is nothing left to witness.';
    answer(409, { error: refusal });
    show(claim());
    fireEvent.click(consentButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(refusal));
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("a request that never reached the server says so, and reads no list it could not reach either", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    show(claim());
    fireEvent.click(consentButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That did not go through"));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a recently decided consent names the Gratitude an older consent granted, and only that", () => {
    render(
      <ConsentQueue
        claims={[
          claim({ id: "old", status: "consented", amount: 60, resolvedAt: "2026-09-01T00:00:00.000Z", userName: "Old Witnessed" }),
          claim({ id: "new", status: "consented", amount: null, resolvedAt: "2026-10-21T00:00:00.000Z", userName: "New Witnessed" }),
        ]}
        refused={false}
        error={null}
        headers={() => ({})}
        onChanged={onChanged}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/Old Witnessed on .*: consented at 60/)).toBeTruthy();
    expect(screen.getByText(/New Witnessed on .*: consented$/)).toBeTruthy();
  });

  it("a failed read says the list may not be empty, and a refused read renders nothing", () => {
    const failed = show(claim(), { claims: null, error: "the database went away" });
    expect(screen.getByText("The claims did not load")).toBeTruthy();
    expect(screen.queryByText("No finished work is waiting for a witness.")).toBeNull();
    failed.unmount();

    const { container } = show(claim(), { claims: null, refused: true });
    expect(container.textContent).toBe("");
  });

  it("a link a member typed is only a link when it is a web address", () => {
    show(claim({ artifactUrl: "javascript:alert(1)" }));
    expect(screen.getByText("javascript:alert(1)")).toBeTruthy();
    expect(document.querySelector("a")).toBeNull();
  });
});
