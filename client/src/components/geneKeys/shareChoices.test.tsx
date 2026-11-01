// @vitest-environment jsdom
/**
 * THE LAST STEP OF FINDING YOUR LINES, reached from a session card's invitation
 * (the coordinator's call on Rye's request of 2026-11-01): finding your lines
 * and saying yes to the card become one pass, and consent stays explicit.
 * Each choice is its own named box, and nothing is ticked that the member did
 * not tick before. Reached any other way, the page asks nothing about cards.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { OwnGeneKeysView } from "@shared/geneKeys";
import ShareChoices, { SHARE_WORDS, savePayload, seedChoices, type Choices } from "./ShareChoices";

afterEach(cleanup);

function Harness({ fromCard, start }: { fromCard: boolean; start: Choices }) {
  const [c, setC] = useState(start);
  return (
    <>
      <ShareChoices fromCard={fromCard} choices={c} onChange={setC} />
      <output data-testid="payload">{JSON.stringify(savePayload(c, fromCard))}</output>
    </>
  );
}

const fresh = seedChoices(null);

describe("the share step's choices", () => {
  it("ticks nothing for somebody new, and carries forward what somebody ticked before", () => {
    expect(fresh).toEqual({ visibility: "show", maia: false, cards: false });
    const before = { visibility: "hide", maia: true, inCards: true } as OwnGeneKeysView;
    expect(seedChoices(before)).toEqual({ visibility: "hide", maia: true, cards: true });
  });

  it("from a card's invitation, names the card's own yes as a box of its own, unticked, and sends it", () => {
    render(<Harness fromCard start={fresh} />);
    const cards = screen.getByRole("checkbox", { name: new RegExp(SHARE_WORDS.cards) }) as HTMLInputElement;
    const maia = screen.getByRole("checkbox", { name: new RegExp(SHARE_WORDS.maia) }) as HTMLInputElement;
    expect([cards.checked, maia.checked]).toEqual([false, false]);
    expect(JSON.parse(screen.getByTestId("payload").textContent!)).toEqual({ visibility: "show", maia: false, cards: false });
    fireEvent.click(cards);
    fireEvent.click(maia);
    expect(JSON.parse(screen.getByTestId("payload").textContent!)).toEqual({ visibility: "show", maia: true, cards: true });
  });

  it("reached any other way, asks nothing about cards and sends no card answer", () => {
    render(<Harness fromCard={false} start={fresh} />);
    expect(screen.queryByRole("checkbox", { name: new RegExp(SHARE_WORDS.cards) })).toBeNull();
    expect(JSON.parse(screen.getByTestId("payload").textContent!)).toEqual({ visibility: "show", maia: false });
  });

  it("says the card reads lines only while they are shown and Maia may use them", () => {
    render(<Harness fromCard start={fresh} />);
    expect(screen.getByText(SHARE_WORDS.cardsLine)).toBeTruthy();
  });
});
