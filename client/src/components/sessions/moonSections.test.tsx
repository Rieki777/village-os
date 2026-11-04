// @vitest-environment jsdom
/**
 * The End of moon sections in a templated room, and their kinds in the
 * template editor (spec section 9, addendum A4).
 *
 *   - While the moon-review module is off the editor offers none of the three
 *     kinds, and the room asks nothing of the module's door.
 *   - On, Our moons draws the stick's own controls and the holder's choice;
 *     their recap shows only after Show my moon.
 *   - Nothing on the screen is a number about a person's moon, even when the
 *     door's answer carries the score, a reading and amounts.
 *   - Sending together shows this viewer's own row with Send mine, and the
 *     room a count of people.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { MOON_TEMPLATE, SECTION_KIND_DEFS, type SessionTemplate, type TemplateRoomView, type TemplatesPayload } from "@shared/sessionTemplates";

const modules = vi.hoisted(() => ({ on: true }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, failed: false, modules: modules.on ? [{ id: "moon-review", lifecycle: "members" }] : [] }),
}));

const api = vi.hoisted(() => ({ view: null as unknown, room: null as unknown, roomStatus: 200, calls: [] as string[], posts: [] as Array<{ url: string; body: unknown }> }));
vi.mock("@/lib/gameApi", () => ({
  gameFetch: async (url: string, init?: { method?: string; body?: string }) => {
    api.calls.push(url);
    if (init?.method === "POST") api.posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.startsWith("/api/moon-review/rooms/")) {
      return new Response(JSON.stringify(api.roomStatus === 200 ? api.room : { error: "module_disabled" }), { status: api.roomStatus });
    }
    return new Response(JSON.stringify(api.view), { status: 200 });
  },
}));

import TemplatePanel from "./TemplatePanel";
import MeetingTemplates from "./MeetingTemplates";

const roomView = (shows: number[]): TemplateRoomView => ({
  template: { id: 9, name: MOON_TEMPLATE.name, category: MOON_TEMPLATE.category, summary: MOON_TEMPLATE.summary, flow: [...MOON_TEMPLATE.flow] },
  hosts: false,
  joined: true,
  open: true,
  here: [
    { no: 4, name: "Ana Reyes" },
    { no: 7, name: "Ben Ortiz" },
  ],
  stick: {
    people: [
      { no: 4, name: "Ana Reyes" },
      { no: 7, name: "Ben Ortiz" },
    ],
    holder: 4,
    next: 7,
    rounds: 0,
    shows,
  },
  priorities: [],
  review: null,
  carried: null,
  shares: [],
  season: null,
  viewerNo: 4,
});

const door = () => ({
  moon: { cycleId: "2026-10", firstDay: "2026-10-10", lastDay: "2026-11-08", periodWords: "the October Moon", endOfMoonFriday: "2026-11-06", sendBy: "2026-11-09", fullMoon: "2026-10-25" },
  holder: { userId: "u-ana", name: "Ana Reyes" },
  recap: {
    roles: [
      {
        roleId: "r1",
        name: "Garden steward",
        items: [{ text: "Planted the lower terrace", evidenceUrl: "https://example.test/terrace", amountMinor: 987654 }],
        heldPrivately: 3,
      },
    ],
    seasonGoals: [{ id: "g1", words: "Feed the village from the land", count: 4 }],
    moonLoad: 7777,
  },
  ready: [{ userId: "u-ben", name: "Ben Ortiz" }],
  goals: {
    last: [{ text: "Finish the terrace", status: "done", flagged: false }],
    score: { numHalves: 25, den: 18, pct: 69 },
    reading: { band: "Steady" },
    next: [{ text: "Plant the upper terrace", doneWhen: "Beds are planted" }],
  },
  mine: { recapStatus: "draft", statusWords: "Draft", invoiceNeeded: true, amountMinor: 450000 },
  sentCount: 3,
});

const renderPanel = () => {
  const { hook } = memoryLocation({ path: "/sessions/1" });
  return render(
    <Router hook={hook}>
      <TemplatePanel sessionId={1} agenda={[]} />
    </Router>,
  );
};

beforeEach(() => {
  modules.on = true;
  api.view = roomView([]);
  api.room = door();
  api.roomStatus = 200;
  api.calls = [];
  api.posts = [];
});
afterEach(cleanup);

describe("the End of moon sections in the room", () => {
  it("keep the recap off the screen until the holder chooses Show my moon", async () => {
    renderPanel();
    const moons = await waitFor(() => {
      const el = document.querySelector('[data-section="moon_recaps"]') as HTMLElement | null;
      if (!el) throw new Error("not drawn yet");
      return el;
    });
    // The stick's controls are drawn inside Our moons itself.
    await waitFor(() => expect(within(moons).getByText("Ana Reyes holds the talking stick")).toBeTruthy());
    await waitFor(() => expect(within(moons).getByText("Ana Reyes is speaking without their moon on screen.")).toBeTruthy());
    expect(within(moons).queryByText(/Planted the lower terrace/)).toBeNull();
    // Who is ready to share, below the recap: Ben is in the stick's order and in the ready row. Nobody is marked not ready.
    expect(within(moons).getByText("Ready to share")).toBeTruthy();
    expect(within(moons).getAllByText("Ben Ortiz")).toHaveLength(2);
    expect(moons.textContent).not.toMatch(/not ready to share/i);
    fireEvent.click(within(moons).getByRole("button", { name: "Show my moon" }));
    await waitFor(() => expect(api.posts.some((p) => p.url.endsWith("/moon-share") && (p.body as { show: boolean }).show === true)).toBe(true));
  });

  it("show the recap and goals in words once shown, and never a number about the moon", async () => {
    api.view = roomView([4]);
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByText(/Planted the lower terrace/)).toBeTruthy());
    expect(screen.getByText("Garden steward")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Proof" }).getAttribute("href")).toBe("https://example.test/terrace");
    // No season-goal tally reaches the room (A4), even when the answer carries one.
    expect(screen.queryByText("Feed the village from the land")).toBeNull();
    expect(screen.getByText("Finish the terrace")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Done when: Beds are planted")).toBeTruthy();
    const text = container.textContent ?? "";
    for (const n of ["987654", "450000", "7777", "69%", "12½", "of 18", "Steady"]) expect(text).not.toContain(n);
    expect(text).not.toMatch(/score|reading/i);
  });

  it("give this viewer their own row with Send mine, and the room a count of people", async () => {
    renderPanel();
    const send = await waitFor(() => {
      const el = document.querySelector('[data-section="moon_invoices"]') as HTMLElement | null;
      if (!el || !within(el).queryByText("3 people have sent.")) throw new Error("not drawn yet");
      return el;
    });
    expect(within(send).getByText("Draft")).toBeTruthy();
    expect(within(send).getByRole("link", { name: "Send mine" }).getAttribute("href")).toBe("/profile#my-moon");
    expect(send.textContent).not.toContain("450000");
  });

  it("show one calm line while the module's door is not there", async () => {
    api.roomStatus = 404;
    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/not ready to show here yet/).length).toBe(3));
  });

  it("ask nothing of the module's door while the module is off", async () => {
    modules.on = false;
    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/not ready to show here yet/).length).toBe(3));
    expect(api.calls.some((u) => u.startsWith("/api/moon-review/"))).toBe(false);
  });
});

describe("the End of moon kinds in the template editor", () => {
  const template = (flow: SessionTemplate["flow"]): SessionTemplate => ({
    id: 1,
    name: "Friday check-in",
    category: "Weekly rhythm",
    summary: "",
    circleId: null,
    durationMin: 60,
    flow,
    position: 1,
    status: "active",
    feedsFromId: null,
    updatedAt: new Date(0).toISOString(),
  });
  const openEditor = (flow: SessionTemplate["flow"]) => {
    const payload: TemplatesPayload = { templates: [template(flow)], mayKeep: true };
    render(<MeetingTemplates payload={payload} circles={[]} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    return screen.getAllByRole("option").map((o) => o.textContent);
  };
  const round = [{ key: "a", kind: "round" as const, title: "Arriving", prompt: "", minutes: 5 }];

  it("are hidden while the moon-review module is off", () => {
    modules.on = false;
    const options = openEditor(round);
    expect(options).toContain(SECTION_KIND_DEFS.talking_stick.label);
    for (const k of ["moon_recaps", "moon_goals", "moon_invoices"] as const) expect(options).not.toContain(SECTION_KIND_DEFS[k].label);
  });

  it("are offered while it is on", () => {
    const options = openEditor(round);
    for (const k of ["moon_recaps", "moon_goals", "moon_invoices"] as const) expect(options).toContain(SECTION_KIND_DEFS[k].label);
  });
});
