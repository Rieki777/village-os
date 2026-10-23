// @vitest-environment jsdom
/**
 * Sending a room's tension to a circle's agenda items (feature 2).
 *
 * What each case holds: whoever named a tension sees "Send to a circle's
 * agenda items" under it in the room's backlog, and somebody who neither named
 * it nor hosts does not; the send names the circle chosen (this room's own
 * first) or none, after saying who will read the words; a tension sent already
 * says where it went instead; a refusal is said in the server's words; and
 * "From last time" offers the send for an earlier session's tension, naming
 * that session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TENSION_SEND_COPY } from "@shared/sessionLibrary";
import type { SessionEntry } from "@shared/sessions";
import type { RoomActions, WriteResult } from "./useSessionRoom";
import { makeView } from "./__tests__/roomFixture";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: () => false }));

import TensionCatcher from "./TensionCatcher";
import FromLastTime from "./FromLastTime";

let sent: unknown[];
let answer: WriteResult<any>;

function doors(): RoomActions {
  const ok = async (): Promise<WriteResult<any>> => ({ ok: true, body: {}, room: null });
  return new Proxy({} as RoomActions, {
    get: (_t, key) =>
      key === "sendTension"
        ? async (input: unknown) => {
            sent.push(input);
            return answer;
          }
        : key === "library"
          ? async () => []
          : ok,
  });
}

const tension = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  id: 70,
  itemId: null,
  kind: "tension",
  text: "The water rota leaves Sundays to whoever notices.",
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

beforeEach(() => {
  sent = [];
  answer = { ok: true, body: {}, room: null };
});

describe("sending a tension from the room's backlog", () => {
  it("is offered to whoever named it, and sends to the circle chosen after saying who reads it", async () => {
    // The fixture's viewer is person 2, who named this tension; the room is the Water circle's.
    const view = makeView({ circleId: "water", entries: [tension()] });
    render(<TensionCatcher view={view} actions={doors()} />);
    fireEvent.click(screen.getByRole("button", { name: TENSION_SEND_COPY.send }));
    const group = screen.getByRole("group", { name: TENSION_SEND_COPY.send });
    expect(within(group).getByText(TENSION_SEND_COPY.warning)).toBeInTheDocument();
    // This room's own circle is chosen first.
    expect((within(group).getByLabelText(TENSION_SEND_COPY.circleLabel) as HTMLSelectElement).value).toBe("water");
    fireEvent.change(within(group).getByLabelText(TENSION_SEND_COPY.circleLabel), { target: { value: "garden" } });
    fireEvent.click(within(group).getByRole("button", { name: TENSION_SEND_COPY.sendYes }));
    await waitFor(() => expect(sent).toEqual([{ sessionId: view.id, entryId: 70, circleId: "garden" }]));
  });

  it("sends to no circle in particular when that is chosen", async () => {
    const view = makeView({ entries: [tension()] });
    render(<TensionCatcher view={view} actions={doors()} />);
    fireEvent.click(screen.getByRole("button", { name: TENSION_SEND_COPY.send }));
    fireEvent.change(screen.getByLabelText(TENSION_SEND_COPY.circleLabel), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: TENSION_SEND_COPY.sendYes }));
    await waitFor(() => expect(sent).toEqual([{ sessionId: view.id, entryId: 70, circleId: null }]));
  });

  it("is not offered to somebody who neither named it nor hosts", () => {
    render(<TensionCatcher view={makeView({ entries: [tension({ authorUserId: 1 })] })} actions={doors()} />);
    expect(screen.queryByRole("button", { name: TENSION_SEND_COPY.send })).toBeNull();
  });

  it("says where a tension went once it was sent", () => {
    render(<TensionCatcher view={makeView({ entries: [tension()], sentTensions: { "70": { circleName: "Garden" } } })} actions={doors()} />);
    expect(screen.getByText(TENSION_SEND_COPY.sent("Garden"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TENSION_SEND_COPY.send })).toBeNull();
  });

  it("says a refusal in the server's words", async () => {
    answer = { ok: false, status: 409, error: "That tension has been sent to agenda items already.", body: {}, room: null };
    render(<TensionCatcher view={makeView({ entries: [tension()] })} actions={doors()} />);
    fireEvent.click(screen.getByRole("button", { name: TENSION_SEND_COPY.send }));
    fireEvent.click(screen.getByRole("button", { name: TENSION_SEND_COPY.sendYes }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That tension has been sent to agenda items already.");
  });
});

describe("sending a tension from From last time", () => {
  it("names the earlier session the tension was named in", async () => {
    const view = makeView({
      carried: { sessionId: 41, title: "Water, week 1", actions: [], backlog: [tension({ id: 9, authorUserId: 3 })], parkedItems: [] },
    });
    render(<FromLastTime view={view} actions={doors()} />);
    fireEvent.click(screen.getByRole("button", { name: TENSION_SEND_COPY.send }));
    fireEvent.click(screen.getByRole("button", { name: TENSION_SEND_COPY.sendYes }));
    await waitFor(() => expect(sent).toEqual([expect.objectContaining({ sessionId: 41, entryId: 9 })]));
  });
});
