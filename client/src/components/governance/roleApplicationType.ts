/**
 * APPLY FOR SEATS, ON TERMS.
 *
 * One entry of WIZARD_TYPE_CONFIGS, kept in its own file because wizardConfig.ts
 * sits near the monolith ratchet's threshold (the same reason roleSeatType.ts
 * lives apart). wizardConfig.ts lists it first, where it always stood.
 *
 * ONE APPLICATION, ONE TO THREE ROLES (seat settings PR4; D3). A member who would
 * hold three seats applies once, so their pay, allowance and bonus are recorded
 * once. The subject step picks the seats (`seatPicks`), the terms step is one
 * `seatSettings` field judged by `parseSeatSettings`, the parser the route uses,
 * and an optional first day lets an application for next season wait for it.
 *
 * IT PUBLISHES FOR REAL. `role_application` is in the server's
 * CONDUCTABLE_TYPES, and `POST /api/governance/role-applications` either puts
 * the application in front of a live holder of the power that seats people or
 * opens the village's vote on it (server/routes/seatApplications.ts). So the
 * review step leaves out the sensing sentences (`opensVote`).
 *
 * DRAFTS KEEP LOADING. The id stays `role_application`. A draft saved when the
 * subject was one seat (`seatId`) publishes as an application for that seat;
 * the old terms fields ride along in the stored payload unread.
 *
 * `?seat=<id>` opens the wizard on this type with that seat picked and its
 * terms on offer in the terms step (`roleApplicationStart`), which is where a
 * seat card's raised hand sends a member who reads terms.
 */
import { UserPlus } from "lucide-react";
import { parseSeatSettings } from "@shared/seatSettings";
import { MAX_SEATS } from "@shared/seatApplications";
import { seatsFromSearch } from "@shared/seatApplyLinks";
import { ALIGN_WORDS } from "@shared/alignments";
import type { WizardTypeConfig } from "./wizardConfig";
import { atLeast } from "./wizardValidators";
import { pickedSeats } from "./SeatPicksField";
import { fetchApplication } from "./seatApplicationsApi";
import { OPEN_AIM_MAX } from "@shared/openProposals";
import { isDoor } from "./wizardDoor";

/** The door's terms answer: accepted or a wish to talk, and the terms on offer it showed (TermsOnOfferField). */
export interface TermsChoice {
  choice: "accept" | "talk";
  note: string;
  settings: unknown;
}

export function termsChoiceOf(v: unknown): TermsChoice | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.choice !== "accept" && o.choice !== "talk") return null;
  return { choice: o.choice, note: typeof o.note === "string" ? o.note : "", settings: o.settings ?? null };
}

/** The door's terms verdict: a choice, a note when talking, and terms the route will read. */
export const termsChoiceProblem = (v: unknown, a: Record<string, unknown>): string | null => {
  if (!isDoor(a)) return null;
  const t = termsChoiceOf(v);
  if (!t) return "Say whether you accept the terms on offer, or would like to talk about them.";
  if (t.choice === "talk" && !t.note.trim()) return "Say what you would like to talk about in the terms.";
  return settingsProblem(t.settings);
};

/** The member door's answers as the route stores them (shared/seatApplications.ts parseApplicationAnswers). */
export function doorAnswers(a: Record<string, unknown>): Record<string, unknown> {
  const goal = String(a.servesGoal ?? "").trim();
  const t = termsChoiceOf(a.termsChoice);
  return {
    aim: String(a.aim ?? "").trim() || null,
    servesGoal: goal && goal !== NO_SEASON_GOALS ? goal : null,
    terms: t ? { choice: t.choice, note: t.note.trim() } : null,
  };
}

/** No goals for the season yet: the goal field answers this for the member (SeasonGoalField). */
export const NO_SEASON_GOALS = "none";

/**
 * THE DOOR'S DELIVERABLES: the aim, the goal served and the terms choice
 * lead, then the member's own list, the way the open form's card reads to a
 * decider (deliverablesOf, server/lib/openProposalDecide.ts). Any other start
 * publishes its deliverables as written.
 */
export function doorDeliverables(a: Record<string, unknown>): unknown {
  if (!isDoor(a)) return a.deliverables;
  const lines: string[] = [];
  const aim = String(a.aim ?? "").trim();
  if (aim) lines.push(`Aim: ${aim}`);
  const goal = String(a.servesGoal ?? "").trim();
  if (goal && goal !== NO_SEASON_GOALS) lines.push(`Serves the village goal: ${goal}`);
  const t = termsChoiceOf(a.termsChoice);
  if (t?.choice === "accept") lines.push("Accepts the terms on offer.");
  if (t?.choice === "talk") lines.push(`Wants to talk about the terms: ${t.note.trim()}`);
  const own = String(a.deliverables ?? "").trim();
  return [lines.join("\n"), own].filter(Boolean).join("\n\n");
}

/** The whole preset the terms step starts from when nothing is written yet. */
export const ROLE_APPLICATION_PREFILL = "platform:whole-volunteer-seat";

/** The terms field's verdict: the parser's first refusal, in its own words. */
export const settingsProblem = (v: unknown): string | null => {
  const parsed = parseSeatSettings(v);
  if (parsed.ok) return null;
  const first = parsed.problems[0];
  const more = parsed.problems.length - 1;
  return more > 0 ? `${first.message} And ${more} more to fix in the terms.` : first.message;
};

/** The seats field's verdict: one to five. */
export const seatsProblem = (v: unknown): string | null => {
  const n = pickedSeats(v).length;
  if (n === 0) return "Pick the role you are proposing for.";
  if (n > MAX_SEATS) return `One proposal holds at most ${MAX_SEATS} roles.`;
  return null;
};

export const ROLE_APPLICATION_TYPE: WizardTypeConfig = {
  id: "role_application",
  group: "Recurring",
  icon: UserPlus,
  title: "Propose for a role",
  description:
    "Propose to hold one role or up to three, with what you will have done by the end of the season and the terms you hold them on.",
  consequence:
    "Sending puts your proposal and its terms in front of whoever adopts roles: a live holder of that power, or the whole village by vote. Every member can read the terms. A vote names the roles and never you or the money.",
  opensVote: true,
  // Its route asks terms.read, the member rung, never proposal.open, so the
  // card stays live for a member who may not open the other votes (TypeCards).
  opensVoteForMembers: true,
  // The candidate aligns as they propose, with the words Review shows: they never click twice.
  aligns: true,
  publishLabel: ALIGN_WORDS.proposeAndAlign,
  publish: {
    path: "/api/governance/role-applications",
    body: (a) => ({
      seatIds: pickedSeats(a.seatIds ?? a.seatId),
      // The door's own answers (aim, the goal served, the terms choice) lead the
      // deliverables, where every decider already reads them (doorDeliverables).
      deliverables: doorDeliverables(a),
      fitStatement: a.fitStatement,
      // B1 (0369): the door's answers, structured, so the proposal's card shows them.
      ...(isDoor(a) ? { answers: doorAnswers(a) } : {}),
      // The door sends the terms on offer it showed, unchanged; every other start sends the terms written.
      seatSettings: isDoor(a) ? (termsChoiceOf(a.termsChoice)?.settings ?? null) : (a.seatSettings ?? null),
      // Sent only when picked: no first day means "as soon as it is adopted".
      ...(String(a.startsNoEarlierThan ?? "").trim() ? { startsNoEarlierThan: String(a.startsNoEarlierThan).trim() } : {}),
      // From the member's season plan: a season still to come sets the first day to its own.
      ...(String(a.seasonId ?? "").trim() ? { seasonId: String(a.seasonId).trim() } : {}),
      // A renewal of terms the member holds (PR8): adopted, it supersedes them.
      ...(String(a.supersedesId ?? "").trim() ? { supersedesId: String(a.supersedesId).trim() } : {}),
    }),
  },
  steps: {
    subject: {
      label: "The roles",
      intro: "Which roles you propose to hold. Pick every role you would hold this season, up to three, and your terms cover them all.",
      fields: [
        {
          key: "seatIds",
          kind: "seatPicks",
          label: "Roles",
          max: MAX_SEATS,
          required: true,
          problem: seatsProblem,
          tip: "Roles come from the village's org chart. One proposal for several roles records your terms once.",
        },
      ],
    },
    details: {
      label: "Your season",
      intro: "Why you, your aim, your first tasks this moon, and the season goal they serve.",
      fields: [
        {
          key: "fitStatement",
          kind: "textarea",
          rows: 4,
          maxLength: 1500,
          label: "Why you",
          placeholder: "I have been planting food forests for 20 years. I've been living on and near the project for 5, and I'm deeply familiar with the land.",
          required: true,
          // The member reads the label "Why you", so the problem names it the same way (red team U11).
          problem: atLeast(30, '"Why you"'),
        },
        {
          // The open form asks it, so the member door does too (brief v2, 5.4).
          key: "aim",
          kind: "text",
          maxLength: OPEN_AIM_MAX,
          label: "Your aim for the season",
          placeholder: "Food grows here every season, and two more people know how.",
          required: true,
          showWhen: isDoor,
          problem: (v, a) => (isDoor(a) && !String(v ?? "").trim() ? "Say your aim for this role." : null),
        },
        {
          key: "deliverables",
          kind: "textarea",
          rows: 6,
          maxLength: 2000,
          // Guide v2: the first tasks for this moon, each with how anyone will know it is done.
          label: "Your first tasks this moon",
          placeholder: "Plant the first three beds, done when they are planted and watered. Share the planting plan, done when every circle lead has it.",
          help: "Each with a \"done when\", so anyone can check it without asking you. Members read this; a vote never shows it.",
          required: true,
          // "Your deliverables needs" read wrong (red team U11): the subject is one list.
          problem: atLeast(40, "Your list of first tasks"),
        },
        {
          key: "servesGoal",
          kind: "seasonGoal",
          label: "Which of the village's goals for the season your work serves",
          required: true,
          showWhen: isDoor,
          problem: (v, a) => (isDoor(a) && !String(v ?? "").trim() ? "Pick the village goal your work serves." : null),
        },
      ],
    },
    terms: {
      doorLabel: "The terms",
      doorIntro: "The terms each role offers. Accept them, or say what you would like to talk about: the people deciding see it. You don't write terms here.",
      label: "Your terms",
      intro: "The terms you would hold these roles on. Start from a preset, or from the role's own terms on offer, and change what does not fit.",
      fields: [
        {
          // The door reads the terms on offer and accepts them or asks to talk (Rye, form v2); it never writes terms.
          key: "termsChoice",
          kind: "termsOnOffer",
          label: "The terms on offer",
          required: true,
          showWhen: isDoor,
          problem: termsChoiceProblem,
        },
        {
          key: "seatSettings",
          kind: "seatSettings",
          label: "Settings",
          showWhen: (a) => !isDoor(a),
          prefillWhole: ROLE_APPLICATION_PREFILL,
          help: "Every member can read these terms. Money in them is recorded here and paid outside the platform.",
          problem: settingsProblem,
        },
        {
          key: "startsNoEarlierThan",
          kind: "date",
          label: "First day",
          help: "Leave it empty to start as soon as the proposal is adopted. Pick the first day of next season to propose for next season's roles now.",
        },
      ],
    },
  },
};

/**
 * WHERE A WIZARD OPENED FROM A SEAT STARTS.
 *
 * `?type=role_application&seat=<id>` (the address `proposeTermsHref` builds)
 * opens this type with the seat picked. Anything else is no start at all, and
 * the wizard opens on its type step as it always has.
 *
 * Season plans (RC1) add two: `renew=<id>` picks a seat the member already
 * holds ("Carry on"), and `season=<id>` names the season they plan, which the
 * publish sends so a season still to come sets the first day.
 *
 * SEVERAL SEATS FROM ONE ADDRESS (the character page's "Propose these"):
 * `seat` repeated, or `seats=a,b,c`, read by `seatsFromSearch`. The list is
 * handed over as it came. The seats step judges it: more than five is refused
 * by `seatsProblem`, and a full seat is taken off by `SeatPicksField`, which
 * names it.
 */
export function roleApplicationStart(search: string): { type: "role_application"; answers: Record<string, unknown> } | null {
  const q = new URLSearchParams(search);
  if (q.get("type") !== "role_application") return null;
  // Several seats at once (`seat` repeated, or `seats=a,b`) from the character page's "Propose these".
  const listed = seatsFromSearch(q);
  const renew = String(q.get("renew") ?? "").trim();
  const seats = listed.length > 0 ? listed : renew ? [renew] : [];
  const season = String(q.get("season") ?? "").trim();
  const supersedes = String(q.get("supersedes") ?? "").trim();
  // A DOOR: roles picked on a role card, the roles board or "Roles that fit", to apply for them
  // (Rye, 10 Nov 2026). A renewal, a supersession or a season plan writes its own terms, so it is not one.
  const door = listed.length > 0 && !renew && !supersedes && !season && q.get("terms") !== "write";
  return {
    type: "role_application",
    answers: {
      ...(seats.length ? { seatIds: seats } : {}),
      ...(season ? { seasonId: season } : {}),
      ...(supersedes ? { supersedesId: supersedes } : {}),
      ...(door ? { door: true } : {}),
    },
  };
}

/**
 * A RENEWAL STARTS FROM THE TERMS IT RENEWS (seat settings PR8). The term
 * warning's "Carry on" names the application the member holds the seat
 * through; the wizard then starts from that application's seats and terms,
 * so renewing on the same terms is one pass through Review. Undefined when the
 * application cannot be read: the wizard then starts as it always has.
 */
export async function renewalPrefill(supersedesId: unknown): Promise<{ seatIds: string[]; settings: unknown } | undefined> {
  const id = String(supersedesId ?? "").trim();
  if (!/^sa-[0-9a-f]{16}$/.test(id)) return undefined;
  const a = await fetchApplication(id);
  if (!a.ok) return undefined;
  const app = a.data.application;
  return { seatIds: app.seats.map((s) => s.id), settings: app.settings };
}

/**
 * The terms on offer for the first picked seat, as the terms step's starting
 * point, or undefined when there are none to offer.
 *
 * Read from the org chart the wizard already holds: `termsOffer` is on a seat
 * only for a reader holding terms.read, so a reader without it gets the
 * platform preset, the same as a seat with nothing on offer.
 */
export function offerPrefill(seatIds: unknown, org: { roles?: any[] } | null): unknown {
  const first = pickedSeats(seatIds)[0];
  if (!first || !org || !Array.isArray(org.roles)) return undefined;
  const seat = org.roles.find((r) => String(r?.id ?? "") === first);
  const raw = seat?.termsOffer;
  if (raw === null || raw === undefined) return undefined;
  const parsed = parseSeatSettings(raw);
  return parsed.ok && parsed.settings ? parsed.settings : undefined;
}
