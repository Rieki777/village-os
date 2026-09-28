/**
 * THE CANVAS'S KEY MOMENTS AND ITS MOON, WIRED (plan 4.2 and 4.4; Wave 4).
 *
 *   GET  /api/canvas/moon            members: the next canvas moon, the blocks
 *                                    its question names, and whether a
 *                                    gathering for it has been offered
 *   POST /api/canvas/moon/gathering  `event.manage`: offer the canvas moon as a
 *                                    recurring new-moon gathering, as a DRAFT
 *
 * And, once at boot, three hand-overs that need no route:
 *
 *   - the delivery behind `raiseCanvasRevisit` (server/lib/canvasRevisit.ts),
 *     built from the host's own readers, so every call site in the build
 *     reaches the same people by the same rule;
 *   - the event observer (`observeKeyMoments`), so the four acts in
 *     `server/index.ts` that already record an audit event raise their moment
 *     without that file gaining a line;
 *   - the canvas moon reader behind the weekly brief's seam
 *     (`setCanvasMoonProvider`, server/lib/calendarBrief.ts), which the moon
 *     digest reads too.
 *
 * ── OFFERED, NEVER SEEDED ──────────────────────────────────────────────────
 *
 * Nothing here runs at boot that creates a gathering. The canvas moon reaches
 * the calendar only when somebody who may manage events presses the offer,
 * and even then as a DRAFT, the calendar's own default for anything new
 * (`createGathering`, server/lib/gatherings.ts): publishing it is a second,
 * deliberate act in the calendar's admin list, where its time and place can be
 * set first. The never-build list's "no seeded aspirational structure"
 * (docs/COORDINATION_SUBSTRATE.md) is the reason for both halves.
 *
 * ── WHO MAY READ ───────────────────────────────────────────────────────────
 *
 * The canvas's own rule, `mayReadCanvas`: a member the village has admitted,
 * or an admin. The moon names block titles only, and never whether any
 * particular moment fired: `source.flagged` never carries a conflict block
 * (server/lib/canvasMoon.ts), and nothing here says who heard what.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import type { NotifyInput, NotifyResult } from "../lib/notify";
import { capabilityDecision } from "../../shared/capabilities";
import { CANVAS_MOON_DESCRIPTION, CANVAS_MOON_TITLE } from "../../shared/canvasRevisit";
import { civilParts, zonedTimeToUtc } from "../../shared/lunar";
import { canonicalTimeZone } from "../../shared/canvasSeason";
import { villageHeldCapabilities } from "../lib/capabilityHolding";
import { deliverCanvasRevisit, observeKeyMoments, setCanvasRevisitDelivery, type CanvasRevisitDeps } from "../lib/canvasRevisit";
import { canvasMoonQuestion, nextNewMoonAfter } from "../lib/canvasMoon";
import { setCanvasMoonProvider } from "../lib/calendarBrief";
import { liveIntakeRecipients, type IntakeHolding } from "../lib/restorativeIntake";
import { isAdmitted } from "../lib/admission";
import { effectiveLifecycle } from "../lib/modules";
import { createGathering, getGathering } from "../lib/gatherings";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { readCanvasSeason } from "../repos/canvasSeason";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { CANVAS_MEMBERS_ONLY, mayReadCanvas } from "./canvas";

/** The `app_config` key that remembers which gathering was offered, so the offer is made once. */
export const CANVAS_MOON_KEY = "canvas-moon";

/** What a person who may not manage events is told. */
export const MOON_OFFER_REFUSAL = "Offering a gathering is for whoever manages the village's calendar.";

/** What anybody is told while the calendar is off. */
export const MOON_CALENDAR_OFF = "The calendar is switched off in this village, so there is nowhere to offer the gathering yet.";

/** The hour a canvas moon starts when no season file names a session time. */
const DEFAULT_HOUR = 18;

export type CanvasRevisitRouteDeps = Pick<
  AppDeps,
  "authedUser" | "isAdmin" | "hasMembership" | "getPool" | "guardCapability" | "capabilityCtx" | "members" | "isPresent"
> & {
  notify(input: NotifyInput): Promise<NotifyResult>;
  /** Who holds a power today, counted the way the gate counts (`liveHoldersOf` in server/index.ts). */
  liveHoldersOf(capability: string): Promise<string[]>;
  /** The exit policy as readers are served it, for the care role. */
  readExitPolicy(): any;
  /** Who sits where, live. */
  roleHolders(): ReadonlyArray<IntakeHolding>;
  /** The village's own timezone. */
  villageTimezone(): string;
};

let stopObserving: (() => void) | null = null;

/** The readers a delivery needs, from the host's. Exported so a test builds them the same way. */
export function revisitDepsFrom(deps: CanvasRevisitRouteDeps): CanvasRevisitDeps {
  const admitted = (u: any): boolean =>
    deps.hasMembership(u) || isAdmitted({ membershipGranted: u?.membershipGranted, stageGranted: u?.stageGranted }, GAME_CONFIG.stages);
  return {
    notify: (input) => deps.notify(input),
    villageHeld: () => villageHeldCapabilities(deps.getPool()),
    liveHoldersOf: (capability) => deps.liveHoldersOf(capability),
    everyMember: async () => (await deps.members.all()).filter((u: any) => deps.isPresent(u) && admitted(u)).map((u: any) => String(u.id)),
    // As `notifyAdmins` reaches them: every admin and founder account. No
    // presence filter, because a fresh instance's founder has not claimed the
    // account yet at the very moment the instance is claimed, and the row
    // waits in their bell for the first sign-in.
    admins: async () => (await deps.members.all()).filter((u: any) => u.role === "admin" || u.role === "founder").map((u: any) => String(u.id)),
    careHolders: async () => {
      const roleId = String(deps.readExitPolicy()?.restorative?.intakeContactRole ?? "");
      return roleId ? liveIntakeRecipients(deps.roleHolders(), roleId) : [];
    },
  };
}

/** The instant the canvas moon's gathering starts: the new moon's village date, at the session time. */
async function startOf(deps: CanvasRevisitRouteDeps, newMoon: Date): Promise<{ startsAt: Date; timeZone: string }> {
  const read = await readCanvasSeason(deps.getPool()).catch(() => null);
  const season = read && read.state === "stored" ? read.season : null;
  const timeZone = canonicalTimeZone(season?.timezone) ?? canonicalTimeZone(deps.villageTimezone()) ?? "UTC";
  const [hour, minute] = /^\d{2}:\d{2}$/.test(season?.sessionTime ?? "")
    ? String(season!.sessionTime).split(":").map(Number)
    : [DEFAULT_HOUR, 0];
  const day = civilParts(newMoon, timeZone);
  return { startsAt: zonedTimeToUtc(day.year, day.month, day.day, hour, minute, timeZone), timeZone };
}

/** The offered gathering, if one was offered and is still on the calendar. */
async function offered(deps: CanvasRevisitRouteDeps): Promise<{ id: string; status: string } | null> {
  const doc = await readConfigDocument<{ eventId?: unknown }>(deps.getPool(), CANVAS_MOON_KEY);
  const id = typeof doc?.eventId === "string" ? doc.eventId : "";
  if (!id) return null;
  const g = await getGathering(deps.getPool(), id);
  return g ? { id: g.id, status: String(g.status) } : null;
}

export function register(app: Express, deps: CanvasRevisitRouteDeps): void {
  const revisitDeps = revisitDepsFrom(deps);
  setCanvasRevisitDelivery((req) => deliverCanvasRevisit(revisitDeps, req));
  stopObserving?.();
  stopObserving = observeKeyMoments();
  setCanvasMoonProvider(async (pool, newMoonAt) => (await canvasMoonQuestion(pool, newMoonAt)).blocks.map((b) => b.name));

  app.get("/api/canvas/moon", async (req, res) => {
    const user = await deps.authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await mayReadCanvas(deps, req, user))) return res.status(403).json({ error: CANVAS_MEMBERS_ONLY });
    const next = nextNewMoonAfter(new Date());
    if (!next) return res.json({ next: null, gathering: null, mayOffer: false, calendarOn: false });
    const [question, gathering, ctx] = await Promise.all([
      canvasMoonQuestion(deps.getPool(), next),
      offered(deps),
      deps.capabilityCtx(user),
    ]);
    const calendarOn = effectiveLifecycle("events") !== "off";
    const { startsAt } = await startOf(deps, next);
    res.json({
      next: { ...question, startsAt: startsAt.toISOString() },
      gathering,
      calendarOn,
      mayOffer: calendarOn && !gathering && capabilityDecision("event.manage", ctx).allowed,
    });
  });

  app.post("/api/canvas/moon/gathering", async (req, res) => {
    const user = await deps.authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await deps.guardCapability(req, res, "event.manage", { status: 403, body: { error: MOON_OFFER_REFUSAL } }))) return;
    if (effectiveLifecycle("events") === "off") return res.status(409).json({ error: MOON_CALENDAR_OFF });
    const already = await offered(deps);
    if (already) {
      return res.status(409).json({ error: "The canvas moon is already on the calendar's list.", gathering: already });
    }
    const next = nextNewMoonAfter(new Date());
    if (!next) return res.status(409).json({ error: "The next new moon could not be worked out, so nothing was offered." });
    const { startsAt } = await startOf(deps, next);
    const created = await createGathering(
      deps.getPool(),
      {
        title: CANVAS_MOON_TITLE,
        description: CANVAS_MOON_DESCRIPTION,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 90 * 60_000).toISOString(),
        kind: "gathering",
        layer: "village",
        status: "draft",
        recurrence: { freq: "lunar", on: "new_moon" },
      },
      String(user.id),
    );
    await writeConfigDocument(deps.getPool(), CANVAS_MOON_KEY, {
      eventId: created.id,
      offeredBy: String(user.id),
      offeredAt: new Date().toISOString(),
    });
    res.status(201).json({
      gathering: { id: created.id, status: String(created.status) },
      message: "The canvas moon is on the calendar's list as a draft. Set its place and publish it there when it suits the village.",
      publishAt: "/admin?tab=events-admin",
    });
  });
}
