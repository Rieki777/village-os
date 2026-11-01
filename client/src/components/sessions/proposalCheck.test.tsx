// @vitest-environment jsdom
/**
 * A proposal's check in the room (0297, shared/sessionCheck.ts): who sees the
 * button, what the card says once a check exists, and that nothing shows
 * where the village offers no checks. Recorded doors stand in for the server.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SessionEntry, SessionView } from "@shared/sessions";
import { CHECK_COPY, type CheckView, type EntryCheck } from "@shared/sessionCheck";
import { T0, makeView } from "./__tests__/roomFixture";
import type { RoomActions, WriteResult } from "./useSessionRoom";

vi.mock("@/components/MicButton", () => ({ default: () => null }));

import Proposal, { mayCheck } from "./Proposal";

let checked: number[] = [];
function doors(): RoomActions {
  const ok = async (): Promise<WriteResult<any>> => ({ ok: true, body: {}, room: null });
  return {
    join: ok,
    patchSession: ok,
    arrival: ok,
    addItem: ok,
    patchItem: ok,
    addEntry: ok,
    patchEntry: ok,
    deleteEntry: ok,
    respond: ok,
    answerNight: ok,
    decideAfterNight: ok,
    act: ok,
    hosts: ok,
    close: ok,
    toolFeedback: ok,
    discard: ok,
    library: async () => [],
    bringFromLibrary: ok,
    sendTension: ok,
    checkEntry: async (entryId) => {
      checked.push(entryId);
      return { ok: true, body: {}, room: null };
    },
  };
}

const proposal = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  id: 80,
  itemId: null,
  kind: "decision",
  text: "The Treasurer fixes the water system",
  status: "open",
  authorUserId: 2,
  ownerUserId: null,
  ownerName: null,
  ownerSeatId: null,
  ownerSeatName: null,
  dueOn: null,
  createdAt: "2026-10-09T17:10:00.000Z",
  ...over,
});

const PROPOSER = { userId: 2, joined: true, facilitates: false, secretary: false, admin: false };
const FACILITATOR = { userId: 1, joined: true, facilitates: true, secretary: false, admin: false };
const OTHER = { userId: 3, joined: true, facilitates: false, secretary: false, admin: false };

const CHECK: EntryCheck = {
  at: new Date(T0).toISOString(),
  read: {
    season: "Rains",
    priorities: [
      { text: "Fix the water system", named: true },
      { text: "Open the guest house", named: false },
    ],
    roles: [
      { seatId: "seat-tre", name: "Treasurer", holder: "away" },
      { seatId: "seat-kit", name: "Kitchen", holder: "open" },
    ],
    hasPurpose: true,
    purposeWrittenAt: "2026-09-23T10:00:00.000Z",
  },
  changed: false,
  purposeChanged: false,
};

const offer = (byEntry: Record<string, EntryCheck> = {}): CheckView => ({ agent: "Sera", purpose: "We serve the valley and its water.", byEntry });
const roomWith = (over: Partial<SessionView> = {}) => makeView({ entries: [proposal()], check: offer(), ...over });

afterEach(() => {
  cleanup();
  checked = [];
});

describe("who may check", () => {
  it("offers the button to the proposer and the facilitator, and presses the door", async () => {
    for (const me of [PROPOSER, FACILITATOR]) {
      const view = roomWith({ me });
      render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} now={T0} />);
      fireEvent.click(screen.getByRole("button", { name: CHECK_COPY.button("Sera") }));
      await waitFor(() => expect(checked).toEqual([80]));
      cleanup();
      checked = [];
    }
  });

  it("offers nobody else the button", () => {
    const view = roomWith({ me: OTHER });
    render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} now={T0} />);
    expect(screen.queryByRole("button", { name: CHECK_COPY.button("Sera") })).toBeNull();
  });

  it("matches the server's rule: open room, joined, open proposal, facilitator or admin or proposer", () => {
    const e = proposal();
    expect(mayCheck(roomWith({ me: PROPOSER }), e)).toBe(true);
    expect(mayCheck(roomWith({ me: { ...OTHER, admin: true } }), e)).toBe(true);
    expect(mayCheck(roomWith({ me: OTHER }), e)).toBe(false);
    expect(mayCheck(roomWith({ me: { ...PROPOSER, joined: false } }), e)).toBe(false);
    expect(mayCheck(roomWith({ me: PROPOSER, status: "closed" }), e)).toBe(false);
    expect(mayCheck(roomWith({ me: PROPOSER }), proposal({ status: "done" }))).toBe(false);
    expect(mayCheck(roomWith({ me: PROPOSER, check: null }), e)).toBe(false);
  });

  it("draws nothing where the village offers no checks", () => {
    const view = roomWith({ me: FACILITATOR, check: null });
    render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} now={T0} />);
    expect(screen.queryByRole("button", { name: CHECK_COPY.button("Sera") })).toBeNull();
    expect(document.querySelector("[data-check]")).toBeNull();
  });
});

describe("the card", () => {
  it("shows everybody the purpose, the priorities named, the roles and where each holder is", () => {
    const view = roomWith({ me: OTHER, check: offer({ "80": CHECK }) });
    render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} now={T0} />);
    expect(screen.getByText(CHECK_COPY.title)).toBeInTheDocument();
    expect(screen.getByText("We serve the valley and its water.")).toBeInTheDocument();
    expect(screen.getByText(CHECK_COPY.prioritiesTitle("Rains"))).toBeInTheDocument();
    const named = document.querySelectorAll("[data-named]");
    expect(named).toHaveLength(1);
    expect(named[0]!.textContent).toContain("Fix the water system");
    expect(screen.getByText(`Treasurer: ${CHECK_COPY.holder.away}`)).toBeInTheDocument();
    expect(screen.getByText(`Kitchen: ${CHECK_COPY.holder.open}`)).toBeInTheDocument();
    expect(screen.getByText(CHECK_COPY.agentLine("Sera"))).toBeInTheDocument();
    expect(screen.queryByText(CHECK_COPY.changed)).toBeNull();
  });

  it("says when the words or the purpose changed since, and offers a check again", () => {
    const view = roomWith({ me: PROPOSER, check: offer({ "80": { ...CHECK, changed: true, purposeChanged: true } }) });
    render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} now={T0} />);
    expect(screen.getByText(CHECK_COPY.changed)).toBeInTheDocument();
    expect(screen.getByText(CHECK_COPY.purposeRewritten)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CHECK_COPY.again })).toBeInTheDocument();
  });

  it("says the village has no purpose yet, no season and no role when the read holds none", () => {
    const empty: EntryCheck = { ...CHECK, read: { season: null, priorities: [], roles: [], hasPurpose: false, purposeWrittenAt: "" } };
    const view = roomWith({ me: OTHER, check: { agent: "Sera", purpose: null, byEntry: { "80": empty } } });
    render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} now={T0} />);
    expect(screen.getByText(CHECK_COPY.noPurpose)).toBeInTheDocument();
    expect(screen.getByText(CHECK_COPY.noSeason)).toBeInTheDocument();
    expect(screen.getByText(CHECK_COPY.noRoles)).toBeInTheDocument();
  });

  it("says the purpose was written, not rewritten, when there was none at the check", () => {
    const before: EntryCheck = { ...CHECK, purposeChanged: true, read: { ...CHECK.read, hasPurpose: false, purposeWrittenAt: "" } };
    const view = roomWith({ me: OTHER, check: offer({ "80": before }) });
    render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} now={T0} />);
    expect(screen.getByText(CHECK_COPY.purposeWritten)).toBeInTheDocument();
    expect(screen.queryByText(CHECK_COPY.purposeRewritten)).toBeNull();
  });

  it("on a decided proposal whose words changed, says so without asking for another check", () => {
    const view = roomWith({ me: FACILITATOR, entries: [proposal({ status: "done" })], check: offer({ "80": { ...CHECK, changed: true } }) });
    render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} now={T0} />);
    expect(screen.getByText(CHECK_COPY.changedDecided)).toBeInTheDocument();
    expect(screen.queryByText(CHECK_COPY.changed)).toBeNull();
  });

  it("keeps the card on a decided proposal, with no button", () => {
    const view = roomWith({ me: FACILITATOR, entries: [proposal({ status: "done" })], check: offer({ "80": CHECK }) });
    render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} now={T0} />);
    expect(screen.getByText(CHECK_COPY.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CHECK_COPY.again })).toBeNull();
  });
});
