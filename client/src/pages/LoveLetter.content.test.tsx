// @vitest-environment jsdom
/**
 * THE MEMBERSHIP LETTER PAGE'S WORDS ARE THE VILLAGE'S (2026-10-22).
 *
 * The page's words and the letter's own words moved into Admin, Pages,
 * Membership letter (shared/pageContent/loveLetter.ts). The letter's are read
 * by the server too (shared/membershipLetter.ts), so what is pinned here:
 *
 *   - every field and list row reaches the page, the letter's through the
 *     server's copy AND through the page's own rendering while that copy is on
 *     its way;
 *   - a contribution level's amount is what a signing records, its label is
 *     what the signer reads;
 *   - `{commitment}` is what the page says where it said "Love Letter", so a
 *     village that calls it that reads that name;
 *   - with nothing written, the page is the neutral starter letter
 *     (2026-10-23), read here from the spec's defaults: no prices, no levels,
 *     no other village's words;
 *   - the `{words}` the server fills the letter with are the page's own,
 *     word for word (`pageVarsFrom` against `usePageVars`).
 *
 * Every name is made up.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LETTER_PAGE_SECTION, letterSourceFrom, renderMembershipLetter } from "@shared/membershipLetter";
import { LOVE_LETTER_PAGE } from "@shared/pageContent/loveLetter";
import { fillVars, markerDocument } from "@shared/pageContent/resolve";
import { pageVarsFrom } from "@shared/pageContent/vars";

let config: Record<string, any>;
let storedPage: unknown;
let legal: unknown;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useVillageContent", () => ({
  useVillageContent: (section: string) => ({
    content: section === LETTER_PAGE_SECTION ? storedPage : section === "legal" ? legal : null,
    loading: false,
    isPlaceholder: false,
  }),
  readVillageSection: () => Promise.resolve(null),
}));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => null,
  gameFetch: (path: string, init?: RequestInit) => fetch(path, init),
  useGameConfig: () => config,
  useVillageLinks: () => ({ contactEmail: "" }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => undefined }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import LoveLetter from "./LoveLetter";
import { usePageVars } from "@/hooks/usePageContent";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let posts: Array<Record<string, any>> = [];
/** What the server would serve: the same rendering, from the same config and content. */
let served: () => unknown;

beforeEach(() => {
  config = { project: { name: "Fernhollow", commitmentName: "Love Letter" }, currency: { name: "Seeds" } };
  storedPage = null;
  legal = { membership: { entityLabel: "Fernhollow Commons" } };
  posts = [];
  served = () => ({ ...renderMembershipLetter(letterSourceFrom(config, { legal, [LETTER_PAGE_SECTION]: storedPage })), version: "lv-1111111111111111" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/membership-letter") return json(served());
      if (url === "/api/forms/submit") {
        posts.push(JSON.parse(String(init?.body ?? "{}")));
        return json({ success: true, id: "1760000000000-abcde" });
      }
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Doc = Record<string, Record<string, any>>;

/** Every marker in a document, by where it sits, leaving out the ones a check below handles on its own. */
function markersOf(doc: Doc, skip: (sectionId: string, key: string) => boolean): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [sectionId, section] of Object.entries(doc)) {
    for (const [key, value] of Object.entries(section)) {
      if (skip(sectionId, key)) continue;
      if (Array.isArray(value)) {
        for (const row of value) for (const [k, v] of Object.entries(row as Record<string, string>)) if (k !== "id") out.push([`${sectionId}.${key}.${k}`, v]);
      } else out.push([`${sectionId}.${key}`, value as string]);
    }
  }
  return out;
}

const missingFrom = (text: string, markers: Array<[string, string]>) => markers.filter(([, v]) => !text.includes(v)).map(([where, v]) => `${where} (${v})`);

/** A field's default as the spec holds it, filled with this file's village. The words are the spec's to choose. */
const starter = (sectionId: string, key: string, commitment = "Love Letter") =>
  fillVars(LOVE_LETTER_PAGE.sections.find((s) => s.id === sectionId)!.fields.find((f) => f.key === key)!.default, {
    village: "Fernhollow",
    commitment,
    entity: "Fernhollow Commons",
    member: "member",
  });
const starterList = (sectionId: string, key: string) =>
  LOVE_LETTER_PAGE.sections.find((s) => s.id === sectionId)!.lists!.find((l) => l.key === key)!.default;

describe("every field in the Membership letter spec reaches the page", () => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    const doc = markerDocument(LOVE_LETTER_PAGE) as Doc;
    storedPage = doc;
    render(<LoveLetter />);
    await screen.findByText(doc.letter.greeting);

    // The thank-you's quote shows after signing, a level's amount is an
    // option's value rather than text, and the custom box's hint is its
    // placeholder: each is checked on its own.
    const markers = markersOf(
      doc,
      (s, k) => s === "thanks" || (s === "contribution" && (k === "tiers" || k === "customPlaceholder")),
    );
    expect(missingFrom(document.body.textContent ?? "", markers)).toEqual([]);
    const options = Array.from(document.querySelectorAll("#letter-contribution option")).map((o) => [o.getAttribute("value"), o.textContent]);
    for (const tier of doc.contribution.tiers) expect(options).toContainEqual([tier.value, tier.label]);
    await userEvent.setup().selectOptions(screen.getByLabelText(doc.contribution.heading), "custom");
    expect(screen.getByLabelText("Your custom monthly contribution")).toHaveAttribute("placeholder", doc.contribution.customPlaceholder);
  });

  it("draws the letter's own words from the page's rendering too, before the server's copy lands", async () => {
    const doc = markerDocument(LOVE_LETTER_PAGE) as Doc;
    storedPage = doc;
    served = () => new Promise(() => {}); // the server never answers
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<LoveLetter />);

    const letterMarkers = markersOf({ letter: doc.letter }, () => false);
    expect(missingFrom(document.body.textContent ?? "", letterMarkers)).toEqual([]);
  });

  it("records the level's amount, and shows the thank-you's quote after signing", async () => {
    const doc = markerDocument(LOVE_LETTER_PAGE) as Doc;
    storedPage = doc;
    render(<LoveLetter />);
    await screen.findByText(doc.letter.greeting);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Full Name/), "Juno Reed");
    await user.type(screen.getByLabelText(/Email Address/), "juno@example.test");
    await user.click(screen.getByRole("button", { name: doc.form.paths[1].label }));
    await user.selectOptions(screen.getByLabelText(doc.contribution.heading), doc.contribution.tiers[1].value);
    await user.type(screen.getByLabelText(/What called you to/), "The grove.");
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: doc.form.submitLabel }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].data).toMatchObject({ paths: ["steward"], monthlyContribution: doc.contribution.tiers[1].value });
    expect(await screen.findByText(`"${doc.thanks.quote}"`)).toBeInTheDocument();
  });
});

describe("the page with no words of its own", () => {
  it("reads as the starter letter, in the village's own names, with no prices and no levels", async () => {
    render(<LoveLetter />);
    await screen.findByText(starter("letter", "greeting"));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The Fernhollow Love Letter");
    expect(screen.getByText(/Our founding covenant, and your official membership in Fernhollow Commons\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: starter("form", "visitorHeading") })).toBeInTheDocument();
    expect(screen.getByText(starter("form", "visitorLede"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: starter("form", "submitLabel") })).toBeInTheDocument();
    expect(screen.getByText(/I have read the Love Letter above and commit to the values and agreements of the Fernhollow community as a member of Fernhollow Commons\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Good Neighbor Criteria" })).toHaveAttribute("href", "/good-neighbor");
    // A price is one village's to set: no suggested line and no levels until
    // the village writes them, and the signer can still describe an amount.
    expect(starterList("contribution", "tiers")).toEqual([]);
    expect(screen.queryByText(/Suggested:/)).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\$/);
    const options = Array.from(document.querySelectorAll("#letter-contribution option")).map((o) => [o.getAttribute("value"), o.textContent]);
    expect(options).toEqual([
      ["", "Select contribution level"],
      ["custom", starter("contribution", "customLabel")],
    ]);
    for (const label of ["Investor / Capital Contributor", "Village Steward / Co-Creator", "Resident / Future Villager", "Prosperity Creator / Business Builder"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("says the village's own name for the letter where it said Love Letter", async () => {
    config = { project: { name: "Fernhollow", commitmentName: "Covenant" }, currency: { name: "Seeds" } };
    render(<LoveLetter />);
    await screen.findByText(/By signing this Covenant, you/);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The Fernhollow Covenant");
    expect(screen.getByRole("button", { name: starter("form", "submitLabel", "Covenant") })).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("Love Letter");
  });

  it("leaves out the suggested line when the village blanks it and has no short note", async () => {
    storedPage = { contribution: { suggested: "" } };
    render(<LoveLetter />);
    await screen.findByText(starter("letter", "greeting"));

    expect(screen.queryByText(/Suggested:/)).toBeNull();
  });

  it("with no commitments, draws neither the list nor the line leading into it", async () => {
    storedPage = { letter: { commitments: [] } };
    render(<LoveLetter />);
    await screen.findByText(starter("letter", "greeting"));

    expect(screen.queryByText("As a member of Fernhollow Commons, you commit to:")).toBeNull();
  });
});

describe("the letter's {words} are the page's {words}", () => {
  it.each([
    { project: { name: "Fernhollow", commitmentName: "Love Letter", tagline: "Roots", location: "the hills", memberName: "Fernling" }, currency: { name: "Seeds", value: { name: "Acorns" } } },
    { project: { name: "  Willowbrook ", roleName: "post", catalystName: "keeper" }, currency: { name: "" } },
    { project: {}, currency: {} },
  ])("agree for %j", (cfg) => {
    config = cfg;
    const { result } = renderHook(() => usePageVars());
    expect(result.current).toEqual(pageVarsFrom(cfg));
  });
});
