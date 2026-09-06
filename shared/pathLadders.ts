/**
 * THE FOUR LADDERS, one per path, and no two of them the same shape.
 *
 * An investor's steps and a resident's steps are different acts with different
 * counts, so one shared ladder would have to invent the rungs the shorter path
 * does not have. Each path therefore gets its own list here: three rungs for a
 * steward, three for a resident, four for an investor, two for a prosperity
 * creator. Two is the honest length of the last one, because `member_ventures`
 * holds exactly two dated acts a member can be at.
 *
 * ── NOTHING IN HERE IS A POSITION ───────────────────────────────────────────
 *
 * This file names the rungs and says what each one MEANS. Where a member
 * stands on them is decided in `server/lib/pathLadders.ts`, from the live rows,
 * at the moment somebody looks. There is no rung column in this repository and
 * this file must never grow one: a stored position outlives the fact that
 * justified it, and a stale one reads exactly like a true one.
 *
 * That is also what makes a rung DROP with no update path anywhere. End a fact,
 * withdraw a reservation, close a venture, let a season turn, and the next read
 * finds one fewer live row and answers lower. Nothing is written to say so and
 * nothing can be forgotten.
 *
 * ── EVERY RUNG NAMES A COLUMN ───────────────────────────────────────────────
 *
 * Each rung below carries, in `column`, the exact thing it reads. That field is
 * not decoration: a rung nobody can trace to a column is a rung that cannot
 * light up, and this profile has already deleted nine fabricated tiles and a
 * set of invented progress bars. If a rung is ever added here with no column
 * behind it, the derivation has nothing to answer with and the rung sits dark
 * forever while looking exactly like a rung somebody could climb.
 *
 * ── NO NUMBERS, ANYWHERE ────────────────────────────────────────────────────
 *
 * No amounts, no percentages, no fractions, no counts. `investor_path_facts`
 * has no numeric column by design and a test holds that against
 * `information_schema`; the ledger answers how much and this plane answers what
 * happened and when. A capital figure on a rung would be a second source of
 * truth for the cap table, which is the one thing that whole table exists to
 * refuse.
 */
import type { VillageMoon } from "./villageMoon";

/** One rung, as it is defined. The state comes later and comes from rows. */
export interface RungDef {
  id: string;
  name: string;
  /** What has to be true for this rung, in words a member reads. */
  meaning: string;
  /**
   * The exact column this rung is derived from. Carried so the claim is
   * checkable by reading, and so a rung with nothing behind it is obvious.
   */
  column: string;
}

/**
 * What an empty ladder says: the mechanic, then one door.
 *
 * The same shape the Contributions card uses, and for the same reason. A card
 * that can only say "nothing yet" is worse than no card; a card that says what
 * MAKES something appear is worth the space.
 *
 * `doorHref` is allowed to be blank, and two of the four leave it blank on
 * purpose. Every tile in the Paths panel already carries the path's own door
 * ("What this path asks"), so a second link to the same place two lines below
 * it is noise. A door is named here only when it is a MORE SPECIFIC one than
 * the tile already holds: the seats page for a steward, the home request form
 * for a resident.
 */
export interface LadderEmpty {
  mechanic: string;
  /** Blank means the tile's own door is the door. */
  doorHref: string;
  doorLabel: string;
}

export interface LadderDef {
  rungs: RungDef[];
  empty: LadderEmpty;
}

/** One rung as it is SERVED: the definition, plus what the rows say today. */
export interface LadderRung extends RungDef {
  /** The fact behind this rung holds right now. */
  lit: boolean;
  /**
   * A column still PROVES this rung was reached and the fact has since ended.
   * Position falls; history does not. Set only where an interval column or a
   * surviving row actually says so, and left false everywhere the record
   * cannot tell us.
   */
  fell: boolean;
  /** What the record says about a dark rung, when a column carries a reason. */
  note: string | null;
  /**
   * The village moon the evidence is dated to, or null when no column dates
   * it. Null is common and is never filled in with a nearby date.
   */
  moon: VillageMoon | null;
}

export interface PathLadder {
  pathId: string;
  rungs: LadderRung[];
  /**
   * The highest LIT rung, 1-based. Zero means none of them is lit, which is a
   * real answer and not a missing one.
   *
   * Highest lit, never "how many are lit". Three of the four ladders are
   * nested, so the two readings agree there. The investor ladder is four
   * independent facts and a gap in the middle is a thing that genuinely
   * happens: a packet released and later withdrawn under a signed agreement
   * leaves rung 2 dark under a lit rung 4. Counting would report that member
   * as further back than they are.
   */
  position: number;
  /** Present only while the ladder has nothing at all on it. */
  empty: LadderEmpty | null;
}

/**
 * THE LADDERS.
 *
 * Keyed by the path id in `GAME_CONFIG.paths`. A fork that renames a path or
 * adds a fifth one gets no ladder for it, which is correct: a ladder needs
 * columns behind it, and this platform only has columns for these four.
 * `server/lib/pathLadders.test.ts` holds every key here against the offered
 * paths, so a typo is a failing test instead of a panel that shows nothing.
 */
export const PATH_LADDERS = {
  /**
   * STEWARD, from `org_role_assignments` joined to the seat it is against.
   *
   * The middle rung can go dark UNDER a lit top rung, and that is deliberate
   * rather than a modelling slip. `isLapsed` in server/lib/orgChart.ts revokes
   * nothing at a season turn: a lapsed holder is still the seated delegate and
   * `mayDeclare` says so in as many words, so a seat that carries its circle's
   * pen keeps carrying it while its mandate waits to be re-chosen. A ladder
   * that dimmed the top rung with the middle one would be claiming a power had
   * been taken away when the code says it has not.
   */
  steward: {
    rungs: [
      {
        id: "seated",
        name: "Seated",
        meaning: "You hold a seat in this village's chart of who does what.",
        column: "org_role_assignments.ended_at IS NULL",
      },
      {
        id: "mandate",
        name: "Mandate current",
        meaning: "The season you were seated in is still running, and your term has not run out.",
        column: "org_role_assignments.season_id and term_ends_at, against org_roles.expires_each_season",
      },
      {
        id: "speaks",
        name: "Speaks for its circle",
        meaning: "One of your seats carries its circle's pen, so you may say how that circle decides.",
        column: "org_roles.represents_circle",
      },
    ],
    empty: {
      mechanic:
        "No seat yet. A rung lights here when the village seats you on one of the seats it has named.",
      doorHref: "/roles",
      doorLabel: "The seats this village names",
    },
  },

  /**
   * RESIDENT, from `housing_reservations.status`, which already runs
   * new, contacted, reserved, withdrawn. Three of those four are rungs and the
   * fourth is the fall, so the ladder was mostly written before this file was.
   *
   * A member may hold several requests. The ladder takes the furthest one,
   * because the question is where the member stands on the path and a second
   * request left at "new" does not undo a home held under the first.
   */
  resident: {
    rungs: [
      {
        id: "enquired",
        name: "Asked about a home",
        meaning: "You have a home request on file, and it is open.",
        column: "housing_reservations.status in new, contacted, reserved",
      },
      {
        id: "contacted",
        name: "Contacted",
        meaning: "Someone from the village has been in touch about it.",
        column: "housing_reservations.status in contacted, reserved",
      },
      {
        id: "held",
        name: "A home is held",
        meaning: "A home is set aside against your name.",
        column: "housing_reservations.status is reserved",
      },
    ],
    empty: {
      mechanic:
        "No home request yet. A rung lights here when you ask for a home, and the ones above it as the village moves your request along.",
      doorHref: "/reserve",
      doorLabel: "Ask for a home",
    },
  },

  /**
   * INVESTOR, one rung per fact in `investor_path_facts`, in the order they are
   * meant to happen. The four ids match `INVESTOR_FACTS` exactly and
   * `server/lib/pathLadders.test.ts` holds them to it, so a village adding a
   * fifth fact gets a visible place to add its rung and never a fact that
   * quietly counts for nothing.
   *
   * There is no money on this ladder and there is no column that could put it
   * there. A holdings figure, if one is ever wanted, is read from the hypha
   * mirror at the moment somebody looks.
   */
  investor: {
    rungs: [
      {
        id: "interest_registered",
        name: "Interest registered",
        meaning: "You told the village you want to hear more.",
        column: "investor_path_facts.fact = interest_registered, ended_at IS NULL",
      },
      {
        id: "packet_released",
        name: "Packet released",
        meaning: "The investor packet was released to you.",
        column: "investor_path_facts.fact = packet_released, ended_at IS NULL",
      },
      {
        id: "accreditation_declared",
        name: "Accreditation declared",
        meaning: "You stated that you qualify. The village records the statement and verifies nothing.",
        column: "investor_path_facts.fact = accreditation_declared, ended_at IS NULL",
      },
      {
        id: "agreement_signed",
        name: "Agreement signed",
        meaning: "A signed agreement exists on your file.",
        column: "investor_path_facts.fact = agreement_signed, ended_at IS NULL",
      },
    ],
    empty: {
      mechanic:
        "Nothing recorded yet. The village records each step against your name as it happens: your interest, the packet, your own declaration, the signed agreement.",
      doorHref: "",
      doorLabel: "",
    },
  },

  /**
   * PROSPERITY CREATOR, from the three dates on `member_ventures`. Two of them
   * are rungs and the third is the fall.
   *
   * TWO RUNGS IS THE HONEST LENGTH. Opening a venture and publishing it to the
   * village are separate acts and carry separate dates, so there are two things
   * a member can be at. A third rung would have to read a column that is not
   * there, and inventing one is what this profile spent a day deleting.
   */
  "prosperity-creator": {
    rungs: [
      {
        id: "opened",
        name: "Opened",
        meaning: "You are running a venture.",
        column: "member_ventures.opened_at, closed_at IS NULL",
      },
      {
        id: "listed",
        name: "Listed to the village",
        meaning: "The village can see it, so members can find what you make.",
        column: "member_ventures.listed_at, closed_at IS NULL",
      },
    ],
    empty: {
      mechanic:
        "No venture on file yet. A venture is recorded when you open one, and the rung above it lights when it is published to the village.",
      doorHref: "",
      doorLabel: "",
    },
  },
} satisfies Record<string, LadderDef>;

export type LadderPathId = keyof typeof PATH_LADDERS;

export const LADDER_PATH_IDS = Object.keys(PATH_LADDERS) as LadderPathId[];

export const hasLadder = (pathId: string): pathId is LadderPathId =>
  Object.prototype.hasOwnProperty.call(PATH_LADDERS, pathId);
