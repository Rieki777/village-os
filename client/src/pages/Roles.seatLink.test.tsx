// @vitest-environment jsdom
/**
 * /roles?seat=<id>: ONE SEAT'S CARD AS A LINK.
 *
 * The page kept its open row in local state alone, so no address opened one
 * seat and a steward recruiting for a seat had nothing to send. Four promises:
 *
 *   1. A LINK OPENS ITS SEAT. The row expands, its header is scrolled to
 *      (instantly, under reduced motion) and takes focus.
 *   2. A LINK TO A SEAT THE PAGE NO LONGER LISTS SAYS SO in one line, with the
 *      seats still listed below it. Never a blank.
 *   3. THE ADDRESS IS THE LINK TO WHAT IS OPEN. Opening and closing a row
 *      replaces the URL and adds no history entry.
 *   4. "Copy link to this seat" writes the absolute link inside the click. Where
 *      the clipboard refuses or is missing, a read-only field holds the link,
 *      selected.
 *
 * Every absence has a known-positive control beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

const session = vi.hoisted(() => ({ token: null as string | null, user: null as null | { id: string; role?: string } }));
const catalog = vi.hoisted(() => ({ modules: [] as Array<{ id: string; name: string; lifecycle: string }> }));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/SeatClaimCard", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, token: session.token, loading: false }),
  useIsAdmin: () => session.user?.role === "admin" || session.user?.role === "founder",
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => session.token,
}));
// The catalog by its real rule: a module is on when the viewer's manifest
// lists it with a lifecycle past off.
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: (id: string) => catalog.modules.find((m) => m.id === id),
  useModuleOn: (id: string) => catalog.modules.some((m) => m.id === id && m.lifecycle !== "off"),
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import Roles from "./Roles";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const seat = (id: string, name: string, state: string) => ({
  id,
  name,
  circleId: "land",
  aim: `Keep the ${name.toLowerCase()} work going.`,
  domain: null,
  accountabilities: [],
  whyItMatters: null,
  seats: 1,
  holderCount: state === "open" ? 0 : 1,
  state,
  stateSource: "derived",
  criticality: "normal",
  recruiting: state === "open",
  representsCircle: false,
  howChosen: null,
  howChosenGloss: null,
  termEnds: "2027-02-01T12:00:00.000Z",
  archetypes: [],
  isExample: false,
  holders: [],
});

/** `/api/org` at the member tier, in the shape the seat projection serves. */
const ORG = {
  people: { visible: true, membersOnly: false, signedIn: true },
  village: { decidesBy: "consent" },
  circles: [{ id: "land", name: "Land & Water", purpose: "The ground and its water", decidesBy: null, color: "sage", status: "active" }],
  roles: [seat("water-keeper", "Water Keeper", "filled"), seat("seed-keeper", "Seed Keeper", "open")],
};

const MISSING = "That seat is not on this page anymore.";
const COPY = "Copy link to this seat";
const FIELD = "Link to this seat";

let scrolled: ReturnType<typeof vi.fn>;
const hadScroll = Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "scrollIntoView");
const ownScroll = HTMLElement.prototype.scrollIntoView;

/** Gives jsdom a clipboard, or takes it away (`undefined`), as an http origin has none. */
function setClipboard(clip: { writeText: (s: string) => Promise<void> } | undefined) {
  Object.defineProperty(window.navigator, "clipboard", { value: clip, configurable: true, writable: true });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/roles");
  session.token = "a-token";
  session.user = { id: "u-me" };
  catalog.modules = [];
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  // jsdom lays nothing out, so it has no scrollIntoView; the spy records the call.
  scrolled = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scrolled, configurable: true, writable: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
      if (u === "/api/org") return reply(ORG);
      if (u === "/api/season") return reply({ current: { name: "Season of Foundations", endsOn: "2099-03-21" }, daysLeft: 171 });
      if (u.endsWith("/needs")) return reply({ needs: [] });
      return reply([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window.navigator as unknown as { clipboard?: unknown }).clipboard;
  if (hadScroll) HTMLElement.prototype.scrollIntoView = ownScroll;
  else delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  window.history.replaceState(null, "", "/");
});

function renderRoles() {
  return render(
    <Router>
      <Roles />
    </Router>,
  );
}

const header = async (name: string) => (await screen.findByRole("heading", { level: 3, name })).closest("button")!;
const card = () => document.querySelector("article[data-power-card]") as HTMLElement | null;

describe("a link to one seat on /roles", () => {
  it("opens that seat, scrolls its header into view without smooth motion, and gives the header focus", async () => {
    window.history.replaceState(null, "", "/roles?seat=seed-keeper");
    renderRoles();
    const seed = await header("Seed Keeper");
    expect(seed.getAttribute("aria-expanded")).toBe("true");
    // Known positive for the closed state: the neighbour stays shut.
    expect((await header("Water Keeper")).getAttribute("aria-expanded")).toBe("false");
    expect(card()?.getAttribute("aria-labelledby")).toBe(seed.id);

    await waitFor(() => expect(document.activeElement).toBe(seed));
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(seed);
    expect(scrolled).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    // The address still names the open seat. The miss line is absent; the
    // next test is its known positive.
    expect(window.location.search).toBe("?seat=seed-keeper");
    expect(screen.queryByText(MISSING)).toBeNull();
  });

  it("says a seat the page no longer lists is gone, in one line, with every seat still listed", async () => {
    window.history.replaceState(null, "", "/roles?seat=old-seat");
    renderRoles();
    const line = await screen.findByText(MISSING);
    // In the page's polite region, which is there from the first paint.
    expect(line.closest('[role="status"]')).toBeTruthy();
    // Never a blank: both seats are listed, both shut, no card drawn, nothing scrolled to.
    const water = await header("Water Keeper");
    const seed = await header("Seed Keeper");
    expect([water, seed].map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "false"]);
    expect(card()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
    // The address drops the seat it could not open, so the bar names what is open.
    expect(window.location.pathname).toBe("/roles");
    expect(window.location.search).toBe("");

    // Known positive for every absence above: opening a row draws its card,
    // writes its seat, and the line goes.
    fireEvent.click(seed);
    expect(seed.getAttribute("aria-expanded")).toBe("true");
    expect(card()).toBeTruthy();
    expect(window.location.search).toBe("?seat=seed-keeper");
    expect(screen.queryByText(MISSING)).toBeNull();
  });

  it("keeps the open seat in the address, replacing the entry and never pushing one", async () => {
    window.history.replaceState(null, "", "/roles?from=newsletter");
    renderRoles();
    const seed = await header("Seed Keeper");
    const water = await header("Water Keeper");
    const entries = window.history.length;

    fireEvent.click(seed);
    expect(window.location.search).toBe("?from=newsletter&seat=seed-keeper");
    fireEvent.click(water);
    expect(window.location.search).toBe("?from=newsletter&seat=water-keeper");
    expect(water.getAttribute("aria-expanded")).toBe("true");
    // Closing the open row takes the seat out; the two writes above are its positive.
    fireEvent.click(water);
    expect(water.getAttribute("aria-expanded")).toBe("false");
    expect(window.location.search).toBe("?from=newsletter");
    expect(window.location.pathname).toBe("/roles");
    // Back is not polluted: three writes, no new entry.
    expect(window.history.length).toBe(entries);
    // Known positive for the instrument: a push does add an entry here.
    window.history.pushState(null, "", "/roles");
    expect(window.history.length).toBe(entries + 1);
  });
});

describe("copying a seat's link", () => {
  it("writes the absolute link inside the click, says so politely, and the link opens that seat", async () => {
    const writeText = vi.fn(async (_s: string) => undefined);
    setClipboard({ writeText });
    const view = renderRoles();
    fireEvent.click(await header("Seed Keeper"));
    const control = await screen.findByRole("button", { name: COPY });
    // Below the card, outside it.
    expect(card()).toBeTruthy();
    expect(card()!.contains(control)).toBe(false);

    fireEvent.click(control);
    // Called before any await: the write ran inside the click handler.
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toBe(`${window.location.origin}/roles?seat=seed-keeper`);
    expect(new URL(copied).origin).toBe(window.location.origin);

    const said = await screen.findByText("Link copied.");
    expect(said.closest('[role="status"]')).toBeTruthy();
    // No fallback field after a copy that worked; the next test is its positive.
    expect(screen.queryByRole("textbox", { name: FIELD })).toBeNull();

    // The link it copied opens that seat.
    view.unmount();
    const { pathname, search } = new URL(copied);
    window.history.replaceState(null, "", `${pathname}${search}`);
    renderRoles();
    expect((await header("Seed Keeper")).getAttribute("aria-expanded")).toBe("true");
  });

  it("selects the link in a read-only field when the clipboard refuses", async () => {
    const writeText = vi.fn(async (_s: string) => {
      throw new DOMException("Write permission denied.", "NotAllowedError");
    });
    setClipboard({ writeText });
    renderRoles();
    fireEvent.click(await header("Water Keeper"));
    const control = await screen.findByRole("button", { name: COPY });
    // No field before a copy is tried; the field below is its positive.
    expect(screen.queryByRole("textbox", { name: FIELD })).toBeNull();

    fireEvent.click(control);
    expect(writeText).toHaveBeenCalledTimes(1);
    const field = (await screen.findByRole("textbox", { name: FIELD })) as HTMLInputElement;
    const link = `${window.location.origin}/roles?seat=water-keeper`;
    expect(field.value).toBe(link);
    expect(field.readOnly).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, link.length]);
    expect(screen.getByText(/Copying did not work here/).closest('[role="status"]')).toBeTruthy();
    // It does not claim a copy; the test above is the positive for this line.
    expect(screen.queryByText("Link copied.")).toBeNull();
  });

  it("selects the link in the field when the browser has no clipboard at all", async () => {
    setClipboard(undefined);
    renderRoles();
    fireEvent.click(await header("Seed Keeper"));
    // Known positive: the control is there to press.
    fireEvent.click(await screen.findByRole("button", { name: COPY }));
    const field = (await screen.findByRole("textbox", { name: FIELD })) as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/roles?seat=seed-keeper`);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
  });
});
