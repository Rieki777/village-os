// @vitest-environment jsdom
/**
 * The journal's door on the profile (Rye, 2026-10-20: "Is the journaling
 * system accessible in members profile?"). It shows only while the module is
 * on, reads the member's own newest entry once, links into today's page, the
 * pulse and feedback, and says where an entry goes without claiming a send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const modules = vi.hoisted(() => ({ on: true }));
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: (id: string) => id === "journal" && modules.on }));

const api = vi.hoisted(() => ({ entries: [] as unknown[], fail: false, calls: 0 }));
vi.mock("@/lib/journalApi", () => ({
  listEntries: async () => {
    api.calls += 1;
    if (api.fail) throw new Error("down");
    return api.entries;
  },
}));

import ProfileJournalCard from "./ProfileJournalCard";

const renderCard = () => {
  const { hook } = memoryLocation({ path: "/profile" });
  return render(
    <Router hook={hook}>
      <ProfileJournalCard />
    </Router>,
  );
};

beforeEach(() => {
  modules.on = true;
  api.entries = [];
  api.fail = false;
  api.calls = 0;
});
afterEach(cleanup);

describe("the journal card on the profile", () => {
  it("renders nothing and reads nothing while the journal is off", () => {
    modules.on = false;
    const { container } = renderCard();
    expect(container.innerHTML).toBe("");
    expect(api.calls).toBe(0);
  });

  it("links into today's page, the pulse and feedback", async () => {
    renderCard();
    expect(screen.getByRole("heading", { name: "Your journal" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Write today" }).getAttribute("href")).toBe("/journal");
    expect(screen.getByRole("link", { name: "Weekly pulse" }).getAttribute("href")).toBe("/journal#pulse");
    expect(screen.getByRole("link", { name: "Feedback" }).getAttribute("href")).toBe("/journal#feedback");
    await waitFor(() => expect(screen.getByText(/Nothing written yet/)).toBeTruthy());
  });

  it("says when the member last wrote", async () => {
    api.entries = [{ id: "e1", writtenAt: "2026-10-19T14:00:00.000Z" }];
    renderCard();
    await waitFor(() => expect(screen.getByText(/You last wrote on/)).toBeTruthy());
    expect(api.calls).toBe(1);
  });

  it("stays calm when the journal cannot be read", async () => {
    api.fail = true;
    renderCard();
    await waitFor(() => expect(screen.getByText(/Nothing written yet/)).toBeTruthy());
  });

  it("says where an entry goes, and never that anything has been sent", () => {
    renderCard();
    const text = document.body.textContent ?? "";
    expect(text).toContain("when that is connected");
    expect(text).toContain("Unless you keep one private");
    expect(text).not.toMatch(/has been sent|is sent to|goes to Saberra now/i);
  });
});
