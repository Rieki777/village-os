// @vitest-environment jsdom
/**
 * A chip that explains itself on touch: a button that opens one line, says
 * so to a screen reader, and keeps one gloss open per card.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Gloss, GlossChip, useGlossGroup } from "./GlossChip";

function Card() {
  const g = useGlossGroup();
  return (
    <div>
      <GlossChip tone="notice" open={g.isOpen("key")} glossId="g-key" onToggle={() => g.toggle("key")} onClose={g.close}>
        Key seat
      </GlossChip>
      <GlossChip tone="suggestion" tag="Suggested" open={g.isOpen("suits")} glossId="g-suits" onToggle={() => g.toggle("suits")}>
        Suits The Builder
      </GlossChip>
      <Gloss id="g-key" open={g.isOpen("key")}>
        The village marked this seat as key.
      </Gloss>
      <Gloss id="g-suits" open={g.isOpen("suits")}>
        Guessed from the seat's own words.
      </Gloss>
    </div>
  );
}

const chip = (name: RegExp) => screen.getByRole("button", { name });
const gloss = (id: string) => document.getElementById(id)!;

describe("GlossChip", () => {
  it("is a button that points at its own gloss", () => {
    render(<Card />);
    const key = chip(/Key seat/);
    expect(key.getAttribute("type")).toBe("button");
    expect(key.getAttribute("aria-controls")).toBe("g-key");
    expect(gloss("g-key")).not.toBeNull();
  });

  it("opens and closes its gloss, and says which", () => {
    render(<Card />);
    const key = chip(/Key seat/);
    expect(key.getAttribute("aria-expanded")).toBe("false");
    expect(gloss("g-key").hidden).toBe(true);
    fireEvent.click(key);
    expect(key.getAttribute("aria-expanded")).toBe("true");
    expect(gloss("g-key").hidden).toBe(false);
    expect(screen.getByText("The village marked this seat as key.")).toBeVisible();
    fireEvent.click(key);
    expect(key.getAttribute("aria-expanded")).toBe("false");
    expect(gloss("g-key").hidden).toBe(true);
  });

  it("keeps one gloss open per card", () => {
    render(<Card />);
    fireEvent.click(chip(/Key seat/));
    fireEvent.click(chip(/Suits The Builder/));
    expect(chip(/Key seat/).getAttribute("aria-expanded")).toBe("false");
    expect(chip(/Suits The Builder/).getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll("p:not([hidden])")).toHaveLength(1);
  });

  it("closes on Escape", () => {
    render(<Card />);
    const key = chip(/Key seat/);
    fireEvent.click(key);
    fireEvent.keyDown(key, { key: "Escape" });
    expect(key.getAttribute("aria-expanded")).toBe("false");
  });

  it("divides the Suggested tag from the class name", () => {
    render(<Card />);
    const suits = chip(/Suits The Builder/);
    const tag = Array.from(suits.querySelectorAll("span")).find((s) => s.textContent === "Suggested");
    expect(tag, "the tag is its own span").toBeTruthy();
    expect(tag!.className).toContain("border-l");
    expect(suits.className).toContain("border-dashed");
  });
});
