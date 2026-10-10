/**
 * APPLY FOR SEATS, ON TERMS.
 *
 * One entry of WIZARD_TYPE_CONFIGS, kept in its own file because wizardConfig.ts
 * sits near the monolith ratchet's threshold (the same reason roleSeatType.ts
 * lives apart). wizardConfig.ts lists it first, where it always stood.
 *
 * ONE APPLICATION, ONE TO FIVE SEATS (seat settings PR4). A member who would
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
import type { WizardTypeConfig } from "./wizardConfig";
import { atLeast } from "./wizardValidators";
import { pickedSeats } from "./SeatPicksField";

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
  if (n === 0) return "Pick the seat you are applying for.";
  if (n > MAX_SEATS) return `One application holds at most ${MAX_SEATS} seats.`;
  return null;
};

export const ROLE_APPLICATION_TYPE: WizardTypeConfig = {
  id: "role_application",
  group: "Recurring",
  icon: UserPlus,
  title: "Apply for a seat",
  description:
    "Apply to hold one seat or up to five, with what you will have done by the end of the season and the terms you hold them on.",
  consequence:
    "Publishing puts your application and its terms in front of whoever adopts seats: a live holder of that power, or the whole village by vote. Every member can read the terms. A vote names the seats and never you or the money.",
  opensVote: true,
  publish: {
    path: "/api/governance/role-applications",
    body: (a) => ({
      seatIds: pickedSeats(a.seatIds ?? a.seatId),
      deliverables: a.deliverables,
      fitStatement: a.fitStatement,
      seatSettings: a.seatSettings ?? null,
      // Sent only when picked: no first day means "as soon as it is adopted".
      ...(String(a.startsNoEarlierThan ?? "").trim() ? { startsNoEarlierThan: String(a.startsNoEarlierThan).trim() } : {}),
      // From the member's season plan: a season still to come sets the first day to its own.
      ...(String(a.seasonId ?? "").trim() ? { seasonId: String(a.seasonId).trim() } : {}),
    }),
  },
  steps: {
    subject: {
      label: "The seats",
      intro: "Which seats you are applying to hold. Pick every seat you would hold this season, up to five, and your terms cover them all.",
      fields: [
        {
          key: "seatIds",
          kind: "seatPicks",
          label: "Seats",
          max: MAX_SEATS,
          required: true,
          problem: seatsProblem,
          tip: "Seats come from the village's org chart. One application for several seats records your terms once.",
        },
      ],
    },
    details: {
      label: "Your season",
      intro: "What you will have done by the end of the season, and why you.",
      fields: [
        {
          key: "deliverables",
          kind: "textarea",
          rows: 6,
          maxLength: 2000,
          label: "Deliverables for the season",
          placeholder: "By the end of the season, the spring runs clear and two people besides me know how to keep it that way.",
          help: "Write what will be TRUE at season's end, so anyone can check it without asking you. Members read this; a vote never shows it.",
          required: true,
          problem: atLeast(40, "Your deliverables"),
        },
        {
          key: "fitStatement",
          kind: "textarea",
          rows: 4,
          maxLength: 1500,
          label: "Why you",
          placeholder: "I have kept the north line running for two seasons and I already know where it silts up.",
          required: true,
          problem: atLeast(30, "Your fit statement"),
        },
      ],
    },
    terms: {
      label: "Your terms",
      intro: "The terms you would hold these seats on. Start from a preset, or from the seat's own terms on offer, and change what does not fit.",
      fields: [
        {
          key: "seatSettings",
          kind: "seatSettings",
          label: "Settings",
          prefillWhole: ROLE_APPLICATION_PREFILL,
          help: "Every member can read these terms. Money in them is recorded here and paid outside the platform.",
          problem: settingsProblem,
        },
        {
          key: "startsNoEarlierThan",
          kind: "date",
          label: "First day",
          help: "Leave it empty to start as soon as the application is adopted. Pick the first day of next season to apply for next season's seats now.",
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
 */
export function roleApplicationStart(search: string): { type: "role_application"; answers: Record<string, unknown> } | null {
  const q = new URLSearchParams(search);
  if (q.get("type") !== "role_application") return null;
  const seat = String(q.get("seat") ?? q.get("renew") ?? "").trim();
  const season = String(q.get("season") ?? "").trim();
  return {
    type: "role_application",
    answers: { ...(seat ? { seatIds: [seat] } : {}), ...(season ? { seasonId: season } : {}) },
  };
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
