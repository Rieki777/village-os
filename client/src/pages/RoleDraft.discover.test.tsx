// @vitest-environment jsdom
/**
 * THE BOARD'S FIRST STEP: R-Ikigai beside the characters, with the optional
 * Human Design or Gene Keys step (role journey, lane L3).
 *
 *   - the board works with every optional step skipped
 *   - answers survive a reload and are capped
 *   - the guide is called only on the press
 *   - Human Design and Gene Keys never reach an application body or any request
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IKIGAI_ANSWER_MAX, IKIGAI_KEY } from "@shared/roleDiscover";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Hollow Oak" }));
vi.mock("@/components/power/SeatTradingCard", () => ({ default: () => <article /> }));
vi.mock("@/hooks/usePageContent", () => ({ usePageContent: () => null }));
vi.mock("@/components/geneKeys/useMyGeneKeys", () => ({ useMyGeneKeys: () => ({ on: false, mine: null }) }));
const auth = vi.hoisted(() => ({ user: null as null | { name: string; email: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: auth.user }) }));
const seasonRef = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/gameApi", async (orig) => ({ ...(await orig<typeof import("@/lib/gameApi")>()), useSeason: () => seasonRef.value }));

import RoleDraft from "./RoleDraft";

const CAST = [
  { key: "building", name: "The Builder", subtitle: "Building" },
  { key: "catalyzing", name: "The Catalyst", subtitle: "Catalyzing" },
];
const ORG = {
  people: { visible: true },
  circles: [{ id: "land", name: "Land Circle" }],
  roles: [
    { id: "garden", name: "Gardener", circleId: "land", seats: 1, holderCount: 0, state: "open", archetypes: ["building"] },
    { id: "host", name: "Welcome Host", circleId: "land", seats: 1, holderCount: 0, state: "open", archetypes: ["catalyzing"] },
  ],
};
const GUIDE = "/api/governance/role-discover/guide";

let calls: Array<{ url: string; method: string; body: string }> = [];

function serve(opts: { mapping?: unknown } = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? "GET", body: String(init?.body ?? "") });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
      if (u.includes("/api/archetypes")) return json(CAST);
      if (u.includes("/api/org")) return json(ORG);
      if (u.includes("/api/open-proposals/form")) return json({ open: true, roles: ORG.roles.map((r) => ({ id: r.id, name: r.name })) });
      if (u.includes("/role-discover/mapping")) return json({ mapping: opts.mapping ?? null });
      if (u === GUIDE) return json({ guide: { id: "village", name: "the village guide" }, suggestions: [{ roleId: "garden", why: "You love soil." }, { roleId: "ghost", why: "no" }] });
      if (u.includes("/api/season")) return json({ current: null, upcoming: null, seasons: [] });
      return json([]);
    }),
  );
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => {
  cleanup();
  auth.user = null;
  vi.unstubAllGlobals();
});

describe("with every optional step skipped", () => {
  it("shows both doors and still drafts a role and links to apply", async () => {
    serve();
    render(<RoleDraft />);
    expect(await screen.findByRole("heading", { level: 2, name: "Your R-Ikigai" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Who do you play? Pick one or more." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add your Human Design or Gene Keys" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Draft Gardener" }));
    const apply = await screen.findAllByRole("link", { name: /apply/i });
    expect(apply.length).toBeGreaterThan(0);
    // Nothing optional was opened, so nothing but the board's own reads happened.
    expect(calls.some((c) => c.url.includes("role-discover"))).toBe(false);
  });
});

describe("the R-Ikigai answers", () => {
  it("survive a reload", async () => {
    serve();
    const first = render(<RoleDraft />);
    fireEvent.change(await screen.findByLabelText(/What I love/), { target: { value: "growing food" } });
    first.unmount();
    render(<RoleDraft />);
    expect(((await screen.findByLabelText(/What I love/)) as HTMLTextAreaElement).value).toBe("growing food");
  });

  it("are capped, on typing and when a stored value was edited by hand", async () => {
    localStorage.setItem(IKIGAI_KEY, JSON.stringify({ answers: { good: "z".repeat(5000), love: { bad: 1 } }, carry: true }));
    serve();
    render(<RoleDraft />);
    const good = (await screen.findByLabelText(/What I am good at/)) as HTMLTextAreaElement;
    expect(good.value).toHaveLength(IKIGAI_ANSWER_MAX);
    fireEvent.change(good, { target: { value: "q".repeat(900) } });
    expect(good.value).toHaveLength(IKIGAI_ANSWER_MAX);
    expect(((screen.getByLabelText(/What I love/)) as HTMLTextAreaElement).value).toBe("");
  });
});

describe("Ask the guide", () => {
  it("is not offered to a visitor, who is told to sign in", async () => {
    serve();
    render(<RoleDraft />);
    await screen.findByLabelText(/What I love/);
    expect(screen.queryByRole("button", { name: "Ask the guide" })).toBeNull();
    expect(screen.getByText("Sign in to ask the guide.")).toBeTruthy();
  });

  it("is called only on the press, with the answers and the role names and nothing else", async () => {
    auth.user = { name: "Rowan", email: "rowan@example.test" };
    serve();
    render(<RoleDraft />);
    fireEvent.change(await screen.findByLabelText(/What I love/), { target: { value: "growing food" } });
    await screen.findByRole("button", { name: "Draft Gardener" });
    // Typing, drafting and waiting sent nothing to the guide.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.url === GUIDE)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Ask the guide" }));
    expect(await screen.findByText(/You love soil/)).toBeTruthy();
    const sent = calls.filter((c) => c.url === GUIDE);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("POST");
    const body = JSON.parse(sent[0].body);
    expect(Object.keys(body).sort()).toEqual(["answers", "roles"]);
    expect(body.answers.love).toBe("growing food");
    expect(screen.getByText(/AI suggestion/)).toBeTruthy();
    // An id the board never sent is not shown as a role.
    expect(screen.queryByText("no")).toBeNull();
  });
});

describe("Human Design and Gene Keys", () => {
  it("with no mapping, explain themselves and suggest nothing; the chart is never sent", async () => {
    serve({ mapping: null });
    render(<RoleDraft />);
    fireEvent.click(await screen.findByRole("button", { name: "Add your Human Design or Gene Keys" }));
    fireEvent.change(await screen.findByLabelText("Birth date"), { target: { value: "1990-05-17" } });
    fireEvent.click(screen.getByRole("button", { name: "Work it out here" }));
    expect(await screen.findByText(/Your type is/)).toBeTruthy();
    expect(await screen.findByText(/has not yet said which characters/)).toBeTruthy();
    expect(screen.queryByText("Characters this village points you toward")).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.url.includes("/role-discover/mapping"))).toBe(true));
    // The only request the step made is the mapping read, and it carries nothing of the person.
    const mine = calls.filter((c) => c.url.includes("role-discover"));
    expect(mine.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/governance/role-discover/mapping"]);
    for (const c of calls) {
      expect(c.url).not.toContain("1990");
      expect(c.body).not.toContain("1990");
      expect(c.body.toLowerCase()).not.toMatch(/projector|generator|manifest|reflector/);
    }
  });

  it("with a mapping, suggest characters the person can add", async () => {
    serve({ mapping: { humanDesign: { Generator: ["building"], "Manifesting Generator": ["building"], Projector: ["catalyzing"], Manifestor: ["catalyzing"], Reflector: ["catalyzing"] } } });
    render(<RoleDraft />);
    fireEvent.click(await screen.findByRole("button", { name: "Add your Human Design or Gene Keys" }));
    fireEvent.change(await screen.findByLabelText("Birth date"), { target: { value: "1990-05-17" } });
    fireEvent.click(screen.getByRole("button", { name: "Work it out here" }));
    expect(await screen.findByText("Characters this village points you toward")).toBeTruthy();
  });
});
