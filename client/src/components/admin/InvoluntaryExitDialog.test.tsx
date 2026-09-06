// @vitest-environment jsdom
/**
 * Asking a person to leave is a form, not a browser prompt.
 *
 * WHAT IT REPLACED. `window.prompt("Involuntary exits follow the published
 * process. Note for the record:")` at client/src/pages/Admin.tsx, guarded by
 * `if (note === null) return`. `window.prompt` returns "" when somebody
 * presses OK on an empty box and null only when they press Cancel, so the old
 * guard let a steward open an involuntary removal against a real member with
 * no reason recorded at all. That is the first thing asserted below.
 *
 * WHAT THE ASSERTIONS READ. The composed record, character for character,
 * because the record is the entire point of the form. A test that asserted "a
 * request was sent" would pass against a dialog that collected four answers
 * and threw them away, which is exactly the failure mode this repo has paid
 * for before: computed, saved, never printed.
 *
 * WHY UNANSWERED IS TESTED SEPARATELY. "No" and "not answered" are different
 * claims about a person, and only one of them is something a steward said.
 * The composer keeps unanswered questions off the record entirely rather than
 * writing them down as "No".
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import InvoluntaryExitDialog, { composeExitNote } from "./InvoluntaryExitDialog";

const GROUNDS = [
  "Has a non-violent dispute resolution process been attempted?",
  "Is this an unexpected death?",
];

const open = (onConfirm = vi.fn(), onCancel = vi.fn()) => {
  render(
    <InvoluntaryExitDialog
      open
      memberName="Wren"
      grounds={GROUNDS}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, onCancel };
};

const confirmButton = () => screen.getByRole("button", { name: /Open involuntary exit/i });

describe("the involuntary exit form", () => {
  it("refuses to open a departure with no reason given", async () => {
    open();
    // The defect in the prompt it replaced: OK on an empty box opened a real
    // removal with an empty record.
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText(/A reason is required/i)).toBeTruthy();
  });

  it("names the member in its own title, so nobody removes the wrong person", async () => {
    open();
    expect(screen.getByText(/Ask Wren to leave/i)).toBeTruthy();
  });

  it("asks the village's own questions, not the platform's", async () => {
    // The list is a prop from the published policy. Passing a fixture proves
    // the component renders what it is given rather than anything compiled in.
    render(
      <InvoluntaryExitDialog
        open
        memberName="Wren"
        grounds={["A question this village invented"]}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("A question this village invented")).toBeTruthy();
    expect(screen.queryByText(GROUNDS[0])).toBeNull();
  });

  it("puts the reason and every answered question on the record", async () => {
    const user = userEvent.setup();
    const { onConfirm } = open();

    await user.type(screen.getByLabelText(/reason for requesting the removal/i), "Repeated harm after two repair attempts.");

    // Answer the first question yes and leave the second untouched.
    const groups = screen.getAllByRole("group");
    await user.click(within(groups[0]).getByRole("button", { name: "Yes" }));

    await user.click(confirmButton());

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const note = onConfirm.mock.calls[0][0] as string;

    expect(note).toContain("Repeated harm after two repair attempts.");
    expect(note).toContain(`${GROUNDS[0]} Yes`);
    // The unanswered question is absent entirely. Recording it as "No" would
    // put a claim on the record that no steward made.
    expect(note).not.toContain(GROUNDS[1]);
  });

  it("keeps 'no' and 'not answered' apart in the composed record", () => {
    // Pure, so the exact record is checked without a render.
    expect(composeExitNote("Reason.", GROUNDS, ["no", ""])).toBe(
      `Reason.\n\n${GROUNDS[0]} No`,
    );
    expect(composeExitNote("Reason.", GROUNDS, ["", ""])).toBe("Reason.");
    expect(composeExitNote("Reason.", GROUNDS, ["yes", "n/a"])).toBe(
      `Reason.\n\n${GROUNDS[0]} Yes\n${GROUNDS[1]} Does not apply`,
    );
  });

  it("closes on Escape and returns focus, because it is a real dialog", async () => {
    const user = userEvent.setup();
    const { onCancel } = open();

    // Radix moves focus into the dialog on open. Five overlays in this client
    // are hand-rolled `fixed inset-0` divs rather than this primitive, and
    // most of them neither trap Tab nor give focus back; this component does
    // not add a sixth.
    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it("keeps the steward's work when the server refuses", async () => {
    /*
     * THE FORM USED TO CLEAR ITSELF ON THE WAY OUT. `reset()` ran before the
     * async confirm, and the parent keeps this dialog OPEN when the server
     * refuses, so a steward who hit any of the live 409s (the member is a
     * seeded example, the departure would strand the last administrator, an
     * exit is already open) was left staring at an empty form with the
     * confirm button disabled, having lost a written account of a person.
     */
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <InvoluntaryExitDialog open memberName="Wren" grounds={GROUNDS} onCancel={vi.fn()} onConfirm={onConfirm} />,
    );

    const reason = screen.getByLabelText(/reason for requesting the removal/i);
    await user.type(reason, "A full account of what happened.");
    await user.click(within(screen.getAllByRole("group")[0]).getByRole("button", { name: "No" }));
    await user.click(confirmButton());

    // The parent has NOT closed the dialog: the server said no.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(/reason for requesting the removal/i) as HTMLTextAreaElement).value)
      .toBe("A full account of what happened.");
    expect(within(screen.getAllByRole("group")[0]).getByRole("button", { name: "No" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(confirmButton(), "the steward can try again without retyping").not.toBeDisabled();
  });

  it("clears only once the dialog has actually closed", async () => {
    const { rerender } = render(
      <InvoluntaryExitDialog open memberName="Wren" grounds={GROUNDS} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/reason for requesting the removal/i), "Something.");

    rerender(<InvoluntaryExitDialog open={false} memberName="Wren" grounds={GROUNDS} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    rerender(<InvoluntaryExitDialog open memberName="Wren" grounds={GROUNDS} onCancel={vi.fn()} onConfirm={vi.fn()} />);

    await waitFor(() =>
      expect((screen.getByLabelText(/reason for requesting the removal/i) as HTMLTextAreaElement).value).toBe(""),
    );
  });

  it("protects the answers from the 2000 character clip", () => {
    /*
     * createExit stores note.slice(0, 2000) and the answers are composed
     * LAST, so a long reason used to push exactly the structured part off the
     * end. The prose survived and the line saying whether a non-violent
     * process was attempted did not, which is the part a reviewer needs.
     */
    const long = "x".repeat(3000);
    const note = composeExitNote(long, GROUNDS, ["no", "yes"]);

    expect(note.length).toBeLessThanOrEqual(2000);
    expect(note, "the answers must survive").toContain(`${GROUNDS[0]} No`);
    expect(note, "the answers must survive").toContain(`${GROUNDS[1]} Yes`);
    expect(note, "and the reader must be told the account was cut").toContain("(clipped)");
  });

  it("does not clip a note that fits", () => {
    const note = composeExitNote("Short reason.", GROUNDS, ["no", ""]);
    expect(note).toBe(`Short reason.

${GROUNDS[0]} No`);
    expect(note).not.toContain("(clipped)");
  });
});

