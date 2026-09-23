/**
 * CHANGE WHAT THIS VILLAGE IS FOR, BY THE VILLAGE'S VOTE (0217).
 *
 * `POST /api/governance/purpose-changes` opens the vote that moves the
 * governing purpose statement. Rye, 2026-09-23: "all upgrades going forward
 * will be judged against it."
 *
 * One entry of WIZARD_TYPE_CONFIGS, kept in its own file for the reason
 * `roleSeatType.ts` gives: wizardConfig.ts sits at the monolith ratchet's
 * threshold, and adding this type inline took it over 1000 lines. Adding a
 * proposal type is still an entry in the config; this file is that entry, and
 * wizardConfig.ts lists it.
 *
 * The id is the ballot's subject type, so the decision card's noun ("Change of
 * purpose") is already in SUBJECT_NOUN.
 */
import { Compass } from "lucide-react";
import type { WizardTypeConfig } from "./wizardConfig";
// The two validators the server runs, so the wizard refuses what the route
// would refuse and says the same sentence while saying it earlier.
import { purposeAlignmentProblem, purposeStatementProblem } from "@shared/governingPurpose";
/*
 * ── CHANGING WHAT THE VILLAGE IS FOR (0217) ──────────────────────────────
 *
 * Rye, 2026-09-23: "all upgrades going forward will be judged against it."
 * This card is how a village that has finished its handover moves the
 * sentence everything else answers to.
 *
 * IT IS DORMANT TODAY AND THE CARD STILL SHOWS. The route refuses while the
 * founder holds the pen and says how many powers are still on the admin
 * panel, which is a door that names its own condition. A card that appeared
 * out of nowhere on the day a handover completed would be a feature nobody
 * had ever seen arriving at the least convenient moment.
 *
 * THE WHOLE STATEMENT IS RETYPED, never edited in place. A wizard field
 * pre-filled with the standing sentence would produce diffs nobody wrote
 * and a village voting on a paragraph it had not read. The document the
 * roll reads carries both, one under the other.
 */
export const GPS_CHANGE_TYPE: WizardTypeConfig = {
  id: "gps_change",
  group: "Rules",
  icon: Compass,
  title: "Change what this village is for",
  description: "Ask the village to change the governing purpose statement every later change is judged against.",
  consequence:
    "Publishing opens the vote to the whole roll. If it carries, the statement reads the new way from that day and every proposal opened afterwards answers to it. Nothing already decided is reopened.",
  opensVote: true,
  publish: {
    path: "/api/governance/purpose-changes",
    body: (a) => ({
      statement: a.statement,
      purposeAlignment: a.purposeAlignment,
    }),
  },
  steps: {
    subject: { skip: true },
    details: {
      label: "The statement",
      intro: "The whole sentence, as the village would read it afterwards.",
      fields: [
        {
          key: "statement",
          kind: "textarea",
          rows: 10,
          maxLength: 20000,
          label: "The governing purpose statement",
          required: true,
          problem: (v) => purposeStatementProblem(v),
          help: "Who this village serves, what they are up against, the move it is making, by what means, and what becomes true if it works.",
          tip: "The village reads this beside the sentence that stands today, so write the whole thing and not the part you are changing.",
        },
        {
          key: "purposeAlignment",
          kind: "textarea",
          rows: 3,
          maxLength: 2000,
          label: "How this serves the purpose",
          required: true,
          problem: (v) => purposeAlignmentProblem("gps_change", v),
          help: "The whole roll reads this beside your proposal before voting, and it stays on the record.",
          tip: "Moving the yardstick is measured against the yardstick that stands today.",
        },
      ],
    },
    terms: { skip: true },
  },
};
