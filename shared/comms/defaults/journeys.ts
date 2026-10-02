/**
 * EVERY DEFAULT JOURNEY, step by step (docs/comms/BUILD_SPEC.md 5.6 and 5.11).
 *
 * THESE NUMBERS ARE THE BEHAVIOUR. The journey engine (lane C1) plans from
 * nothing else: when each email is due, whether it waits for daytime, what a
 * late enrollment does with steps already past, and what ends a journey for
 * good. So every field is written out here, and each choice that is not read
 * straight off the spec says why beside it.
 *
 * A village's own edits live in `comms_journeys.definition`, which is NULL
 * while these apply. Every journey ships OFF: a village turns each one on.
 *
 * Times are minutes. Event steps are anchored to the gathering's own clock
 * and use `window: "any"`, because a reminder belongs to the hour of the
 * gathering and not to the reader's working day. Path, member and joining
 * steps use `window: "daytime"`, which holds a step inside the quiet hours
 * dials in the reader's own zone.
 */
import type { ConditionKey, JourneyDefinition, JourneyStep, StopKey } from "../contracts";
import { DEFAULT_PATH_IDS, pathTemplateKey } from "./templates";

const DAY = 24 * 60;

/**
 * How late a daytime step may run and still go. Longer than the widest night
 * the quiet hours can hold (twelve hours at the default 8 to 20), so a step
 * deferred to the morning is never mistaken for a late one, and short enough
 * that an email written for day two does not land on day five.
 */
const DAYTIME_LATENESS = 2 * DAY;

/** Every journey ends for anybody who said no to its kind or whose address stopped working. */
const ALWAYS_STOPS: StopKey[] = ["unsubscribed", "suppressed"];

/**
 * Somebody said yes to a gathering.
 *
 * The confirmation goes inside the request that took the answer. The two
 * reminders sit on the gathering's start, a day before and two hours before,
 * matching the default of the `comms.event_reminder_minutes` dial ("1440,120").
 *
 * EVERY STEP WAITS WHILE THE TIME IS STILL BEING VOTED: a confirmation that
 * names a time the village is still choosing is a promise the vote can break.
 * The steps go once the poll locks, or for a weekly series once the
 * occurrence is inside the freeze window and can no longer move.
 *
 * CATCH-UP IS `skip` FOR THE REMINDERS. Somebody who says yes an hour before
 * has just read the confirmation; a "starting soon" one second later is noise.
 */
const GATHERING_GOING: JourneyDefinition = {
  key: "gathering.going",
  kind: "event",
  trigger: "rsvp_going",
  // A guest confirming by email starts the same journey. The confirmation
  // also passes through `rsvp()`, so `comms_enrollments_once` keeps the two
  // doors to one enrollment however both fire.
  alsoOn: ["guest_confirmed"],
  emailKind: "events",
  version: 1,
  steps: [
    {
      key: "confirm",
      anchor: "enrolled",
      offsetMinutes: 0,
      window: "any",
      audience: "all",
      templateKey: "gathering.confirm",
      skipIf: ["time_still_being_voted"],
      catchUp: "latest",
      // A confirmation that could not go at once (the time was being voted)
      // still goes when it can, as long as that is within a day.
      maxLateMinutes: DAY,
      urgent: true,
    },
    {
      key: "day",
      anchor: "event_start",
      offsetMinutes: -DAY,
      window: "any",
      audience: "all",
      templateKey: "gathering.reminder_day",
      skipIf: ["time_still_being_voted", "signed_up_within_36_hours"],
      catchUp: "skip",
      // Up to six hours late is still the evening before.
      maxLateMinutes: 6 * 60,
    },
    {
      key: "soon",
      anchor: "event_start",
      offsetMinutes: -120,
      window: "any",
      audience: "all",
      templateKey: "gathering.reminder_soon",
      skipIf: ["time_still_being_voted"],
      catchUp: "skip",
      // Past an hour late it would arrive with the gathering already begun.
      maxLateMinutes: 60,
    },
  ],
  stops: ["withdrew", "gathering_cancelled", "gathering_removed", ...ALWAYS_STOPS],
};

/**
 * The host is asked for a recap after the gathering ends. The offset is the
 * default of the `comms.host_nudge_minutes` dial. Nothing is sent when there
 * is nothing to write about: a recap already sent, or nobody who said yes.
 */
const GATHERING_HOST: JourneyDefinition = {
  key: "gathering.host",
  kind: "event",
  trigger: "gathering_published",
  emailKind: "events",
  version: 1,
  steps: [
    {
      key: "nudge",
      anchor: "event_end",
      offsetMinutes: 60,
      window: "any",
      audience: "all",
      templateKey: "gathering.host_nudge",
      skipIf: ["recap_already_sent", "nobody_answered"],
      catchUp: "skip",
      // Inside the recap window (`comms.recap_window_days`, three days by
      // default), a day late is still worth a nudge.
      maxLateMinutes: DAY,
    },
  ],
  stops: ["gathering_cancelled", "gathering_removed", ...ALWAYS_STOPS],
};

/** A daytime step on the enrolled clock, which is what every non-event journey is made of. */
function daytime(key: string, day: number, templateKey: string, skipIf: ConditionKey[] = []): JourneyStep {
  return {
    key,
    anchor: "enrolled",
    offsetMinutes: day * DAY,
    window: "daytime",
    audience: "all",
    templateKey,
    skipIf,
    // Several overdue steps send only the most recent one, so a village
    // switching a journey on after a week does not post a backlog.
    catchUp: "latest",
    maxLateMinutes: DAYTIME_LATENESS,
  };
}

/**
 * A new member, day 0, 3, 7 and 14. The journey's goal is the member taking
 * part (a quest consented, or a gathering they came to), which ends it.
 *
 * `paths` is the email kind on purpose: this is a series that walks somebody
 * in, the same question of permission as a path, and it counts against the
 * daily cap the way paths do.
 */
const MEMBER_WELCOME: JourneyDefinition = {
  key: "member.welcome",
  kind: "member",
  trigger: "member_joined",
  emailKind: "paths",
  version: 1,
  steps: [
    daytime("day0", 0, "member.welcome.day0"),
    daytime("first_quest", 3, "member.welcome.first_quest", ["member_first_step_done"]),
    daytime("meet_us", 7, "member.welcome.meet_us", ["going_to_next_gathering"]),
    daytime("check_in", 14, "member.welcome.check_in"),
  ],
  stops: ["member_took_part", ...ALWAYS_STOPS],
};

/**
 * Somebody asked to join a village that admits by invitation, day 0, 5 and
 * 14. It ends the moment the request is answered, either way.
 */
const JOINING_REQUEST: JourneyDefinition = {
  key: "joining.request",
  kind: "joining",
  trigger: "membership_requested",
  emailKind: "paths",
  version: 1,
  steps: [
    daytime("received", 0, "joining.received"),
    daytime("meet_us", 5, "joining.meet_us", ["going_to_next_gathering"]),
    daytime("check_in", 14, "joining.check_in"),
  ],
  stops: ["joining_admitted", "joining_declined", ...ALWAYS_STOPS],
};

/**
 * What each default path's first step is, and what its goal is (5.11). A path
 * a fork adds of its own gets the same five emails with no first-step skip
 * and no goal, until somebody writes those two queries for it.
 */
const PATH_RULES: Record<string, { firstStepDone: ConditionKey; goal: StopKey }> = {
  resident: { firstStepDone: "resident_first_step_done", goal: "resident_reserved" },
  investor: { firstStepDone: "investor_first_step_done", goal: "investor_committed" },
  steward: { firstStepDone: "steward_first_step_done", goal: "steward_seated" },
  "prosperity-creator": { firstStepDone: "prosperity_first_step_done", goal: "prosperity_venture_listed" },
};

/** The journey key for one path. */
export function pathJourneyKey(pathId: string): string {
  return `path.${pathId}`;
}

/**
 * One path's journey, day 0, 2, 5, 10 and 21.
 *
 * THE INVESTOR PATH IS HELD (Rye, 2026-10-02: its words need his eyes or
 * counsel's). Until `comms-settings.investorWordsReviewed` is set it sends the
 * welcome and the day 21 hand-off and nothing between them, which is what the
 * `investor_words_unreviewed` skip on the middle three steps does.
 *
 * Day 21 is a person writing, never a machine: the check-in email goes, and
 * the path's contact person is asked to write (the `comms_path_handoff`
 * notification).
 */
export function pathJourney(pathId: string): JourneyDefinition {
  const rules = PATH_RULES[pathId];
  const held: ConditionKey[] = pathId === "investor" ? ["investor_words_unreviewed"] : [];
  return {
    key: pathJourneyKey(pathId),
    kind: "path",
    trigger: "path_joined",
    emailKind: "paths",
    version: 1,
    steps: [
      daytime("welcome", 0, pathTemplateKey(pathId, "welcome")),
      daytime("first_step", 2, pathTemplateKey(pathId, "first_step"), [
        ...(rules ? [rules.firstStepDone] : []),
        ...held,
      ]),
      daytime("meet_us", 5, pathTemplateKey(pathId, "meet_us"), ["going_to_next_gathering", ...held]),
      daytime("stories", 10, pathTemplateKey(pathId, "stories"), held),
      daytime("check_in", 21, pathTemplateKey(pathId, "check_in")),
    ],
    stops: ["left_path", ...(rules ? [rules.goal] : []), ...ALWAYS_STOPS],
  };
}

export const DEFAULT_JOURNEYS: readonly JourneyDefinition[] = [
  GATHERING_GOING,
  GATHERING_HOST,
  MEMBER_WELCOME,
  JOINING_REQUEST,
  ...DEFAULT_PATH_IDS.map((id) => pathJourney(id)),
];

export const DEFAULT_JOURNEYS_BY_KEY: Readonly<Record<string, JourneyDefinition>> = Object.fromEntries(
  DEFAULT_JOURNEYS.map((j) => [j.key, j]),
);

/** The platform default for a journey key, or null when the platform has none. */
export function defaultJourney(key: string): JourneyDefinition | null {
  return DEFAULT_JOURNEYS_BY_KEY[key] ?? null;
}
