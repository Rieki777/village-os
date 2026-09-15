/**
 * SEAT SOMEBODY IN A ROLE, BY THE VILLAGE'S VOTE.
 *
 * `POST /api/governance/role-seats` has opened seat votes since R90, and no
 * screen could reach it. Since 0199 every seat carries a term, and a seat with
 * no date asked ends with the season (Rye, 2026-09-13/14), so the terms step
 * says when the seat would end while the author is still choosing, from the
 * same rule the route freezes onto the ballot.
 *
 * One entry of WIZARD_TYPE_CONFIGS, kept in its own file because wizardConfig.ts
 * sits at the monolith ratchet's threshold. Adding a proposal type is still an
 * entry in the config: this file is that entry, and wizardConfig.ts lists it.
 *
 * The id is the ballot's subject type, so the decision card's noun ("Who sits
 * in a role") is already in SUBJECT_NOUN.
 */
import { UserCheck } from "lucide-react";
import type { WizardTypeConfig } from "./wizardConfig";
import { atLeast, required } from "./wizardValidators";

export const ROLE_SEAT_TYPE: WizardTypeConfig = {
  id: "role_seat",
  group: "People",
  icon: UserCheck,
  title: "Seat someone in a role",
  description: "Ask the village to seat a member in one of its roles, until a date you pick or the end of the season.",
  consequence:
    "Publishing opens the vote to the whole roll. If it carries, the member sits in the role from that day until the end date, holding every power the role carries, and the village can vote the seat back at any time.",
  opensVote: true,
  publish: {
    path: "/api/governance/role-seats",
    body: (a) => ({
      userId: a.userId,
      roleId: a.roleId,
      reason: a.reason,
      // Sent only when picked: the route ends a seat with no date asked with the season.
      ...(String(a.termEndsOn ?? "").trim() ? { termEndsOn: String(a.termEndsOn).trim() } : {}),
    }),
  },
  steps: {
    subject: {
      label: "Member and role",
      intro: "Who would sit, and in which role.",
      fields: [
        { key: "userId", kind: "pick", source: "members", label: "Member", required: true, problem: required("A member") },
        {
          key: "roleId",
          kind: "pick",
          source: "roles",
          label: "Role",
          required: true,
          problem: required("A role"),
          help: "Whoever sits in this role can do everything it carries from the day the vote carries.",
        },
      ],
    },
    details: {
      label: "Why this person",
      intro: "What makes this person the right one for this role.",
      fields: [
        {
          key: "reason",
          kind: "textarea",
          rows: 6,
          maxLength: 2000,
          label: "Why this person",
          placeholder:
            "He has run the tool library's lending desk every Saturday since spring, and the stewards already send him the questions it gets.",
          help: "The whole roll reads this before voting.",
          required: true,
          problem: atLeast(40, "The case for it"),
        },
      ],
    },
    terms: {
      label: "For how long",
      intro: "Every seat has an end. Leave the date empty and the seat ends with the season.",
      fields: [
        {
          key: "termEndsOn",
          kind: "seatTerm",
          roleKey: "roleId",
          label: "End date",
          help: "A steward's seat can end no later than the season's end. Any other seat can run as long as the village wants.",
          tip: "Seats come back to the village. A seat running past four seasons carries a caution on the ballot, and the vote can still carry it.",
        },
      ],
    },
  },
};
