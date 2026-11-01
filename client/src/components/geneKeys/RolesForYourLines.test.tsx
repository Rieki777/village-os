// @vitest-environment jsdom
/**
 * "ROLES THAT FIT YOUR LINES", on the last step of finding your lines.
 *
 * Rick, 2026-10-30: he found his lines, pressed "Next: see roles that fit you",
 * and it "really didn't do anything". The button went to the character select,
 * which reads no lines and leaves full seats out, and the seats that suit him
 * are the two he holds. The walk below is his: the whole page, form to save,
 * with him holding Builder and Architect.
 *
 *   - the last step names the roles he already holds that his lines fit,
 *     "Role (FirstName)", in one sentence;
 *   - it still offers the open roles, best fit first, each saying why;
 *   - the ranking: a circle gap beats a character tag, the member never fills
 *     their own gap, examples and full seats are not offered.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { viewOf, type GeneKeysView } from "@shared/geneKeys";
import { chartAt, zonedToUtc } from "@shared/geneKeysSky";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  // The page reads `?next=` (a session card's invitation sends members here and back).
  useSearch: () => "",
}));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "rick", name: "Rick Moss" } }) }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "gene-keys", lifecycle: "members" }] }),
  useModule: (id: string) => (id === "gene-keys" ? { id, lifecycle: "members" } : undefined),
  useModuleOn: (id: string) => id === "gene-keys",
}));
vi.mock("@/components/geneKeys/places", async (orig) => ({
  ...(await orig<typeof import("./places")>()),
  loadPlaces: async () => [{ name: "Boulder", key: "boulder", country: "US", zone: "America/Denver" }],
}));

const api = vi.hoisted(() => ({ people: {} as Record<string, unknown>, saved: 0 }));
vi.mock("@/lib/geneKeysApi", () => ({
  readPeopleGeneKeys: async () => api.people,
  readMyGeneKeys: async () => null,
  saveMyGeneKeys: async () => {
    api.saved += 1;
    return { mine: null, badgeEarned: null };
  },
  GeneKeysRefusal: class extends Error {},
}));
const loadOrg = vi.fn();
vi.mock("@/components/governance/pickSources", () => ({ loadOrg: () => loadOrg() }));

import GeneKeysPage from "@/pages/GeneKeys";
import { LINES_FIT_WORDS, rankForLines, whyLine } from "./RolesForYourLines";

const view = (zone: string, y: number, mo: number, d: number, h: number, mi: number): GeneKeysView =>
  viewOf(chartAt(zonedToUtc(y, mo, d, h, mi, zone)));
/** Two invented people in Rick's circles, with shown lines. */
const ANA = view("America/New_York", 1990, 6, 15, 14, 30);
const BO = view("Europe/London", 2001, 7, 10, 4, 2);

const holder = (userId: string, name: string) => ({ userId, name, kind: "member", lapsed: false });
const role = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  circleId: "c-build",
  seats: 1,
  state: "open",
  isExample: false,
  holders: [],
  archetypes: [],
  ...over,
});
/** Rick holds Builder and Architect; both are full, which is why the character page left them out. */
const ORG = {
  circles: [{ id: "c-build", name: "Build circle" }, { id: "c-hearth", name: "Hearth circle" }],
  roles: [
    role("builder", "Builder", { state: "filled", holders: [holder("rick", "Rick Moss")], archetypes: ["builder"] }),
    role("architect", "Architect", { state: "filled", holders: [holder("rick", "Rick Moss")] }),
    role("host", "Hearth host", { circleId: "c-hearth", holders: [], seats: 2, state: "partial" }),
    role("scribe", "Scribe", { circleId: "c-hearth", archetypes: ["builder"] }),
    role("warden", "Water warden", { state: "filled", holders: [holder("ana", "Ana Ruiz")] }),
    role("example", "Example seat", { isExample: true }),
  ],
};

beforeEach(() => {
  api.people = {};
  api.saved = 0;
  loadOrg.mockReset();
  loadOrg.mockResolvedValue(ORG);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url === "/api/me/characters"
          ? { party: [{ archetypeKey: "builder" }] }
          : url === "/api/archetypes"
            ? [{ key: "builder", name: "The Builder" }]
            : null,
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The flow as a member walks it, birth details to the saved step. */
async function walkToDone() {
  render(<GeneKeysPage />);
  fireEvent.change(screen.getByLabelText("Birth date"), { target: { value: "1984-03-02" } });
  fireEvent.change(screen.getByLabelText("Birth time"), { target: { value: "09:20" } });
  await waitFor(() => expect(screen.getByLabelText("Birth town or city")).toHaveProperty("placeholder", "Start typing, like Boulder"));
  fireEvent.change(screen.getByLabelText("Birth town or city"), { target: { value: "Boul" } });
  fireEvent.click(await screen.findByRole("button", { name: /Boulder/ }));
  fireEvent.click(screen.getByRole("button", { name: "Show my lines" }));
  // Near a change the page asks which window; either way the next screen has "Next".
  await waitFor(() => expect(screen.queryByRole("button", { name: "Reading the sky" })).toBeNull(), { timeout: 10_000 });
  const choose = screen.queryByRole("list");
  if (!screen.queryByRole("button", { name: "Next" }) && choose) fireEvent.click(within(choose).getAllByRole("button")[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Lines found");
}

describe("the last step of finding your lines", () => {
  it("names the roles Rick already holds and still offers the open ones", async () => {
    await walkToDone();
    expect(api.saved).toBe(1);
    expect(await screen.findByText(LINES_FIT_WORDS.held("Builder (Rick), Architect (Rick)"))).toBeTruthy();
    const open = screen.getByRole("list");
    const names = within(open)
      .getAllByRole("listitem")
      .map((li) => li.querySelector("span")?.textContent);
    expect(names).toEqual(["Scribe", "Hearth host"]);
    expect(within(open).getAllByRole("link", { name: LINES_FIT_WORDS.read })[0].getAttribute("href")).toBe("/roles?seat=scribe");
  }, 20_000);

  it("no longer ends in a button to the character page that reads no lines", async () => {
    await walkToDone();
    expect(screen.queryByText("Next: see roles that fit you")).toBeNull();
    expect(screen.getByRole("link", { name: LINES_FIT_WORDS.characters }).getAttribute("href")).toBe("/profile/characters");
  }, 20_000);
});

describe("rankForLines", () => {
  const mine = [2, 4];

  it("counts a gap only when nobody ELSE in the circle shows the line", () => {
    const a = rankForLines(ORG, "rick", mine, [], {});
    expect(a.held.map((f) => f.label)).toEqual(["Builder (Rick)", "Architect (Rick)"]);
    expect(a.held[0].gap).toBe(2);
    // Ana, in the Build circle, showing both of Rick's lines closes the gap.
    const both = { ...ANA, lines: [2, 4] as [number, number] };
    const b = rankForLines(ORG, "rick", mine, [], { ana: both });
    expect(b.held).toEqual([]);
  });

  it("ranks a circle gap over a character tag, and leaves out examples and full seats", () => {
    const a = rankForLines(ORG, "rick", mine, [{ key: "builder", name: "The Builder" }], { ana: BO });
    expect(a.open.map((f) => f.id)).toEqual(["scribe", "host"]);
    expect(a.open[0].score).toBe(3);
    expect(whyLine(a.open[0])).toBe(LINES_FIT_WORDS.both("Hearth circle", 2, "The Builder"));
    expect(whyLine(a.open[1])).toBe(LINES_FIT_WORDS.gap("Hearth circle", 2));
  });

  it("names a partly held role with its holders, and says why even when nothing fits", () => {
    const org = { circles: ORG.circles, roles: [role("host", "Hearth host", { circleId: "c-hearth", seats: 2, state: "partial", holders: [holder("bo", "Bo Lind")] })] };
    const a = rankForLines(org, "rick", mine, [], { bo: { ...BO, lines: [2, 4] as [number, number] } });
    expect(a.open[0].label).toBe("Hearth host (Bo)");
    expect(whyLine(a.open[0])).toBe(LINES_FIT_WORDS.openNow);
  });
});
