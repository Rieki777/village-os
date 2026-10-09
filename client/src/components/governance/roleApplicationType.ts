/**
 * APPLY FOR A SEAT, ON TERMS.
 *
 * One entry of WIZARD_TYPE_CONFIGS, kept in its own file because wizardConfig.ts
 * sits at the monolith ratchet's threshold (the same reason roleSeatType.ts
 * lives apart). wizardConfig.ts lists it first, where it always stood.
 *
 * WHAT CHANGED WHEN IT MOVED. Its terms step used to ask a commitment
 * percentage, a deferred percentage, a token and an amount per cycle, under
 * two tips that were never true: that commitment scaled a seat's voice, and
 * that deferring never cost a say. No route ever read those fields, and no
 * rule in the platform ties voice to a seat's terms. They are gone. The terms
 * step is now one `seatSettings` field, the same object the Settings drawer
 * reads and `parseSeatSettings` judges (shared/seatSettings.ts). The old cash
 * field's sentence lives on as the pay group's help in the editor.
 *
 * DRAFTS KEEP LOADING. The id stays `role_application`, so a draft saved
 * under the old fields opens here; the publish body below reads only the
 * fields that still exist, and the old keys ride along in the stored payload
 * unread.
 *
 * PUBLISHING IS STILL A PRACTICE VOTE. `role_application` stays out of the
 * server's CONDUCTABLE_TYPES until its route lands (PR4), so the type step
 * offers it only as a practice vote, and `roleApplicationType.test.tsx`
 * holds that lock. The publish target below is the route PR4 mounts.
 */
import { UserPlus } from "lucide-react";
import { parseSeatSettings } from "@shared/seatSettings";
import type { WizardTypeConfig } from "./wizardConfig";
import { atLeast, required } from "./wizardValidators";

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

export const ROLE_APPLICATION_TYPE: WizardTypeConfig = {
  id: "role_application",
  group: "Recurring",
  icon: UserPlus,
  title: "Apply for a seat",
  description: "Raise your hand for a seat, with what you will have done by the end of the season and the terms you hold it on.",
  consequence:
    "Publishing puts your application and its terms in front of whoever adopts seats: a live holder of that power, or the whole village by vote. Every member can read the terms.",
  publish: {
    path: "/api/governance/role-applications",
    body: (a) => ({
      orgRoleId: a.seatId,
      deliverables: a.deliverables,
      fitStatement: a.fitStatement,
      seatSettings: a.seatSettings ?? null,
    }),
  },
  steps: {
    subject: {
      label: "The seat",
      intro: "Which seat you are raising your hand for.",
      fields: [
        {
          key: "seatId",
          kind: "pick",
          source: "seats",
          label: "Seat",
          required: true,
          problem: required("A seat"),
          tip: "Seats come from the village's org chart. A seat that is recruiting shows first.",
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
          help: "Write what will be TRUE at season's end, so anyone can check it without asking you.",
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
      intro: "The terms you would hold this seat on. Start from a preset and change what does not fit.",
      fields: [
        {
          key: "seatSettings",
          kind: "seatSettings",
          label: "Settings",
          prefillWhole: ROLE_APPLICATION_PREFILL,
          help: "Every member can read these terms. Money in them is recorded here and paid outside the platform.",
          problem: settingsProblem,
        },
      ],
    },
  },
};
