// @vitest-environment jsdom
/**
 * The agenda library on screen: the room's card in the agenda stage, the start
 * card's checklist, and the "Agenda items" section on /sessions.
 *
 * What each case holds: the room offers what this viewer may bring and leaves
 * out what is already on its agenda; only somebody in the room gets the
 * button; the checklist follows the circle and keeps the order it shows; the
 * section groups by circle with the viewer's own first, asks for a circle
 * before it sends, offers only the controls a card's rights allow, and says
 * where each item stands in one line. No member-facing word is "library".
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AIM_DEFS, ROOM_COPY, SESSION_COPY, type SessionItem } from "@shared/sessions";
import { LIBRARY_COPY, LIBRARY_STATUS_LINE, broughtFor, type LibraryCard, type LibraryPayload } from "@shared/sessionLibrary";
import { makeView } from "./__tests__/roomFixture";
import type { RoomActions, WriteResult } from "./useSessionRoom";

const state = vi.hoisted(() => ({ fetch: null as null | ((path: string, init?: RequestInit) => Promise<Response>) }));
vi.mock("@/lib/gameApi", () => ({ gameFetch: (path: string, init?: RequestInit) => state.fetch!(path, init) }));
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: () => true }));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> };
});

import AgendaList from "./AgendaList";
import RoomBrought from "./RoomBrought";
import StartChecklist from "./StartChecklist";
import WaitingForCircle from "./WaitingForCircle";

const card = (over: Partial<LibraryCard>): LibraryCard => ({
  id: 1,
  title: "An item",
  aim: null,
  note: null,
  circleId: "water",
  circleName: "Water",
  broughtBy: "Dee Lund",
  mine: false,
  broughtAt: "2026-10-01T10:00:00.000Z",
  status: "waiting",
  session: null,
  settledAt: null,
  backAt: null,
  changedBy: null,
  canEdit: false,
  canMoveCircle: false,
  canWithdraw: false,
  canBringAgain: false,
  source: null,
  ...over,
});

const item = (over: Partial<SessionItem> = {}): SessionItem => ({
  id: 5,
  title: "Roof",
  aim: "decide",
  minutes: 10,
  position: 1,
  status: "waiting",
  presenterUserId: null,
  addedBy: 1,
  startedAt: null,
  endedAt: null,
  usedSeconds: 0,
  fromSessionId: null,
  ...over,
});

type Rec = { door: string; args: unknown[] };
let log: Rec[];
let offered: LibraryCard[];

function doors(): RoomActions {
  const ok = async (door: string, ...args: unknown[]): Promise<WriteResult<any>> => {
    log.push({ door, args });
    return { ok: true, body: {}, room: null };
  };
  return {
    join: (...a) => ok("join", ...a),
    patchSession: (...a) => ok("patchSession", ...a),
    arrival: (...a) => ok("arrival", ...a),
    addItem: (...a) => ok("addItem", ...a),
    patchItem: (...a) => ok("patchItem", ...a),
    addEntry: (...a) => ok("addEntry", ...a),
    patchEntry: (...a) => ok("patchEntry", ...a),
    deleteEntry: (...a) => ok("deleteEntry", ...a),
    respond: (...a) => ok("respond", ...a),
    act: (...a) => ok("act", ...a),
    hosts: (...a) => ok("hosts", ...a),
    close: (...a) => ok("close", ...a),
    toolFeedback: (...a) => ok("toolFeedback", ...a),
    discard: (...a) => ok("discard", ...a),
    library: async () => offered,
    bringFromLibrary: (...a) => ok("bringFromLibrary", ...a),
    sendTension: (...a) => ok("sendTension", ...a),
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Call = { path: string; method: string; body: unknown };
let calls: Call[];
let answers: Record<string, () => Response>;

beforeEach(() => {
  log = [];
  offered = [];
  calls = [];
  answers = {};
  window.location.hash = "";
  state.fetch = async (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${path}`];
    return answer ? answer() : json({ ok: true });
  };
});

describe("the room's card in the agenda stage", () => {
  it("draws nothing when nothing was brought", async () => {
    const { container } = render(<RoomBrought view={makeView()} actions={doors()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("offers what was brought, and brings one onto the agenda with one tap", async () => {
    offered = [
      card({ id: 11, title: "Shed roof", aim: "decide", note: "We need a builder before the rains." }),
      card({ id: 12, title: "Village picnic", circleId: null, circleName: null }),
    ];
    render(<RoomBrought view={makeView()} actions={doors()} />);
    const section = await screen.findByRole("region", { name: broughtFor("Water") });
    expect(within(section).getByText("Shed roof")).toBeInTheDocument();
    expect(within(section).getByText(`${AIM_DEFS.decide.label} · 15 ${ROOM_COPY.minutesShort}`)).toBeInTheDocument();
    expect(within(section).getByText("We need a builder before the rains.")).toBeInTheDocument();
    // An item for no circle says so in a circle's room.
    expect(within(section).getAllByText(LIBRARY_COPY.roomNoCircle)).toHaveLength(1);
    const adds = within(section).getAllByRole("button", { name: LIBRARY_COPY.addToAgenda });
    expect(adds).toHaveLength(2);
    expect(adds[0]!.className).toContain("min-h-11");
    fireEvent.click(adds[0]!);
    await waitFor(() => expect(log).toEqual([{ door: "bringFromLibrary", args: [[11]] }]));
  });

  it("leaves out what is already on the agenda, and gives somebody outside the room no button", async () => {
    offered = [card({ id: 11, title: "Shed roof" }), card({ id: 12, title: "Tool shed lock" })];
    const view = makeView({ items: [item({ id: 40, title: "Shed roof", libraryId: 11, broughtBy: "Dee Lund" })], me: { userId: 4, joined: false, facilitates: false, secretary: false, admin: false } });
    render(<RoomBrought view={view} actions={doors()} />);
    const section = await screen.findByRole("region", { name: broughtFor("Water") });
    expect(within(section).queryByText("Shed roof")).toBeNull();
    expect(within(section).getByText("Tool shed lock")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: LIBRARY_COPY.addToAgenda })).toBeNull();
    expect(within(section).getByText(ROOM_COPY.joinFirst)).toBeInTheDocument();
  });

  it("names whoever brought an item on the agenda, even when they are not in the room", () => {
    const view = makeView({ items: [item({ id: 40, title: "Shed roof", addedBy: 1, libraryId: 11, broughtBy: "Dee Lund" })] });
    render(<AgendaList view={view} actions={doors()} />);
    expect(screen.getByText(`· ${LIBRARY_COPY.broughtByName("Dee Lund")}`)).toBeInTheDocument();
    expect(screen.queryByText("· Ada Moss")).toBeNull();
  });
});

describe("the start card's checklist", () => {
  const items = [
    card({ id: 1, title: "Water rota", circleId: "water", broughtAt: "2026-10-02T00:00:00.000Z" }),
    card({ id: 2, title: "Picnic", circleId: null, circleName: null, broughtAt: "2026-10-01T00:00:00.000Z" }),
    card({ id: 3, title: "Pump", circleId: "water", aim: "decide", broughtAt: "2026-10-01T00:00:00.000Z" }),
    card({ id: 4, title: "Kitchen sink", circleId: "kitchen", circleName: "Kitchen" }),
    card({ id: 5, title: "On an agenda", circleId: "water", status: "on_agenda" }),
  ];

  it("offers the circle's waiting items oldest first, then those for no circle, and keeps the order it shows", () => {
    const onPicked = vi.fn();
    render(<StartChecklist items={items} circleId="water" circleName="Water" picked={[]} onPicked={onPicked} durationMin={60} />);
    const group = screen.getByRole("group", { name: broughtFor("Water") });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(3);
    const labels = within(group).getAllByRole("listitem").map((li) => li.querySelector("span span")?.textContent);
    expect(labels).toEqual(["Pump", "Water rota", "Picnic"]);
    expect(within(group).getAllByRole("listitem")[0]!.querySelector("label")!.className).toContain("min-h-11");
    fireEvent.click(within(group).getByRole("checkbox", { name: /Picnic/ }));
    expect(onPicked).toHaveBeenLastCalledWith([2]);
  });

  it("puts a new tick in the agenda's order, whatever order the ticks came in", () => {
    const onPicked = vi.fn();
    render(<StartChecklist items={items} circleId="water" circleName="Water" picked={[2]} onPicked={onPicked} durationMin={60} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Pump/ }));
    expect(onPicked).toHaveBeenLastCalledWith([3, 2]);
    // 15 minutes for a decision and 10 for the picnic, against the hour.
    expect(screen.getByText(ROOM_COPY.agendaFitLine(10, 50))).toBeInTheDocument();
  });

  it("offers a session for no circle only what was brought for no circle, and draws nothing when nothing fits", () => {
    const { rerender, container } = render(<StartChecklist items={items} circleId={null} circleName={null} picked={[]} onPicked={() => undefined} durationMin={60} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("group", { name: broughtFor(null) })).toBeInTheDocument();
    rerender(<StartChecklist items={items.filter((i) => i.circleId === "kitchen")} circleId="water" circleName="Water" picked={[]} onPicked={() => undefined} durationMin={60} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("waiting for a circle, on /sessions", () => {
  const circles = [
    { id: "water", name: "Water" },
    { id: "kitchen", name: "Kitchen" },
  ];
  const payload = (items: LibraryCard[], myCircleIds: string[] = []): LibraryPayload => ({ items, myCircleIds });

  it("lists one group per circle, the viewer's own first and no circle last, and says where each stands", () => {
    const items = [
      card({ id: 1, title: "Picnic", circleId: null, circleName: null }),
      card({ id: 2, title: "Sink", circleId: "kitchen", circleName: "Kitchen" }),
      card({ id: 3, title: "Pump", circleId: "water", status: "on_agenda", session: { id: 70, title: "Water, week 2", open: true } }),
      card({ id: 4, title: "Old roof", circleId: "water", status: "taken_up", settledAt: "2026-10-03T00:00:00.000Z" }),
    ];
    render(<WaitingForCircle library={payload(items, ["water"])} circles={circles} onChanged={() => undefined} />);
    const section = screen.getByRole("region", { name: LIBRARY_COPY.sectionTitle });
    const headings = within(section).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Water circle", "Kitchen circle", SESSION_COPY.noCircle]);
    expect(within(section).getByRole("link", { name: LIBRARY_STATUS_LINE.on_agenda({ title: "Water, week 2", date: null })! })).toHaveAttribute("href", "/sessions/70");
    // What was taken up folds away under its own disclosure.
    const lately = within(section).getByText(LIBRARY_COPY.takenUpLately).closest("details")!;
    expect(lately.open).toBe(false);
    expect(within(lately).getByText("Old roof")).toBeInTheDocument();
    // Every card has its anchor, so a notice can land on it.
    expect(document.getElementById("brought-3")).not.toBeNull();
  });

  it("says plainly when nothing waits", () => {
    render(<WaitingForCircle library={payload([])} circles={circles} onChanged={() => undefined} />);
    expect(screen.getByText(LIBRARY_COPY.empty)).toBeInTheDocument();
  });

  it("asks for a circle before it sends, then thanks them with where it waits", async () => {
    const onChanged = vi.fn();
    answers["POST /api/sessions/library"] = () => json({ item: card({ id: 9 }) });
    render(<WaitingForCircle library={payload([])} circles={circles} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.bringButton }));
    fireEvent.change(screen.getByLabelText(LIBRARY_COPY.titleLabel), { target: { value: "Pump house" } });
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.addButton }));
    expect(screen.getByRole("alert")).toHaveTextContent(LIBRARY_COPY.circleNeeded);
    expect(calls).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(LIBRARY_COPY.circleLabel), { target: { value: "water" } });
    fireEvent.change(screen.getByLabelText(LIBRARY_COPY.aimLabel), { target: { value: "decide" } });
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.addButton }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ path: "/api/sessions/library", method: "POST", body: { title: "Pump house", aim: "decide", note: null, circleId: "water" } });
    expect(await screen.findByText(LIBRARY_COPY.saved("Water"))).toHaveAttribute("aria-live", "polite");
    expect(onChanged).toHaveBeenCalled();
  });

  it("chooses the circle for a member who has standing in exactly one, and keeps the server's sentence when it refuses", async () => {
    answers["POST /api/sessions/library"] = () => json({ error: "You have 50 items waiting. Remove one, or let a circle take some up first." }, 409);
    render(<WaitingForCircle library={payload([], ["kitchen"])} circles={circles} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.bringButton }));
    expect((screen.getByLabelText(LIBRARY_COPY.circleLabel) as HTMLSelectElement).value).toBe("kitchen");
    fireEvent.change(screen.getByLabelText(LIBRARY_COPY.titleLabel), { target: { value: "Sink" } });
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.addButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You have 50 items waiting.");
    expect(screen.queryByText(LIBRARY_COPY.saved("Kitchen"))).toBeNull();
  });

  it("offers only the controls a card's rights allow, and asks once before it withdraws", async () => {
    const onChanged = vi.fn();
    const items = [
      card({ id: 1, title: "Mine", mine: true, canEdit: true, canMoveCircle: true, canWithdraw: true }),
      card({ id: 2, title: "Theirs" }),
      card({ id: 3, title: "Taken up, mine", mine: true, status: "taken_up", canWithdraw: true, canBringAgain: true, settledAt: "2026-10-03T00:00:00.000Z" }),
    ];
    render(<WaitingForCircle library={payload(items, ["water"])} circles={circles} onChanged={onChanged} />);
    const mine = document.getElementById("brought-1")!;
    const theirs = document.getElementById("brought-2")!;
    expect(within(theirs).queryByRole("button")).toBeNull();
    // The date is in the reader's own locale, so only the words around it are held here.
    expect(within(mine).getByText(/^Added by you · /)).toBeInTheDocument();

    fireEvent.click(within(mine).getByRole("button", { name: LIBRARY_COPY.withdraw }));
    expect(within(mine).getByText(LIBRARY_COPY.withdrawConfirm)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    fireEvent.click(within(mine).getByRole("button", { name: LIBRARY_COPY.withdrawYes }));
    await waitFor(() => expect(calls).toEqual([{ path: "/api/sessions/library/1", method: "DELETE", body: undefined }]));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    const takenUp = document.getElementById("brought-3")!;
    fireEvent.click(within(takenUp).getByRole("button", { name: LIBRARY_COPY.bringAgain }));
    await waitFor(() => expect(calls.at(-1)).toEqual({ path: "/api/sessions/library/3/again", method: "POST", body: {} }));
  });

  it("sends only what changed, and keeps the circle still for somebody who may only reword it", async () => {
    const items = [card({ id: 1, title: "Pump", circleId: "water", canEdit: true, canMoveCircle: false })];
    answers["PATCH /api/sessions/library/1"] = () => json({ item: card({ id: 1, title: "Pump house" }) });
    render(<WaitingForCircle library={payload(items, ["water"])} circles={circles} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.edit }));
    expect(screen.getByLabelText(LIBRARY_COPY.circleLabel)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(LIBRARY_COPY.titleLabel), { target: { value: "Pump house" } });
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.save }));
    await waitFor(() => expect(calls).toEqual([{ path: "/api/sessions/library/1", method: "PATCH", body: { title: "Pump house" } }]));
  });

  it("lands a notice's link on its card", async () => {
    window.location.hash = "#brought-2";
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(<WaitingForCircle library={payload([card({ id: 1, title: "One" }), card({ id: 2, title: "Two" })])} circles={circles} onChanged={() => undefined} />);
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(document.getElementById("brought-2")!.className).toContain("ring-2");
  });
});

describe("waiting for a circle, after the review", () => {
  const circles = [
    { id: "water", name: "Water" },
    { id: "kitchen", name: "Kitchen" },
  ];
  const payload = (items: LibraryCard[], myCircleIds: string[] = ["water"]): LibraryPayload => ({ items, myCircleIds });

  it("sends only what this person changed, measured against the card as it was when the form opened", async () => {
    answers["PATCH /api/sessions/library/1"] = () => json({ item: card({ id: 1 }) });
    const first = card({ id: 1, title: "Pump", note: "Old note", canEdit: true, canMoveCircle: true });
    const { rerender } = render(<WaitingForCircle library={payload([first])} circles={circles} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.edit }));
    // Somebody else renames it while the form is open; the next poll brings that.
    rerender(<WaitingForCircle library={payload([{ ...first, title: "Pump house" }])} circles={circles} onChanged={() => undefined} />);
    fireEvent.change(screen.getByLabelText(LIBRARY_COPY.noteLabel), { target: { value: "New note" } });
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.save }));
    await waitFor(() => expect(calls).toEqual([{ path: "/api/sessions/library/1", method: "PATCH", body: { note: "New note" } }]));
  });

  it("names the boxes by their labels for a screen reader, and reads the privacy line with the note", () => {
    render(<WaitingForCircle library={payload([])} circles={circles} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.bringButton }));
    const note = screen.getByRole("textbox", { name: LIBRARY_COPY.noteLabel });
    expect(note).toHaveAttribute("placeholder", LIBRARY_COPY.notePlaceholder);
    const seen = document.getElementById(note.getAttribute("aria-describedby")!);
    expect(seen).toHaveTextContent(LIBRARY_COPY.seenHint);
    expect(screen.getByRole("textbox", { name: LIBRARY_COPY.titleLabel })).toHaveAttribute("placeholder", LIBRARY_COPY.titlePlaceholder);
  });

  it("puts the focus back on the add button when the form goes away", async () => {
    render(<WaitingForCircle library={payload([])} circles={circles} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.bringButton }));
    fireEvent.click(screen.getByRole("button", { name: LIBRARY_COPY.cancel }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: LIBRARY_COPY.bringButton })));
  });

  it("opens the taken-up list before it lands on a card there, and gives the card the focus", async () => {
    window.location.hash = "#brought-4";
    Element.prototype.scrollIntoView = vi.fn();
    const items = [card({ id: 3, title: "Waiting one" }), card({ id: 4, title: "Old roof", status: "taken_up", settledAt: "2026-10-03T00:00:00.000Z" })];
    render(<WaitingForCircle library={payload(items)} circles={circles} onChanged={() => undefined} />);
    const lately = screen.getByText(LIBRARY_COPY.takenUpLately).closest("details")!;
    await waitFor(() => expect(lately.open).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("brought-4")));
  });

  it("lands a notice tapped while the page is already open", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<WaitingForCircle library={payload([card({ id: 7, title: "Seven" })])} circles={circles} onChanged={() => undefined} />);
    expect(document.getElementById("brought-7")!.className).not.toContain("ring-2");
    // The bell's link is a client-side move: the router pushes the entry and says so.
    window.history.pushState(null, "", "/sessions#brought-7");
    window.dispatchEvent(new Event("pushState"));
    await waitFor(() => expect(document.getElementById("brought-7")!.className).toContain("ring-2"));
  });

  it("takes a withdrawn card away at once, and shows a circle gone dormant as it is", async () => {
    const items = [
      card({ id: 1, title: "Gone soon", mine: true, canWithdraw: true }),
      card({ id: 2, title: "Old circle's", mine: true, circleId: "orchard", circleName: "Orchard", canEdit: true, canMoveCircle: true, canWithdraw: true }),
    ];
    render(<WaitingForCircle library={payload(items)} circles={circles} onChanged={() => new Promise(() => undefined)} />);
    const gone = document.getElementById("brought-1")!;
    fireEvent.click(within(gone).getByRole("button", { name: LIBRARY_COPY.withdraw }));
    fireEvent.click(within(gone).getByRole("button", { name: LIBRARY_COPY.withdrawYes }));
    // The list has not been read again yet (it never answers here), and the card is already gone.
    await waitFor(() => expect(document.getElementById("brought-1")).toBeNull());

    fireEvent.click(within(document.getElementById("brought-2")!).getByRole("button", { name: LIBRARY_COPY.edit }));
    const select = screen.getByLabelText(LIBRARY_COPY.circleLabel) as HTMLSelectElement;
    expect(select.value).toBe("orchard");
    expect(select.selectedOptions[0]!.textContent).toBe("Orchard");
  });
});
