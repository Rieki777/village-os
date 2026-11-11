/**
 * THE STEPS BEFORE A ROLE STARTS, IN WORDS (role journey L7).
 *
 * One copy for the holder's notice (server/lib/seatApplicationCloser.ts,
 * `tellSteps`) and the card on their profile
 * (client/src/components/profile/RoleStartSteps.tsx), so the two never say
 * different things. The rules live in server/lib/roleStartAgreements.ts.
 */
import { applicationHref } from "./seatApplications";

/** The steps, in the order the holder meets them: the board's shipped order, confidentiality first. */
export const START_STEPS = ["confidentiality", "membership", "terms"] as const;
export type StartStep = (typeof START_STEPS)[number];

/** How many days the first stretch is. Next-season prompts and the ladder wait until it has passed. */
export const FIRST_DAYS = 14;

const COUNT = ["No steps", "One step", "Two steps", "Three steps"] as const;

export const START_WORDS = {
  title: (n: number) => `${COUNT[Math.min(n, 3)]} before your role starts`,
  /** The card's own heading: it lists every step, so it carries no count. */
  cardTitle: "Before you start",
  alignWith: (title: string) => `Align with ${title}`,
  step: {
    confidentiality: "Align with the village's confidentiality agreement.",
    membership: "Align with the membership letter.",
    terms: "Align with your role's terms, the agreed rate included.",
  } satisfies Record<StartStep, string>,
  after: "Your role starts within the hour after the last one. Aligning is the village's way of signing.",
  noAgreement: "A role is waiting on the confidentiality agreement, and the village has not written it yet",
} as const;

/** Where each step is done. */
export function stepHref(step: StartStep, app: { id: string }): string {
  if (step === "confidentiality") return "/aligned";
  if (step === "membership") return "/love-letter";
  return applicationHref(app.id);
}

/** The notice's words: the steps, one a line, then when the role starts. */
export function stepsBody(steps: readonly StartStep[]): string {
  return [...steps.map((s) => START_WORDS.step[s]), START_WORDS.after].join("\n");
}
