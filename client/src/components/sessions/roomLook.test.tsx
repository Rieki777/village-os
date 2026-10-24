// @vitest-environment jsdom
/**
 * How the room reads and where its controls sit: the facilitator's one
 * forward button, the drawn moon and a village's own season names, each
 * thing said once on Drop in, the breath that speaks only when it starts and
 * ends, and the names under a consent tally of who is still to answer.
 *
 * Wave 2, the game look: the open room wears the night and the closed record
 * the linen, the stage rail is a path of glyph nodes, one gold button per
 * screen, the session's title is a door for whoever edits the room's words,
 * the people are faces, and the clock is a figure in the body face.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  ROOM_COPY,
  SESSION_COPY,
  SESSION_SOMEONE,
  SESSION_STAGES,
  STAGE_DEFS,
  defaultSessionState,
  type SessionEntry,
  type SessionView,
} from "@shared/sessions";
import { T0, json, makeView } from "./__tests__/roomFixture";
import type { RoomActions, WriteResult } from "./useSessionRoom";

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    useParams: () => ({ id: "7" }),
    Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
  };
});
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "2" } }) }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "sessions", lifecycle: "members" }] }),
  useModuleOn: () => false,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import SessionRoom from "@/pages/SessionRoom";
import ConsentRound from "./ConsentRound";
import FacilitatorBar from "./FacilitatorBar";
import { OpenProposals } from "./Proposal";
import RoomHeader from "./RoomHeader";
import PersonDisc from "./PersonDisc";
import RoomMoon, { skyLine } from "./RoomMoon";
import SharedBreath, { breathAnnouncement } from "./SharedBreath";
import StageDropIn from "./StageDropIn";
import StageRail from "./StageRail";
import { ITEM_TITLE, LEARNED_QUOTE, STAGE_TITLE, forgetDrafts, waitingNames } from "./roomUi";

let log: { door: keyof RoomActions; args: unknown[] }[];

function doors(): RoomActions {
  const ok = async (door: keyof RoomActions, ...args: unknown[]): Promise<WriteResult<any>> => {
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
    answerNight: (...a) => ok("answerNight", ...a),
    decideAfterNight: (...a) => ok("decideAfterNight", ...a),
    act: (...a) => ok("act", ...a),
    hosts: (...a) => ok("hosts", ...a),
    close: (...a) => ok("close", ...a),
    toolFeedback: (...a) => ok("toolFeedback", ...a),
    discard: (...a) => ok("discard", ...a),
    library: async () => [],
    bringFromLibrary: (...a) => ok("bringFromLibrary", ...a),
  };
}

const FACILITATOR = { userId: 1, joined: true, facilitates: true, secretary: false, admin: false };
const started = (stage: SessionView["state"]["stage"] = "dropin") => ({ ...defaultSessionState(), stage, startedAt: T0, stageStartedAt: T0 });

beforeEach(() => {
  log = [];
  forgetDrafts();
});

describe("the facilitator's one forward button", () => {
  it("reads Begin before the clock runs, and Begin starts the clock", async () => {
    render(<FacilitatorBar view={makeView({ me: FACILITATOR })} actions={doors()} shown="dropin" onMoved={() => {}} />);
    expect(screen.queryByRole("button", { name: new RegExp(`^${ROOM_COPY.nextStage}`) })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.beginSession }));
    await waitFor(() => expect(log).toEqual([{ door: "act", args: [{ type: "start" }] }]));
  });

  it("Begin says it worked, and hands focus to a new Next stage button", async () => {
    const { rerender } = render(<FacilitatorBar view={makeView({ me: FACILITATOR })} actions={doors()} shown="dropin" onMoved={() => {}} />);
    const begin = screen.getByRole("button", { name: ROOM_COPY.beginSession });
    begin.focus();
    fireEvent.click(begin);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(ROOM_COPY.sessionBegun));
    rerender(<FacilitatorBar view={makeView({ me: FACILITATOR, state: started() })} actions={doors()} shown="dropin" onMoved={() => {}} />);
    const nextButton = screen.getByRole("button", { name: `${ROOM_COPY.nextStage}: ${STAGE_DEFS.arrival.short}` });
    // A fresh node, never Begin relabelled, and it holds the focus.
    expect(nextButton).not.toBe(begin);
    expect(nextButton).toHaveFocus();
  });

  it("the same slot reads Next stage once the clock runs, and moves the room on", async () => {
    const onMoved = vi.fn();
    render(<FacilitatorBar view={makeView({ me: FACILITATOR, state: started() })} actions={doors()} shown="dropin" onMoved={onMoved} />);
    expect(screen.queryByRole("button", { name: ROOM_COPY.beginSession })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `${ROOM_COPY.nextStage}: ${STAGE_DEFS.arrival.short}` }));
    await waitFor(() => expect(log).toEqual([{ door: "act", args: [{ type: "go", stage: "arrival" }] }]));
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
  });

  it("looking at another stage offers Move the room here in that slot, before or after Begin", () => {
    const { rerender } = render(<FacilitatorBar view={makeView({ me: FACILITATOR })} actions={doors()} shown="agenda" onMoved={() => {}} />);
    expect(screen.getByRole("button", { name: ROOM_COPY.moveHere })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROOM_COPY.beginSession })).not.toBeInTheDocument();
    rerender(<FacilitatorBar view={makeView({ me: FACILITATOR, state: started() })} actions={doors()} shown="agenda" onMoved={() => {}} />);
    expect(screen.getByRole("button", { name: ROOM_COPY.moveHere })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(`^${ROOM_COPY.nextStage}`) })).not.toBeInTheDocument();
  });

  it("the header holds no forward button, and tells the facilitator how the clock starts", () => {
    render(<RoomHeader view={makeView({ me: FACILITATOR })} now={T0} actions={doors()} shown="dropin" />);
    expect(screen.queryByRole("button", { name: ROOM_COPY.beginSession })).not.toBeInTheDocument();
    expect(screen.getByText(ROOM_COPY.clockWaitingYou)).toBeInTheDocument();
  });
});

describe("the moon and the season", () => {
  it("draws the moon from the stamp's phase beside its name, with no text moon", () => {
    const { container } = render(<RoomMoon stamp={makeView().stamp} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("Moon 4 · Waxing gibbous · spring")).toBeInTheDocument();
    expect(container.textContent).not.toContain("o Moon");
  });

  it("an older stamp with no phase shows the name only", () => {
    const { container } = render(<RoomMoon stamp={{ ...makeView().stamp, moonPhase: null, hemisphere: null }} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container).toHaveTextContent("Moon 4 · Waxing gibbous · spring");
  });

  it("prints a village's own season name as given, and leaves a missing season out", () => {
    expect(skyLine({ moonOrdinal: null, moonName: "Full moon", season: "Green" })).toBe("Full moon · Green");
    expect(skyLine({ moonOrdinal: 2, moonName: "New moon", season: null })).toBe("Moon 2 · New moon");
    expect(skyLine({ moonOrdinal: null, moonName: "New moon", season: "  " })).toBe("New moon");
    render(<RoomMoon stamp={{ ...makeView().stamp, season: "Season of the long rains" }} />);
    expect(screen.getByText("Moon 4 · Waxing gibbous · Season of the long rains")).toBeInTheDocument();
  });
});

describe("Drop in says each thing once", () => {
  const renderDropIn = (over: Partial<SessionView> = {}) => {
    const view = makeView(over);
    return render(
      <>
        <RoomHeader view={view} now={T0} actions={doors()} shown="dropin" />
        <StageDropIn view={view} now={T0} actions={doors()} offset={0} />
      </>,
    );
  };

  it("the moon line, the breath's title and the people list each appear once", () => {
    const { container } = renderDropIn();
    expect(screen.getAllByText("Moon 4 · Waxing gibbous · spring")).toHaveLength(1);
    expect(container.querySelectorAll("svg[role='presentation']")).toHaveLength(1);
    expect(screen.getAllByText(ROOM_COPY.breathTitle)).toHaveLength(1);
    expect(screen.getAllByRole("list", { name: ROOM_COPY.whoIsHere })).toHaveLength(1);
    expect(screen.getByText("We meet on the hill above the creek.")).toBeInTheDocument();
  });

  it("the header names the facilitator, and keeps the people on every other stage", () => {
    const view = makeView();
    render(<RoomHeader view={view} now={T0} actions={doors()} shown="agenda" />);
    expect(screen.getByText(ROOM_COPY.facilitatedBy("Ada Moss"))).toBeInTheDocument();
    expect(screen.getByRole("list", { name: ROOM_COPY.whoIsHere })).toBeInTheDocument();
  });

  it("a member who has not joined still reads the place line with no fallback in its place", () => {
    renderDropIn({ me: { userId: 4, joined: false, facilitates: false, secretary: false, admin: false } });
    expect(screen.getByText("We meet on the hill above the creek.")).toBeInTheDocument();
    expect(screen.queryByText(SESSION_COPY.placeLineFallback)).not.toBeInTheDocument();
  });
});

describe("the breath", () => {
  it("tells a screen reader only that it started and that it ended", () => {
    expect(breathAnnouncement({ state: "idle" }, 6)).toBe("");
    const first = breathAnnouncement({ state: "breathing", round: 1, kind: "in", progress: 0.1, secondsLeft: 4 }, 6);
    const later = breathAnnouncement({ state: "breathing", round: 3, kind: "out", progress: 0.5, secondsLeft: 3 }, 6);
    expect(first).toBe(ROOM_COPY.breathStartedSay(6));
    // The same sentence the whole way through, so the live region does not speak again.
    expect(later).toBe(first);
    expect(breathAnnouncement({ state: "done" }, 6)).toBe(ROOM_COPY.breathDone);
  });

  it("the live region never holds the step words", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0 + 1000);
      const { container } = render(
        <SharedBreath breath={{ pattern: "settle", rounds: 3, startedAt: T0 }} offset={0} facilitates={false} actions={doors()} />,
      );
      const live = container.querySelector("[aria-live]")!;
      expect(live).toHaveTextContent(ROOM_COPY.breathStartedSay(3));
      expect(screen.getByText("Breathe in")).not.toHaveAttribute("aria-live");
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByText("Breathe out")).toBeInTheDocument();
      expect(live).toHaveTextContent(ROOM_COPY.breathStartedSay(3));
    } finally {
      vi.useRealTimers();
    }
  });

  it("while idle the title is said once and the step slot is empty", () => {
    render(<SharedBreath breath={{ pattern: "settle", rounds: 6, startedAt: null }} offset={0} facilitates={false} actions={doors()} />);
    expect(screen.getAllByText(ROOM_COPY.breathTitle)).toHaveLength(1);
    expect(screen.getByText(ROOM_COPY.breathIdle)).toBeInTheDocument();
  });

  it("the facilitator picks a pattern and rounds from tiles and starts it for everyone", async () => {
    render(<SharedBreath breath={{ pattern: "settle", rounds: 6, startedAt: null }} offset={0} facilitates actions={doors()} />);
    const patterns = screen.getByRole("radiogroup", { name: ROOM_COPY.breathPattern });
    fireEvent.click(within(patterns).getByRole("radio", { name: /^Box/ }));
    expect(within(patterns).getByRole("radio", { name: /^Box/ })).toHaveAttribute("aria-checked", "true");
    expect(within(patterns).getByRole("radio", { name: /^Box/ })).toHaveTextContent(ROOM_COPY.breathCounts([4, 4, 4, 4]));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: ROOM_COPY.breathRounds })).getByRole("radio", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.breathStart }));
    await waitFor(() => expect(log).toEqual([{ door: "act", args: [{ type: "breath", pattern: "box", rounds: 3, run: true }] }]));
  });
});

describe("who a consent round is waiting on", () => {
  const proposal = (over: Partial<SessionEntry> = {}): SessionEntry => ({
    id: 70,
    itemId: 5,
    kind: "decision",
    text: "Fix the roof before the rains.",
    status: "open",
    authorUserId: 1,
    ownerUserId: null,
    ownerName: null,
    ownerSeatId: null,
    ownerSeatName: null,
    dueOn: null,
    createdAt: "2026-10-09T17:30:00.000Z",
    ...over,
  });

  it("names the people still to answer under the agenda's tally", () => {
    const view = makeView({
      responses: [{ target: "agenda", userId: 2, value: "consent", text: null }],
      waiting: { agenda: [{ userId: 1, name: "Ada Moss" }] },
    });
    render(<ConsentRound view={view} actions={doors()} target="agenda" ask={SESSION_COPY.agendaConsentAsk} />);
    expect(screen.getByText(ROOM_COPY.waitingFor(["Ada"]))).toBeInTheDocument();
  });

  it("says nothing once nobody is waiting, or to somebody who does not see the answers", () => {
    const { rerender } = render(
      <ConsentRound view={makeView({ waiting: { agenda: [] } })} actions={doors()} target="agenda" ask={SESSION_COPY.agendaConsentAsk} />,
    );
    expect(screen.queryByText(/^Waiting for/)).not.toBeInTheDocument();
    const outsider = makeView({
      me: { userId: 4, joined: false, facilitates: false, secretary: false, admin: false },
      waiting: { agenda: [{ userId: 1, name: "Ada Moss" }] },
    });
    rerender(<ConsentRound view={outsider} actions={doors()} target="agenda" ask={SESSION_COPY.agendaConsentAsk} readOnly />);
    expect(screen.queryByText(/^Waiting for/)).not.toBeInTheDocument();
  });

  it("names them under each open proposal's tally at the close", () => {
    const view = makeView({
      state: { ...defaultSessionState(), stage: "close" },
      entries: [proposal(), proposal({ id: 71, text: "Paint the gate blue." })],
      responses: [{ target: "decision:70", userId: 1, value: "consent", text: null }],
      waiting: { "decision:70": [{ userId: 2, name: "Bo Fern" }], "decision:71": [{ userId: 1, name: "Ada Moss" }, { userId: 2, name: "Bo Fern" }] },
      me: FACILITATOR,
    });
    render(<OpenProposals view={view} actions={doors()} />);
    expect(screen.getByText(ROOM_COPY.waitingFor(["Bo"]))).toBeInTheDocument();
    expect(screen.getByText(ROOM_COPY.waitingFor(["Ada", "Bo"]))).toBeInTheDocument();
  });

  it("keeps a person the village no longer names whole, never cut to 'A'", () => {
    const view = makeView({ waiting: { agenda: [{ userId: 9, name: SESSION_SOMEONE }] } });
    expect(waitingNames(view, "agenda")).toEqual([SESSION_SOMEONE]);
    render(<ConsentRound view={view} actions={doors()} target="agenda" ask={SESSION_COPY.agendaConsentAsk} />);
    expect(screen.getByText(ROOM_COPY.waitingFor([SESSION_SOMEONE]))).toBeInTheDocument();
  });

  it("gives full names to two people who share a first name", () => {
    const view = makeView({
      waiting: { agenda: [{ userId: 1, name: "Ana Rios" }, { userId: 2, name: "Ana Vega" }, { userId: 3, name: "Bo Fern" }] },
    });
    expect(waitingNames(view, "agenda")).toEqual(["Ana Rios", "Ana Vega", "Bo"]);
  });
});

// -- Wave 2: the game look ---------------------------------------------------

describe("the room is a world while it is open", () => {
  const serve = (view: SessionView) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === "/api/sessions/7" ? json(view) : json({ ok: true }))),
    );

  it("the open room wears the night and the village's face, with the motes behind it", async () => {
    serve(makeView({ me: FACILITATOR }));
    try {
      const { container } = render(<SessionRoom />);
      await screen.findByRole("navigation", { name: ROOM_COPY.stagesLabel });
      const night = container.querySelector("[data-room='open']")!;
      expect(night.className).toMatch(/\bsheet-night\b/);
      expect(night.className).toMatch(/\broom-night\b/);
      // The village's display face is read outside the night, before the night swaps its own in.
      expect(night.parentElement!.className).toMatch(/\broom-world\b/);
      expect(night.querySelector("canvas[aria-hidden='true']")).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the closed record stays on the linen, with no night and no motes", async () => {
    serve(makeView({ status: "closed", closedAt: "2026-10-09T18:10:00.000Z" }));
    try {
      const { container } = render(<SessionRoom />);
      await screen.findByText(SESSION_COPY.closeDone);
      expect(container.querySelector(".sheet-night")).toBeNull();
      expect(container.querySelector(".room-night")).toBeNull();
      expect(container.querySelector("canvas")).toBeNull();
      // The record is signed once, in the hand-lettered face.
      expect(screen.getAllByText(ROOM_COPY.signoff)).toHaveLength(1);
      expect(screen.getByText(ROOM_COPY.signoff).className).toMatch(/\bfont-accent\b/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("in the record, an item's actions sit under their own label, apart from what we learned", async () => {
    const card = (id: number, kind: SessionEntry["kind"], text: string, over: Partial<SessionEntry> = {}): SessionEntry => ({
      id,
      itemId: 5,
      kind,
      text,
      status: "open",
      authorUserId: 1,
      ownerUserId: null,
      ownerName: null,
      ownerSeatId: null,
      ownerSeatName: null,
      dueOn: null,
      createdAt: "2026-10-09T17:30:00.000Z",
      ...over,
    });
    const roof = { id: 5, title: "Roof", aim: "decide" as const, minutes: 10, position: 1, status: "done" as const, presenterUserId: null, addedBy: 1, startedAt: null, endedAt: null, usedSeconds: 0, fromSessionId: null };
    serve(
      makeView({
        status: "closed",
        closedAt: "2026-10-09T18:10:00.000Z",
        items: [roof],
        entries: [card(81, "seed", "Rain comes before the roof"), card(82, "action", "Call the roofer", { ownerUserId: 2, ownerName: "Bo Fern" })],
      }),
    );
    try {
      render(<SessionRoom />);
      const act = await screen.findByText("Call the roofer");
      const learned = screen.getByText(ROOM_COPY.seedsHeading).closest("li")!;
      expect(learned).not.toContainElement(act);
      const block = act.closest("ul")!.closest("li")!;
      expect(within(block).getByText(ROOM_COPY.actionsHere)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the facilitator's screen holds exactly one gold button, and a member's none", async () => {
    serve(makeView({ me: FACILITATOR, state: started("agenda") }));
    try {
      const { container, unmount } = render(<SessionRoom />);
      await screen.findByRole("button", { name: `${ROOM_COPY.nextStage}: ${STAGE_DEFS.items.short}` });
      expect(container.querySelectorAll("[data-forward]")).toHaveLength(1);
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
    serve(makeView({ state: started("agenda") }));
    try {
      const { container } = render(<SessionRoom />);
      await screen.findByRole("navigation", { name: ROOM_COPY.stagesLabel });
      expect(container.querySelectorAll("[data-forward]")).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the stage rail is a path", () => {
  it("six stages, each a button by its name, the shown one current", () => {
    render(<StageRail roomStage="agenda" shown="items" onShow={() => {}} />);
    const nav = screen.getByRole("navigation", { name: ROOM_COPY.stagesLabel });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons).toHaveLength(6);
    expect(buttons.map((b) => b.textContent)).toEqual(SESSION_STAGES.map((s) => STAGE_DEFS[s].short));
    expect(within(nav).getByRole("button", { name: STAGE_DEFS.items.short })).toHaveAttribute("aria-current", "step");
    expect(buttons.filter((b) => b.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it("the room's stage carries the Now badge, and the passed stages carry a check", () => {
    const { container } = render(<StageRail roomStage="agenda" shown="agenda" onShow={() => {}} />);
    const roomNode = screen.getByRole("button", { name: STAGE_DEFS.agenda.short }).closest("li")!;
    expect(within(roomNode).getByText(ROOM_COPY.liveBadge)).toBeInTheDocument();
    expect(screen.getAllByText(ROOM_COPY.liveBadge)).toHaveLength(1);
    const passed = Array.from(container.querySelectorAll("[data-passed='true']"));
    expect(passed.map((b) => b.getAttribute("data-stage"))).toEqual(["dropin", "arrival"]);
    for (const b of passed) expect(b.querySelector("svg")!.getAttribute("class")).toMatch(/circle-check/);
    expect(screen.getByRole("button", { name: STAGE_DEFS.items.short }).querySelector("svg")!.getAttribute("class")).not.toMatch(/circle-check/);
  });

  it("opening a stage asks the room to show it", () => {
    const onShow = vi.fn();
    render(<StageRail roomStage="dropin" shown="dropin" onShow={onShow} />);
    fireEvent.click(screen.getByRole("button", { name: STAGE_DEFS.close.short }));
    expect(onShow).toHaveBeenCalledWith("close");
  });
});

describe("one gold button in the facilitator's bar", () => {
  it("Begin, Next stage and Move the room here each wear the gold, one at a time", () => {
    const { container, rerender } = render(<FacilitatorBar view={makeView({ me: FACILITATOR })} actions={doors()} shown="dropin" onMoved={() => {}} />);
    expect(container.querySelectorAll("[data-forward]")).toHaveLength(1);
    expect(screen.getByRole("button", { name: ROOM_COPY.beginSession })).toHaveAttribute("data-forward");
    rerender(<FacilitatorBar view={makeView({ me: FACILITATOR, state: started() })} actions={doors()} shown="dropin" onMoved={() => {}} />);
    expect(container.querySelectorAll("[data-forward]")).toHaveLength(1);
    rerender(<FacilitatorBar view={makeView({ me: FACILITATOR, state: started() })} actions={doors()} shown="close" onMoved={() => {}} />);
    expect(container.querySelectorAll("[data-forward]")).toHaveLength(1);
    expect(screen.getByRole("button", { name: ROOM_COPY.moveHere })).toHaveAttribute("data-forward");
    // Everything else on the bar is quiet.
    expect(screen.getByRole("button", { name: ROOM_COPY.showCues })).not.toHaveAttribute("data-forward");
  });

  it("sets the forward button at the end of the rail it is handed", () => {
    render(
      <FacilitatorBar
        view={makeView({ me: FACILITATOR, state: started() })}
        actions={doors()}
        shown="dropin"
        onMoved={() => {}}
        rail={<StageRail roomStage="dropin" shown="dropin" onShow={() => {}} />}
      />,
    );
    const nav = screen.getByRole("navigation", { name: ROOM_COPY.stagesLabel });
    const forward = screen.getByRole("button", { name: `${ROOM_COPY.nextStage}: ${STAGE_DEFS.arrival.short}` });
    // The rail and the gold button share one row, the button after the path.
    expect(nav.parentElement!.parentElement).toBe(forward.parentElement!.parentElement);
    expect(nav.compareDocumentPosition(forward) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the session's title is a door", () => {
  const pencil = () => screen.queryByRole("button", { name: ROOM_COPY.editThis(ROOM_COPY.sessionTitleLabel) });
  const as = (me: SessionView["me"], over: Partial<SessionView> = {}) => makeView({ me, ...over });

  it("the facilitator, the note taker and an admin who joined get the pencil; a member does not", () => {
    const header = (view: SessionView) => <RoomHeader view={view} now={T0} actions={doors()} shown="agenda" />;
    const { rerender } = render(header(as(FACILITATOR)));
    expect(pencil()).toBeInTheDocument();
    rerender(header(as({ userId: 3, joined: true, facilitates: false, secretary: true, admin: false })));
    expect(pencil()).toBeInTheDocument();
    rerender(header(as({ userId: 2, joined: true, facilitates: false, secretary: false, admin: true })));
    expect(pencil()).toBeInTheDocument();
    rerender(header(makeView()));
    expect(pencil()).not.toBeInTheDocument();
    // An admin who has not joined sees what a visitor sees: the server asks everyone to join first.
    rerender(header(as({ userId: 2, joined: false, facilitates: false, secretary: false, admin: true })));
    expect(pencil()).not.toBeInTheDocument();
    rerender(header(as(FACILITATOR, { status: "closed" })));
    expect(pencil()).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Water circle" })).toBeInTheDocument();
  });

  it("Save sends the new title through patchSession", async () => {
    render(<RoomHeader view={as(FACILITATOR)} now={T0} actions={doors()} shown="agenda" />);
    fireEvent.click(pencil()!);
    const box = screen.getByRole("textbox", { name: ROOM_COPY.sessionTitleLabel });
    fireEvent.change(box, { target: { value: "  Water circle,  October  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(log).toEqual([{ door: "patchSession", args: [{ title: "Water circle, October" }, { quiet: true }] }]));
  });

  it("a refusal keeps the box open with the server's sentence, and the heading unchanged", async () => {
    const refusing = doors();
    refusing.patchSession = async (...args) => {
      log.push({ door: "patchSession", args });
      return { ok: false, status: 403, error: "Only the facilitator can change that.", body: {}, room: null };
    };
    render(<RoomHeader view={as(FACILITATOR)} now={T0} actions={refusing} shown="agenda" />);
    fireEvent.click(pencil()!);
    const box = screen.getByRole("textbox", { name: ROOM_COPY.sessionTitleLabel });
    fireEvent.change(box, { target: { value: "Fire circle" } });
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the facilitator can change that.");
    expect(screen.getByRole("textbox", { name: ROOM_COPY.sessionTitleLabel })).toHaveValue("Fire circle");
    expect(screen.queryByRole("heading", { level: 1, name: "Fire circle" })).not.toBeInTheDocument();
    expect(screen.queryByText(ROOM_COPY.saved)).not.toBeInTheDocument();
  });
});

describe("figures in the display face stand at capital height", () => {
  // A garden serif draws old-style figures, and "D1" then reads as "DI".
  it("the session's title, a stage's title, an item's title and what we learned all ask for lining figures", () => {
    render(<RoomHeader view={makeView({ title: "D1 water circle" })} now={T0} actions={doors()} shown="agenda" />);
    expect(screen.getByRole("heading", { level: 1, name: "D1 water circle" })).toHaveClass("lining-nums");
    for (const look of [STAGE_TITLE, ITEM_TITLE, LEARNED_QUOTE]) expect(look.split(" ")).toContain("lining-nums");
  });
});

describe("the clock is a figure", () => {
  it("prints the minutes in the body face, with the whole sentence for a screen reader", () => {
    const { container } = render(<RoomHeader view={makeView({ me: FACILITATOR, state: started("agenda") })} now={T0} actions={doors()} shown="agenda" />);
    const clock = container.querySelector("[data-room-clock]")!;
    expect(clock.tagName).toBe("DL");
    expect(clock.className).toMatch(/\bfont-body\b/);
    const count = clock.querySelector("dd")!;
    expect(count).toHaveTextContent(/^0$/);
    expect(count.className).toMatch(/\bfont-body\b/);
    expect(clock).toHaveTextContent("60");
    expect(screen.getByText(ROOM_COPY.clockLine(0, 60))).toHaveClass("sr-only");
  });
});

describe("a person is a face", () => {
  it("draws the stock art when the member fronts a character, and initials otherwise", () => {
    const { container, rerender } = render(<PersonDisc person={{ name: "Ada Moss", present: true, avatar: "/characters/weaver.png" }} />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "/characters/weaver.png");
    expect(img).toHaveAttribute("alt", "");
    rerender(<PersonDisc person={{ name: "Ada Moss", present: true, avatar: null }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("AM");
  });

  it("here wears the gold ring, away the dashed edge", () => {
    const { container, rerender } = render(<PersonDisc person={{ name: "Cy Reed", present: true }} />);
    expect(container.querySelector("[data-person-disc] > span")!.className).toMatch(/ring-notice/);
    rerender(<PersonDisc person={{ name: "Cy Reed", present: false }} />);
    expect(container.querySelector("[data-person-disc] > span")!.className).toMatch(/border-dashed/);
  });

  it("the facilitator's star and the note taker's pen each carry their word", () => {
    const { rerender } = render(<PersonDisc person={{ name: "Ada Moss", present: true }} mark="facilitator" />);
    expect(screen.getByText(ROOM_COPY.facilitating)).toHaveClass("sr-only");
    rerender(<PersonDisc person={{ name: "Ada Moss", present: true }} mark="notes" />);
    expect(screen.getByText(ROOM_COPY.noteTaking)).toHaveClass("sr-only");
  });

  it("the header's strip names every face for a screen reader, and counts who is here", () => {
    const { container } = render(<RoomHeader view={makeView()} now={T0} actions={doors()} shown="agenda" />);
    const list = screen.getByRole("list", { name: ROOM_COPY.whoIsHere });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(list).toHaveTextContent("Cy Reed");
    expect(list).toHaveTextContent(ROOM_COPY.away);
    expect(container.querySelector("li[title='Ada Moss']")).not.toBeNull();
    expect(screen.getByText(ROOM_COPY.holding)).toBeInTheDocument();
    expect(screen.getByText(ROOM_COPY.here).closest("div")).toHaveTextContent("2");
  });
});
