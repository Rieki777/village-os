// @vitest-environment jsdom
/**
 * "Sleep on it" with an answer-by time (0281; Rye, 2026-10-23), in the room
 * and on the closed record.
 *
 * What each case holds: a night cannot be sent without its time, a quick
 * choice fills it and the time goes with the answer; the round says until
 * when each night lasts, by name, and that a night which ended counts as no
 * objection; on the record, whoever asked for a night answers it while it
 * lasts on the room's clock, the facilitator marks a round that consented
 * decided, what landed is read out from the record with the focus on the
 * proposal, and a refusal is said in the server's words.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CONSENT_LABELS, ROOM_COPY, type NightRound, type SessionView } from "@shared/sessions";
import { json, makeView } from "./__tests__/roomFixture";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: () => true }));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> };
});

import ClosedRecord from "./ClosedRecord";
import ConsentRound from "./ConsentRound";
import NightAfterCall from "./NightAfterCall";
import { localInputValue, nightWhen, nineAfter } from "./roomUi";
import type { RoomActions } from "./useSessionRoom";

type Logged = { name: string; args: unknown[] };

/** Every door of the room, answering yes and writing down what it was asked, or a refusal when one is named. */
function doors(log: Logged[], refuse: Record<string, string> = {}): RoomActions {
  return new Proxy({} as RoomActions, {
    get: (_t, name: string) => async (...args: unknown[]) => {
      log.push({ name, args });
      return refuse[name] ? { ok: false, status: 409, error: refuse[name], body: {}, room: null } : { ok: true, body: {}, room: null };
    },
  });
}

const proposal = { id: 5, itemId: null, kind: "decision" as const, text: "We fill the tanks on Mondays.", status: "open" as const };
const roomWith = (over: Partial<SessionView> = {}) => makeView({ entries: [proposal as any], ...over });

describe("a night in the room", () => {
  it("cannot be sent without a time; a quick choice fills it, and the time goes with the answer", async () => {
    const log: Logged[] = [];
    render(<ConsentRound view={roomWith()} actions={doors(log)} target="decision:5" ask="Do we consent?" />);
    fireEvent.click(screen.getByRole("radio", { name: CONSENT_LABELS.sleep }));
    expect(screen.getByText(ROOM_COPY.nightHint)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ROOM_COPY.consentSend })).toBeDisabled();
    const at = nineAfter(Date.now(), 2);
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.nightTwoDays }));
    expect((screen.getByLabelText(ROOM_COPY.nightTimeLabel) as HTMLInputElement).value).toBe(localInputValue(at));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.consentSend }));
    await waitFor(() => expect(log).toHaveLength(1));
    expect(log[0]).toEqual({ name: "respond", args: ["decision:5", "sleep", null, { quiet: true }, new Date(at).toISOString()] });
  });

  it("says until when each night lasts, by name, and that one which ended counts as no objection", () => {
    const now = Date.now();
    const lasts = now + 3 * 3_600_000;
    const ended = now - 60_000;
    const view = roomWith({
      responses: [
        { target: "decision:5", userId: 1, value: "sleep", text: null, answerBy: new Date(lasts).toISOString() },
        { target: "decision:5", userId: 3, value: "sleep", text: null, answerBy: new Date(ended).toISOString() },
      ],
    });
    render(<ConsentRound view={view} actions={doors([])} target="decision:5" ask="Do we consent?" />);
    expect(screen.getByText(ROOM_COPY.nightOpen("Ada Moss", nightWhen(lasts, now)))).toBeInTheDocument();
    expect(screen.getByText(ROOM_COPY.nightOver("Cy Reed", nightWhen(ended, now)))).toBeInTheDocument();
    expect(screen.getByText(/1 no objection by default/)).toBeInTheDocument();
    // Both nights carry a time, so the old line for a night with none does not show.
    expect(screen.queryByText(ROOM_COPY.sleepingOpen)).not.toBeInTheDocument();
  });
});

describe("a round that outlived its call, on the record", () => {
  const closed = (responses: SessionView["responses"]) => roomWith({ status: "closed", responses });
  const round = (over: Partial<NightRound> = {}): NightRound => ({ entryId: 5, open: true, consented: false, canAnswer: false, canDecide: false, ...over });

  it("lets whoever asked for a night answer it, a concern in one sentence, and hands what landed to the record", async () => {
    const at = Date.now() + 3_600_000;
    const view = closed([{ target: "decision:5", userId: 2, value: "sleep", text: null, answerBy: new Date(at).toISOString() }]);
    const log: Logged[] = [];
    const done = vi.fn();
    render(<NightAfterCall view={view} entryId={5} round={round({ canAnswer: true })} actions={doors(log)} onDone={done} />);
    expect(screen.getByText(ROOM_COPY.recordNightYours(nightWhen(at, Date.now())))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: CONSENT_LABELS.concern }));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.consentSend }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ROOM_COPY.consentNeedsSentence);
    expect(log).toEqual([]);
    fireEvent.change(screen.getByLabelText(ROOM_COPY.consentSentence), { target: { value: "Mondays clash with the market." } });
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.consentSend }));
    await waitFor(() => expect(log).toEqual([{ name: "answerNight", args: [5, "concern", "Mondays clash with the market.", { quiet: true }] }]));
    await waitFor(() => expect(done).toHaveBeenCalledWith(ROOM_COPY.nightAnswered));
    expect(screen.queryByRole("radio", { name: CONSENT_LABELS.sleep })).not.toBeInTheDocument();
  });

  it("offers no answer once the night has passed on the room's clock, whatever the last poll said", () => {
    const at = Date.now() + 60_000;
    const view = closed([{ target: "decision:5", userId: 2, value: "sleep", text: null, answerBy: new Date(at).toISOString() }]);
    render(<NightAfterCall view={view} entryId={5} round={round({ canAnswer: true })} actions={doors([])} now={at + 1} />);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByText(ROOM_COPY.nightOver("Bo Fern", nightWhen(at, at + 1)))).toBeInTheDocument();
  });

  it("offers the facilitator Mark it decided once the round consented, and says a refusal in the server's words", async () => {
    const log: Logged[] = [];
    const view = closed([{ target: "decision:5", userId: 3, value: "sleep", text: null, answerBy: new Date(Date.now() - 60_000).toISOString() }]);
    render(<NightAfterCall view={view} entryId={5} round={round({ open: false, consented: true, canDecide: true })} actions={doors(log, { decideAfterNight: "Only the person facilitating can do that." })} />);
    expect(screen.getByText(ROOM_COPY.recordConsented)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.markDecided }));
    await waitFor(() => expect(log).toEqual([{ name: "decideAfterNight", args: [5, { quiet: true }] }]));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the person facilitating can do that.");
  });

  describe("inside the record", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn(async () => json({ tasks: [], mail: { canSend: false, lastSend: null } })));
    });
    // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    it("reads out a decision marked after the night, with the focus on the proposal", async () => {
      const log: Logged[] = [];
      const view = makeView({
        status: "closed",
        closedAt: "2026-10-02T18:00:00.000Z",
        entries: [proposal as any],
        responses: [{ target: "decision:5", userId: 3, value: "sleep", text: null, answerBy: new Date(Date.now() - 60_000).toISOString() }],
        nights: [round({ open: false, consented: true, canDecide: true })],
        me: { userId: 1, joined: true, facilitates: true, secretary: false, admin: false },
      });
      render(<ClosedRecord view={view} actions={doors(log)} />);
      fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.markDecided }));
      await waitFor(() => expect(document.activeElement?.id).toBe("record-decision-5"));
      expect(screen.getByText(ROOM_COPY.decidedAfterNight)).toBeInTheDocument();
      expect(log).toEqual([{ name: "decideAfterNight", args: [5, { quiet: true }] }]);
    });
  });

  it("says a settled round that did not consent, and offers nothing to do", () => {
    render(<NightAfterCall view={closed([])} entryId={5} round={round({ open: false })} actions={doors([])} />);
    expect(screen.getByText(ROOM_COPY.recordNotConsented)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
