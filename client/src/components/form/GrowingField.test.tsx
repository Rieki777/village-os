// @vitest-environment jsdom
/**
 * A sentence field wraps and grows. "This role exists while" used to be one
 * line and cut the words off at the edge of the screen.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EDIT_FIELDS } from "@/components/roleProposal/roleWords";
import StepWords from "@/components/roleProposal/StepWords";
import { CARD_WORDS } from "@shared/playerCardWords";
import GrowingField from "./GrowingField";

const LONG = "This role exists while the garden needs a keeper through the guest season and the quiet months after.";

describe("a sentence field grows", () => {
  it("is a wrapping textarea, at least 44px tall", () => {
    render(<GrowingField aria-label="While" value={LONG} onChange={() => {}} />);
    const box = screen.getByLabelText("While");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box.className).toContain("min-h-[44px]");
    expect(box.className).toContain("whitespace-pre-wrap");
    expect(box.className).toContain("break-words");
    expect(box.className).toContain("max-w-full");
    expect((box as HTMLTextAreaElement).value).toBe(LONG);
  });

  it("draws This role exists while, and Time, as growing fields", () => {
    expect(EDIT_FIELDS.find((f) => f.field === "existsWhile")?.multiline).toBe(true);
    expect(EDIT_FIELDS.find((f) => f.field === "timeCommitment")?.multiline).toBe(true);
    render(
      <StepWords
        roles={[{ id: "r1", name: "Garden", isNew: false, fields: [], reviewOn: "", circle: null, holderCount: 0 }]}
        typed={{ r1: { existsWhile: LONG } }}
        frameworkTerms={false}
        onType={() => {}}
        onReview={() => {}}
      />,
    );
    const box = screen.getByLabelText(CARD_WORDS.existsWhile);
    expect(box.tagName).toBe("TEXTAREA");
    expect((box as HTMLTextAreaElement).value).toBe(LONG);
    expect(screen.getByLabelText(CARD_WORDS.timeCommitment).tagName).toBe("TEXTAREA");
  });
});
