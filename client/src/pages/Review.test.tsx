// @vitest-environment jsdom
/**
 * THREE STATES THAT MUST NEVER COLLAPSE INTO EACH OTHER.
 *
 * "A read failure renders as an error and never as an empty queue" is half of
 * acceptance test 2 in the work order, and it is the half a server test cannot
 * reach. `server/review.routes.e2e.test.ts` proves the other half: the route
 * refuses with a status and a reason and never with a 200 carrying an empty
 * list, which is what makes it POSSIBLE for a page to tell them apart. This
 * file proves the page actually does.
 *
 * The harm is stated inline on the draft queue in Admin.tsx, which got this
 * right first and is where the pattern comes from: a queue of proposals
 * sitting on the server while the page says positively that there is nothing
 * to review is a governance failure and not a cosmetic one. A steward who sees
 * "Nothing waiting" stops looking.
 *
 * `Layout` is mocked to a passthrough. This file's subject is the queue's
 * three states, not the site shell around them.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => "a-token",
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import Review from "./Review";

const EMPTY = {
  batches: [],
  quests: [],
  drops: [],
  counts: { proposals: 0, quests: 0 },
};

function answerWith(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  );
}

function renderReview() {
  return render(
    <Router>
      <Review />
    </Router>,
  );
}

describe("the review queue tells three states apart", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says NOTHING WAITING only when the server actually said so", async () => {
    answerWith(200, EMPTY);
    renderReview();
    await waitFor(() => expect(screen.getByText("Nothing waiting")).toBeTruthy());
  });

  it("renders a failed read as an error, and says the queue may not be empty", async () => {
    answerWith(500, { error: "the database went away" });
    renderReview();
    await waitFor(() => expect(screen.getByText("The queue did not load")).toBeTruthy());
    // The exact promise the draft queue makes, kept here.
    expect(screen.getByText(/this is not an empty queue/i)).toBeTruthy();
    expect(screen.queryByText("Nothing waiting")).toBeNull();
  });

  it("renders a network failure the same way, and never as an empty queue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    renderReview();
    await waitFor(() => expect(screen.getByText("The queue did not load")).toBeTruthy());
    expect(screen.queryByText("Nothing waiting")).toBeNull();
  });

  it("renders a refusal as a refusal, which is a different sentence again", async () => {
    // A member without the capability. NOT an error and NOT an empty queue:
    // there may be plenty waiting and this person may not read it, and saying
    // either of the other two things would be false.
    answerWith(403, { error: "auth_required" });
    renderReview();
    await waitFor(() => expect(screen.getByText("This queue is not open to you yet")).toBeTruthy());
    expect(screen.queryByText("Nothing waiting")).toBeNull();
    expect(screen.queryByText("The queue did not load")).toBeNull();
  });

  it("prints the dropped count out loud, which is the whole story on an empty queue", async () => {
    // Copied from the Calls tab, which prints its own drop count on purpose.
    // Without this, "nothing arrived today" and "everything arrived and all of
    // it was refused for carrying an email address" render identically.
    answerWith(200, {
      ...EMPTY,
      drops: [{ moduleId: "saberra", reason: "contained_an_email", dropped: 4, lastAt: null }],
    });
    renderReview();
    await waitFor(() =>
      expect(screen.getByText(/4 record\(s\) were refused on arrival/i)).toBeTruthy(),
    );
    expect(screen.getByText(/carried an email address/i)).toBeTruthy();
    // And it still says the queue itself is empty, because it is. The two
    // facts are both true and neither stands in for the other.
    expect(screen.getByText("Nothing waiting")).toBeTruthy();
  });

  it("puts the editable payload on screen, because that is what the page is for", async () => {
    answerWith(200, {
      ...EMPTY,
      counts: { proposals: 1, quests: 0 },
      batches: [
        {
          batchId: "b1",
          moduleId: "saberra",
          receivedAt: "2026-08-14T10:00:00.000Z",
          items: [
            {
              id: "p1",
              batchId: "b1",
              moduleId: "saberra",
              kind: "role.proposed",
              payload: { name: "Water Steward" },
              quote: "Ada said the well needs somebody.",
              sourceRef: "meeting#42",
              sourceOccurredAt: "2026-08-14T09:00:00.000Z",
              evidence: "quoted",
              audience: "steward",
              trustTier: "extracted_unreviewed",
              confidence: null,
              significance: null,
              subjectRef: null,
              receivedAt: "2026-08-14T10:00:00.000Z",
              correlationId: null,
            },
          ],
        },
      ],
    });
    renderReview();
    // The textarea is the redaction path and the centre of the design.
    const box = await screen.findByLabelText(/Change anything before you accept it/i);
    expect((box as HTMLTextAreaElement).value).toContain("Water Steward");
    // The evidence, quoted verbatim, the way the Calls tab renders it.
    expect(screen.getByText(/Ada said the well needs somebody/)).toBeTruthy();
    // Not stated, never zero.
    expect(screen.getByText(/confidence not stated/i)).toBeTruthy();
    // One decision for the batch, beside the per-item ones.
    expect(screen.getByText(/Accept all 1, with my edits/i)).toBeTruthy();
  });
});

/**
 * THE LIMIT A BATCH MEETS, SAID BEFORE ANYBODY ACCEPTS IT.
 *
 * Rye, 2026-09-14: "Definitely should show the batch limit with a button to go
 * to that setting to change adjust it higher." The limit used to be three per
 * account and appeared nowhere until a steward had accepted a batch and found
 * most of it blocked. Each case below is a sentence or a door a steward needs
 * before pressing accept, and the last is the door a steward must NOT be shown.
 */
describe("the change limit on a batch card", () => {
  const seat = (id: string, name: string) => ({
    id,
    batchId: "b1",
    moduleId: "vendor",
    kind: "role.proposed",
    payload: { name },
    quote: null,
    sourceRef: null,
    sourceOccurredAt: null,
    evidence: "absent",
    audience: "steward",
    trustTier: "extracted_unreviewed",
    confidence: null,
    significance: null,
    subjectRef: null,
    receivedAt: "2026-08-14T10:00:00.000Z",
    correlationId: null,
  });
  const queueWith = (over: { limit: number; proposed: number | null; may: boolean }) => ({
    ...EMPTY,
    counts: { proposals: 1, quests: 0 },
    batches: [
      {
        batchId: "b1",
        moduleId: "vendor",
        receivedAt: "2026-08-14T10:00:00.000Z",
        proposedChanges: over.proposed,
        items: [seat("p1", "Water Steward")],
      },
    ],
    proposalChangeLimit: over.limit,
    mayChangeProposalLimit: over.may,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the village's limit and what this batch proposes, with nothing blocked under it", async () => {
    answerWith(200, queueWith({ limit: 500, proposed: 18, may: false }));
    renderReview();
    expect(
      await screen.findByText(/This village accepts up to 500 changes from one outside batch\. This batch proposes 18\./),
    ).toBeTruthy();
    expect(screen.queryByText(/will be blocked/)).toBeNull();
  });

  it("says the changes past the limit will be blocked when the batch proposes more", async () => {
    answerWith(200, queueWith({ limit: 6, proposed: 18, may: false }));
    renderReview();
    expect(await screen.findByText(/This batch proposes 18\. Every change past the first 6 will be blocked\./)).toBeTruthy();
  });

  it("offers an admin the way to the setting, opened at that one dial", async () => {
    answerWith(200, queueWith({ limit: 6, proposed: 18, may: true }));
    renderReview();
    const link = await screen.findByRole("link", { name: "Change the limit" });
    expect(link.getAttribute("href")).toBe("/admin?tab=variables&variable=org.proposal_change_limit");
    expect(screen.queryByText(/An admin can raise it/)).toBeNull();
  });

  it("tells a steward who is not an admin who can raise it, and shows them no button that goes nowhere", async () => {
    answerWith(200, queueWith({ limit: 6, proposed: 18, may: false }));
    renderReview();
    expect(await screen.findByText(/Every change past the first 6 will be blocked\. An admin can raise it\./)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Change the limit" })).toBeNull();
    expect(screen.queryByText("Change the limit")).toBeNull();
  });

  it("says nothing about a limit on a batch that holds no org proposals", async () => {
    answerWith(200, queueWith({ limit: 6, proposed: null, may: true }));
    renderReview();
    await screen.findByText(/Accept all 1, with my edits/i);
    expect(screen.queryByText(/This village accepts up to/)).toBeNull();
    expect(screen.queryByText("Change the limit")).toBeNull();
  });
});

/**
 * WHAT AN ACCEPT SAYS AFTERWARDS, and when it stops saying it.
 *
 * Three defects, each a sentence that reached nobody or outlived its subject:
 * a single accept of a seat that could never publish said a flat "Accepted"
 * with no reason and no way to withdraw; the fields-left-out card kept
 * describing a draft after it was withdrawn; and that card never said whether
 * anything needed doing.
 */
describe("what the review page says after an accept", () => {
  const ITEM = {
    id: "p1",
    batchId: "b1",
    moduleId: "vendor",
    kind: "role.proposed",
    payload: { role_name: "Mill Warden", circle: "Milling Circle", vendor_rank: 3 },
    quote: null,
    sourceRef: null,
    sourceOccurredAt: null,
    evidence: "absent",
    audience: "steward",
    trustTier: "extracted_unreviewed",
    confidence: null,
    significance: null,
    subjectRef: null,
    receivedAt: "2026-08-14T10:00:00.000Z",
    correlationId: null,
  };
  const QUEUE = {
    ...EMPTY,
    counts: { proposals: 1, quests: 0 },
    batches: [{ batchId: "b1", moduleId: "vendor", receivedAt: "2026-08-14T10:00:00.000Z", items: [ITEM] }],
  };
  const REASON =
    'There is no circle called "Milling Circle" yet. Ask an admin to create it, then withdraw this draft. ' +
    "Its proposals go back in the review queue, ready to accept again";

  /** Answers by method and path; anything unlisted gets the queue, which is what a reload reads. */
  function routes(table: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        const key = `${init?.method ?? "GET"} ${url}`;
        return { ok: true, status: 200, json: async () => (key in table ? table[key] : QUEUE) };
      }),
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows why a single accepted seat cannot apply, beside a way to withdraw it", async () => {
    routes({
      "POST /api/review/proposals/p1/accept": {
        success: true,
        createdRef: "d1",
        seats: 1,
        blocked: 1,
        blockedLines: [{ reads: 'Create the seat "Mill Warden"', blocked: REASON }],
        ignored: [],
      },
    });
    renderReview();
    fireEvent.click(await screen.findByText("Accept this one"));
    expect(await screen.findByText(/There is no circle called "Milling Circle" yet/)).toBeTruthy();
    expect(screen.getByText("A draft from this queue cannot publish")).toBeTruthy();
    expect(screen.getByText("Withdraw that draft")).toBeTruthy();
  });

  it("keeps a card for every stuck draft, so a second blocked accept cannot hide the first one's withdraw", async () => {
    // One page-wide slot: a blocked batch, then a blocked single accept, and
    // the batch's draft lost the only withdraw button any screen offered.
    const OTHER = { ...ITEM, id: "p2", batchId: "b2", payload: { role_name: "Kiln Tender", circle: "Kiln Circle" } };
    const KILN = 'There is no circle called "Kiln Circle" yet. Ask an admin to create it';
    const TWO = {
      ...QUEUE,
      counts: { proposals: 2, quests: 0 },
      batches: [...QUEUE.batches, { batchId: "b2", moduleId: "vendor", receivedAt: "2026-08-14T10:00:00.000Z", items: [OTHER] }],
    };
    const table: Record<string, unknown> = {
      "POST /api/review/batches/b1/accept": {
        success: true, accepted: 1, draftId: "d1", seats: 1, blocked: 1, noted: 0, ignored: [],
        blockedLines: [{ reads: 'Create the seat "Mill Warden"', blocked: REASON }],
      },
      "POST /api/review/proposals/p2/accept": {
        success: true, createdRef: "d2", seats: 1, blocked: 1, ignored: [],
        blockedLines: [{ reads: 'Create the seat "Kiln Tender"', blocked: KILN }],
      },
      "POST /api/review/drafts/d2/withdraw": { success: true, reopened: 1 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        const key = `${init?.method ?? "GET"} ${url}`;
        return { ok: true, status: 200, json: async () => (key in table ? table[key] : TWO) };
      }),
    );
    renderReview();
    // Two batches of one each, so two batch buttons: b1's is first.
    fireEvent.click((await screen.findAllByText(/Accept all 1, with my edits/i))[0]);
    expect(await screen.findByText(/"Milling Circle" yet/)).toBeTruthy();
    fireEvent.click(screen.getAllByText("Accept this one")[1]);
    expect(await screen.findByText(/"Kiln Circle" yet/)).toBeTruthy();
    // Both drafts, each with its own way out.
    expect(screen.getByText(/"Milling Circle" yet/)).toBeTruthy();
    expect(screen.getAllByText("Withdraw that draft")).toHaveLength(2);
    // Withdrawing one takes only its own card.
    fireEvent.click(screen.getAllByText("Withdraw that draft")[1]);
    await waitFor(() => expect(screen.queryByText(/"Kiln Circle" yet/)).toBeNull());
    expect(screen.getByText(/"Milling Circle" yet/)).toBeTruthy();
    expect(screen.getAllByText("Withdraw that draft")).toHaveLength(1);
  });

  it("shows every stuck draft the queue read lists, so a reload keeps each withdraw", async () => {
    let withdrawn = false;
    const d7 = { draftId: "d7", blocked: 1, blockedLines: [{ reads: 'Create the seat "Mill Warden"', blocked: REASON }] };
    const d8 = { draftId: "d8", blocked: 2, blockedLines: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method === "POST" && url === "/api/review/drafts/d7/withdraw") {
          withdrawn = true;
          return { ok: true, status: 200, json: async () => ({ success: true, reopened: 1 }) };
        }
        return { ok: true, status: 200, json: async () => ({ ...QUEUE, stuckDrafts: withdrawn ? [d8] : [d7, d8] }) };
      }),
    );
    renderReview();
    // No accept on this page at all: the cards come from the server.
    expect(await screen.findByText(/"Milling Circle" yet/)).toBeTruthy();
    expect(screen.getByText(/2 of its seats are blocked/)).toBeTruthy();
    expect(screen.getAllByText("Withdraw that draft")).toHaveLength(2);
    fireEvent.click(screen.getAllByText("Withdraw that draft")[0]);
    await waitFor(() => expect(screen.queryByText(/"Milling Circle" yet/)).toBeNull());
    expect(screen.getByText(/2 of its seats are blocked/)).toBeTruthy();
    expect(screen.getAllByText("Withdraw that draft")).toHaveLength(1);
  });

  it("reads the queue again when a withdraw is refused, so a draft somebody else withdrew loses its card", async () => {
    // Two stewards, one stuck draft. The other steward withdrew it first, so
    // this click is refused, and the card used to stay with a button that
    // could never work until the page was reloaded by hand.
    let refused = false;
    const d9 = { draftId: "d9", blocked: 1, blockedLines: [{ reads: 'Create the seat "Mill Warden"', blocked: REASON }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method === "POST" && url === "/api/review/drafts/d9/withdraw") {
          refused = true;
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: "This draft is withdrawn, and only an open draft can be withdrawn" }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ ...QUEUE, stuckDrafts: refused ? [] : [d9] }) };
      }),
    );
    renderReview();
    expect(await screen.findByText(/"Milling Circle" yet/)).toBeTruthy();
    fireEvent.click(screen.getByText("Withdraw that draft"));
    await waitFor(() => expect(screen.queryByText(/"Milling Circle" yet/)).toBeNull());
    expect(screen.queryByText("Withdraw that draft")).toBeNull();
  });

  it("clears the fields-left-out card when a withdraw is refused, so its button does not move there and refuse forever", async () => {
    // Another steward withdrew d1 first. The reload cleared the stuck card and
    // its button moved onto the fields-left-out card, which 409'd on every press.
    let refused = false;
    const d1 = { draftId: "d1", blocked: 1, blockedLines: [{ reads: 'Create the seat "Mill Warden"', blocked: REASON }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method === "POST" && url === "/api/review/batches/b1/accept") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true, accepted: 1, draftId: "d1", seats: 1, blocked: 1, noted: 0,
              blockedLines: d1.blockedLines,
              ignored: [{ proposalId: "p1", keys: ["vendor_rank"] }],
            }),
          };
        }
        if (init?.method === "POST" && url === "/api/review/drafts/d1/withdraw") {
          refused = true;
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: "This draft is withdrawn, and only an open draft can be withdrawn" }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ ...QUEUE, stuckDrafts: refused ? [] : [d1] }) };
      }),
    );
    renderReview();
    fireEvent.click(await screen.findByText(/Accept all 1, with my edits/i));
    expect(await screen.findByText(/Not read from/)).toBeTruthy();
    expect(screen.getAllByText("Withdraw that draft")).toHaveLength(1);
    fireEvent.click(screen.getByText("Withdraw that draft"));
    await waitFor(() => expect(screen.queryByText(/"Milling Circle" yet/)).toBeNull());
    expect(screen.queryByText(/Not read from/)).toBeNull();
    expect(screen.queryByText("Withdraw that draft")).toBeNull();
  });

  it("says a draft the server could not preview could not be checked, and counts no blocked seats", async () => {
    answerWith(200, {
      ...QUEUE,
      stuckDrafts: [
        {
          draftId: "d5",
          blocked: 1,
          unpreviewable: true,
          blockedLines: [
            {
              reads: "",
              blocked: "This draft could not be previewed, so it cannot publish. Withdraw it, and its proposals go back in the review queue",
            },
          ],
        },
      ],
    });
    renderReview();
    expect(await screen.findByText(/This draft could not be checked/)).toBeTruthy();
    expect(screen.queryByText(/of its seats are blocked/)).toBeNull();
    expect(screen.getByText("Withdraw that draft")).toBeTruthy();
  });

  it("says what to do about fields left out, and offers the withdraw when nothing blocked", async () => {
    routes({
      "POST /api/review/proposals/p1/accept": {
        success: true,
        createdRef: "d1",
        seats: 1,
        blocked: 0,
        blockedLines: [],
        ignored: [{ proposalId: "p1", keys: ["vendor_rank"] }],
      },
    });
    renderReview();
    fireEvent.click(await screen.findByText("Accept this one"));
    expect(await screen.findByText(/Not read from/)).toBeTruthy();
    expect(screen.getByText(/The draft publishes without them/)).toBeTruthy();
    expect(screen.getByText(/there is nothing to do/)).toBeTruthy();
    expect(screen.getByText("Withdraw that draft")).toBeTruthy();
    expect(screen.queryByText("A draft from this queue cannot publish")).toBeNull();
  });

  it("clears both cards once the draft they describe is withdrawn", async () => {
    routes({
      "POST /api/review/batches/b1/accept": {
        success: true,
        accepted: 1,
        draftId: "d1",
        seats: 1,
        blocked: 1,
        blockedLines: [{ reads: 'Create the seat "Mill Warden"', blocked: REASON }],
        noted: 0,
        ignored: [{ proposalId: "p1", keys: ["vendor_rank"] }],
      },
      "POST /api/review/drafts/d1/withdraw": { success: true, reopened: 1 },
    });
    renderReview();
    fireEvent.click(await screen.findByText(/Accept all 1, with my edits/i));
    expect(await screen.findByText(/Not read from/)).toBeTruthy();
    // One way out, even though both cards describe the same draft.
    expect(screen.getAllByText("Withdraw that draft")).toHaveLength(1);
    fireEvent.click(screen.getByText("Withdraw that draft"));
    await waitFor(() => expect(screen.queryByText(/Not read from/)).toBeNull());
    expect(screen.queryByText("A draft from this queue cannot publish")).toBeNull();
  });
});
