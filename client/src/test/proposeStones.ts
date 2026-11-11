/**
 * Walking the open proposal form's six stones in a test (the firefly path,
 * pages/ProposeARole.tsx). Every stone stays in the page, hidden until stood
 * on, so a field anywhere can be filled by its label; what changes is that
 * Send is on the last stone, and Next judges each stone on the way.
 */
import { fireEvent, screen } from "@testing-library/react";
import { OPEN_WORDS } from "@shared/openProposals";

/** One goal on every picked role's card: the form asks for at least one before it sends (audit B1). */
export const fillGoals = () => {
  for (const card of Array.from(document.querySelectorAll("[data-role-card]"))) {
    const title = card.querySelector<HTMLInputElement>('input[id$="-title"]');
    const done = card.querySelector<HTMLInputElement>('input[id$="-done"]');
    if (title && !title.value) fireEvent.change(title, { target: { value: "Open the gate each dawn" } });
    if (done && !done.value) fireEvent.change(done, { target: { value: "the gate is open by sunrise" } });
  }
};

/** The stone the form stands on: role, moon, why, energy, about or send. */
export const stoneNow = () => document.querySelector("[data-open-proposal]")?.getAttribute("data-stone-now") ?? null;

/** Press Next once. */
export const pressNext = () => fireEvent.click(document.querySelector("[data-stone-next]") as HTMLElement);

/** Walk on with Next until the Send stone, or until a stone holds you there (its gaps are then listed). */
export const walk = () => {
  for (let i = 0; i < 6 && stoneNow() !== "send"; i++) {
    const before = stoneNow();
    pressNext();
    if (stoneNow() === before) return;
  }
};

/** Walk to Send and press it. A stone that holds you leaves Send unpressed, and its list says why. */
export const sendNow = () => {
  walk();
  if (stoneNow() === "send") fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
};
