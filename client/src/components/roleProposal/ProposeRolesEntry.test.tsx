// @vitest-environment jsdom
/**
 * The profile's "Propose my roles for next season" button, and the owner's
 * proposals under My applications (role proposals PR C).
 *
 *   - with no draft it starts one at /role-proposals/new;
 *   - with a draft open it reads "Continue my proposal for next season" and
 *     opens that draft;
 *   - a guest (403) or a village with governance off (404) gets no button;
 *   - signed out, nothing is asked;
 *   - My applications on the owner's live card lists each proposal with where
 *     it stands, linked to its page; nobody else's card asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { fixturePayload } from "@/test/playerCardFixture";
import { consentOf, proposalWith } from "@/test/roleProposalFixture";

const session = vi.hoisted(() => ({ token: "t" as string | null }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => session.token }));

import ProposeRolesEntry from "./ProposeRolesEntry";
import { PlayerRoleCardView } from "@/components/playerCard/PlayerRoleCard";
import { RP_WORDS } from "./proposalWords";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const mine = (draftId: string | null, proposals: unknown[] = []) => ({ nextSeason: null, nextSeasonWords: null, draftId, proposals });

let answer: () => Response;
const fetchMock = vi.fn(async (_url: string) => answer());

beforeEach(() => {
  session.token = "t";
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const draw = () =>
  render(
    <Router>
      <ProposeRolesEntry />
    </Router>,
  );

describe("the profile button", () => {
  it("starts a proposal when there is no draft", async () => {
    answer = () => json(mine(null));
    draw();
    const link = await screen.findByRole("link", { name: RP_WORDS.propose });
    expect(link.getAttribute("href")).toBe("/role-proposals/new");
    expect(fetchMock).toHaveBeenCalledWith("/api/governance/role-proposals/mine", expect.anything());
  });

  it("reads Continue and opens the draft when one exists", async () => {
    answer = () => json(mine("rp-00000000000000a1"));
    draw();
    const link = await screen.findByRole("link", { name: RP_WORDS.continue });
    expect(link.getAttribute("href")).toBe("/role-proposals/rp-00000000000000a1");
    expect(screen.queryByRole("link", { name: RP_WORDS.propose })).toBeNull();
  });

  it("says when next season has no dates yet", async () => {
    answer = () => json({ ...mine(null), nextSeasonWords: "Next season's dates aren't set yet" });
    draw();
    expect(await screen.findByText("Next season's dates aren't set yet")).toBeTruthy();
  });

  it.each([[403], [404]])("draws nothing on a %s", async (status) => {
    answer = () => json({ error: "x", message: "Proposing roles opens at the member rung." }, status);
    const { container } = draw();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("asks nothing while nobody is signed in", async () => {
    session.token = null;
    const { container } = draw();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});

describe("my proposals under My applications", () => {
  const submitted = proposalWith({ roles: [{ roleId: "r1" }] }, { id: "rp-00000000000000b2", status: "submitted", consent: consentOf("open") });
  const draft = proposalWith({ roles: [{ roleId: "r1" }] }, { id: "rp-00000000000000a1", target: null });

  it("lists each of the owner's proposals with where it stands, linked to its page", async () => {
    answer = () => json(mine(draft.id, [draft, submitted]));
    render(
      <Router>
        <PlayerRoleCardView data={fixturePayload(1, "self")} />
      </Router>,
    );
    const open = await screen.findByRole("link", { name: /Role proposal for Season of Roots/ });
    expect(open.getAttribute("href")).toBe("/role-proposals/rp-00000000000000b2");
    expect(open.textContent).toContain("Waiting on the circle");
    const d = screen.getByRole("link", { name: /Role proposal for next season/ });
    expect(d.getAttribute("href")).toBe("/role-proposals/rp-00000000000000a1");
    expect(d.textContent).toContain(RP_WORDS.draftWords);
  });

  it("is not asked on somebody else's card, or on a proposal card", async () => {
    answer = () => json(mine(null, [submitted]));
    render(
      <Router>
        <PlayerRoleCardView data={fixturePayload(1, "member")} />
        <PlayerRoleCardView data={fixturePayload(1, "self", { mode: "proposal" })} mode="proposal" />
      </Router>,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
