/**
 * THE JOURNEYS ROUTES, `/api/admin/comms/journeys/*`: every journey with its
 * state and how many people are on it, one journey's timeline, Turn on and
 * Turn off, editing a step, stopping one person's journey, a test of a step
 * sent to yourself, and "Walk someone through it" (the comms build spec 5.6
 * and 6). Registered by one line in server/routes/comms.ts, which also runs
 * the tick from its "run now" button through `journeysTickDeps`.
 *
 * ── THE GATES ───────────────────────────────────────────────────────────────
 *
 * Behind `requireModule("comms")`, one route at a time, like the Words routes:
 * the Journeys tab follows the comms module (client/src/lib/adminNav.ts), so
 * its routes answer the module's 404 while it is off. Then the one capability
 * gate for `comms.manage`: a change through `guardCapability`, a look through
 * `mayStillSee`. The walk-through is a POST because it carries a made-up
 * person, and it is a LOOK: it plans and renders, and sends nothing.
 *
 * ── THE JOB ─────────────────────────────────────────────────────────────────
 *
 * `comms-journeys` runs the tick every five minutes and returns at once while
 * the module is off (server/lib/comms/journeys.ts).
 *
 * The village's zone comes from `villageTimezone()`, which the server wires at
 * boot to the season settings, so this module needs nothing more from
 * server/index.ts.
 */
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { emailKeyOf } from "../../shared/comms/address";
import type { JourneyDefinition } from "../../shared/comms/contracts";
import { templateGroups, templateLabel } from "../../shared/comms/defaults/templates";
import { CONDITIONS_FOR_KIND, CONDITION_LABELS, STOP_LABELS, timingLabel, type StepPatch } from "../../shared/comms/journeySteps";
import { kindForTemplate, sampleValues } from "../../shared/comms/mergeFields";
import { GAME_CONFIG } from "../../shared/gameConfig";
import type { AppDeps } from "../lib/appDeps";
import { listCalendarItems } from "../lib/calendar";
import {
  allJourneyStatuses,
  journeyStatus,
  saveJourneyStep,
  setJourneyState,
  villagePathIds,
  type JourneyStatus,
} from "../lib/comms/journeyDefinitions";
import { JOURNEYS_EVERY_MS, JOURNEYS_JOB, runJourneysJob, walkThrough, type TickDeps, type WalkInput } from "../lib/comms/journeys";
import { answerFor, suppressionsPortFor } from "../lib/comms/permissions";
import { post } from "../lib/comms/postOffice";
import { derivedValues, loadEmailVillage, renderTemplate } from "../lib/comms/render";
import { readLiveWords } from "../lib/comms/templates";
import { effectiveLifecycle, requireModule } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { villageTimezone } from "../lib/villageReaders";
import { contactByEmailKey, contactById } from "../repos/commsContacts";
import { activeCountsByJourney, activeEnrollmentsOf, journeyVersionList, stopEnrollmentById } from "../repos/commsJourneys";
import { liveTemplateRows } from "../repos/commsTemplates";

type Deps = Pick<AppDeps, "authedUser" | "guardCapability" | "mayStillSee" | "getPool" | "commsPostOffice" | "members">;

const REFUSAL = { status: 403, body: { error: "Running the village's email is an appointment" } };
const KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
const STEP = /^[a-z][a-z0-9_]{0,63}$/;
const ENROLLMENTS_SHOWN = 100;
/** How far ahead "Walk someone through it" offers gatherings to pick from. */
const SUBJECT_DAYS = 60;

/** The tick's dependencies on the running server: the module's lifecycle, the village's zone, people's answers. */
export function journeysTickDeps(deps: Pick<AppDeps, "getPool" | "commsPostOffice" | "members">): TickDeps {
  const { getPool, commsPostOffice, members } = deps;
  const people = { getPool, members, suppressions: suppressionsPortFor(getPool) };
  return {
    getPool,
    postOffice: commsPostOffice,
    lifecycle: () => effectiveLifecycle("comms"),
    villageZone: () => villageTimezone(),
    permission: async (contactId, kind) => {
      const contact = await contactById(getPool(), contactId);
      if (!contact) return null;
      const a = await answerFor(people, contact, kind);
      return { state: a.state, derived: a.derived, pausedUntil: a.pausedUntil };
    },
  };
}

/** What the screen calls a journey: its Words group's title, a path by its own name. */
function titleOf(key: string): string {
  const pathId = key.match(/^path\.([a-z0-9-]+)$/)?.[1];
  const path = pathId ? GAME_CONFIG.paths.find((p) => p.id === pathId) : undefined;
  if (path) return `${path.label} path`;
  return templateGroups(villagePathIds()).find((g) => g.journeyKey === key)?.title ?? key;
}

/** True for a gathering journey whose reminders still follow the village's dials. */
const followsDials = (s: JourneyStatus) => !s.own && (s.key === "gathering.going" || s.key === "gathering.host");

function stepsOf(def: JourneyDefinition) {
  return def.steps.map((s) => ({
    key: s.key,
    label: templateLabel(s.templateKey),
    templateKey: s.templateKey,
    timing: timingLabel(def.kind, s),
    anchor: s.anchor,
    offsetMinutes: s.offsetMinutes,
    window: s.window,
    audience: s.audience,
    skipIf: s.skipIf,
    catchUp: s.catchUp,
    maxLateMinutes: s.maxLateMinutes,
    urgent: s.urgent === true,
  }));
}

/** A date from a request, or null. */
function dateOf(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Only the fields an edit may carry, typed as they arrived; the shared check decides. */
function patchOf(body: unknown): StepPatch {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const patch: StepPatch = {};
  if (b.offsetMinutes !== undefined) patch.offsetMinutes = Number(b.offsetMinutes);
  if (b.window !== undefined) patch.window = b.window as StepPatch["window"];
  if (b.audience !== undefined) patch.audience = b.audience as StepPatch["audience"];
  if (b.templateKey !== undefined) patch.templateKey = String(b.templateKey);
  if (b.skipIf !== undefined) patch.skipIf = (Array.isArray(b.skipIf) ? b.skipIf.map(String) : b.skipIf) as StepPatch["skipIf"];
  return patch;
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, mayStillSee, getPool, commsPostOffice } = deps;
  const moduleGate = requireModule("comms");
  const tickDeps = journeysTickDeps(deps);

  registerJob(JOURNEYS_JOB, JOURNEYS_EVERY_MS, () => runJourneysJob(tickDeps));

  async function mayLook(req: Request, res: Response): Promise<boolean> {
    if (!(await authedUser(req))) {
      res.status(401).json({ error: "Sign in to see the village's email" });
      return false;
    }
    if (!(await mayStillSee(req, "comms.manage"))) {
      res.status(REFUSAL.status).json(REFUSAL.body);
      return false;
    }
    return true;
  }

  /** The journey a path names, or a 404 that says so. */
  async function statusFrom(req: Request, res: Response): Promise<JourneyStatus | null> {
    const key = String(req.params.key ?? "");
    const status = KEY.test(key) ? await journeyStatus(tickDeps, key) : null;
    if (!status) {
      res.status(404).json({ error: `There is no journey called "${key.slice(0, 100)}".` });
      return null;
    }
    return status;
  }

  /** Every journey with its state and how many people are on it. */
  app.get("/api/admin/comms/journeys", moduleGate, async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const pool = getPool();
    const [statuses, counts] = await Promise.all([allJourneyStatuses(tickDeps), activeCountsByJourney(pool)]);
    res.json({
      journeys: statuses.map((s) => ({
        key: s.key,
        title: titleOf(s.key),
        kind: s.definition.kind,
        emailKind: s.definition.emailKind,
        state: s.state,
        version: s.version,
        own: s.own,
        active: counts.get(s.key) ?? 0,
        steps: s.definition.steps.map((step) => ({ key: step.key, label: templateLabel(step.templateKey), timing: timingLabel(s.definition.kind, step) })),
      })),
    });
  });

  /** One journey: its timeline, its versions, the people on it, and what its steps may be changed to. */
  app.get("/api/admin/comms/journeys/:key", moduleGate, async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const status = await statusFrom(req, res);
    if (!status) return;
    const pool = getPool();
    const def = status.definition;
    const [versions, enrollments, live, counts] = await Promise.all([
      journeyVersionList(pool, status.key),
      activeEnrollmentsOf(pool, status.key, ENROLLMENTS_SHOWN),
      liveTemplateRows(pool),
      activeCountsByJourney(pool),
    ]);
    const liveKeys = new Set(live.map((r) => r.templateKey));
    const choices = new Set<string>([...templateGroups(villagePathIds()).flatMap((g) => g.keys), ...Array.from(liveKeys)]);
    const steps = await Promise.all(
      stepsOf(def).map(async (s) => {
        const words = await readLiveWords(pool, s.templateKey);
        return { ...s, subject: words?.subject ?? null, words: liveKeys.has(s.templateKey) ? "village" : words ? "platform" : "missing" };
      }),
    );
    res.json({
      key: status.key,
      title: titleOf(status.key),
      kind: def.kind,
      emailKind: def.emailKind,
      trigger: def.trigger,
      state: status.state,
      version: status.version,
      own: status.own,
      followsDials: followsDials(status),
      active: counts.get(status.key) ?? 0,
      steps,
      stops: def.stops.map((k) => ({ key: k, label: STOP_LABELS[k] ?? k })),
      conditions: CONDITIONS_FOR_KIND[def.kind].map((k) => ({ key: k, label: CONDITION_LABELS[k] })),
      templates: Array.from(choices)
        .filter((k) => kindForTemplate(k) === def.emailKind)
        .map((k) => ({ key: k, label: templateLabel(k) })),
      versions,
      enrollments: enrollments.map((e) => ({
        id: e.id,
        name: e.name,
        email: e.email,
        subjectRef: e.subjectRef,
        version: e.journeyVersion,
        enrolledAt: e.enrolledAt,
        nextCheckAt: e.nextCheckAt,
      })),
    });
  });

  /** Turn a journey on or off. */
  app.post("/api/admin/comms/journeys/:key/state", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const status = await statusFrom(req, res);
    if (!status) return;
    const state = req.body?.state;
    if (state !== "on" && state !== "off") return res.status(400).json({ error: "Choose on or off." });
    const user = await authedUser(req);
    const done = await setJourneyState(tickDeps, status.key, state, user?.id ?? null);
    if (!done) return res.status(404).json({ error: "This journey could not be found." });
    res.json({ key: status.key, state: done.status.state, version: done.status.version, adopted: done.adopted, touched: done.touched });
  });

  /** Change one step. The journey moves to its next version; people already on it keep theirs. */
  app.put("/api/admin/comms/journeys/:key/steps/:step", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const status = await statusFrom(req, res);
    if (!status) return;
    const stepKey = String(req.params.step ?? "");
    if (!STEP.test(stepKey)) return res.status(404).json({ error: "This journey has no such step." });
    const user = await authedUser(req);
    const saved = await saveJourneyStep(tickDeps, status.key, stepKey, patchOf(req.body), user?.id ?? null);
    if (!saved) return res.status(404).json({ error: "This journey could not be found." });
    if ("problems" in saved) return res.status(400).json({ error: saved.problems[0], problems: saved.problems });
    res.json({ key: status.key, version: saved.version, steps: stepsOf(saved.status.definition) });
  });

  /** One step's email, with sample values, sent to the signed-in admin's own address. */
  app.post("/api/admin/comms/journeys/:key/steps/:step/test", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const status = await statusFrom(req, res);
    if (!status) return;
    const step = status.definition.steps.find((s) => s.key === String(req.params.step ?? ""));
    if (!step) return res.status(404).json({ error: "This journey has no such step." });
    const user = await authedUser(req);
    const to = String(user?.email ?? "").trim();
    if (!to) return res.status(400).json({ error: "Your account has no email address to send a test to." });
    const village = await loadEmailVillage(getPool(), commsPostOffice.origin());
    const derived = derivedValues(step.templateKey, village.url);
    const name = String(user?.name ?? "").trim();
    const vars = sampleValues({
      villageUrl: village.url,
      firstName: name.split(/\s+/)[0] ?? "",
      fullName: name,
      pathUrl: typeof derived["path.pageUrl"] === "string" ? derived["path.pageUrl"] : null,
    });
    const email = await renderTemplate(step.templateKey, vars, { getPool, village });
    const result = await post(commsPostOffice, {
      idempotencyKey: `comms.test:${randomUUID()}`,
      kind: "essential",
      origin: "comms.test",
      to: { email: to, name: user?.name ?? null, userId: user?.id ?? null },
      subject: email.subject,
      html: email.html,
      text: email.text,
      preheader: email.preheader,
      source: { templateKey: step.templateKey, journeyKey: status.key, stepKey: step.key, ...(email.version !== null ? { templateVersion: email.version } : {}) },
      urgent: true,
    });
    res.json({ status: result.status, reason: result.reason ?? null, messageId: result.messageId, sentTo: to });
  });

  /** What one person would get from this journey, step by step. Sends nothing. */
  app.post("/api/admin/comms/journeys/:key/walk", moduleGate, async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const status = await statusFrom(req, res);
    if (!status) return;
    const b = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    let input: WalkInput;
    if (typeof b.enrollmentId === "string" && b.enrollmentId) {
      input = { enrollmentId: b.enrollmentId };
    } else if (typeof b.email === "string" && b.email.trim()) {
      const contact = await contactByEmailKey(getPool(), emailKeyOf(b.email));
      if (!contact) return res.status(404).json({ error: "Nobody with that address is in the address book yet." });
      const subjectRef = typeof b.subjectRef === "string" && b.subjectRef.trim() ? b.subjectRef.trim().slice(0, 191) : null;
      if (!subjectRef) return res.status(400).json({ error: "Choose what the journey is about for them." });
      input = { contactId: contact.id, subjectRef };
    } else if (b.madeUp && typeof b.madeUp === "object") {
      const m = b.madeUp as Record<string, unknown>;
      const attendance = m.attendance === "came" || m.attendance === "missed" ? m.attendance : null;
      input = {
        madeUp: {
          name: typeof m.name === "string" ? m.name.slice(0, 120) : null,
          timezone: typeof m.timezone === "string" ? m.timezone.slice(0, 64) : null,
          startsAt: dateOf(m.startsAt),
          endsAt: dateOf(m.endsAt),
          attendance,
          enrolledAt: dateOf(m.enrolledAt),
        },
      };
    } else {
      return res.status(400).json({ error: "Choose somebody to walk through it." });
    }
    const walk = await walkThrough(tickDeps, status.key, input);
    if ("missing" in walk) {
      const what = { journey: "This journey could not be found.", enrollment: "That person is not on this journey.", contact: "That person is no longer in the address book." };
      return res.status(404).json({ error: what[walk.missing] });
    }
    res.json(walk);
  });

  /** What a real person can be walked through: upcoming gatherings for a gathering journey, the path for a path. */
  app.get("/api/admin/comms/journeys/:key/subjects", moduleGate, async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const status = await statusFrom(req, res);
    if (!status) return;
    const kind = status.definition.kind;
    if (kind === "event") {
      const now = new Date();
      const items = await listCalendarItems(getPool(), {
        from: now,
        to: new Date(now.getTime() + SUBJECT_DAYS * 86_400_000),
        viewer: { userId: null, isAdmin: true },
        timezone: villageTimezone(),
        kinds: ["gathering"],
        limit: 60,
      });
      return res.json({
        subjects: items
          .filter((i) => !i.isExample && i.status !== "cancelled")
          .map((i) => ({ subjectRef: `event:${i.id}:${i.occurrenceKey}`, label: i.title, startsAt: i.startsAt })),
      });
    }
    if (kind === "path") return res.json({ subjects: [{ subjectRef: status.key.replace(/^path\./, "path:"), label: titleOf(status.key), startsAt: null }] });
    if (kind === "member") return res.json({ subjects: [{ subjectRef: "account", label: "Their account", startsAt: null }] });
    res.json({ subjects: [] });
  });

  /** Stop one person's journey. Nothing more is sent to them from it. */
  app.post("/api/admin/comms/journeys/enrollments/:id/stop", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const id = String(req.params.id ?? "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !(await stopEnrollmentById(getPool(), id, "stopped_by_admin"))) {
      return res.status(404).json({ error: "That journey is not running for anybody now." });
    }
    res.json({ stopped: id });
  });
}
