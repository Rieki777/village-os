/**
 * THE DIALS THAT STEER HOW PROPOSALS ARE MADE (change requests, spec C17 and
 * R20). Rye, 2026-11-06, relayed by the master coordinator: "great go with
 * all suggestions". So the four dials that decide when and how often a
 * proposal may reach the vote are priced as structural changes and are meta
 * settings: a routine vote cannot set the review to nothing just before a big
 * change, and no trial can lift them for a moon at a lower bar.
 */
import { describe, expect, it } from "vitest";
import { VARIABLES_BY_KEY } from "./gameVariables";
import { isMetaSetting, metaSettingTrialRefusal } from "./ballotSubjects";

const PROCESS_DIALS = [
  "governance.proposal_support_threshold",
  "governance.proposals_per_member_per_cycle",
  "governance.change_cooldown_days",
  "governance.vote_days",
] as const;

describe("the process dials (C17)", () => {
  it.each(PROCESS_DIALS)("%s is priced as a structural change", (key) => {
    expect(VARIABLES_BY_KEY[key]?.criticality).toBe("structural");
  });

  it.each(PROCESS_DIALS)("%s is a meta setting, so it is never tried for a moon", (key) => {
    expect(isMetaSetting(key)).toBe(true);
    expect(metaSettingTrialRefusal(key)).toContain(key);
  });
});
