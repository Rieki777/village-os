/**
 * WHAT A MEMBER SEES OF THE VILLAGE'S EMAIL, AND HOW THEY ASK FOR A CHANGE
 * (the comms build spec 5.13, ruling 2026-09-25: the dials are visible and
 * proposable).
 *
 * One page lists every journey with whether it is on, its steps and their
 * timing, and each email's words rendered with sample data, plus the comms
 * dials. It is read-only. Every item carries a "Propose a change" door, and
 * the door goes one of two ways:
 *
 *   - A dial the village may vote on (ring `open`) goes to the village's own
 *     proposal path for dials, the Game Mechanics page, with the dial named in
 *     the address (`dialLink`). That page already drafts, sponsors and opens a
 *     mechanics proposal, so a comms dial gets no second way to be proposed.
 *   - Everything that path cannot carry (a journey, a step's timing, an
 *     email's words, and a founder-held dial) becomes a `comms-change`
 *     submission, which lands in the admin queue beside every other request.
 *
 * Proposing changes nothing. Changing a journey, its words or a dial stays
 * with whoever holds `comms.manage`, or with the village's vote for a dial.
 *
 * Pure and isomorphic: the server checks a proposal with `readProposal`, and
 * the page uses the same limits to say what fits before anything is sent.
 */

/** The submission type a proposed comms change is filed under. */
export const COMMS_CHANGE = "comms-change";

/** What a proposal is about. */
export const PROPOSE_TARGETS = ["journey", "step", "words", "dial"] as const;
export type ProposeTarget = (typeof PROPOSE_TARGETS)[number];

/** How long the words of a proposal may be. */
export const PROPOSAL_LIMITS = { min: 10, max: 2000 } as const;

/** Where a dial's "Propose a change" door leads. */
export type DialDoor = "mechanics" | "submission";

export interface MemberEmailView {
  templateKey: string;
  label: string;
  subject: string;
  preheader: string;
  /** The plain-text part, rendered with sample data greeting the reader. */
  text: string;
}

export interface MemberStepView {
  key: string;
  label: string;
  timing: string;
  /** What makes this step wait or skip, in words. */
  skipIf: string[];
  email: MemberEmailView | null;
}

export interface MemberJourneyView {
  key: string;
  title: string;
  state: "on" | "off";
  /** What ends the journey for somebody, in words. */
  stops: string[];
  steps: MemberStepView[];
}

export interface MemberDialView {
  key: string;
  label: string;
  description: string;
  value: string;
  defaultValue: string;
  unit: string | null;
  isDefault: boolean;
  door: DialDoor;
}

export interface MemberCommsView {
  journeys: MemberJourneyView[];
  /** Emails no journey sends: a gathering changing, the waitlist, time votes, letters. */
  others: Array<{ title: string; emails: MemberEmailView[] }>;
  dials: MemberDialView[];
}

export interface ProposalInput {
  target: ProposeTarget;
  /** The journey key, template key or dial key the proposal is about. */
  key: string;
  /** The step, for a proposal about one step of a journey. */
  step: string | null;
  change: string;
}

const KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
const STEP = /^[a-z][a-z0-9_]{0,63}$/;

/** A proposal from a request body, or the one thing wrong with it. */
export function readProposal(body: unknown): { proposal: ProposalInput } | { problem: string } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const target = String(b.target ?? "");
  if (!(PROPOSE_TARGETS as readonly string[]).includes(target)) return { problem: "Choose what the change is about." };
  const key = String(b.key ?? "").trim();
  if (!KEY.test(key)) return { problem: "Choose the journey, email or dial the change is about." };
  const rawStep = typeof b.step === "string" ? b.step.trim() : "";
  if (target === "step" && !STEP.test(rawStep)) return { problem: "Choose the step the change is about." };
  const change = String(b.change ?? "").trim();
  if (change.length < PROPOSAL_LIMITS.min) return { problem: `Say what you'd change, in at least ${PROPOSAL_LIMITS.min} characters.` };
  if (change.length > PROPOSAL_LIMITS.max) return { problem: `Keep it under ${PROPOSAL_LIMITS.max} characters.` };
  return { proposal: { target: target as ProposeTarget, key, step: target === "step" ? rawStep : null, change } };
}

/** The Game Mechanics page with one dial found for the reader. */
export function dialLink(key: string): string {
  return `/game-mechanics?dial=${encodeURIComponent(key)}`;
}

/** The dial a Game Mechanics address names, or "" when it names none. */
export function dialFromSearch(search: string): string {
  const key = new URLSearchParams(search).get("dial") ?? "";
  return KEY.test(key) ? key : "";
}
