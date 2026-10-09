// @vitest-environment jsdom
/**
 * The stages on their own, handed a room and a set of recorded doors: the
 * consent round's one sentence, the agenda's order, an item's three choices
 * when its time is up, a proposal decided by consent, the actions every
 * person or seat holds, the breath every screen shares, and the thank-you at
 * the close.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CONSENT_LABELS,
  ROOM_COPY,
  SESSION_COPY,
  SESSION_LIMITS,
  breathAt,
  defaultSessionState,
  type SessionEntry,
  type SessionItem,
  type SessionView,
} from "@shared/sessions";
import { T0, makeView } from "./__tests__/roomFixture";
import type { RoomActions, WriteResult } from "./useSessionRoom";

let gratitudeOn = true;
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: (id: string) => id === "gratitude" && gratitudeOn }));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> };
});

import AgendaList from "./AgendaList";
import ConsentRound from "./ConsentRound";
import GratitudeRound from "./GratitudeRound";
import ItemPage from "./ItemPage";
import { breathEndsAt, breathScale } from "./SharedBreath";
import StageActions from "./StageActions";

type Rec = { door: keyof RoomActions; args: unknown[] };
let log: Rec[];
let nextRoom: SessionView | null;

function doors(): RoomActions {
  const ok = async (door: keyof RoomActions, ...args: unknown[]): Promise<WriteResult<any>> => {
    log.push({ door, args });
    return { ok: true, body: {}, room: nextRoom };
  };
  return {
    join: (...a) => ok("join", ...a),
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
  };
}

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

const entry = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  id: 60,
  itemId: 5,
  kind: "action",
  text: "Call the roofer",
  status: "open",
  authorUserId: 2,
  ownerUserId: null,
  ownerName: null,
  ownerSeatId: null,
  ownerSeatName: null,
  dueOn: null,
  createdAt: "2026-10-09T17:30:00.000Z",
  ...over,
});

const FACILITATOR = { userId: 1, joined: true, facilitates: true, secretary: false, admin: false };

beforeEach(() => {
  log = [];
  nextRoom = null;
  gratitudeOn = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a consent round", () => {
  it("a concern cannot be sent without its one sentence", async () => {
    render(<ConsentRound view={makeView()} actions={doors()} target="agenda" ask={SESSION_COPY.agendaConsentAsk} />);
    fireEvent.click(screen.getByRole("radio", { name: CONSENT_LABELS.concern }));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.consentSend }));
    expect(screen.getByRole("alert")).toHaveTextContent(ROOM_COPY.consentNeedsSentence);
    expect(log).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText(ROOM_COPY.consentSentence), { target: { value: "  The roof item needs Cy,  who is away. " } });
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.consentSend }));
    await waitFor(() => expect(log).toHaveLength(1));
    expect(log[0]!.args.slice(0, 3)).toEqual(["agenda", "concern", "The roof item needs Cy, who is away."]);
  });

  it("a plain consent carries no words, and the tally counts the people here", async () => {
    const view = makeView({ responses: [{ target: "agenda", userId: 1, value: "consent", text: null }] });
    render(<ConsentRound view={view} actions={doors()} target="agenda" ask={SESSION_COPY.agendaConsentAsk} />);
    expect(screen.getByText(ROOM_COPY.tallyLine({ consent: 1, concern: 0, object: 0, waiting: 1 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: CONSENT_LABELS.consent }));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.consentSend }));
    await waitFor(() => expect(log).toHaveLength(1));
    expect(log[0]!.args.slice(0, 3)).toEqual(["agenda", "consent", null]);
  });

  it("says when everyone here consents", () => {
    const view = makeView({
      responses: [
        { target: "agenda", userId: 1, value: "consent", text: null },
        { target: "agenda", userId: 2, value: "concern", text: "Keep it short." },
      ],
    });
    render(<ConsentRound view={view} actions={doors()} target="agenda" ask={SESSION_COPY.agendaConsentAsk} readOnly />);
    expect(screen.getByText(ROOM_COPY.consented)).toBeInTheDocument();
    expect(screen.getByText("Keep it short.", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});

describe("the agenda", () => {
  const two = () => [item({ id: 5, title: "Roof", position: 1 }), item({ id: 6, title: "Paths", position: 2, aim: "explore" })];

  it("moving an item down sends the neighbour's position, and fixes the neighbour when the server only set the number", async () => {
    nextRoom = makeView({ items: [item({ id: 5, position: 2 }), item({ id: 6, title: "Paths", position: 2 })] });
    render(<AgendaList view={makeView({ items: two(), me: FACILITATOR })} actions={doors()} />);
    fireEvent.click(screen.getAllByRole("button", { name: ROOM_COPY.moveDown })[0]!);
    await waitFor(() => expect(log).toHaveLength(2));
    expect(log[0]).toEqual({ door: "patchItem", args: [5, { position: 2 }] });
    expect(log[1]).toEqual({ door: "patchItem", args: [6, { position: 1 }] });
  });

  it("a server that swapped the two needs one write", async () => {
    nextRoom = makeView({ items: [item({ id: 5, position: 2 }), item({ id: 6, title: "Paths", position: 1 })] });
    render(<AgendaList view={makeView({ items: two(), me: FACILITATOR })} actions={doors()} />);
    fireEvent.click(screen.getAllByRole("button", { name: ROOM_COPY.moveDown })[0]!);
    await waitFor(() => expect(log).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toHaveLength(1);
  });

  it("the person who added an item can change its words while it waits, and only the facilitator orders it or takes it off", () => {
    const items = [item({ addedBy: 2 }), item({ id: 6, title: "Paths", addedBy: 1, position: 2 }), item({ id: 7, title: "Gate", addedBy: 2, position: 3, status: "done" })];
    const { unmount } = render(<AgendaList view={makeView({ items })} actions={doors()} />);
    expect(screen.queryByRole("button", { name: ROOM_COPY.moveUp })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROOM_COPY.takeOff })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: ROOM_COPY.edit })).toHaveLength(1);
    unmount();

    render(<AgendaList view={makeView({ items, me: FACILITATOR })} actions={doors()} />);
    expect(screen.getAllByRole("button", { name: ROOM_COPY.edit })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: ROOM_COPY.takeOff })[0]!);
    expect(log[0]).toEqual({ door: "patchItem", args: [5, { status: "parked" }] });
  });

  it("the note taker changes any item's words, and does not order the agenda", () => {
    render(
      <AgendaList
        view={makeView({ items: [item({ addedBy: 1 })], me: { userId: 2, joined: true, facilitates: false, secretary: true, admin: false } })}
        actions={doors()}
      />,
    );
    expect(screen.getByRole("button", { name: ROOM_COPY.edit })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROOM_COPY.moveDown })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROOM_COPY.takeOff })).not.toBeInTheDocument();
  });
});

describe("an item's page", () => {
  const overRoom = (me = FACILITATOR) =>
    makeView({
      items: [item({ status: "active" }), item({ id: 6, title: "Paths", position: 2 })],
      state: { ...defaultSessionState(), stage: "items", activeItemId: 5, itemStartedAt: T0 - 11 * 60_000 },
      me,
    });

  it("past its time, everyone reads the three choices and the facilitator makes one", async () => {
    render(<ItemPage view={overRoom()} now={T0} actions={doors()} item={item({ status: "active" })} />);
    expect(screen.getByText(SESSION_COPY.overChoices)).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveAccessibleName(ROOM_COPY.timeOver(60));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.extendFive }));
    await waitFor(() => expect(log[0]).toEqual({ door: "act", args: [{ type: "extend", minutes: SESSION_LIMITS.extendStepMin }] }));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.wrapNext }));
    await waitFor(() => expect(log[1]).toEqual({ door: "act", args: [{ type: "item", itemId: 6 }] }));
  });

  it("parking an over item clears it from the room when the server has not", async () => {
    nextRoom = overRoom();
    render(<ItemPage view={overRoom()} now={T0} actions={doors()} item={item({ status: "active" })} />);
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.park }));
    await waitFor(() => expect(log).toHaveLength(2));
    expect(log[0]).toEqual({ door: "patchItem", args: [5, { status: "parked" }] });
    expect(log[1]).toEqual({ door: "act", args: [{ type: "item", itemId: null }] });
  });

  it("a member reads the choices and cannot make them", () => {
    render(<ItemPage view={overRoom(makeView().me)} now={T0} actions={doors()} item={item({ status: "active" })} />);
    expect(screen.getByText(SESSION_COPY.overChoices)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROOM_COPY.extendFive })).not.toBeInTheDocument();
  });

  it("the facilitator marks a proposal decided once everyone here consents", async () => {
    const view = makeView({
      items: [item({ status: "active" })],
      entries: [entry({ id: 70, kind: "decision", text: "Fix the roof before the rains." })],
      responses: [
        { target: "decision:70", userId: 1, value: "consent", text: null },
        { target: "decision:70", userId: 2, value: "consent", text: null },
      ],
      state: { ...defaultSessionState(), stage: "items", activeItemId: 5, itemStartedAt: T0 },
      me: FACILITATOR,
    });
    render(<ItemPage view={view} now={T0} actions={doors()} item={item({ status: "active" })} />);
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.decide }));
    await waitFor(() => expect(log[0]).toEqual({ door: "patchEntry", args: [70, { status: "done" }] }));
  });

  it("an action is caught with its seat and its due date", async () => {
    const view = makeView({ items: [item({ status: "active" })] });
    render(<ItemPage view={view} now={T0} actions={doors()} item={item({ status: "active" })} />);
    fireEvent.change(screen.getByLabelText(SESSION_COPY.addAction), { target: { value: "Call the roofer" } });
    fireEvent.change(screen.getAllByLabelText(ROOM_COPY.seatLabel)[0]!, { target: { value: "seat1" } });
    fireEvent.change(screen.getAllByLabelText(ROOM_COPY.dueLabel)[0]!, { target: { value: "2026-10-20" } });
    fireEvent.submit(screen.getByLabelText(SESSION_COPY.addAction).closest("form")!);
    await waitFor(() => expect(log).toHaveLength(1));
    expect(log[0]!.args[0]).toEqual({ kind: "action", text: "Call the roofer", itemId: 5, ownerSeatId: "seat1", dueOn: "2026-10-20" });
  });
});

describe("who does what", () => {
  it("counts what nobody holds, and anyone in the room can take it", async () => {
    const view = makeView({
      items: [item()],
      entries: [entry({ id: 60 }), entry({ id: 61, text: "Sweep the hall", ownerUserId: 1, ownerName: "Ada Moss" })],
    });
    render(<StageActions view={view} now={T0} actions={doors()} highlight={[60]} />);
    expect(screen.getByRole("status")).toHaveTextContent(ROOM_COPY.unownedOne);
    expect(screen.getByText(`${ROOM_COPY.heldBy} Ada Moss`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.claim }));
    await waitFor(() => expect(log[0]).toEqual({ door: "patchEntry", args: [60, { claim: true }] }));
  });

  it("says so when every action has someone holding it", () => {
    const view = makeView({ entries: [entry({ ownerSeatId: "seat1", ownerSeatName: "Water steward" })], items: [item()] });
    render(<StageActions view={view} now={T0} actions={doors()} />);
    expect(screen.getByRole("status")).toHaveTextContent(SESSION_COPY.everyoneHolds);
  });

  it("the facilitator names a seat and parks; the holder lets it go", async () => {
    const view = makeView({ entries: [entry({ ownerUserId: 1, ownerName: "Ada Moss" })], items: [item()], me: FACILITATOR });
    render(<StageActions view={view} now={T0} actions={doors()} />);
    fireEvent.change(screen.getByLabelText(SESSION_COPY.nameSeat), { target: { value: "seat1" } });
    await waitFor(() => expect(log[0]).toEqual({ door: "patchEntry", args: [60, { ownerSeatId: "seat1" }] }));
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.release }));
    await waitFor(() => expect(log[1]).toEqual({ door: "patchEntry", args: [60, { release: true }] }));
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.park }));
    await waitFor(() => expect(log[2]).toEqual({ door: "patchEntry", args: [60, { status: "parked" }] }));
  });
});

describe("who may touch an action", () => {
  const SECRETARY = { userId: 2, joined: true, facilitates: false, secretary: true, admin: false };

  it("a member who neither wrote it nor holds it can only take it", () => {
    const view = makeView({ items: [item()], entries: [entry({ authorUserId: 1 })] });
    render(<StageActions view={view} now={T0} actions={doors()} />);
    expect(screen.getByRole("button", { name: SESSION_COPY.claim })).toBeInTheDocument();
    expect(screen.queryByLabelText(SESSION_COPY.nameSeat)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SESSION_COPY.park })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROOM_COPY.remove })).not.toBeInTheDocument();
  });

  it("whoever wrote it names a seat, parks it and takes it out", () => {
    const view = makeView({ items: [item()], entries: [entry({ authorUserId: 2 })] });
    render(<StageActions view={view} now={T0} actions={doors()} />);
    expect(screen.getByLabelText(SESSION_COPY.nameSeat)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SESSION_COPY.park })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ROOM_COPY.remove })).toBeInTheDocument();
  });

  it("the note taker keeps any action in order, and cannot let go of someone else's", () => {
    const view = makeView({ items: [item()], entries: [entry({ authorUserId: 1, ownerUserId: 3, ownerName: "Cy Reed" })], me: SECRETARY });
    render(<StageActions view={view} now={T0} actions={doors()} />);
    expect(screen.getByLabelText(SESSION_COPY.nameSeat)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ROOM_COPY.remove })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SESSION_COPY.release })).not.toBeInTheDocument();
  });

  it("the facilitator can let go of an action somebody else holds", async () => {
    const view = makeView({ items: [item()], entries: [entry({ ownerUserId: 3, ownerName: "Cy Reed" })], me: FACILITATOR });
    render(<StageActions view={view} now={T0} actions={doors()} />);
    fireEvent.click(screen.getByRole("button", { name: SESSION_COPY.release }));
    await waitFor(() => expect(log[0]).toEqual({ door: "patchEntry", args: [60, { release: true }] }));
  });

  it("after a refused close, says the refusal again until the named actions are held", () => {
    const refused = makeView({ items: [item()], entries: [entry({ id: 60 })] });
    const { unmount } = render(<StageActions view={refused} now={T0} actions={doors()} highlight={[60]} refusal="Every action needs someone." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Every action needs someone.");
    unmount();
    const held = makeView({ items: [item()], entries: [entry({ id: 60, ownerUserId: 2, ownerName: "Bo Fern" })] });
    render(<StageActions view={held} now={T0} actions={doors()} highlight={[60]} refusal="Every action needs someone." />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("the shared breath", () => {
  it("knows when a breath ends, so the fast beat stops", () => {
    expect(breathEndsAt({ pattern: "even", rounds: 3, startedAt: T0 })).toBe(T0 + 30_000);
    expect(breathEndsAt({ pattern: "box", rounds: 6, startedAt: T0 })).toBe(T0 + 96_000);
    expect(breathEndsAt({ pattern: "settle", rounds: 6, startedAt: null })).toBeNull();
  });

  it("grows on the in breath, rests full, shrinks on the out breath", () => {
    const b = { pattern: "box" as const, rounds: 3, startedAt: T0 };
    expect(breathScale(breathAt(b, T0))).toBeCloseTo(0.55);
    expect(breathScale(breathAt(b, T0 + 2000))).toBeCloseTo(0.775);
    expect(breathScale(breathAt(b, T0 + 5000))).toBe(1);
    expect(breathScale(breathAt(b, T0 + 10_000))).toBeCloseTo(0.775);
    expect(breathScale(breathAt(b, T0 + 13_000))).toBe(0.55);
    expect(breathScale({ state: "idle" })).toBe(0.7);
  });
});

describe("gratitude at the close", () => {
  it("thanks a person through the gratitude door, by their handle", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<GratitudeRound view={makeView()} />);
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.thank("Ada") }));
    fireEvent.change(screen.getByPlaceholderText(ROOM_COPY.thankPlaceholder), { target: { value: "For holding the room" } });
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.send }));
    expect(await screen.findByText(ROOM_COPY.thankSent("Ada"))).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/game/gratitude/send");
    expect(JSON.parse(String(init.body))).toEqual({ to: "@ada", amount: 10, message: "For holding the room" });
  });

  it("shows the server's own sentence when it refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Your sending budget is spent for this cycle." }), { status: 400 })));
    render(<GratitudeRound view={makeView()} />);
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.thank("Ada") }));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.send }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your sending budget is spent for this cycle.");
  });

  it("points at the wall for a person the room has no handle for", () => {
    render(<GratitudeRound view={makeView()} />);
    expect(screen.getByRole("link", { name: ROOM_COPY.thankOnWall })).toHaveAttribute("href", "/gratitude");
  });

  it("is hidden when the gratitude module is off", () => {
    gratitudeOn = false;
    const { container } = render(<GratitudeRound view={makeView()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
