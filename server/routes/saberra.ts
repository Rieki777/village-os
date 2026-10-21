/**
 * The outside governance service, as four routes and one scheduled job.
 *
 * ── WHY A PULL AND NOT AN INBOX ──────────────────────────────────────────
 *
 * The obvious build is an endpoint the service POSTs into. That is not what
 * this is, and the reason came from the vendor: their connector is PULLED and
 * never pushes, which is also why their listing declares `on-demand` liveness.
 * A push inbox would have meant issuing them an inbound credential and standing
 * up a second authenticated write path into the proposal spine. A
 * steward-triggered pull needs neither.
 *
 * ── THE ADDRESS COMES FROM THE STORE, NEVER FROM THE CALLER ──────────────
 *
 * This route sends the village's SEALED CREDENTIAL to whatever address it is
 * given. An earlier version read that address out of the request body, which
 * meant anybody holding `intake.moderate` could name a host and be sent the
 * key. `intake.moderate` is deliberately not admin, so that was a steward-level
 * path to the village's secret. It is now read from `module_settings` through
 * `moduleConfig`, exactly as every other module reads its own configuration,
 * and checked for an https scheme before a single byte goes out.
 *
 * ── WHAT THE GATE IS AND WHY THIS ONE ────────────────────────────────────
 *
 * `intake.moderate`, the capability that already governs the review queue. A
 * sync produces proposals and nothing else, so the person allowed to cause one
 * is the person who reads them.
 *
 * Reading the vendor's DETAIL is deliberately not gated on that. Rye's reason,
 * 2026-09-24: a member should be able to read what a role actually involves
 * before deciding whether to put their hand up for it. The module's own
 * lifecycle is the gate there, enforced by `requireModule` at the mount.
 *
 * ── A FACT IS ATTACHED TO A SEAT AT SYNC TIME ────────────────────────────
 *
 * The vendor names a seat; this village identifies one by id. Resolving that
 * here, against the live chart, is what makes the member's panel work at all:
 * an earlier version stored every fact with a null `entity_id` while the panel
 * asked by seat id, so it was empty for every seat forever and no test noticed,
 * because each half was correct on its own.
 *
 * ── A SYNC ASKS FOR THE SERVICE'S NAMES, AND ONLY WHAT IT OFFERS ─────────
 *
 * This village's kind ids are its own (`roleAssignment`); the service calls
 * that kind `role_assignment` and does not offer tensions or risks yet. Before
 * the first `list_records` the sync reads the service's `tools/list`, and
 * `saberraKinds.ts` turns that into which kinds to ask for, under which
 * argument. A kind this village holds and the service does not offer is a
 * named line in the answer (`notOffered`), never an absence.
 *
 * ── THE SYNC ITSELF LIVES IN `server/lib/saberraSync.ts` ─────────────────
 *
 * So the schedule beside Sync now runs exactly the code a press runs. This
 * file keeps the gates. Every sync runs under one named lock, a press that
 * finds one running is answered 409, and each run, pressed or scheduled, is
 * written to a log of the last twenty that `GET /api/saberra/runs` answers.
 * The job checks every scheduler tick and calls the service only when the
 * module's `pollSchedule` says it is due; off, the default, never calls it.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { POLL_JOB, pollOnce, syncByHand, syncRunsAnswer } from "../lib/saberraSync";
import { readConnection } from "../lib/saberraConnection";
import { registerJob, TICK_MS } from "../lib/scheduler";
import { secretStatus, villageSecretsConfigured, villageSecretsKeyProblem } from "../lib/secrets";
import { moduleConfig } from "../lib/modules";
import { httpsAddress } from "@shared/modules";
import { factsForEntity, moduleFactCount } from "../repos/moduleFacts";

type Deps = Pick<AppDeps, "guardCapability" | "getPool" | "authedUser">;

const MODULE_ID = "saberra";
const SECRET_KEY = "sera_api_secret";

/** Whether the store holds an https address for the service. The rule is `httpsAddress`, as the sync's. */
function addressSet(): boolean {
  const cfg = (moduleConfig(MODULE_ID) as Record<string, unknown> | null) ?? {};
  return httpsAddress(cfg.apiUrl) !== null;
}

export function register(app: Express, deps: Deps): void {
  const { guardCapability, getPool, authedUser } = deps;

  // The pool is read when the job RUNS, never when it is registered: this runs
  // during boot, before the pool is guaranteed to be the one the village uses.
  // Every tick, so a schedule saved in the panel is honoured within one; the
  // job itself decides whether anything is due, and off calls nothing.
  registerJob(POLL_JOB, TICK_MS, () => pollOnce(getPool()));

  /** What a steward needs before pressing anything. */
  app.get("/api/saberra/status", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      const connection = readConnection(secretStatus(SECRET_KEY), villageSecretsConfigured(), villageSecretsKeyProblem());
      const held = await moduleFactCount(getPool(), MODULE_ID);
      res.json({ connection, held, addressSet: addressSet() });
    } catch {
      res.status(500).json({ error: "Could not read the connection." });
    }
  });

  /**
   * Fetch what the service holds and land it as proposals.
   *
   * Every refusal is NAMED, and the read, the landing and the answer are in
   * `server/lib/saberraSync.ts`. A sync already running is its own refusal.
   */
  app.post("/api/saberra/sync", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      const { status, body } = await syncByHand(getPool());
      res.status(status).json(body);
    } catch {
      res.status(500).json({ error: "The sync stopped on an error in this village's server." });
    }
  });

  /**
   * The schedule, when it next calls the service, and the last twenty runs.
   * The same gate as the button, because it is the button's report.
   */
  app.get("/api/saberra/runs", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      res.json(await syncRunsAnswer(getPool()));
    } catch {
      res.status(500).json({ error: "Could not read the sync log." });
    }
  });

  /**
   * What the service holds about one seat, for the panel a member opens before
   * deciding whether to put their hand up.
   *
   * No capability gate on purpose: `requireModule` at the mount is the gate,
   * and the detail carries no person by construction.
   */
  app.get("/api/saberra/facts", async (req, res) => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to see this." });
      return;
    }
    const kind = String(req.query.kind ?? "");
    const id = String(req.query.id ?? "");
    if (kind === "" || id === "") {
      res.status(400).json({ error: "Say which seat or circle to read." });
      return;
    }
    try {
      const facts = await factsForEntity(getPool(), kind, id);
      res.json({ facts });
    } catch {
      res.status(500).json({ error: "Could not read what the service holds." });
    }
  });
}
