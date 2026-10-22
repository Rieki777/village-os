// @vitest-environment jsdom
/**
 * "YOUR ROLES" ON YOUR OWN PROFILE: the door to the role proposal process.
 *
 *   - a member holding seats: each seat, the two acts (Apply for a seat, Plan
 *     your season), and only their own applications that can still move, each
 *     a link to its page with where it stands;
 *   - a member with none: says so, and still offers both acts;
 *   - a guest below the member rung: the MySeason sentence, no wizard link, and
 *     the applications list is never asked for (it would answer 401);
 *   - a failed read: says so, with Retry, and never "you hold no seats".
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchMine = vi.fn();
const fetchApplications = vi.fn();
vi.mock("@/components/seasonPlans/seasonPlansApi", () => ({ fetchMine: () => fetchMine() }));
vi.mock("@/components/governance/seatApplicationsApi", () => ({ fetchApplications: () => fetchApplications() }));

import YourRolesSection, { YOUR_ROLES_WORDS } from "./YourRolesSection";

const SEASON = { id: "s-next", name: "Thaw Season", startsOn: "2027-03-01", endsOn: "2027-06-01", goals: [] };
const mine = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    season: SEASON,
    window: null,
    plan: null,
    filed: null,
    heldSeats: [],
    applications: [],
    questsThisMoon: { done: 0 },
    mayApply: true,
    ...over,
  },
});
const app = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  href: `/seat-applications/${id}`,
  status: "voting",
  statusWords: "The village is voting",
  seats: [{ id: "seat-orchard", name: "Orchard keeper", aim: null }],
  createdAt: "2027-02-01T00:00:00.000Z",
  you: { isCandidate: true, mayAdopt: false, mayPutToVillage: false, mayWithdraw: true, holdsThePower: false },
  ...over,
});

const hrefOf = (name: RegExp | string) => screen.getByRole("link", { name }).getAttribute("href");

beforeEach(() => {
  fetchMine.mockReset();
  fetchApplications.mockReset();
});
afterEach(cleanup);

describe("Your roles, for a member", () => {
  it("lists the seats held, both acts, and only their own open applications", async () => {
    fetchMine.mockResolvedValue(
      mine({
        heldSeats: [
          { id: "seat-host", name: "Host", termEndsOn: "2027-06-01", lapsed: false },
          { id: "seat-well", name: "Well keeper", termEndsOn: "2027-01-01", lapsed: true },
        ],
      }),
    );
    fetchApplications.mockResolvedValue({
      ok: true,
      data: {
        applications: [
          app("sa-0000000000000001"),
          app("sa-0000000000000002", { status: "awaiting-holder", statusWords: "Waiting for a seat holder", seats: [{ id: "seat-alder", name: "Seed keeper", aim: null }, { id: "seat-birch", name: "Path warden", aim: null }], createdAt: "2027-02-05T00:00:00.000Z" }),
          app("sa-0000000000000003", { status: "adopted", statusWords: "Adopted", seats: [{ id: "seat-xylem", name: "Adopted seat", aim: null }] }),
          app("sa-0000000000000004", { you: { isCandidate: false }, seats: [{ id: "seat-yarrow", name: "Someone else's seat", aim: null }] }),
        ],
      },
    });
    render(<YourRolesSection />);

    await screen.findByText(YOUR_ROLES_WORDS.holding);
    expect(hrefOf(/Host/)).toBe("/roles?seat=seat-host");
    expect(screen.getByRole("link", { name: /Host/ }).textContent).toContain("Until 1 June 2027");
    expect(screen.getByRole("link", { name: /Well keeper/ }).textContent).toContain(YOUR_ROLES_WORDS.ended);

    expect(hrefOf(YOUR_ROLES_WORDS.apply)).toBe("/propose?type=role_application&season=s-next");
    expect(hrefOf(YOUR_ROLES_WORDS.plan)).toBe("/season-plans/mine");
    expect(hrefOf(YOUR_ROLES_WORDS.every)).toBe("/roles");
    expect(hrefOf(YOUR_ROLES_WORDS.fits)).toBe("/profile/characters");

    await screen.findByText(YOUR_ROLES_WORDS.openHeading);
    const open = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/seat-applications/"));
    // Newest first, open ones only, the reader's own only.
    expect(open.map((a) => a.getAttribute("href"))).toEqual(["/seat-applications/sa-0000000000000002", "/seat-applications/sa-0000000000000001"]);
    expect(open[0].textContent).toContain("Seed keeper, Path warden");
    expect(open[0].textContent).toContain("Waiting for a seat holder");
    expect(open[1].textContent).toContain("The village is voting");
    expect(screen.queryByText("Adopted seat")).toBeNull();
    expect(screen.queryByText(/Someone else/)).toBeNull();
  });

  it("with no seats and no applications, says so and still offers both acts", async () => {
    fetchMine.mockResolvedValue(mine({ season: null }));
    fetchApplications.mockResolvedValue({ ok: true, data: { applications: [] } });
    render(<YourRolesSection />);
    await screen.findByText(YOUR_ROLES_WORDS.noSeats);
    // No season to plan: the wizard opens with no season named.
    expect(hrefOf(YOUR_ROLES_WORDS.apply)).toBe("/propose?type=role_application");
    expect(hrefOf(YOUR_ROLES_WORDS.plan)).toBe("/season-plans/mine");
    await waitFor(() => expect(fetchApplications).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(YOUR_ROLES_WORDS.openHeading)).toBeNull();
  });
});

describe("Your roles, for a guest below the member rung", () => {
  it("says applying opens at the member rung, offers no wizard, and never asks for the applications", async () => {
    fetchMine.mockResolvedValue(mine({ mayApply: false }));
    render(<YourRolesSection />);
    await screen.findByText(YOUR_ROLES_WORDS.membersOnly);
    expect(screen.queryByRole("link", { name: YOUR_ROLES_WORDS.apply })).toBeNull();
    expect(screen.queryByRole("link", { name: YOUR_ROLES_WORDS.plan })).toBeNull();
    expect(hrefOf(YOUR_ROLES_WORDS.every)).toBe("/roles");
    expect(fetchApplications).not.toHaveBeenCalled();
  });
});

describe("Your roles, when the read fails", () => {
  it("says it did not load, offers Retry, and never claims the member holds nothing", async () => {
    fetchMine.mockResolvedValueOnce({ ok: false, status: 500, error: "boom" }).mockResolvedValueOnce(mine({ heldSeats: [{ id: "seat-host", name: "Host", termEndsOn: null, lapsed: false }] }));
    fetchApplications.mockResolvedValue({ ok: true, data: { applications: [] } });
    render(<YourRolesSection />);
    await screen.findByText(YOUR_ROLES_WORDS.failed);
    expect(screen.queryByText(YOUR_ROLES_WORDS.noSeats)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: YOUR_ROLES_WORDS.retry }));
    await screen.findByText(YOUR_ROLES_WORDS.holding);
    expect(hrefOf(/Host/)).toBe("/roles?seat=seat-host");
  });
});
