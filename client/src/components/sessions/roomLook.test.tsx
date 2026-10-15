// @vitest-environment jsdom
/**
 * How the room reads and where its controls sit: the facilitator's one
 * forward button, the drawn moon and a village's own season names, each
 * thing said once on Drop in, the breath that speaks only when it starts and
 * ends, and the names under a consent tally of who is still to answer.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  ROOM_COPY,
  SESSION_COPY,
  SESSION_SOMEONE,
  STAGE_DEFS,
  defaultSessionState,
  type SessionEntry,
  type SessionView,
} from "@shared/sessions";
import { T0, makeView } from "./__tests__/roomFixture";
import type { RoomActions, WriteResult } from "./useSessionRoom";

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> };
});

import ConsentRound from "./ConsentRound";
import FacilitatorBar from "./FacilitatorBar";
import { OpenProposals } from "./Proposal";
import RoomHeader from "./RoomHeader";
import RoomMoon, { skyLine } from "./RoomMoon";
import SharedBreath, { breathAnnouncement } from "./SharedBreath";
import StageDropIn from "./StageDropIn";
import { forgetDrafts, waitingNames } from "./roomUi";

let log: { door: keyof RoomActions; args: unknown[] }[];

function doors(): RoomActions {
  const ok = async (door: keyof RoomActions, ...args: unknown[]): Promise<WriteResult<any>> => {
    log.push({ door, args });
    return { ok: true, body: {}, room: null };
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
