/**
 * THE FOUR KEY MOMENTS, AS DATA (plan section 4.2; Wave 4, 2026-09-28).
 *
 * The Governance Canvas names four moments when a group should look at its
 * canvas again: starting a collaboration, onboarding new partners, navigating
 * conflict, and funding or formalisation. This file says which events in a
 * village count as each moment, which blocks each one asks about, and every
 * word the notice carries. The server half (server/lib/canvasRevisit.ts)
 * decides who hears it and writes the rows.
 *
 * ── WHAT A NOTICE MAY CARRY ────────────────────────────────────────────────
 *
 * Block names, a fixed question, and a link to the block. Nothing else, and
 * that is enforced by construction: `revisitTitle` and `revisitBody` below
 * take a moment, a block and who is hearing it, and the one builder of a row
 * (`canvasRevisitNotice`, server/lib/canvasRevisit.ts) takes nothing more, so
 * there is no parameter through which a person's words, a name, a count or a
 * date could arrive. The event that fired it (a peer's name, the circle's
 * name, who opened an exit) never reaches this file at all.
 *
 * ── ONE NOTICE PER BLOCK, AND WHY ──────────────────────────────────────────
 *
 * The dedupe is per (moment, block, moon), so each block is its own row: a
 * second trigger of the same moment in the same moon adds nothing, and a
 * block flagged by two different moments is asked twice, once in each
 * moment's words. The bell folds a burst of one kind into one line
 * (`many` in shared/notificationKinds.ts), and the daily digest folds every
 * row of this kind into that same line (`digestLines`, server/lib/notify.ts),
 * so twelve rows read as one in both places.
 *
 * ── NEVER A PUSH, NEVER AN IMMEDIATE EMAIL ─────────────────────────────────
 *
 * `emailCadenceFor("canvas_revisit")` answers "daily" (server/lib/notify.ts),
 * so the notice waits for the digest, which lists titles only. There is no
 * push channel in this build; if one arrives, this kind is not on it.
 */
import { CANVAS_BLOCK_IDS, CANVAS_BLOCKS, type CanvasBlockId } from "./governanceCanvas";

/** The notification type every notice from this file carries. */
export const CANVAS_REVISIT = "canvas_revisit";

export const KEY_MOMENTS = ["collaboration", "partners", "conflict", "funding"] as const;
export type KeyMoment = (typeof KEY_MOMENTS)[number];

/**
 * The events that count as each moment. The keys are the ones a call site
 * names; a trigger belongs to exactly one moment.
 *
 * `tension-opened` has no call site in this build, because tensions do not
 * exist yet (plan Wave 5). It is named here so the lane that builds them
 * raises it with one line and no new vocabulary.
 *
 * `crowdpool-on` is the village-side act nearest to "a crowdpool drafted":
 * the campaign itself is drafted on the crowdpool hub, outside this instance,
 * and what a village does here is switch its crowdpool module on.
 */
export const MOMENT_TRIGGERS = {
  collaboration: ["instance-claimed", "circle-declared", "peer-added"],
  partners: ["love-letter-admitted", "partner-accepted"],
  conflict: ["tension-opened", "objection-ruled", "exit-opened"],
  funding: ["crowdpool-on", "governance-on", "birthing-opened"],
} as const satisfies Record<KeyMoment, readonly string[]>;

export type MomentTrigger<M extends KeyMoment = KeyMoment> = (typeof MOMENT_TRIGGERS)[M][number];

/** The moment a trigger belongs to, or null for a key this file does not know. */
export function momentOfTrigger(trigger: string): KeyMoment | null {
  for (const moment of KEY_MOMENTS) {
    if ((MOMENT_TRIGGERS[moment] as readonly string[]).includes(trigger)) return moment;
  }
  return null;
}

/**
 * The blocks each moment asks about, in canvas order.
 *
 * Starting a collaboration asks about all twelve. Onboarding a partner asks
 * about Stakeholders. Conflict asks about Conflict. Funding asks about the
 * four the plan names: Power, Resourcing, Legal and Impact.
 */
export const MOMENT_BLOCKS: Record<KeyMoment, readonly CanvasBlockId[]> = {
  collaboration: CANVAS_BLOCK_IDS,
  partners: ["stakeholders"],
  conflict: ["conflict"],
  funding: ["power", "resourcing", "legal", "impact"],
};

/**
 * The blocks one raise asks about: the moment's own, or a narrower set a call
 * site names (plan 4.2: "All 12, or the scoped blocks"). A scope can only
 * narrow the moment's list, never add to it, and an empty or unknown scope
 * falls back to the moment's own list. Always in canvas order.
 */
export function blocksForRaise(moment: KeyMoment, scope?: readonly string[] | null): CanvasBlockId[] {
  const own = MOMENT_BLOCKS[moment];
  if (!scope || scope.length === 0) return CANVAS_BLOCK_IDS.filter((b) => own.includes(b));
  const wanted = new Set(scope);
  const narrowed = CANVAS_BLOCK_IDS.filter((b) => own.includes(b) && wanted.has(b));
  return narrowed.length ? narrowed : CANVAS_BLOCK_IDS.filter((b) => own.includes(b));
}

/**
 * THE POWER A MOMENT'S NOTICE FOLLOWS.
 *
 * The notice asks the village to look at a canvas block again, and changing a
 * canvas answer's words is the prose pen, `story.tell` (plan 2.3; `server/routes/
 * canvas.ts` records readings through the same key). So three moments follow
 * that power: its live holder hears it, every member hears it once the
 * village holds it, and the admins hear it before the handover.
 *
 * Conflict follows a ROLE instead: the care holder the exit policy names
 * (`restorative.intakeContactRole`), and only them. See
 * `server/lib/canvasRevisit.ts` for what happens when nobody holds it.
 */
export const MOMENT_POWER: Record<KeyMoment, "story.tell" | "care"> = {
  collaboration: "story.tell",
  partners: "story.tell",
  conflict: "care",
  funding: "story.tell",
};

/** Who a notice reached, in the vocabulary of the rule that chose them. */
export type RevisitAudience = "live-holders" | "every-member" | "admins" | "care-holders";

/** Where a notice opens: the block's card on the Canvas view. */
export function revisitLink(block: CanvasBlockId): string {
  return `/journey-to-launch?view=canvas#canvas-block-${block}`;
}

/** The page a partner can be sent, if the holder chooses to. Never sent by the platform. */
export const PUBLIC_CANVAS_PATH = "/governance";

/** What every member who hears a village-held notice is told, beside the question. */
export const ANYONE_MAY_RAISE = "The village holds this power, so anyone may raise this.";

/**
 * The title, per moment. It is also the whole of what the digest email
 * shows, so it names the block and asks the moment's question, and nothing
 * else.
 *
 * Every title but the partners line reads true of a BLANK block (audit of
 * Wave 4, 2026-10-01). The claim moment fires on a brand-new instance, whose
 * canvas is empty by construction, and asked the founder twelve times whether
 * "our Purpose answer" still held; a circle or a peer does the same for any
 * block nobody has answered, and the conflict line named an agreement that
 * may not exist. The partners line keeps the plan's own words (plan 4.2).
 */
export function revisitTitle(moment: KeyMoment, block: CanvasBlockId): string {
  const name = CANVAS_BLOCKS[block].name;
  switch (moment) {
    case "collaboration":
      return `Something new is starting. Look at ${name} again.`;
    case "partners":
      return `A new partner arrived. Does our ${name} answer still hold?`;
    case "conflict":
      return `Is the pathway holding? Look at ${name} again.`;
    case "funding":
      return `Before you raise: look at ${name} again.`;
  }
}

/** The line under the title, per moment. Fixed words; the second sentence depends only on the audience. */
export function revisitBody(moment: KeyMoment, audience: RevisitAudience): string {
  const lines: string[] = [];
  switch (moment) {
    case "collaboration":
      lines.push("When a village starts something new, the canvas asks it to look at its blocks again, answered or not.");
      break;
    case "partners":
      lines.push(
        `Nothing was sent to them. If you want them to see how the village works, you can send them the public canvas at ${PUBLIC_CANVAS_PATH}.`,
      );
      break;
    case "conflict":
      lines.push("This notice says nothing about who or what, on purpose. The pathway is the village's own, and you hold its care.");
      break;
    case "funding":
      lines.push("Before a village raises money or takes a legal shape, the canvas asks about Power, Resourcing, Legal and Impact.");
      break;
  }
  if (audience === "every-member") lines.push(ANYONE_MAY_RAISE);
  return lines.join(" ");
}

/**
 * The dedupe key: one row per moment, block, moon and person, forever. A
 * second trigger of the same moment in the same moon inserts nothing (the
 * spine's unique index decides, server/lib/notify.ts).
 *
 * `moon` is the absolute lunation number (`cycleBoundsFor(at).cycleNumber`,
 * shared/lunar.ts), the one storage key a lunation has; a village's own
 * ordinal is presentation and never goes into a key (shared/villageMoon.ts).
 */
export function revisitDedupeKey(moment: KeyMoment, block: CanvasBlockId, moon: number, userId: string): string {
  return `${CANVAS_REVISIT}:${moment}:${block}:${moon}:${userId}`;
}

/* ── The canvas moon (plan 4.4) ─────────────────────────────────────────── */

/** What `GET /api/canvas/moon` answers a member (server/routes/canvasRevisit.ts). */
export interface CanvasMoonPayload {
  /** The next new moon's question, or null when the sky table has no next new moon. */
  next: {
    newMoonAt: string;
    /** When the offered gathering would start: the new moon's date at the session time. */
    startsAt: string;
    moon: number;
    blocks: Array<{ id: CanvasBlockId; name: string }>;
    source: { chosen: CanvasBlockId[]; flagged: CanvasBlockId[]; rotated: CanvasBlockId | null };
  } | null;
  /** The gathering offered for it, while it is still on the calendar. */
  gathering: { id: string; status: string } | null;
  /** The calendar module is on, so there is somewhere to offer a gathering. */
  calendarOn: boolean;
  /** This member may offer it now: they manage events, the calendar is on, and none is offered yet. */
  mayOffer: boolean;
}

/** The title a gathering offered for the canvas moon carries. */
export const CANVAS_MOON_TITLE = "Canvas moon";

/** Its description. Fixed words; the blocks are read fresh each moon and never stored in it. */
export const CANVAS_MOON_DESCRIPTION =
  "Once a moon the village looks at its canvas again: the block it chose to grow, and any block a key moment flagged since the last one.";

/**
 * THE MOON'S ONE LINE, block titles and nothing else. The weekly brief and the
 * moon digest both print this, so the two can never word the same moon two
 * ways. Null when there is nothing to name.
 */
export function canvasMoonLine(titles: readonly string[]): string | null {
  const names = titles.map((t) => String(t).trim()).filter((t) => t.length > 0);
  if (!names.length) return null;
  if (names.length >= CANVAS_BLOCK_IDS.length) return "The canvas moon looks at all twelve blocks together.";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `The canvas moon looks at ${list}.`;
}
