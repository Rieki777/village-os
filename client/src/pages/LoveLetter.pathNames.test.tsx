// @vitest-environment jsdom
/**
 * One set of path names in the membership letter's form: each path choice
 * carries the village's path name (Admin, Paths & Stages) wherever the village
 * has not written its own words for that choice (Admin, Pages, Membership
 * letter). A choice is what a signing records by id, so its words never reach
 * the letter's fingerprint (server/lib/pathNames.test.ts pins that).
 *
 * Mocked the way LoveLetter.content.test.tsx mocks the page. Every name is made up.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LETTER_PAGE_SECTION, letterSourceFrom, renderMembershipLetter } from "@shared/membershipLetter";
import { resolveVillagePathWords, servedPaths } from "@shared/villagePaths";
import { pageVarsFrom } from "@shared/pageContent/vars";

let config: Record<string, any>;
let storedPage: unknown;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useVillageContent", () => ({
  useVillageContent: (section: string) => ({
    content: section === LETTER_PAGE_SECTION ? storedPage : null,
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

const project = { name: "Fernhollow", commitmentName: "Pact" };
const withPaths = (doc: unknown) => {
  config = { ...config, paths: servedPaths(resolveVillagePathWords(doc), pageVarsFrom({ project })) };
};

beforeEach(() => {
  config = { project, currency: { name: "Seeds" }, brochurePages: true, brochureHidden: [] };
  storedPage = null;
  withPaths(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/membership-letter") {
        const letter = { ...renderMembershipLetter(letterSourceFrom(config, { [LETTER_PAGE_SECTION]: storedPage })), version: "lv-1111111111111111" };
        return new Response(JSON.stringify(letter), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The four choices' words, in the order drawn. */
async function choices() {
  render(<LoveLetter />);
  await screen.findByText(/Which path\(s\) are you on\?/);
  const label = screen.getByText(/Which path\(s\) are you on\?/).closest("div")!;
  return Array.from(label.querySelectorAll("button")).map((b) => b.textContent?.trim());
}

describe("the letter's path choices", () => {
  it("are the platform's words while nothing was renamed, the control for the cases below", async () => {
    expect(await choices()).toEqual([
      "Investor / Capital Contributor",
      "Village Steward / Co-Creator",
      "Resident / Future Villager",
      "Prosperity Creator / Business Builder",
    ]);
  });

  it("follow a rename where the village wrote no words for that choice", async () => {
    withPaths({ paths: { investor: { label: "Backer", role: "Seed Partner" }, resident: { label: "Neighbour" } } });
    const drawn = await choices();
    expect(drawn[0]).toBe("Backer / Seed Partner");
    expect(drawn[2], "the choice keeps its own second line").toBe("Neighbour / Future Villager");
  });

  it("CONTROL: keep the words the village saved for a choice, and the rename reaches the rest", async () => {
    withPaths({ paths: { investor: { label: "Backer" }, steward: { label: "Keeper" } } });
    storedPage = { form: { paths: [{ id: "investor", label: "Funding the land" }] } };
    const drawn = await choices();
    expect(drawn[0]).toBe("Funding the land");
    expect(drawn[1]).toBe("Keeper / Co-Creator");
  });

  it("still offers a path whose journey page is switched off, under its new name: a choice is a way in, not a link", async () => {
    withPaths({ paths: { investor: { label: "Backer" } } });
    config.brochureHidden = ["/investor"];
    expect((await choices())[0]).toBe("Backer / Capital Contributor");
  });
});
