// @vitest-environment jsdom
/**
 * THE SCREEN HALF OF "SHOW THE DECLINES".
 *
 * Rye, 2026-09-24: "founders only for this first season (after that anyone can
 * raise their hand for a steward role and fill it if voted in), and show the
 * declines". The server half is asserted against a real schema in
 * `server/stewardSlate.db.test.ts` and over HTTP in
 * `server/launchVote.routes.e2e.test.ts`; neither of those can see whether the
 * words reach a page.
 *
 * Every assertion here is about what a READER sees: the names, the answers,
 * who chose the list, what accepting costs, and which control a nominee is
 * offered. Nothing here asserts a class name.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StewardSlate from "./StewardSlate";
import type { StewardSlate as StewardSlateData } from "./governanceApi";

const SLATE: StewardSlateData = {
  subjectType: "village_launch",
  open: true,
  proposedBy: "Wren",
  powerCount: 19,
  members: [
    { id: "cat-1", name: "Wren", answer: "accepted", declinedAt: null, mine: false },
    { id: "cat-2", name: "Iris", answer: "declined", declinedAt: "2026-09-24T10:00:00.000Z", mine: false },
    { id: "cat-3", name: "Ash", answer: "waiting", declinedAt: null, mine: false },
  ],
};

describe("the steward slate on a launch decision", () => {
  it("shows every name with its answer, and a DECLINE is one of them", () => {
    render(<StewardSlate slate={SLATE} onAnswer={async () => {}} busy={false} />);
    expect(screen.getByText("Wren")).toBeTruthy();
    expect(screen.getByText("Iris")).toBeTruthy();
    expect(screen.getByText("Ash")).toBeTruthy();
    // The three states read as three different words, so nobody has to infer
    // a refusal from the absence of an acceptance.
    expect(screen.getByText("accepted")).toBeTruthy();
    expect(screen.getByText("declined")).toBeTruthy();
    expect(screen.getByText("has not answered yet")).toBeTruthy();
  });

  it("says whose list it is, and what accepting costs", () => {
    render(<StewardSlate slate={SLATE} onAnswer={async () => {}} busy={false} />);
    // ONE PERSON CHOSE IT. The village is voting on somebody else's choice.
    expect(screen.getByText(/Wren opened this vote and chose this list/)).toBeTruthy();
    // ALL NINETEEN, said where somebody reads about the seat rather than in a
    // help page. The number comes from the server, off HANDOVER_SET.
    expect(screen.getByText(/all\s+19\s+of the powers this village has to give/)).toBeTruthy();
  });

  it("offers a nominee the DECLINE, and sends it", async () => {
    const onAnswer = vi.fn(async () => {});
    render(
      <StewardSlate
        slate={{ ...SLATE, members: [{ ...SLATE.members[2]!, mine: true }] }}
        onAnswer={onAnswer}
        busy={false}
      />,
    );
    const button = screen.getByRole("button", { name: /Decline the steward's seat/ });
    await userEvent.click(button);
    expect(onAnswer).toHaveBeenCalledWith(false);
    // ACCEPTING IS NOT HERE. It rides on the vote, because the acceptance is
    // carried on the vote row and there is no row until somebody votes. A
    // second accept control here would be a second home for one answer.
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  });

  it("lets somebody who declined change their mind, and nobody else see that control", async () => {
    const onAnswer = vi.fn(async () => {});
    const { rerender } = render(
      <StewardSlate
        slate={{ ...SLATE, members: [{ ...SLATE.members[1]!, mine: true }] }}
        onAnswer={onAnswer}
        busy={false}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /I have changed my mind/ }));
    expect(onAnswer).toHaveBeenCalledWith(true);

    // The same decline, read by somebody it does not belong to: visible, and
    // not actionable. `mine` is the only thing that changed.
    rerender(<StewardSlate slate={SLATE} onAnswer={onAnswer} busy={false} />);
    expect(screen.getByText("declined"), "still on the record for the village").toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says a slate everybody declined seats nobody, before anybody votes", () => {
    render(
      <StewardSlate
        slate={{
          ...SLATE,
          members: [{ ...SLATE.members[1]!, mine: false }],
        }}
        onAnswer={async () => {}}
        busy={false}
      />,
    );
    expect(screen.getByText(/Everybody named has declined/)).toBeTruthy();
  });

  it("renders a proposal that names nobody without pretending it is a fault", () => {
    render(<StewardSlate slate={{ ...SLATE, members: [], proposedBy: null }} onAnswer={async () => {}} busy={false} />);
    expect(screen.getByText(/names nobody for the steward's seat/)).toBeTruthy();
    expect(screen.getByText(/That stops nothing/)).toBeTruthy();
  });

  it("offers nothing to answer once the vote has closed", () => {
    render(
      <StewardSlate
        slate={{ ...SLATE, open: false, members: [{ ...SLATE.members[2]!, mine: true }] }}
        onAnswer={async () => {}}
        busy={false}
      />,
    );
    // The same two lists, now a record. A control here would offer an answer
    // the server refuses, because the seating has already read these rows.
    expect(screen.getByText("Ash")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
