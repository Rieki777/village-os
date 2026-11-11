// @vitest-environment jsdom
/**
 * The decider's side by side names the gaps. A founding application (Phase A)
 * sends value items and no picked goals, so an empty `moves` list beside value
 * items is not "No goal of X picked". An application with nothing at all still
 * reads as the gap it is.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardSideBySide } from "./RoleCardBridge";

afterEach(cleanup);

const ROLE = { id: "lfs", name: "Lead Finance Steward", accountabilities: ["Keep the books open"], commitmentPct: 100 };
const card = (roles: Array<{ roleId: string; moves: Array<{ text: string; target: string }>; firstMoon: Array<{ quest: string; doneWhen: string; serves?: string }> }>) => ({
  roles,
  serves: [{ goalId: "g1", how: "A cash view" }],
  agreed: { nda: true },
});

describe("CardSideBySide gaps", () => {
  it("does not flag a missing goal pick when the application carries value items and no moves", () => {
    const { container } = render(
      <CardSideBySide roles={[ROLE]} membershipAligned card={card([{ roleId: "lfs", moves: [], firstMoon: [{ quest: "A cash view every Monday", doneWhen: "every circle has it", serves: "g1" }] }])} />,
    );
    expect(container.textContent).not.toContain("No goal of Lead Finance Steward picked");
  });

  it("CONTROL: still flags it when nothing was offered at all", () => {
    const { container } = render(<CardSideBySide roles={[ROLE]} membershipAligned card={card([{ roleId: "lfs", moves: [], firstMoon: [] }])} />);
    expect(container.textContent).toContain("No goal of Lead Finance Steward picked");
  });
});
