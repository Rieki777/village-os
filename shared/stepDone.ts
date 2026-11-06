/**
 * The line after a screen of the role proposal: what was saved, and what
 * comes next. One sentence each. The page shows both as text.
 */
export interface StepDoneCopy {
  saved: string;
  next: string;
}

export type DoneFrom = "welcome" | "yours" | "roles" | "words" | "season" | "terms" | "preview";

const COPY: Record<DoneFrom, StepDoneCopy> = {
  welcome: { saved: "You started.", next: "Three questions, in your own words." },
  yours: { saved: "Your words, kept as you wrote them.", next: "Pick the roles, or propose a new one." },
  roles: { saved: "The roles you picked are saved.", next: "Each role's words come next." },
  words: { saved: "The words on your roles are saved.", next: "Your aim for the season comes next." },
  season: { saved: "Your aim for the season is saved.", next: "Terms and review dates come next." },
  terms: { saved: "Your terms are saved.", next: "A preview of your card comes next." },
  preview: { saved: "You looked over your card.", next: "Share it, then submit it." },
};

export function stepDone(from: DoneFrom): StepDoneCopy {
  return COPY[from];
}

export const DONE_FROMS = Object.keys(COPY) as DoneFrom[];
