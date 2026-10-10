// @vitest-environment jsdom
/**
 * Season plans RC1, rendered: the village page, your own page, the profile
 * section and the banner line.
 *
 *   - a visitor gets the sign-in doors on both pages and nothing is fetched;
 *   - a guest answered 401 reads the members line and no plan;
 *   - the village page draws the cards in the order the server sends (by name),
 *     "7 of 9 have filed", "Not filed yet" by name, and the "Waiting on the
 *     village" filter;
 *   - your page offers Carry on into the member door for this season, Hand it
 *     back, and files with one button;
 *   - another member's profile section draws nothing on a 401;
 *   - the banner says "Plan your season" only to a signed-in member while the
 *     window is open.
 *
 * Every name is made up.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let signedIn: { id: string } | null = { id: "u-ana" };
let season: any = null;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: signedIn }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "governance", lifecycle: "members" }] }),
  useModule: () => ({ id: "governance", lifecycle: "members" }),
}));
vi.mock("@/components/modules/ModuleGate", () => ({
  default: () => <p>Module gate</p>,
  SignInDoors: ({ next }: { next?: string }) => <a href={`/login?next=${next}`}>Sign in</a>,
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));
vi.mock("@/lib/gameApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/gameApi")>()),
  useSeason: () => season,
}));

import SeasonPlans from "./SeasonPlans";
import MySeason from "./MySeason";
import SeasonPlanSection from "@/components/profile/SeasonPlanSection";
import SeasonBanner from "@/components/SeasonBanner";

const card = (over: Record<string, unknown>) => ({
  userId: "u-x",
  name: "Someone",
  handle: null,
  filed: false,
  filedOn: null,
  changedSinceFiling: false,
  seats: [],
  handingBack: [],
  applications: [],
  waiting: false,
  aim: null,
  servesGoal: null,
  questsThisMoon: { done: 0, min: null, max: null },
  measures: [],
  ...over,
});

const VILLAGE = {
  season: { id: "s-next", name: "Season of Testing", startsOn: "2027-03-01", endsOn: "2027-06-01", goals: ["Plant the north orchard"] },
  window: { seasonId: "s-next", seasonName: "Season of Testing", opensOn: "2027-02-01", closesOn: "2027-03-31", state: "open" },
  people: [
    card({
      userId: "u-ana",
      name: "Ana Quillfeather",
      handle: "ana",
      filed: true,
      filedOn: "2027-02-10",
      seats: [{ id: "seat-host", name: "Host" }],
      applications: [{ id: "sa-00000000000000a1", href: "/seat-applications/sa-00000000000000a1", status: "voting", statusWords: "The village is voting", seats: [{ id: "seat-host", name: "Host" }] }],
      waiting: true,
      aim: "The north orchard is planted.",
      questsThisMoon: { done: 2, min: 2, max: 4 },
      measures: [{ measure: "Trees planted", target: "40 by the turn" }],
    }),
    card({ userId: "u-mo", name: "Mo Brindlecap", handle: "mo" }),
    card({ userId: "u-zed", name: "Zed Lanternwick", filed: true, filedOn: "2027-02-11", handingBack: [{ id: "seat-kitchen", name: "Kitchen keeper" }] }),
  ],
  filedCount: 2,
  memberCount: 3,
  notFiled: [{ userId: "u-mo", name: "Mo Brindlecap", handle: "mo" }],
};

const MINE = {
  season: VILLAGE.season,
  window: VILLAGE.window,
  plan: null,
  filed: null,
  changedSinceFiling: false,
  heldSeats: [
    { id: "seat-host", name: "Host", termEndsOn: "2027-03-01", lapsed: false },
    { id: "seat-gate", name: "Gate keeper", termEndsOn: null, lapsed: false },
  ],
  applications: [],
  questsThisMoon: { done: 1 },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let village: () => Response;
let mine: () => Response;
const asked: Array<{ method: string; url: string; body?: string }> = [];

beforeEach(() => {
  signedIn = { id: "u-ana" };
  season = null;
  asked.length = 0;
  village = () => json(VILLAGE);
  mine = () => json(MINE);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      asked.push({ method, url, body: init?.body });
      if (url.startsWith("/api/season-plans/mine/file")) return json({ ...MINE, filed: { version: 1, filedOn: "2027-02-15" } });
      if (url.startsWith("/api/season-plans/mine")) return method === "PUT" ? json({ ...MINE, plan: { version: 1, aim: "x", servesGoal: null, commitments: {}, handingBack: ["seat-gate"], savedOn: "2027-02-15" } }) : mine();
      if (url.startsWith("/api/season-plans")) return village();
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("who reads the village's season", () => {
  it("a visitor gets the sign-in doors on both pages, and nothing is fetched", () => {
    signedIn = null;
    render(<SeasonPlans />);
    expect(screen.getByText("Members read the village's season plans.")).toBeTruthy();
    cleanup();
    render(<MySeason />);
    expect(screen.getByText("Sign in to plan your season.")).toBeTruthy();
    expect(asked).toEqual([]);
  });

  it("a guest answered 401 reads the members line and no plan", async () => {
    signedIn = { id: "u-guest" };
    village = () => json({ error: "auth_required", message: "Members read the village's season plans." }, 401);
    render(<SeasonPlans />);
    expect(await screen.findByText("Members read the village's season plans.")).toBeTruthy();
    expect(screen.queryByText("Ana Quillfeather")).toBeNull();
  });
});

describe("the village page", () => {
  it("draws every card in the server's order, the count, and who has not filed, by name", async () => {
    render(<SeasonPlans />);
    expect(await screen.findByText("2 of 3 have filed")).toBeTruthy();
    const names = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(["Ana Quillfeather", "Mo Brindlecap", "Zed Lanternwick"]);
    const notFiled = screen.getByRole("heading", { name: "Not filed yet" }).parentElement!;
    expect(notFiled.textContent).toContain("Mo Brindlecap");
    expect(screen.getByRole("link", { name: "Host: The village is voting" }).getAttribute("href")).toBe("/seat-applications/sa-00000000000000a1");
    expect(screen.getByRole("img", { name: "2 of 4 quests done this moon" })).toBeTruthy();
    expect(screen.getByText("Kitchen keeper")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Recorded here|XTS/);
  });

  it("filters to the members waiting on the village", async () => {
    render(<SeasonPlans />);
    await screen.findByText("2 of 3 have filed");
    fireEvent.click(screen.getByRole("button", { name: "Waiting on the village" }));
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Ana Quillfeather"]);
  });
});

describe("your own season", () => {
  it("opens the member door on a held seat for this season, hands a seat back, and files", async () => {
    render(<MySeason />);
    const carry = await screen.findAllByRole("link", { name: "Carry on" });
    expect(carry[0].getAttribute("href")).toBe("/propose?type=role_application&seat=seat-host&renew=seat-host&season=s-next");
    expect(screen.getByRole("link", { name: "Apply for a seat" }).getAttribute("href")).toBe("/propose?type=role_application&season=s-next");
    expect(screen.getByText("Open until 31 March 2027.")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Hand it back" })[1]);
    expect(screen.getByText("You hand this seat back when the season turns.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your aim"), { target: { value: "The gate opens on time every market day." } });
    fireEvent.click(screen.getByRole("button", { name: "File my season" }));
    await waitFor(() => expect(asked.some((a) => a.url === "/api/season-plans/mine/file")).toBe(true));
    const put = asked.find((a) => a.method === "PUT")!;
    expect(JSON.parse(put.body!)).toMatchObject({ aim: "The gate opens on time every market day.", handingBack: ["seat-gate"] });
    expect(await screen.findByText("Filed. The village can read your season.")).toBeTruthy();
  });

  it("says so when there is no season to plan yet", async () => {
    mine = () => json({ season: null, window: null, plan: null, filed: null, heldSeats: [], applications: [], questsThisMoon: { done: 0 } });
    render(<MySeason />);
    expect(await screen.findByText("There is no season to plan yet.")).toBeTruthy();
  });
});

describe("the profile section", () => {
  it("draws another member's filed plan, and nothing at all on a 401", async () => {
    render(<SeasonPlanSection handle="ana" />);
    expect(await screen.findByText("The north orchard is planted.")).toBeTruthy();
    cleanup();
    village = () => json({ error: "auth_required" }, 401);
    const { container } = render(<SeasonPlanSection handle="ana" />);
    await waitFor(() => expect(asked.filter((a) => a.url.includes("handle=ana")).length).toBe(2));
    expect(container.textContent).toBe("");
  });

  it("on your own profile, says where your season stands and opens it", async () => {
    render(<SeasonPlanSection />);
    expect(await screen.findByText(/Not filed yet\. Planning is open until 31 March 2027\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Plan your season" }).getAttribute("href")).toBe("/season-plans/mine");
  });
});

describe("the banner", () => {
  const base = { current: { id: "s-now", name: "Season Now", theme: "", focus: "", startsOn: "2026-12-01", endsOn: "2027-03-01", goals: [] }, upcoming: null, needsNextSeason: false, daysLeft: 14, daysUntilStart: 0, timezone: "UTC", cadence: "custom", today: "2027-02-15" };

  it("says Plan your season to a member while the window is open", () => {
    season = { ...base, planWindow: VILLAGE.window };
    render(<SeasonBanner />);
    expect(screen.getByRole("link", { name: "Plan your season" }).getAttribute("href")).toBe("/season-plans/mine");
    expect(document.body.textContent).toContain("Open until 31 March 2027.");
  });

  it("CONTROL: says nothing of it to a visitor, or once the window has closed", () => {
    signedIn = null;
    season = { ...base, planWindow: VILLAGE.window };
    render(<SeasonBanner />);
    expect(screen.queryByRole("link", { name: "Plan your season" })).toBeNull();
    cleanup();
    signedIn = { id: "u-ana" };
    season = { ...base, planWindow: { ...VILLAGE.window, state: "closed" } };
    render(<SeasonBanner />);
    expect(screen.queryByRole("link", { name: "Plan your season" })).toBeNull();
  });
});
