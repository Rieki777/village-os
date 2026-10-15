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
 *   - a founder's own words are never overwritten by choosing a policy, and
 *     under the default they cannot be adopted unless they keep its sentence;
 *   - once adopted, a change is saved by adopting it (the server refuses a
 *     draft over adopted words), and a save hands the tab only the section.
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
    expect(screen.getByText(/Members read these words until new ones are adopted/)).toBeInTheDocument();
  });

  it("once adopted, a change is saved only by adopting it, never as a draft over the promise", async () => {
    render(
      <ClosingPolicyEditor
        password="tok"
        closing={{ policyId: "own-words", statement: OWN, adoptedAt: "2026-10-03T10:00:00.000Z" }}
        onSaved={() => {}}
      />,
    );
    const saveButton = () => screen.getByRole("button", { name: "Save what closing means" }) as HTMLButtonElement;
    expect(saveButton().disabled, "unchanged and adopted: saving re-adopts").toBe(false);
    fireEvent.change(statementBox(), { target: { value: `${OWN} The bank account closes last.` } });
    expect(saveButton().disabled, "a draft over adopted words is what the server refuses").toBe(true);
    fireEvent.click(adoptBox());
    expect(saveButton().disabled).toBe(false);
    save();
    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]).toEqual({ policyId: "own-words", statement: `${OWN} The bank account closes last.`, adopt: true });
  });

  it("hands the tab the section the server now holds, and nothing else", async () => {
    const held = { policyId: "proportional-closing-balance", statement: PROPORTIONAL_CLOSING_STATEMENT, adoptedAt: "2026-10-03T10:00:00.000Z" };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true, named: true, closing: held }) })));
    const onSaved = vi.fn();
    render(<ClosingPolicyEditor password="tok" closing={undefined} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("radio", { name: /Shared by closing-day balances/ }));
    fireEvent.click(adoptBox());
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith(held);
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

  it("the founder's words under the default's name say why they cannot be adopted, and the default's words come back on request", () => {
    render(<ClosingPolicyEditor password="tok" closing={undefined} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /In the village's own words/ }));
    fireEvent.change(statementBox(), { target: { value: OWN } });
    expect(adoptBox().disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Start again from this choice's words" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Shared by closing-day balances/ }));
    expect(statementBox().value, "a founder's words are never overwritten").toBe(OWN);
    expect(adoptBox().disabled, "these words do not say what the default says").toBe(true);
    expect(screen.getByText(/keep the sentence that choice stands for/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start again from this choice's words" }));
    expect(statementBox().value).toBe(PROPORTIONAL_CLOSING_STATEMENT);
    expect(adoptBox().disabled).toBe(false);
    expect(adoptBox().checked, "putting the words back is not adopting them").toBe(false);
    expect(screen.queryByRole("button", { name: "Start again from this choice's words" })).toBeNull();
  });
});
