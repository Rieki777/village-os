// @vitest-environment jsdom
/**
 * The "Your parties" card on the profile dashboard: one row per shared work
 * chat, the unread dot, the honest empty line, and nothing at all while the
 * messaging module is off. Every person is invented.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { InboxConversation } from "@/lib/messaging";

const modules = vi.hoisted(() => ({ on: true }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModuleOn: (id: string) => id === "messaging" && modules.on,
}));

import PartiesCard, { partiesOf } from "./PartiesCard";

const ME = "u1";

function member(userId: string, name: string, left = false) {
  return { userId, name, handle: null, role: "member" as const, left };
}

function convo(over: Partial<InboxConversation>): InboxConversation {
  return {
    id: "1",
    kind: "group",
    title: "Seed bank shelves",
    name: "Seed bank shelves",
    unreadCount: 0,
    muted: false,
    role: "member",
    lastReadSeq: 0,
    latestSeq: 0,
    preview: "",
    lastAuthorId: null,
    lastMessageAt: null,
    memberCount: 3,
    members: [member(ME, "Rye"), member("u2", "Jessica"), member("u3", "Tomas")],
    contextType: "quest",
    contextId: "q1",
    ...over,
  };
}

const INBOX: InboxConversation[] = [
  convo({ id: "10", unreadCount: 2, preview: "Trays arrive Monday", lastAuthorId: "u2" }),
  convo({ id: "11", title: "Map the water lines", contextType: "task", preview: "On it", lastAuthorId: ME }),
  // A direct thread and a crew thread are not parties.
  convo({ id: "12", kind: "direct", title: "Jessica", contextType: null }),
  convo({ id: "13", kind: "crew", title: "Kitchen crew", contextType: "quest" }),
];

function show(parties: ReturnType<typeof partiesOf> | null) {
  const { hook } = memoryLocation({ path: "/profile" });
  return render(
    <Router hook={hook}>
      <PartiesCard data={{ messages: parties === null ? null : { unreadTotal: 2, top: null, parties } }} />
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  modules.on = true;
});

describe("partiesOf", () => {
  it("keeps the work chats, names the last speaker, and puts the viewer last among the faces", () => {
    const parties = partiesOf(INBOX, ME);
    expect(parties.map((p) => p.id)).toEqual(["10", "11"]);
    expect(parties[0]).toMatchObject({ title: "Seed bank shelves", last: "Jessica: Trays arrive Monday", unread: 2 });
    expect(parties[0].people.map((p) => p.name)).toEqual(["Jessica", "Tomas", "Rye"]);
    expect(parties[1].last).toBe("You: On it");
  });

  it("drops members who left, and a muted chat carries no unread", () => {
    const [p] = partiesOf(
      [convo({ unreadCount: 4, muted: true, members: [member(ME, "Rye"), member("u2", "Jessica", true), member("u3", "Tomas")] })],
      ME,
    );
    expect(p.people.map((x) => x.name)).toEqual(["Tomas", "Rye"]);
    expect(p.unread).toBe(0);
  });
});

describe("PartiesCard", () => {
  it("draws one row per party, with faces, the title, the last line and a link to the chat", () => {
    show(partiesOf(INBOX, ME));
    const card = screen.getByRole("region", { name: "Your parties" });
    expect(within(card).getByRole("link", { name: "Messages" }).getAttribute("href")).toBe("/messages");
    const rows = within(card).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Seed bank shelves");
    expect(rows[0].textContent).toContain("Jessica: Trays arrive Monday");
    expect(within(rows[0]).getAllByTestId("party-face").map((f) => f.textContent)).toEqual(["J", "T", "R"]);
    expect(within(rows[0]).getByRole("link").getAttribute("href")).toBe("/messages/10");
  });

  it("puts the unread dot only on a party with unread lines, and says how many", () => {
    show(partiesOf(INBOX, ME));
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByTestId("party-unread").textContent).toBe("2 unread");
    expect(within(rows[1]).queryByTestId("party-unread")).toBeNull();
  });

  it("says so honestly when there are no parties yet", () => {
    show([]);
    expect(screen.getByRole("region", { name: "Your parties" }).textContent).toContain("No parties yet.");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("draws nothing while the messaging module is off", () => {
    modules.on = false;
    const { container } = show(partiesOf(INBOX, ME));
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing when the inbox never answered", () => {
    const { container } = show(null);
    expect(container.innerHTML).toBe("");
  });
});
