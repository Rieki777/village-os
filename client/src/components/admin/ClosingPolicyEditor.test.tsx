// @vitest-environment jsdom
/**
 * THE CLOSING SECTION'S EDITOR: choosing the default is not adopting it.
 *
 * Rye, 2026-09-25: the village chooses the default or writes its own, the
 * statement is always shown and editable, and naming it is mandatory. The
 * server refuses to count unadopted words (server/lib/closingPolicy.test.ts);
 * this pins the screen's half, which is what a founder actually presses:
 *
 *   - choosing the default fills the box with its words and leaves the adopt
 *     box UNTICKED, so a save of the pre-filled words sends `adopt: false`;
 *   - adopting is a tick the founder makes, and it is what the save sends;
 *   - any edit to an adopted section unticks it, so new words are adopted on
 *     purpose;
 *   - a founder's own words are never overwritten by choosing a policy.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ClosingPolicyEditor from "./ClosingPolicyEditor";
import { PROPORTIONAL_CLOSING_STATEMENT } from "@shared/closingPolicies";

const OWN = "If the village closes, the land passes to a community land trust and the cash is shared among whoever still lives here.";

let sent: any[] = [];
beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: any) => {
      sent.push(JSON.parse(String(init?.body ?? "{}")));
      return { ok: true, json: async () => ({ success: true, named: false }) };
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const statementBox = () => screen.getByLabelText("The village's words") as HTMLTextAreaElement;
const adoptBox = () => screen.getByRole("checkbox", { name: /adopts these words/ }) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save what closing means" }));

describe("the closing section editor", () => {
  it("choosing the default fills its words and saves them as a DRAFT unless adopted", async () => {
    render(<ClosingPolicyEditor password="tok" closing={undefined} onSaved={() => {}} />);
    expect(statementBox().value).toBe("");
    fireEvent.click(screen.getByRole("radio", { name: /Shared by closing-day balances/ }));
    expect(statementBox().value).toBe(PROPORTIONAL_CLOSING_STATEMENT);
    expect(adoptBox().checked).toBe(false);
    expect(adoptBox().disabled).toBe(false);

    save();
    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]).toEqual({ policyId: "proportional-closing-balance", statement: PROPORTIONAL_CLOSING_STATEMENT, adopt: false });
  });

  it("adopting is a tick the founder makes, and it is what the save sends", async () => {
    render(<ClosingPolicyEditor password="tok" closing={undefined} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Shared by closing-day balances/ }));
    fireEvent.click(adoptBox());
    save();
    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0].adopt).toBe(true);
  });

  it("an edit to adopted words unticks the adoption", () => {
    render(
      <ClosingPolicyEditor
        password="tok"
        closing={{ policyId: "own-words", statement: OWN, adoptedAt: "2026-10-03T10:00:00.000Z" }}
        onSaved={() => {}}
      />,
    );
    expect(adoptBox().checked).toBe(true);
    fireEvent.change(statementBox(), { target: { value: `${OWN} The bank account closes last.` } });
    expect(adoptBox().checked).toBe(false);
    expect(screen.getByText(/Changing the choice or the words needs adopting again/)).toBeInTheDocument();
  });

  it("never overwrites a founder's own words, and empties a box that held only the default", () => {
    render(<ClosingPolicyEditor password="tok" closing={undefined} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Shared by closing-day balances/ }));
    fireEvent.click(screen.getByRole("radio", { name: /In the village's own words/ }));
    expect(statementBox().value).toBe("");
    expect(adoptBox().disabled, "nothing to adopt yet").toBe(true);

    fireEvent.change(statementBox(), { target: { value: OWN } });
    fireEvent.click(screen.getByRole("radio", { name: /Shared by closing-day balances/ }));
    expect(statementBox().value).toBe(OWN);
  });
});
