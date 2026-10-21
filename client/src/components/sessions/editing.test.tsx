// @vitest-environment jsdom
/**
 * Editing in the room, wave 2: every card a person wrote can be fixed in place
 * by whoever the server lets change it, every box grows with its words, and
 * what stays final on purpose says why.
 *
 * Rye's first call found three things: no card could be edited ("be able to
 * edit all cards", "I should be able to edit this too to fix my typo"), the
 * add-an-action box was squeezed to one letter, and the boxes were too small
 * to read while typing. These cases hold each of those shut, through the same
 * stages and cards the room draws, with recorded doors standing in for the
 * server.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  ENTRY_LABELS,
  ROOM_COPY,
  SESSION_COPY,
  SESSION_LIMITS,
  SESSION_REFUSALS,
  defaultSessionState,
  type EntryKind,
  type SessionEntry,
  type SessionItem,
  type SessionView,
} from "@shared/sessions";
import { T0, makeView } from "./__tests__/roomFixture";
import type { RoomActions, WriteResult } from "./useSessionRoom";

// The browser's speech engine is absent in jsdom, so the voice button would
// draw nothing. A stand-in says one phrase when pressed, the way MicButton
// hands each finished phrase to `onText`.
vi.mock("@/components/MicButton", () => ({
  default: ({ onText, disabled }: { onText: (t: string) => void; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onText("spoken words")}>
      Speak
    </button>
  ),
}));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> };
});

import AgendaList from "./AgendaList";
import { AddAction } from "./ActionRow";
import EntryStream from "./EntryStream";
import FromLastTime from "./FromLastTime";
import GrowingText from "./GrowingText";
import ItemPage from "./ItemPage";
import Proposal from "./Proposal";
import { forgetDrafts } from "./roomUi";
import StageActions from "./StageActions";
import TensionCatcher from "./TensionCatcher";

type Rec = { door: keyof RoomActions; args: unknown[] };
let log: Rec[];
/** Doors the server refuses, with the sentence it refuses in. */
let refuse: Map<keyof RoomActions, string>;
/** While set, every door waits on it: a save that is still out. */
let hold: Promise<void> | null;

function doors(): RoomActions {
  const ok = async (door: keyof RoomActions, ...args: unknown[]): Promise<WriteResult<any>> => {
    log.push({ door, args });
    if (hold) await hold;
    const no = refuse.get(door);
    if (no) return { ok: false, status: 403, error: no, body: {}, room: null };
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
  };
}

const item = (over: Partial<SessionItem> = {}): SessionItem => ({
  id: 5,
  title: "Roof",
  aim: "decide",
  minutes: 10,
  position: 1,
  status: "active",
  presenterUserId: null,
  addedBy: 1,
  startedAt: null,
  endedAt: null,
  usedSeconds: 0,
  fromSessionId: null,
  ...over,
});

const entry = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  id: 80,
  itemId: 5,
  kind: "note",
  text: "Status of D1 ~3 months from now",
  status: "open",
  authorUserId: 2,
  ownerUserId: null,
  ownerName: null,
  ownerSeatId: null,
  ownerSeatName: null,
  dueOn: null,
  createdAt: "2026-10-14T17:30:00.000Z",
  ...over,
});

// Who is reading the page. Bo (2) wrote every card unless a case says otherwise.
const AUTHOR = { userId: 2, joined: true, facilitates: false, secretary: false, admin: false };
const FACILITATOR = { userId: 1, joined: true, facilitates: true, secretary: false, admin: false };
const SECRETARY = { userId: 3, joined: true, facilitates: false, secretary: true, admin: false };
const ADMIN_IN = { userId: 4, joined: true, facilitates: false, secretary: false, admin: true };
const ADMIN_OUT = { ...ADMIN_IN, joined: false };
const OTHER = { userId: 3, joined: true, facilitates: false, secretary: false, admin: false };

const onItem = (over: Partial<SessionView> = {}) =>
  makeView({ items: [item()], state: { ...defaultSessionState(), stage: "items", activeItemId: 5, itemStartedAt: T0 }, ...over });

/** The six kinds of card, each drawn by the part of the room that draws it. */
const KINDS: { kind: EntryKind; multi: boolean; text: string }[] = [
  { kind: "note", multi: true, text: "Status of D1 ~3 months from now" },
  { kind: "idea", multi: true, text: "Ask the river group" },
  { kind: "seed", multi: false, text: "Rain comes before the roof" },
  { kind: "decision", multi: true, text: "Fix the roof before the rains" },
  { kind: "action", multi: false, text: "Setup Claude to connetct with Google Docs" },
  { kind: "tension", multi: true, text: "The well pump is loud" },
];

function place(kind: EntryKind, view: SessionView) {
  const actions = doors();
  const e = view.entries[0]!;
  switch (kind) {
    case "note":
    case "idea":
      return <EntryStream view={view} actions={actions} kind={kind} itemId={5} title={ROOM_COPY.notes} addLabel={SESSION_COPY.addNote} />;
    case "seed":
      return <ItemPage view={view} now={T0} actions={actions} item={view.items[0]!} />;
    case "decision":
      return <Proposal view={view} actions={actions} entry={e} />;
    case "action":
      return <StageActions view={view} now={T0} actions={actions} />;
    case "tension":
      return <TensionCatcher view={view} actions={actions} />;
  }
}

const word = (kind: EntryKind) => ENTRY_LABELS[kind].toLowerCase();
const pencil = (kind: EntryKind) => screen.queryByRole("button", { name: ROOM_COPY.editThis(word(kind)) });
const box = (kind: EntryKind) => screen.getByRole("textbox", { name: word(kind) });

beforeEach(() => {
  log = [];
  refuse = new Map();
  hold = null;
  forgetDrafts();
});

describe.each(KINDS)("a $kind card", ({ kind, multi, text }) => {
  const view = (me: SessionView["me"], over: Partial<SessionEntry> = {}) =>
    onItem({ entries: [entry({ kind, text, itemId: kind === "tension" ? null : 5, ...over })], me });

  it("shows the pencil to its author, the facilitator, the note taker and an admin in the room", () => {
    for (const me of [AUTHOR, FACILITATOR, SECRETARY, ADMIN_IN]) {
      const { unmount } = render(place(kind, view(me)));
      expect(pencil(kind), `userId ${me.userId}`).toBeInTheDocument();
      unmount();
    }
  });

  it("shows no pencil to a member who did not write it, or to an admin who has not joined", () => {
    for (const me of [OTHER, ADMIN_OUT]) {
      const { unmount } = render(place(kind, view(me)));
      expect(pencil(kind)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("opens on a tap of its words, and Enter saves the new words", async () => {
    render(place(kind, view(AUTHOR)));
    fireEvent.click(screen.getByText(text));
    expect(box(kind)).toHaveValue(text);
    // Rye's two typos, and a few more words on every other kind.
    const fixed = text.includes("connetct") || text.includes("~3") ? text.replace("connetct", "connect").replace("~3", "about three") : `${text}, again`;
    fireEvent.change(box(kind), { target: { value: `${fixed} ` } });
    fireEvent.keyDown(box(kind), { key: "Enter" });
    await waitFor(() => expect(log.find((r) => r.door === "patchEntry")).toBeDefined());
    const call = log.find((r) => r.door === "patchEntry")!;
    expect(call.args[0]).toBe(80);
    expect(call.args[1]).toEqual({ text: fixed });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: word(kind) })).not.toBeInTheDocument());
    expect(screen.getByText(ROOM_COPY.saved)).toBeInTheDocument();
  });

  it(multi ? "Shift and Enter starts a new line and sends nothing" : "Shift and Enter does nothing in a one-line card", () => {
    render(place(kind, view(AUTHOR)));
    fireEvent.click(pencil(kind)!);
    const notPrevented = fireEvent.keyDown(box(kind), { key: "Enter", shiftKey: true });
    // A new line is the browser's own default, so a multi-line box lets it through.
    expect(notPrevented).toBe(multi);
    fireEvent.change(box(kind), { target: { value: "one\ntwo" } });
    expect(box(kind)).toHaveValue(multi ? "one\ntwo" : "one two");
    expect(log.filter((r) => r.door === "patchEntry")).toHaveLength(0);
  });

  it("Escape puts the words back and closes the editor", () => {
    render(place(kind, view(AUTHOR)));
    fireEvent.click(pencil(kind)!);
    fireEvent.change(box(kind), { target: { value: "Words never saved" } });
    fireEvent.keyDown(box(kind), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: word(kind) })).not.toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(log).toHaveLength(0);
  });

  it("a refused save stays open with the server's sentence, and never says it saved", async () => {
    refuse.set("patchEntry", SESSION_REFUSALS.notYours);
    render(place(kind, view(AUTHOR)));
    fireEvent.click(pencil(kind)!);
    fireEvent.change(box(kind), { target: { value: "Better words" } });
    fireEvent.keyDown(box(kind), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(SESSION_REFUSALS.notYours);
    expect(box(kind)).toHaveValue("Better words");
    expect(screen.queryByText(ROOM_COPY.saved)).not.toBeInTheDocument();
  });

  it("a poll that changes the words while the editor is open does not write over the draft", () => {
    const { rerender } = render(place(kind, view(AUTHOR)));
    fireEvent.click(pencil(kind)!);
    fireEvent.change(box(kind), { target: { value: "My half edit" } });
    rerender(place(kind, view(AUTHOR, { text: "Somebody else's words" })));
    expect(box(kind)).toHaveValue("My half edit");
  });

  it("a Save with nothing typed, after a poll brought somebody else's fix, sends nothing and keeps their fix", async () => {
    const { rerender } = render(place(kind, view(AUTHOR)));
    fireEvent.click(pencil(kind)!);
    rerender(place(kind, view(AUTHOR, { text: "Somebody else's fix" })));
    // The open box still holds the words it opened on.
    expect(box(kind)).toHaveValue(text);
    fireEvent.keyDown(box(kind), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: word(kind) })).not.toBeInTheDocument());
    expect(log.filter((r) => r.door === "patchEntry")).toHaveLength(0);
    expect(screen.getByText("Somebody else's fix")).toBeInTheDocument();
  });
});

describe("what stays final, and says why", () => {
  it("the holder of an action who did not write it sets its date and gets no pencil", () => {
    const view = onItem({ entries: [entry({ kind: "action", text: "Call the roofer", authorUserId: 1, ownerUserId: 2, ownerName: "Bo Fern" })], me: AUTHOR });
    render(<StageActions view={view} now={T0} actions={doors()} />);
    expect(pencil("action")).not.toBeInTheDocument();
    expect(document.getElementById("action-80-due")).toBeInTheDocument();
  });

  it("editing an open proposal says the consent round starts again", () => {
    const view = onItem({ entries: [entry({ kind: "decision", text: "Fix the roof" })], me: AUTHOR });
    render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} />);
    expect(screen.queryByText(ROOM_COPY.rewordWarn)).not.toBeInTheDocument();
    fireEvent.click(pencil("decision")!);
    expect(screen.getByText(ROOM_COPY.rewordWarn)).toBeInTheDocument();
  });

  it("a decided proposal has no pencil and no remove, even for the facilitator, and says why", () => {
    const view = onItem({ entries: [entry({ kind: "decision", text: "Fix the roof", status: "done" })], me: FACILITATOR });
    render(<Proposal view={view} actions={doors()} entry={view.entries[0]!} />);
    expect(pencil("decision")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROOM_COPY.remove })).not.toBeInTheDocument();
    expect(screen.getByText(ROOM_COPY.decidedLock)).toBeInTheDocument();
  });

  it("a card carried over from a closed session is read and never edited, even by the person who wrote it", () => {
    const carried = { sessionId: 3, title: "Water circle, last moon", actions: [], backlog: [entry({ id: 30, itemId: null, kind: "tension", text: "Paths flood" })], parkedItems: [] };
    render(<FromLastTime view={makeView({ carried, me: AUTHOR })} actions={doors()} />);
    expect(screen.getByText("Paths flood")).toBeInTheDocument();
    expect(pencil("tension")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROOM_COPY.remove })).not.toBeInTheDocument();
  });
});

describe("saving honestly", () => {
  it("says Saving while the answer is out, and Saved only once the server said yes", async () => {
    let open: () => void = () => {};
    hold = new Promise<void>((r) => (open = r));
    const view = onItem({ entries: [entry()], me: AUTHOR });
    render(<EntryStream view={view} actions={doors()} kind="note" itemId={5} title={ROOM_COPY.notes} addLabel={SESSION_COPY.addNote} />);
    fireEvent.click(pencil("note")!);
    fireEvent.change(box("note"), { target: { value: "Status of D1 in three months" } });
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.save }));
    expect(screen.getByRole("button", { name: ROOM_COPY.saving })).toBeDisabled();
    expect(screen.queryByText(ROOM_COPY.saved)).not.toBeInTheDocument();
    await act(async () => {
      hold = null;
      open();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText(ROOM_COPY.saved)).toBeInTheDocument();
  });

  it("saving the same words, or none, closes without sending", () => {
    const view = onItem({ entries: [entry()], me: AUTHOR });
    render(<EntryStream view={view} actions={doors()} kind="note" itemId={5} title={ROOM_COPY.notes} addLabel={SESSION_COPY.addNote} />);
    fireEvent.click(pencil("note")!);
    fireEvent.keyDown(box("note"), { key: "Enter" });
    expect(screen.queryByRole("textbox", { name: "note" })).not.toBeInTheDocument();
    fireEvent.click(pencil("note")!);
    fireEvent.change(box("note"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.save }));
    expect(log).toHaveLength(0);
  });

  it("a half edit comes back when the room moves away and returns", () => {
    const view = onItem({ entries: [entry()], me: AUTHOR });
    const stream = () => <EntryStream view={view} actions={doors()} kind="note" itemId={5} title={ROOM_COPY.notes} addLabel={SESSION_COPY.addNote} />;
    const first = render(stream());
    fireEvent.click(pencil("note")!);
    fireEvent.change(box("note"), { target: { value: "Halfway there" } });
    first.unmount();
    render(stream());
    expect(box("note")).toHaveValue("Halfway there");
  });
});

describe("an item's title", () => {
  const titlePencil = () => screen.queryByRole("button", { name: ROOM_COPY.editThis(ROOM_COPY.itemTitleLabel) });

  it("the person who added it can rename it while it runs, and the heading is still a heading", async () => {
    const view = onItem({ items: [item({ addedBy: 2 })], me: AUTHOR });
    render(<ItemPage view={view} now={T0} actions={doors()} item={view.items[0]!} />);
    expect(screen.getByRole("heading", { level: 3, name: "Roof" })).toBeInTheDocument();
    fireEvent.click(titlePencil()!);
    const field = screen.getByRole("textbox", { name: ROOM_COPY.itemTitleLabel });
    fireEvent.change(field, { target: { value: "Roof and gutters" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(log).toEqual([{ door: "patchItem", args: [5, { title: "Roof and gutters" }, { quiet: true }] }]));
  });

  it("a member who did not add it gets no pencil, and nobody but the hosts renames a done item", () => {
    const { unmount } = render(<ItemPage view={onItem({ me: AUTHOR })} now={T0} actions={doors()} item={item()} />);
    expect(titlePencil()).not.toBeInTheDocument();
    unmount();
    const done = item({ addedBy: 2, status: "done" });
    const second = render(<ItemPage view={onItem({ items: [done], me: AUTHOR })} now={T0} actions={doors()} item={done} />);
    expect(titlePencil()).not.toBeInTheDocument();
    second.unmount();
    render(<ItemPage view={onItem({ items: [done], me: SECRETARY })} now={T0} actions={doors()} item={done} />);
    expect(titlePencil()).toBeInTheDocument();
  });

  it("on the agenda, the adder of a running item changes its title and not its aim or minutes", async () => {
    render(<AgendaList view={onItem({ items: [item({ addedBy: 2 })], me: AUTHOR })} actions={doors()} />);
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.edit }));
    expect(screen.queryByLabelText(SESSION_COPY.agendaMinutesLabel)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(SESSION_COPY.agendaAimLabel)).not.toBeInTheDocument();
    const field = screen.getByLabelText(ROOM_COPY.itemTitleLabel);
    expect(field.tagName).toBe("TEXTAREA");
    fireEvent.change(field, { target: { value: "Roof first" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(log).toEqual([{ door: "patchItem", args: [5, { title: "Roof first" }] }]));
  });

  it("while it waits, the adder still sets its aim and minutes", () => {
    render(<AgendaList view={makeView({ items: [item({ addedBy: 2, status: "waiting" })], me: AUTHOR })} actions={doors()} />);
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.edit }));
    expect(screen.getByLabelText(SESSION_COPY.agendaMinutesLabel)).toBeInTheDocument();
  });
});

describe("the tensions named so far", () => {
  it("are listed under the catcher, each one editable by whoever named it", () => {
    const view = makeView({ entries: [entry({ id: 90, kind: "tension", itemId: null, text: "The well pump is loud" })], me: AUTHOR });
    render(<TensionCatcher view={view} actions={doors()} />);
    const panel = screen.getByRole("region", { name: ROOM_COPY.backlogSoFar });
    expect(within(panel).getByText("The well pump is loud")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: ROOM_COPY.editThis("tension") })).toBeInTheDocument();
  });

  it("are not drawn when there are none", () => {
    render(<TensionCatcher view={makeView({ me: AUTHOR })} actions={doors()} />);
    expect(screen.queryByRole("region", { name: ROOM_COPY.backlogSoFar })).not.toBeInTheDocument();
    expect(screen.queryByText(ROOM_COPY.backlogSoFar)).not.toBeInTheDocument();
  });
});

describe("the growing box", () => {
  function Box(props: { initial?: string; max?: number; singleLine?: boolean; mic?: boolean; onValue?: (v: string) => void }) {
    return (
      <GrowingText
        value={props.initial ?? ""}
        onValue={props.onValue ?? (() => {})}
        label="Say it here"
        max={props.max ?? 100}
        singleLine={props.singleLine}
        mic={props.mic}
      />
    );
  }

  it("grows to fit its words", () => {
    const tall = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(120);
    render(<Box initial="A long note" />);
    expect(screen.getByRole("textbox", { name: "Say it here" }).style.height).toBe("122px");
    tall.mockRestore();
  });

  it("holds no more than its cap, and shows the count once the words near it", () => {
    const { rerender } = render(<Box initial={"a".repeat(10)} />);
    const field = screen.getByPlaceholderText("Say it here");
    expect(field).toHaveAttribute("maxLength", "100");
    expect(screen.queryByText(ROOM_COPY.countOf(10, 100))).not.toBeInTheDocument();
    rerender(<Box initial={"a".repeat(75)} />);
    expect(screen.getByText(ROOM_COPY.countOf(75, 100))).toBeInTheDocument();
  });

  it("a one-line box turns line breaks into spaces", () => {
    const onValue = vi.fn();
    render(<Box singleLine onValue={onValue} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Say it here" }), { target: { value: "one\r\ntwo\nthree" } });
    expect(onValue).toHaveBeenLastCalledWith("one two three");
  });

  it("puts the voice button beside it when asked, and adds what is said to the end", () => {
    const onValue = vi.fn();
    const { unmount } = render(<Box />);
    expect(screen.queryByRole("button", { name: "Speak" })).not.toBeInTheDocument();
    unmount();
    render(<Box initial="Gutters" mic onValue={onValue} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak" }));
    expect(onValue).toHaveBeenLastCalledWith("Gutters spoken words");
  });
});

describe("adding an action", () => {
  it("gives the sentence a growing box on its own row, apart from who holds it and the date", () => {
    render(<AddAction view={makeView({ me: AUTHOR })} actions={doors()} itemId={5} />);
    const field = screen.getByLabelText(SESSION_COPY.addAction);
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("placeholder", ROOM_COPY.actionPlaceholder);
    expect(field).toHaveAttribute("maxLength", String(SESSION_LIMITS.text));
    const seat = screen.getByLabelText(ROOM_COPY.actionHolderLabel);
    const row = field.closest("[data-action-text]")!;
    expect(row).not.toContainElement(seat);
    expect(row).not.toContainElement(screen.getByLabelText(ROOM_COPY.dueLabel));
    expect(field.parentElement).not.toContainElement(seat);
  });

  it("Enter adds it", async () => {
    render(<AddAction view={makeView({ me: AUTHOR })} actions={doors()} itemId={5} />);
    const field = screen.getByLabelText(SESSION_COPY.addAction);
    fireEvent.change(field, { target: { value: "Call the roofer" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(log).toHaveLength(1));
    expect(log[0]!.args[0]).toEqual({ kind: "action", text: "Call the roofer", itemId: 5, ownerSeatId: null, dueOn: null });
  });
});
