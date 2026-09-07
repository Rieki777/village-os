/**
 * WHAT EVERY KIND OF NOTICE IS ABOUT, in one place.
 *
 * The notification spine (server/lib/notify.ts) carries a `type` on every row
 * and never says what one means. That was fine while the bell was a flat list
 * of titles; it is not fine once the bell groups, batches and rations
 * celebration, because all three of those are decisions about the KIND and
 * not about the row.
 *
 * So each type declares four things:
 *
 *  - `group`     which part of village life it belongs to, so twenty rows read
 *                as five sections instead of one scroll;
 *  - `blurb`     one line saying why a notice of this kind matters. Shown
 *                under a row that carries no body of its own, which is where
 *                the reader most needs it. NN/g's rule for notification copy
 *                is self-sufficiency: a notice is not about something the
 *                reader just did, so it must carry its own context
 *                (docs/NOTIFICATION_RESEARCH.md, part 1 section 3);
 *  - `many`      the batched line, with `{n}` standing in for the count, so a
 *                burst of the same kind reads as ONE line;
 *  - `celebrate` whether this kind is rare enough to earn a moment. FOUR are.
 *
 * THE CELEBRATION RATION IS THE POINT OF THIS FILE. A stage crossed, a ballot
 * carried, a cycle settled, a quest consented. Everything else gets a quiet
 * line. The natural kit's contract says the same in its own words
 * (docs/modules/natural-interface.md): celebration on every action becomes
 * wallpaper, and then the rare event has nothing left to say with.
 *
 * An unknown type degrades to the village group with a generic line, so a
 * type added by a future module renders correctly before anyone edits this.
 */

export const NOTIFICATION_GROUPS = [
  {
    id: "decisions",
    title: "Decisions",
    blurb: "What the village is deciding, and what it decided.",
  },
  {
    id: "economy",
    title: "Economy",
    blurb: "Value that moved, and value that is owed.",
  },
  {
    id: "work",
    title: "Work",
    blurb: "Quests claimed, finished, and consented.",
  },
  {
    id: "people",
    title: "People",
    blurb: "Somebody reached for you by name.",
  },
  {
    id: "village",
    title: "The village",
    blurb: "Everything the village is keeping for you.",
  },
] as const;

export type NotificationGroupId = (typeof NOTIFICATION_GROUPS)[number]["id"];

export interface NotificationKind {
  group: NotificationGroupId;
  /** Why a notice of this kind matters. One line, the object named. */
  blurb: string;
  /** The batched line. `{n}` is replaced with the count. */
  many: string;
  /** Rare enough to earn a celebration. Four kinds are; the rest are quiet. */
  celebrate: boolean;
}

export const NOTIFICATION_KINDS: Record<string, NotificationKind> = {
  // ── Decisions ─────────────────────────────────────────────────────────────
  ballot_opened: {
    group: "decisions",
    blurb: "The village opened a vote and you are on the roll for it. Your answer counts toward the outcome.",
    many: "{n} votes opened, and you are on the roll for each one.",
    celebrate: false,
  },
  ballot_closing: {
    group: "decisions",
    blurb: "The window is closing and your vote is still owed. Quorum is measured against everyone on the roll.",
    many: "{n} votes close soon and are still waiting on your answer.",
    celebrate: false,
  },
  ballot_carried: {
    group: "decisions",
    blurb: "The village said yes. What was voted on now applies, and the closer wrote down why.",
    many: "{n} votes carried.",
    celebrate: true,
  },
  ballot_failed: {
    group: "decisions",
    blurb: "The village said no. The closer wrote down the reasoning, and it stands on the record.",
    many: "{n} votes closed without passing.",
    celebrate: false,
  },
  // Its own kind, and this is not a nicety. Too few answering is a different
  // fact from the village saying no, and while a missed quorum fired
  // `ballot_failed` the line under it read "The village said no" about a vote
  // that had settled nothing.
  ballot_no_quorum: {
    group: "decisions",
    blurb: "Too few of the roll answered for this to settle anything. The question stands, and it can be asked again.",
    many: "{n} votes closed with too few answering to settle them.",
    celebrate: false,
  },
  ballot_withdrawn: {
    group: "decisions",
    blurb: "A vote you were on the roll for was called off before it closed. Nothing was decided, and the reason is on the record.",
    many: "{n} votes were called off.",
    celebrate: false,
  },
  // An advisory vote reaches a real verdict and executes nothing, so it takes
  // its own kind and stays out of `ballot_carried`, which is one of the four
  // that earn a celebration.
  ballot_advisory_closed: {
    group: "decisions",
    blurb: "An advisory vote closed. It records what the village would decide, and nothing changed on its own.",
    many: "{n} advisory votes closed.",
    celebrate: false,
  },
  // The steward's one act. It does not celebrate: a village that carried
  // something already had its moment, and this is the last word on it rather
  // than a second one. There is no approval kind beside it, because nothing
  // waits for a steward: a carried decision lands on its own, and the seat can
  // only stop it inside the window before it does.
  ballot_vetoed: {
    group: "decisions",
    blurb: "A steward stopped a decision the village carried, inside its window, and said why.",
    many: "{n} decisions were stopped, each with a reason.",
    celebrate: false,
  },
  /*
   * THE THREE WINDOW NOTICES, and they are three types rather than one for a
   * reason that is entirely about the mail.
   *
   * Every governance type resolves to the governance email preference, which
   * defaults to DAILY. A daily digest is right for a ballot opening: its
   * window is measured in days. It is wrong for these: the last one is sent
   * two hours before a change the village carried takes effect, so a digest
   * tomorrow arrives after the door it names has shut. Their own types let
   * `emailCadenceFor` pin all three to "immediate" without making every other
   * governance notice immediate with them.
   *
   * They go to the seated stewards and to nobody else, and none of them
   * celebrates: a countdown is not a moment.
   */
  veto_window_opened: {
    group: "decisions",
    blurb: "The village carried a decision and your window to stop it is open. The page names the instant it lands.",
    many: "{n} carried decisions are inside their window.",
    celebrate: false,
  },
  veto_window_halfway: {
    group: "decisions",
    blurb: "Half of your window to stop a carried decision has gone. It lands at its instant unless somebody stops it.",
    many: "{n} windows are half gone.",
    celebrate: false,
  },
  veto_window_closing: {
    group: "decisions",
    blurb: "Two hours left to stop a carried decision. After that it lands and the door is closed.",
    many: "{n} windows close within two hours.",
    celebrate: false,
  },
  ballot_expired: {
    group: "decisions",
    blurb: "A voting window ran out with nobody closing it. Closing is a human act, so the ballot waits for one.",
    many: "{n} votes are past their window and waiting for someone to close them.",
    celebrate: false,
  },
  governance: {
    group: "decisions",
    blurb: "A proposal you raised, or one the village is carrying, moved a step.",
    many: "{n} proposals moved.",
    celebrate: false,
  },
  // How much your vote weighs is power, and the weight routes moved it for a
  // year while telling the person it belonged to nothing at all. The trail was
  // readable the whole time, which is a different thing from being told: a
  // member has to already suspect something changed before a trail helps them.
  // The reason was required at the point of the change and now reaches the one
  // person it was written for. Quiet, per R52: this is a fact somebody needs,
  // and no part of it is a celebration.
  weight_changed: {
    group: "decisions",
    blurb: "How much your vote weighs was changed, and whoever changed it said why.",
    many: "{n} changes to how much your vote weighs.",
    celebrate: false,
  },
  role_appointed: {
    group: "decisions",
    blurb: "A seat is yours to hold. The role page says what it is accountable for.",
    many: "{n} seats came to you.",
    celebrate: false,
  },
  season: {
    group: "decisions",
    blurb: "No season is running, so the calendar every term is measured against has stopped. Every mandate in the village hangs on it, the steward's seat included, so it says so until somebody starts the next one.",
    many: "The calendar has been stopped for {n} sweeps.",
    celebrate: false,
  },
  term_expiring: {
    group: "decisions",
    blurb: "The agreement to keep holding your seat is running out. On a seat that carries permissions those end with the term (0171), so it is the moment to renew or hand it on.",
    many: "{n} of your terms are running out.",
    celebrate: false,
  },
  submission: {
    group: "decisions",
    blurb: "Somebody raised a hand for a seat, and the village owes them an answer.",
    many: "{n} people raised a hand for a seat.",
    celebrate: false,
  },
  submission_status: {
    group: "decisions",
    blurb: "An answer came back on something you applied for, offered, or raised a hand for.",
    many: "{n} answers came back on things you put forward.",
    celebrate: false,
  },

  // ── Economy ───────────────────────────────────────────────────────────────
  cycle_settled: {
    group: "economy",
    blurb: "A lunation closed, and its pool was split by the recognition people sent you inside it.",
    many: "{n} cycles settled with a share for you.",
    celebrate: true,
  },
  /**
   * 0092: one member sent another member credits. Never celebrated: at a
   * farmers market this is dozens of small notices a week, and celebration
   * that arrives every time is the wallpaper the ration exists to prevent.
   */
  wallet: {
    group: "economy",
    blurb: "Somebody sent you credits, and they are in your balance now.",
    many: "{n} people sent you credits.",
    celebrate: false,
  },
  /**
   * The two ends of a redemption (`server/routes/redemption.ts`). A member
   * asked for tokens to become something off the platform, and a steward has
   * now said whether it happened.
   *
   * NEITHER IS CELEBRATED, and the confirmation least of all. A confirmation
   * is a steward saying the off-platform half took place; the platform is the
   * witness and never the guarantor, and a celebration would read as the
   * platform vouching for a payment it cannot see. The refusal is not
   * celebrated for the obvious reason, and it carries the steward's own note
   * as its body, so the member is told why by the person who decided.
   */
  redemption_confirmed: {
    group: "economy",
    blurb: "A steward confirmed your redemption, and those tokens are gone from your balance.",
    many: "{n} of your redemptions were confirmed.",
    celebrate: false,
  },
  redemption_refused: {
    group: "economy",
    blurb: "A redemption was not confirmed, and the tokens it held are back in your wallet.",
    many: "{n} of your redemptions were not confirmed.",
    celebrate: false,
  },
  exchange: {
    group: "economy",
    blurb: "An exchange order settled, and what you bought is in your wallet.",
    many: "{n} exchange orders settled.",
    celebrate: false,
  },
  payment: {
    group: "economy",
    blurb: "A receipt for something bought, renewed, or reversed.",
    many: "{n} receipts landed.",
    celebrate: false,
  },
  payments_alert: {
    group: "economy",
    blurb: "Something about money needs a person: a hold lifted, a signature refused, a charge disputed.",
    many: "{n} money matters need a look.",
    celebrate: false,
  },
  stays: {
    group: "economy",
    blurb: "Your stay: nights posting, credits arriving, or a balance running low.",
    many: "{n} things moved on your stay.",
    celebrate: false,
  },
  library: {
    group: "economy",
    blurb: "A borrowed thing: due back, settled, or credits released for what you gave.",
    many: "{n} library items moved.",
    celebrate: false,
  },

  // ── Work ──────────────────────────────────────────────────────────────────
  quest_submitted: {
    group: "work",
    blurb: "Somebody finished work and it is waiting to be read. Value moves when a steward says so.",
    many: "{n} pieces of finished work are waiting to be read.",
    celebrate: false,
  },
  quest_consented: {
    group: "work",
    blurb: "A steward read your work and released what it was worth.",
    many: "{n} of your quests were consented.",
    celebrate: true,
  },
  quest_declined: {
    group: "work",
    blurb: "A claim was released, and the quest is open again for whoever wants it next.",
    many: "{n} claims were released.",
    celebrate: false,
  },
  quest_help: {
    group: "work",
    blurb: "Somebody flagged that they are stuck or wobbling on work they took on.",
    many: "{n} people asked for a hand on work they took on.",
    celebrate: false,
  },
  call_task_suggested: {
    group: "work",
    blurb: "A call turned into a suggested task with your name on it. Accept or decline on the thread; nothing happens on its own.",
    many: "{n} tasks were suggested to you from calls.",
    celebrate: false,
  },

  // ── People ────────────────────────────────────────────────────────────────
  gratitude: {
    group: "people",
    blurb: "Somebody said thank you, and put their name to it.",
    many: "{n} people sent you appreciation.",
    celebrate: false,
  },
  message: {
    group: "people",
    blurb: "Somebody wrote to you.",
    many: "{n} conversations have something new in them.",
    celebrate: false,
  },
  mention: {
    group: "people",
    blurb: "Somebody used your name in a thread and meant you to see it.",
    many: "{n} threads name you.",
    celebrate: false,
  },
  forum_reply: {
    group: "people",
    blurb: "Somebody answered you in a thread you are part of.",
    many: "{n} replies landed in threads you are part of.",
    celebrate: false,
  },
  thread_activity: {
    group: "people",
    blurb: "A thread you follow moved. Nothing in it needs you.",
    many: "{n} threads you follow moved.",
    celebrate: false,
  },
  introduction: {
    group: "people",
    blurb: "The village thinks two of you may be worth knowing. Yes or not now, both are whole answers.",
    many: "{n} introductions are waiting on you.",
    celebrate: false,
  },
  contact_request: {
    group: "people",
    blurb: "Somebody wants to reach you about a seat you hold. They see a relay, never your address.",
    many: "{n} people want to reach you.",
    celebrate: false,
  },

  // ── The village ───────────────────────────────────────────────────────────
  stage_advanced: {
    group: "village",
    blurb: "You crossed into a new stage, and what it opens is listed beside it.",
    many: "{n} stages crossed.",
    celebrate: true,
  },
  badge: {
    group: "village",
    blurb: "A mark on your profile, earned or placed, with what it means beside it.",
    many: "{n} marks on your profile changed.",
    celebrate: false,
  },
  // 0098. A badge's DEFINITION changed under the people holding it, so what
  // they can do changed with it. Every award left a trail and the definition
  // the awards answer to did not, which meant somebody gained or lost real
  // access and found out by trying. Not a celebration: an edit to a badge is
  // somebody else's housekeeping, and the holder needs the fact rather than
  // confetti.
  badge_definition_changed: {
    group: "village",
    blurb: "A badge you hold carries something different now, and the line says what changed.",
    many: "{n} badges you hold were changed.",
    celebrate: false,
  },
  // 0098. Somebody with an admin account acted on a power this village has
  // taken on, and you are one of the people holding it. The public record
  // carries the same fact; this is the tap on the shoulder, because a power
  // being reached past without its holder noticing is the failure the
  // witness exists to prevent.
  capability_override: {
    group: "decisions",
    blurb: "An admin acted on a power you hold. It is on the village's own record, with their name on it.",
    many: "{n} powers you hold were acted on from the admin panel.",
    celebrate: false,
  },
  waitlist_promoted: {
    group: "village",
    blurb: "A seat opened at a gathering you queued for, and the line reached you.",
    many: "{n} gatherings found you a seat.",
    celebrate: false,
  },
  weekly_brief: {
    group: "village",
    blurb: "What the week ahead holds, gathered once.",
    many: "{n} weekly briefs are waiting.",
    celebrate: false,
  },
  feedback: {
    group: "village",
    blurb: "A bug or an idea you sent in was triaged, and this is where it landed.",
    many: "{n} things you sent in were triaged.",
    celebrate: false,
  },
  moderation: {
    group: "village",
    blurb: "Something was flagged for a steward to read, or a report you filed was closed.",
    many: "{n} reports moved.",
    celebrate: false,
  },
  restorative_intake: {
    group: "village",
    blurb: "Somebody reached out privately about a rupture. Same day matters for these.",
    many: "{n} private intakes are waiting.",
    celebrate: false,
  },
  exit_opened: {
    group: "village",
    blurb: "A departure process opened. The published exit policy describes every step of it.",
    many: "{n} departure processes opened.",
    celebrate: false,
  },
  health: {
    group: "village",
    blurb: "A number the village watches moved further than the stewards asked to be told about.",
    many: "{n} health readings moved.",
    celebrate: false,
  },
  tools: {
    group: "village",
    blurb: "Links the village depends on stopped answering.",
    many: "{n} link sweeps found something broken.",
    celebrate: false,
  },
  agent_inbox: {
    group: "village",
    blurb: "Your agent inbox stopped answering, so deliveries to it were switched off.",
    many: "{n} notices about your agent inbox.",
    celebrate: false,
  },
};

/** The fallback, so a type this file has never heard of still renders. */
export const UNKNOWN_KIND: NotificationKind = {
  group: "village",
  blurb: "Something the village keeps for you moved.",
  many: "{n} more notices.",
  celebrate: false,
};

export function kindOf(type: string): NotificationKind {
  return NOTIFICATION_KINDS[type] ?? UNKNOWN_KIND;
}

/** The batched line for `n` rows of one kind. `{n}` carries the count. */
export function manyLine(type: string, n: number): string {
  return kindOf(type).many.replace("{n}", String(n));
}

/**
 * Rare enough to earn a moment. Read through `kindOf`, so an unknown type is
 * quiet by default: a new producer has to ASK for a celebration by adding a
 * line here, and adding one is a decision somebody makes on purpose.
 */
export function celebrates(type: string): boolean {
  return kindOf(type).celebrate;
}

/** Which celebration the natural kit draws for a kind. Four kinds, four scenes. */
export function celebrationFor(type: string): "seeds" | "blossom" | "fireflies" | "dawn" | "ripples" {
  switch (type) {
    case "stage_advanced":
      return "dawn";
    case "ballot_carried":
      return "ripples";
    case "cycle_settled":
      return "fireflies";
    default:
      return "blossom";
  }
}
