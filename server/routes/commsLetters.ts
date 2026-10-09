/**
 * LETTERS AND OUTCOMES, `/api/admin/comms/letters*` and
 * `/api/admin/comms/outcomes/:journeyKey` (the comms build spec 5.12 and 6).
 * Registered from server/routes/comms.ts. The behaviour is
 * server/lib/comms/letters.ts and server/lib/comms/outcomes.ts.
 *
 *   GET  /api/admin/comms/letters                 every letter with its numbers,
 *                                                 the audiences to choose from,
 *                                                 and today's sending limit
 *   POST /api/admin/comms/letters                 a new draft
 *   PUT  /api/admin/comms/letters/:id             a draft's new words
 *   POST /api/admin/comms/letters/:id/preview     the audience now, the letter as
 *                                                 its first reader sees it, and
 *                                                 the confirmation
 *   POST /api/admin/comms/letters/:id/test        the letter to yourself
 *   POST /api/admin/comms/letters/:id/send        confirm: send now, or schedule
 *   POST /api/admin/comms/letters/:id/cancel      a scheduled letter taken back
 *   POST /api/admin/comms/letters/:id/reschedule  a scheduled letter moved
 *   GET  /api/admin/comms/outcomes/:journeyKey    each step's numbers, for the
 *                                                 Journeys screen
 *
 * ── THE GATES ───────────────────────────────────────────────────────────────
 *
 * Behind `requireModule("comms")`, one route at a time, the way the comms
 * module's registry entry says its automation routes are gated: letters are
 * off while the module is off (5.16), and a village rehearsing in preview
 * writes and sends letters that go to its rehearsal inbox. Then the one
 * capability gate for `comms.manage`: every change and the preview (it writes
 * the snapshot) through `guardCapability`, which carries the break-glass and
 * the public record; a look through `mayStillSee`.
 *
 * ── THE JOB ─────────────────────────────────────────────────────────────────
 *
 * `comms-letters` runs every minute on the scheduler: it picks up any send
 * that stopped part way and sends the scheduled letters whose time came.
 * "Run now" drives it as `{ job: "letters" }` (server/routes/comms.ts).
 */
import type { Express, Request, Response } from "express";
import { DEFAULT_LETTERS_PER_DAY, LETTERS_EVERY_MS, LETTERS_JOB, readLetterDraft } from "../../shared/comms/letters";
import { GAME_CONFIG } from "../../shared/gameConfig";
import type { AppDeps } from "../lib/appDeps";
import { journeyStatus } from "../lib/comms/journeyDefinitions";
import {
  cancelLetter,
  createLetter,
  letterHistory,
  lettersJobLine,
  moveLetter,
  previewLetter,
  runLettersJob,
  saveLetter,
  sendLetter,
  testLetter,
  type LettersDeps,
  type LettersJobSummary,
} from "../lib/comms/letters";
import { journeyOutcomes } from "../lib/comms/outcomes";
import { suppressionsPortFor } from "../lib/comms/permissions";
import { effectiveLifecycle, requireModule } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { numberVar } from "../lib/variables";
import { villageTimezone } from "../lib/villageReaders";
import { gatheringChoices, lettersWindow } from "../repos/commsLetters";

type Deps = Pick<AppDeps, "authedUser" | "guardCapability" | "mayStillSee" | "getPool" | "commsPostOffice" | "members">;

const REFUSAL = { status: 403, body: { error: "Sending the village's letters is an appointment" } };
const ID = /^ltr_[a-f0-9]{24}$/;
const JOURNEY_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;

/** The letters' dependencies on the running server. */
export function lettersDepsOf(deps: Pick<AppDeps, "getPool" | "commsPostOffice" | "members">): LettersDeps {
  const { getPool, commsPostOffice, members } = deps;
  return {
    getPool,
    postOffice: commsPostOffice,
    people: { getPool, members, suppressions: suppressionsPortFor(getPool) },
    lifecycle: () => effectiveLifecycle("comms"),
  };
}

/** "Run now" for the letters job. */
export function runLettersNow(deps: Pick<AppDeps, "getPool" | "commsPostOffice" | "members">): Promise<LettersJobSummary> {
  return runLettersJob(lettersDepsOf(deps));
}

function perDayDial(): number {
  try {
    const v = numberVar("comms.letters_per_day");
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_LETTERS_PER_DAY;
  } catch {
    return DEFAULT_LETTERS_PER_DAY;
  }
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, mayStillSee, getPool } = deps;
  const moduleGate = requireModule("comms");
  const letters = lettersDepsOf(deps);

  registerJob(LETTERS_JOB, LETTERS_EVERY_MS, () => lettersJobLine(letters));

  async function mayLook(req: Request, res: Response): Promise<boolean> {
    if (!(await authedUser(req))) {
      res.status(401).json({ error: "Sign in to see the village's letters" });
      return false;
    }
    if (!(await mayStillSee(req, "comms.manage"))) {
      res.status(REFUSAL.status).json(REFUSAL.body);
      return false;
    }
    return true;
  }

  /** The letter id from the path, refused with a 404 when it is not one. */
  function idFrom(req: Request, res: Response): string | null {
    const id = String(req.params.id ?? "");
    if (!ID.test(id)) {
      res.status(404).json({ error: "There is no such letter." });
      return null;
    }
    return id;
  }

  app.get("/api/admin/comms/letters", moduleGate, async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const pool = getPool();
    const [history, gatherings, window] = await Promise.all([letterHistory(letters), gatheringChoices(pool), lettersWindow(pool)]);
    res.json({
      letters: history,
      choices: {
        paths: GAME_CONFIG.paths.map((p) => ({ id: p.id, label: p.label })),
        gatherings,
      },
      limit: { perDay: perDayDial(), today: window.today, minutesSinceLast: window.minutesSinceLast },
      ready: deps.commsPostOffice.hasApiKey() && deps.commsPostOffice.sender() !== "",
    });
  });

  app.post("/api/admin/comms/letters", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const read = readLetterDraft(req.body);
    if ("problems" in read) return res.status(400).json({ error: read.problems[0], problems: read.problems });
    const user = await authedUser(req);
    const letter = await createLetter(letters, read.draft, String(user?.id ?? "admin"));
    res.json({ letter: { id: letter.id, state: letter.state } });
  });

  app.put("/api/admin/comms/letters/:id", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const id = idFrom(req, res);
    if (!id) return;
    const read = readLetterDraft(req.body);
    if ("problems" in read) return res.status(400).json({ error: read.problems[0], problems: read.problems });
    const saved = await saveLetter(letters, id, read.draft);
    if (!saved.ok) return res.status(saved.status).json({ error: saved.error });
    res.json({ letter: { id: saved.letter.id, state: saved.letter.state } });
  });

  app.post("/api/admin/comms/letters/:id/preview", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const id = idFrom(req, res);
    if (!id) return;
    const user = await authedUser(req);
    const answer = await previewLetter(letters, id, { name: user?.name ?? null });
    if (!answer.ok) return res.status(answer.status).json({ error: answer.error });
    res.json(answer);
  });

  app.post("/api/admin/comms/letters/:id/test", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const id = idFrom(req, res);
    if (!id) return;
    const user = await authedUser(req);
    const answer = await testLetter(letters, id, { email: String(user?.email ?? ""), name: user?.name ?? null, userId: user?.id ?? null });
    if (!answer.ok) return res.status(answer.status).json({ error: answer.error });
    res.json({ status: answer.result.status, reason: answer.result.reason ?? null, messageId: answer.result.messageId, sentTo: answer.sentTo });
  });

  app.post("/api/admin/comms/letters/:id/send", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const id = idFrom(req, res);
    if (!id) return;
    const b = req.body ?? {};
    const answer = await sendLetter(letters, id, { confirmToken: b.confirmToken, sendKey: b.idempotencyKey, scheduledFor: b.scheduledFor });
    if (!answer.ok) return res.status(answer.status).json({ error: answer.error });
    res.json({
      state: answer.state,
      duplicate: answer.duplicate,
      counts: answer.counts,
      scheduledFor: answer.scheduledFor == null ? null : new Date(answer.scheduledFor * 1000).toISOString(),
    });
  });

  app.post("/api/admin/comms/letters/:id/cancel", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const id = idFrom(req, res);
    if (!id) return;
    const answer = await cancelLetter(letters, id);
    if (!answer.ok) return res.status(answer.status).json({ error: answer.error });
    res.json({ state: "cancelled" });
  });

  app.post("/api/admin/comms/letters/:id/reschedule", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const id = idFrom(req, res);
    if (!id) return;
    const answer = await moveLetter(letters, id, req.body?.scheduledFor);
    if (!answer.ok) return res.status(answer.status).json({ error: answer.error });
    res.json({ state: "scheduled", scheduledFor: new Date(answer.scheduledFor * 1000).toISOString() });
  });

  app.get("/api/admin/comms/outcomes/:journeyKey", moduleGate, async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const key = String(req.params.journeyKey ?? "");
    const status = JOURNEY_KEY.test(key) ? await journeyStatus({ getPool }, key) : null;
    if (!status) return res.status(404).json({ error: `There is no journey called "${key.slice(0, 100)}".` });
    res.json(await journeyOutcomes({ getPool, villageZone: () => villageTimezone() }, status.definition));
  });
}
