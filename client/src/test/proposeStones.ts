/**
 * Walking the application's six steps in a test (pages/ProposeARole.tsx).
 * Every step stays in the page, hidden until stood on, so a field anywhere can
 * be filled by its label; what changes is that Send is on the last step, and
 * Continue judges each step on the way.
 */
import { fireEvent, screen } from "@testing-library/react";
import { OPEN_WORDS } from "@shared/openProposals";

/**
 * One value item on the role's card, filled: what it brings, how we will know
 * it is done, and the first season goal when the season has any.
 */
export const fillValue = () => {
  for (const card of Array.from(document.querySelectorAll("[data-role-card]"))) {
    const title = card.querySelector<HTMLInputElement>('input[id$="-0-title"]');
    const done = card.querySelector<HTMLInputElement>('input[id$="-0-done"]');
    const serves = card.querySelector<HTMLSelectElement>('select[id$="-0-serves"]');
    if (title && !title.value) fireEvent.change(title, { target: { value: "Open the gate each dawn" } });
    if (done && !done.value) fireEvent.change(done, { target: { value: "the gate is open by sunrise" } });
    if (serves && !serves.value && serves.options.length > 1) fireEvent.change(serves, { target: { value: serves.options[1].value } });
  }
};
/** The older name, kept for the tests that say "goals". */
export const fillGoals = fillValue;

/** The step the form stands on: know, about, value, terms, first or review. */
export const stoneNow = () => document.querySelector("[data-open-proposal]")?.getAttribute("data-stone-now") ?? null;

/** Press Continue once. */
export const pressNext = () => fireEvent.click(document.querySelector("[data-stone-next]") as HTMLElement);

/** Walk on with Continue until Review & submit, or until a step holds you there (its gaps are then listed). */
export const walk = () => {
  for (let i = 0; i < 6 && stoneNow() !== "review"; i++) {
    const before = stoneNow();
    pressNext();
    if (stoneNow() === before) return;
  }
};

/** Walk to Review & submit and press Send. A step that holds you leaves Send unpressed, and its list says why. */
export const sendNow = () => {
  walk();
  if (stoneNow() === "review") fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
};

/** The form's answer for a test: one role named in the address, the village's words as a fresh village has them. */
export const SETUP = {
  knowUs: ["Join a community call", "Visit the land", "Share a meal with us"],
  knowUsNote: "We encourage you to do these, but you can still apply.",
  shares: [
    { label: "Cash", pct: 40 },
    { label: "Equity", pct: 55 },
    { label: "Credits", pct: 5 },
  ],
  atRisk: "The equity and credits are at risk: they hold value only if the village succeeds.",
  footer: "Indicative only. Equity, land credit, token and credit terms are still being defined and are subject to legal review.",
  firstCycle: "Your first cycle is one month. At its end, either side may choose to stop there, with thanks.",
  firstConversations: ["Technical Operations: your accounts and tools"],
  updatedNote: "",
};
