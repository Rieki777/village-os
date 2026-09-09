// @vitest-environment jsdom
/**
 * THE FOUR SENTENCES A SEAT OWES A READER.
 *
 * Rye's ask for this map: "any existing or new member can come to this map
 * and know what roles do what, and whom to interact with." A seat answers
 * that with four fields, and sociocracy names the first two deliberately:
 *
 *   aim               what it works toward
 *   domain            what it DECIDES on
 *   accountabilities  what it is answerable for
 *   whyItMatters      why the village bothers having it
 *
 * All 25 of Amora's seats carry all four, written by the people who hold
 * them. Two of them have been silently absent from this card at different
 * times: `domain` was read every request and dropped by the projection, and
 * `whyItMatters` was taken OFF the `/api/map` wire earlier in this same
 * session on the grounds that nothing read it. Both times the data existed,
 * the database returned it, and one object literal deleted it on the way out.
 *
 * That is why this file asserts the READING and not the wire. A field with no
 * reader gets removed by the next person who greps for one, correctly, and a
 * field with a reader and no test gets removed by the person after that.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HolderCard, { unwrittenLine } from "./HolderCard";
import type { PowerData, PowerSeat, PowerCircle } from "./types";

const SEAT: PowerSeat = {
  id: "water-keeper",
  name: "Water Keeper",
  description: "Keep the village's water clean, flowing and understood.",
  domain: "The catchment, the tanks and the greywater lines",
  accountabilities: ["Testing the spring monthly", "Calling a repair before a failure"],
  whyItMatters: "A village that loses its water loses a season, not an afternoon.",
  circleId: "land",
  seats: 2,
  holderCount: 1,
  vacant: true,
  state: "partial",
  // The card reads `seat.holders` without a guard, so the fixture carries the
  // shape the server always sends: an array, empty below the people tier.
  holders: [{ userId: "u-bo", name: "Bo", kind: "member", lapsed: false, avatar: null }],
} as PowerSeat;

const CIRCLE = { id: "land", name: "Permaculture Council" } as PowerCircle;

const DATA = {
  circles: [CIRCLE],
  roles: [SEAT],
  relations: [],
  relationTypes: [],
  season: { current: null, nextRollAt: null },
  viewer: { viewPeople: true, canContact: false },
  power: { glossary: { shapes: [], decidesBy: [], domains: [], howChosen: [] } },
} as unknown as PowerData;

/*
 * A LABEL IS A <dt>, AND THAT DISTINCTION IS LOAD-BEARING HERE.
 *
 * `queryByText(/why it matters/i)` matched the unwritten-fields sentence too,
 * because that sentence legitimately contains those words: "Still to be
 * written down: ... and why it matters." So an assertion that the LABEL is
 * absent has to look at the label element, or it reports a heading that is
 * not there and passes over one that is.
 */
const labels = () => Array.from(document.querySelectorAll("dt")).map((d) => (d.textContent ?? "").trim());

const show = (over: Partial<PowerSeat> = {}) =>
  render(<HolderCard seat={{ ...SEAT, ...over }} circle={CIRCLE} data={DATA} />);

describe("a seat card says what the seat is for", () => {
  it("gives all four sentences when the seat carries all four", () => {
    show();
    expect(screen.getByText(/Keep the village's water clean/)).toBeTruthy();
    expect(screen.getByText(/The catchment, the tanks/)).toBeTruthy();
    expect(screen.getByText(/Testing the spring monthly/)).toBeTruthy();
    expect(screen.getByText(/loses a season, not an afternoon/)).toBeTruthy();
  });

  it("labels them, so a reader knows which question each one answers", () => {
    // "Decides on" is the half that tells you whether to bring this seat your
    // question at all, and an unlabelled paragraph does not say that.
    show();
    expect(labels()).toEqual(["Decides on", "Answerable for", "Why it matters"]);
  });

  it("READS whyItMatters, the field that was dropped for having no reader", () => {
    // The regression this file exists for. Stated on its own so a failure
    // names the field rather than "the card changed".
    show();
    expect(
      screen.queryByText(/loses a season, not an afternoon/),
      "whyItMatters is on the wire again and nothing renders it",
    ).toBeTruthy();
  });

  it("says nothing at all rather than an empty heading", () => {
    // A village that has not written these yet must not get three labels
    // over blank space, which reads as broken rather than as unwritten.
    const { container } = render(
      <HolderCard
        seat={{ ...SEAT, domain: null, accountabilities: [], whyItMatters: null }}
        circle={CIRCLE}
        data={DATA}
      />,
    );
    expect(container.querySelector("dl")).toBeNull();
    expect(labels()).toEqual([]);
  });

  it("SAYS SO when nothing has been written, instead of showing blank space", () => {
    // The fork case. Every new village starts here, and blank reads as a
    // broken map rather than as work nobody has done yet.
    render(
      <HolderCard
        seat={{ ...SEAT, description: "", domain: null, accountabilities: [], whyItMatters: null }}
        circle={CIRCLE}
        data={DATA}
      />,
    );
    expect(screen.getByText(/Nobody has written down what this seat is for yet/)).toBeTruthy();
  });

  it("shows the three that exist when one is missing", () => {
    show({ domain: null });
    expect(labels()).toEqual(["Answerable for", "Why it matters"]);
  });
});

describe("what a seat has not said yet", () => {
  const seat = (over: Record<string, unknown> = {}) => ({
    description: "Keep the water clean.",
    domain: "The catchment",
    accountabilities: ["Testing the spring"],
    whyItMatters: "A village needs water.",
    ...over,
  });

  it("stays SILENT on a seat that is fully written", () => {
    // The rule that keeps this from being a nag. Amora is in this state on
    // all 25 of its seats, and it must see nothing.
    expect(unwrittenLine(seat())).toBeNull();
  });

  it("names the one field that is missing", () => {
    expect(unwrittenLine(seat({ domain: null }))).toBe("Still to be written down: what it decides on.");
  });

  it("joins two or three into one line rather than repeating an apology", () => {
    expect(unwrittenLine(seat({ domain: null, whyItMatters: "" }))).toBe(
      "Still to be written down: what it decides on and why it matters.",
    );
    expect(unwrittenLine(seat({ domain: null, accountabilities: [], whyItMatters: null }))).toBe(
      "Still to be written down: what it decides on, what it answers for and why it matters.",
    );
  });

  it("says the short plain thing when the seat is entirely blank", () => {
    expect(unwrittenLine({})).toBe("Nobody has written down what this seat is for yet.");
  });

  it("treats whitespace as unwritten, because it is", () => {
    expect(unwrittenLine(seat({ domain: "   " }))).toBe("Still to be written down: what it decides on.");
  });
});
