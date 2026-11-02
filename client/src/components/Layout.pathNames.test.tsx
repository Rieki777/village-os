// @vitest-environment jsdom
/**
 * One set of path names in the shell: the menu and the footer say the
 * village's path names (Admin, Paths & Stages), wherever the village has not
 * written its own menu name for that page.
 *
 * The config is what the server would serve: `siteWords` itself
 * (server/lib/pageMeta.ts) builds the menu from a fake village's stored words,
 * and the real config cache (lib/gameApi.ts) carries it to the shell, so the
 * last case can prove a rename reaches a menu that is already open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { resolveVillagePathWords, servedPaths } from "@shared/villagePaths";
import { pageVarsFrom } from "@shared/pageContent/vars";
import { siteWords } from "../../../server/lib/pageMeta";
import { refreshGameConfig } from "@/lib/gameApi";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false, logout: vi.fn() }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ modules: [], loaded: true, failed: false }),
}));
vi.mock("@/components/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/NotificationToasts", () => ({ default: () => null }));
vi.mock("@/components/mobile/MobileTabBar", () => ({ default: () => null, isBareRoute: () => false }));
vi.mock("@/components/mobile/MobileFab", () => ({ default: () => null }));
vi.mock("@/components/NextStepTrail", () => ({ default: () => null }));

import Layout from "@/components/Layout";

const project = { name: "Willowbrook", tagline: "", location: "", memberName: "", adminPath: "/admin", commitmentName: "Pact" };
/** The fake village: what it saved in Paths & Stages, on its Whole site page, and which pages it switched off. */
let pathWords: Record<string, unknown>;
let sitePage: unknown;
let hidden: string[];

/** /api/game/config as the server answers it from those. */
function served() {
  const paths = servedPaths(resolveVillagePathWords(pathWords), pageVarsFrom({ project }));
  return {
    project,
    images: {},
    paths,
    brochurePages: true,
    brochureHidden: hidden,
    site: siteWords(sitePage ? { "page-site": sitePage } : null, { project }, paths),
  };
}

beforeEach(async () => {
  pathWords = {};
  sitePage = null;
  hidden = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url) === "/api/game/config") return new Response(JSON.stringify(served()), { status: 200 });
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The shell with the Join dropdown open, after the config has answered. */
async function openJoin() {
  await refreshGameConfig();
  render(
    <Router>
      <Layout>
        <p>page body</p>
      </Layout>
    </Router>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /^Join/ }));
}
const menuEntry = (href: string) => document.querySelector(`#nav-menu-join a[href="${href}"]`)?.textContent ?? null;
const footerEntry = (href: string) => document.querySelector(`footer a[href="${href}"]`)?.textContent?.trim() ?? null;

describe("path names in the menu and the footer", () => {
  it("the platform's names while nothing was renamed, the control for the cases below", async () => {
    await openJoin();
    expect(menuEntry("/steward")).toBe("Village StewardCo-Creator");
    expect(footerEntry("/steward")).toBe("Village Steward");
  });

  it("a rename reaches the menu, its second line, and the footer, when nothing was saved there", async () => {
    pathWords = { paths: { steward: { label: "Keeper", role: "Tends the land" } } };
    await openJoin();
    expect(menuEntry("/steward")).toBe("KeeperTends the land");
    expect(footerEntry("/steward")).toBe("Keeper");
    expect(menuEntry("/resident"), "a path it did not rename").toBe("ResidentCo-Creator");
  });

  it("CONTROL: a menu name the village saved stays after a rename, in the menu and the footer", async () => {
    pathWords = { paths: { steward: { label: "Keeper" } } };
    sitePage = { menu: { pages: [{ id: "/steward", label: "Stewards", subtitle: "Our circle" }] } };
    await openJoin();
    expect(menuEntry("/steward")).toBe("StewardsOur circle");
    expect(footerEntry("/steward")).toBe("Stewards");
  });

  it("a path whose page is switched off stays out of the menu and the footer, renamed or not", async () => {
    pathWords = { paths: { investor: { label: "Backer" } } };
    hidden = ["/investor"];
    await openJoin();
    expect(menuEntry("/investor")).toBeNull();
    expect(footerEntry("/investor")).toBeNull();
    expect(document.body.textContent).not.toContain("Backer");
    expect(menuEntry("/steward")).toBe("Village StewardCo-Creator");
  });

  it("a rename made while the menu is open reaches it once the config is read again, as Paths & Stages does on save", async () => {
    await openJoin();
    expect(menuEntry("/prosperity")).toBe("Prosperity CreatorBusiness Builder");
    pathWords = { paths: { "prosperity-creator": { label: "Maker" } } };
    await act(async () => {
      await refreshGameConfig();
    });
    expect(menuEntry("/prosperity"), "the dropdown never closed").toBe("MakerBusiness Builder");
    expect(footerEntry("/prosperity")).toBe("Maker");
  });
});
