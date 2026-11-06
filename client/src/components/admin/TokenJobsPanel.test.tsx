// @vitest-environment jsdom
/**
 * Admin, Tokens, "Which token does what": each job, the tokens doing it, and
 * the one door that changes it. A reader only: no second place to set a job.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import TokenJobsPanel, { doorFor } from "./TokenJobsPanel";
import type { TokenJob } from "@shared/tokenJobs";

const JOBS: TokenJob[] = [
  { id: "work.quest", label: "Quests", tokens: [{ slug: "credits", name: "Village Credits" }, { slug: "voice", name: "Voice" }], setBy: { kind: "mint_rules", trigger: "quest.completed" }, assignable: true, module: null },
  { id: "pool.payout", label: "The cycle pool", tokens: [{ slug: "credits", name: "Village Credits" }], setBy: { kind: "dial", key: "gratitude.pool_token" }, assignable: true, module: null },
  { id: "thanks", label: "Thanks between members", tokens: [{ slug: "gratitude", name: "Gratitude" }], setBy: { kind: "code", where: "server/lib/economy.ts" }, assignable: false, module: null },
  { id: "dues", label: "Village dues", tokens: [], setBy: { kind: "nothing" }, assignable: false, module: null },
  { id: "stays", label: "Stays", tokens: [{ slug: "stay-credit", name: "Stay Credits" }], setBy: { kind: "module", module: "stays" }, assignable: false, module: { id: "stays", lifecycle: "off" } },
];

function stub(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}
afterEach(() => vi.unstubAllGlobals());

const row = (label: string) => screen.getByText(label).closest("li") as HTMLElement;

describe("Which token does what", () => {
  it("lists every job with the tokens doing it, by their live names", async () => {
    stub(200, { jobs: JOBS });
    render(<TokenJobsPanel password="pw" />);
    await screen.findByText("Quests");
    expect(within(row("Quests")).getByText("Village Credits")).toBeInTheDocument();
    expect(within(row("Quests")).getByText("Voice")).toBeInTheDocument();
    expect(within(row("Village dues")).getByText("None")).toBeInTheDocument();
  });

  it("sends a change to the door that already owns the job", async () => {
    stub(200, { jobs: JOBS });
    render(<TokenJobsPanel password="pw" />);
    await screen.findByText("Quests");
    expect(within(row("The cycle pool")).getByRole("link")).toHaveAttribute("href", "/admin?tab=variables&variable=gratitude.pool_token");
    expect(within(row("Quests")).getByRole("link")).toHaveAttribute("href", "/admin/mint");
  });

  it("offers no control for a job the village cannot reassign, and says why", async () => {
    stub(200, { jobs: JOBS });
    render(<TokenJobsPanel password="pw" />);
    await screen.findByText("Quests");
    expect(within(row("Thanks between members")).queryByRole("link")).toBeNull();
    expect(within(row("Thanks between members")).getByText("Fixed in the platform")).toBeInTheDocument();
    expect(within(row("Village dues")).getByText("No token does this here")).toBeInTheDocument();
  });

  it("marks a job whose module is off as not running", async () => {
    stub(200, { jobs: JOBS });
    render(<TokenJobsPanel password="pw" />);
    await screen.findByText("Stays");
    expect(within(row("Stays")).getByText(/module is off/)).toBeInTheDocument();
  });

  it("says so when the list cannot be read", async () => {
    stub(401, { error: "auth_required", message: "Sign in again." });
    render(<TokenJobsPanel password="pw" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again.");
  });

  it("has a door for every kind of source", () => {
    expect(doorFor({ kind: "exchange" }).href).toBe("/admin?tab=exchange-admin");
    expect(doorFor({ kind: "module", module: "stays" }).href).toBe("/modules/stays");
  });
});
