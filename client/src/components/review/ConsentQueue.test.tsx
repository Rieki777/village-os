// @vitest-environment jsdom
/**
 * What the consent section promises before anybody presses (finding 10).
 *
 * The box opens on a number the route will take, and the button refuses what
 * the route would refuse. That `canGrant` and the route's refusal agree for
 * every mode, label, zero dial and amount is proven in
 * server/lib/questConsent.test.ts. This file proves the screen asks it, and
 * that a refusal the screen cannot foresee comes back in the server's words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from "sonner";
import type { ConsentBounds } from "@shared/questConsentBounds";
import ConsentQueue, { type ConsentClaim } from "./ConsentQueue";

const posted: ConsentBounds = {
  label: "50-100",
  readable: true,
  floor: 50,
  ceiling: 100,
  zeroAllowed: false,
  mode: "posted",
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
  bounds: posted,
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

const box = () => screen.getByLabelText("What this work earns") as HTMLInputElement;
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const consentButton = () => screen.getByRole("button", { name: /^Consent/ }) as HTMLButtonElement;

function answer(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("the consent section refuses what the route would refuse, before anybody presses (finding 10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the box on the floor the quest advertises, and says the range", () => {
    show(claim());
    expect(box().value).toBe("50");
    expect(screen.getByText(/Between 50 and 100, what the board advertises/)).toBeTruthy();
    expect(consentButton().disabled).toBe(false);
    expect(consentButton().textContent).toBe("Consent and credit 50");
  });

  it("refuses above the advertised top under posted, and names the top", () => {
    show(claim());
    type("101");
    expect(consentButton().disabled).toBe(true);
    expect(screen.getByText("Above 100, the most this quest advertises.")).toBeTruthy();
    type("100");
    expect(consentButton().disabled).toBe(false);
  });

  it("under capped the bonus ceiling is the top, and the floor still holds", () => {
    show(claim({ bounds: { ...posted, mode: "capped", ceiling: 200 } }));
    type("200");
    expect(consentButton().disabled).toBe(false);
    type("201");
    expect(consentButton().disabled).toBe(true);
    expect(screen.getByText("Above 200, the most this village allows.")).toBeTruthy();
    type("49");
    expect(consentButton().disabled).toBe(true);
    expect(screen.getByText("Below 50, the least this quest pays.")).toBeTruthy();
  });

  it("offers 0 only where the quest or the village allows it", () => {
    const first = show(claim());
    type("0");
    expect(consentButton().disabled).toBe(true);
    expect(screen.getByText("This quest does not allow a consent at 0.")).toBeTruthy();
    first.unmount();

    show(claim({ bounds: { ...posted, zeroAllowed: true } }));
    type("0");
    expect(consentButton().disabled).toBe(false);
    expect(consentButton().textContent).toBe("Consent at 0");
  });

  it("never offers a fraction, a negative or a word, which the ledger could not post", () => {
    show(claim());
    for (const value of ["60.5", "-1", "sixty"]) {
      type(value);
      expect(consentButton().disabled, value).toBe(true);
      expect(screen.getByText("Whole tokens only, 0 or more.")).toBeTruthy();
    }
  });

  it("an unreadable reward says so, and nothing can be pressed", () => {
    show(
      claim({
        bounds: { label: "tbd", readable: false, floor: null, ceiling: null, zeroAllowed: false, mode: "posted" },
      }),
    );
    expect(box().value).toBe("");
    expect(screen.getByText(/reads "tbd", which is not an amount/)).toBeTruthy();
    for (const value of ["5", "0"]) {
      type(value);
      expect(consentButton().disabled, value).toBe(true);
    }
  });

  it("a claim whose quest is gone is left to the server to answer", () => {
    show(claim({ bounds: null }));
    expect(screen.getByText(/Its quest is gone from the board/)).toBeTruthy();
    type("60");
    expect(consentButton().disabled).toBe(false);
  });

  it("a refusal it could not foresee comes back in the server's words, and nothing says it landed", async () => {
    const refusal = "You cannot consent to your own claim. Someone else has to witness the work.";
    answer(403, { error: refusal });
    show(claim());
    fireEvent.click(consentButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(refusal));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a consent that lands sends the amount in the box, and reads the claims again", async () => {
    const fetchMock = answer(200, {});
    show(claim());
    type("75");
    fireEvent.click(consentButton());
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/quest-claims/c1/consent");
    expect(JSON.parse(String(init?.body))).toEqual({ approve: true, amount: 75 });
    expect(toast.success).toHaveBeenCalledWith("Consented, and the credit is posted.");
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
