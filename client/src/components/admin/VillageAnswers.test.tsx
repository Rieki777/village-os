// @vitest-environment jsdom
/**
 * THE BANNER THAT OUTLIVES THE LAUNCH CHECKLIST.
 *
 * The two questions only a village can answer, its timezone and its currency,
 * are launch items. The launch surfaces stop speaking the moment a village
 * launches: the admin banner returns null once `launchedAt` is set, and the
 * Journey page keeps its list only as the record of what launching took. So a
 * launched village, which is the one that has been running on an inherited
 * clock the longest, would never be asked at all.
 *
 * This reads the same registry through the same route, so the two surfaces
 * cannot drift into saying different things, and it disappears for good once
 * both are answered.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import VillageAnswers from "./VillageAnswers";

const item = (id: string, state: string, over: Record<string, unknown> = {}) => ({
  id,
  state,
  title: id === "village-timezone" ? "Say which timezone the village keeps" : "Say which currency your prices are in",
  detail:
    id === "village-timezone"
      ? "Days here run on America/Costa_Rica, which is where the platform starts and not an answer anybody here gave"
      : "Prices follow the platform's own currency, which nobody here has confirmed",
  fixAt:
    id === "village-timezone"
      ? "/admin?tab=season&setting=season.timezone"
      : "/admin?tab=setup&setting=project.fiatCurrency",
  severity: "recommended",
  ...over,
});

const launchAnswering = (items: unknown[], ok = true) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ items }) })),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("VillageAnswers", () => {
  it("asks both questions, each linking to its own control", async () => {
    launchAnswering([item("village-timezone", "missing"), item("village-currency", "missing")]);
    render(<VillageAnswers password="secret" />);
    expect(await screen.findByText(/Days here run on America\/Costa_Rica/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Say which timezone the village keeps" }).getAttribute("href"),
    ).toBe("/admin?tab=season&setting=season.timezone");
    expect(
      screen.getByRole("link", { name: "Say which currency your prices are in" }).getAttribute("href"),
    ).toBe("/admin?tab=setup&setting=project.fiatCurrency");
  });

  it("asks only what is still unanswered", async () => {
    launchAnswering([item("village-timezone", "ok"), item("village-currency", "missing")]);
    render(<VillageAnswers password="secret" />);
    await screen.findByText(/Prices follow the platform's own currency/);
    expect(screen.queryByText(/Days here run on/)).toBeNull();
  });

  it("disappears entirely once both are answered", async () => {
    launchAnswering([item("village-timezone", "ok"), item("village-currency", "ok")]);
    const { container } = render(<VillageAnswers password="secret" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("ignores the rest of the checklist, which has its own page", async () => {
    launchAnswering([item("village-timezone", "ok"), { ...item("village-currency", "ok"), id: "stripe-keys", state: "missing" }]);
    const { container } = render(<VillageAnswers password="secret" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("says nothing at all when the reading fails, rather than guessing", async () => {
    // A village whose launch route errored has not told us it is unanswered.
    // Announcing a question we could not ask would be a worse answer than
    // silence, and this banner is an ask and never a gate.
    launchAnswering([], false);
    const { container } = render(<VillageAnswers password="secret" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
