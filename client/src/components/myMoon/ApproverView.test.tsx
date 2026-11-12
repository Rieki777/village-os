// @vitest-environment jsdom
/**
 * THE APPROVERS' VIEW CARRIES NO SCORE (Phase C, decision 2, 12 Nov 2026).
 *
 * The people who approve a member's pay read the work queue (`ReviewQueueView`)
 * and the Finance desk (`InvoicesDeskView`). Neither draws the member's task
 * score, its band ("Rethink the plan"), its sentence or their role coverage,
 * even when a row arrives from an older server still carrying them. What the
 * approvers need is unchanged: the name, the roles and their counts, the items
 * to approve or return, and the invoice with its total.
 *
 * Break-the-fix control: put `<p>{(row as any).taskReading?.label}</p>` back
 * into `WorkRow` or `InvoiceRow` and the first assertion of each test fails.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { TASK_BANDS } from "@shared/moonRecap";
import { ReviewQueueView } from "./ReviewQueue";
import { InvoicesDeskView } from "./InvoicesDesk";
import type { QueueData, QueueRowView } from "./moonApi";
import { invoice, item } from "./myMoon.fixture";

afterEach(cleanup);

const RETHINK = TASK_BANDS.find((b) => b.key === "rethink")!;

/** A row as an OLDER server sent it: the reading and the score still on it. */
function staleRow(over: Partial<QueueRowView> = {}): QueueRowView {
  const row = {
    recapId: "mr-0000000000000001",
    userId: "m-wren",
    name: "Wren",
    status: "waiting",
    waitingOn: "work",
    dueOn: null,
    selfApproved: false,
    workApprovers: ["Ops holder"],
    invoiceApprovers: ["Finance holder"],
    roles: [{ roleId: "role-seeds", name: "Seed keeper", itemCount: 1 }],
    outsideMyRoles: 0,
    hash: "h".repeat(64),
    items: [item()],
    invoice: null,
    taskReading: { band: "rethink", label: RETHINK.label, says: RETHINK.says, lines: ["3 of 8 done"], capped: false },
    seatReading: { band: "bigger", label: "Role bigger than the moon", says: "Some accountabilities had no work under them.", lines: [], capped: false },
    score: { numHalves: 6, den: 8, pct: 38 },
    ...over,
  };
  return row as unknown as QueueRowView;
}

const data = (rows: QueueRowView[]): QueueData => ({
  moon: { cycleId: "lunar-2026-10", firstDay: "2026-10-10", lastDay: "2026-11-08", periodWords: "10 October to 8 November 2026", endOfMoonFriday: "2026-11-05", sendBy: "2026-11-09", halfwayDay: "2026-10-25" },
  rows,
  rolesWithNoItems: [],
  noEligible: [],
});

function expectNoReading(text: string) {
  expect(text).not.toContain(RETHINK.label);
  expect(text).not.toContain(RETHINK.says);
  expect(text).not.toContain("3 of 8 done");
  expect(text).not.toContain("Role bigger than the moon");
  expect(text).not.toMatch(/\b38\s?%/);
}

describe("the work approvers' queue (decision 2)", () => {
  it("shows the name, the roles and the items, and never the member's band or score", () => {
    const { container } = render(<ReviewQueueView data={data([staleRow()])} reload={async () => undefined} />);
    expectNoReading(container.textContent ?? "");
    expect(screen.queryByTestId("queue-reading")).toBeNull();
    // What an approver needs is still there.
    expect(container.textContent).toContain("Wren");
    expect(container.textContent).toContain("Seed keeper: 1");
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(container.textContent).toContain("Mapped the seed bank shelves");
    expectNoReading(container.textContent ?? "");
  });
});

describe("the Finance desk (decision 2)", () => {
  it("shows the invoice and its total, and never the member's band or score", () => {
    const row = staleRow({ waitingOn: "invoice", invoice: { ...invoice({ id: "mv-1", status: "waiting", statusLine: "Waiting on Finance" }), routeCheck: null, taxFormValid: true, authorityNote: null, queueNote: null, hash: "h".repeat(64) } });
    const { container } = render(<InvoicesDeskView data={data([row])} init={{}} reload={async () => undefined} />);
    expectNoReading(container.textContent ?? "");
    expect(container.textContent).toContain("Waiting on Finance");
    expect(container.querySelector("[data-amount]")?.textContent).toContain("1,234.56");
  });
});
