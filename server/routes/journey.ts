/**
 * Journey to Launch: the founding team's own working tracker.
 *
 * Six routes, lifted out of server/index.ts unchanged, and three added when
 * the plan became data (2026-10-22):
 *
 *   GET  /api/journey/state         the whole document, with the plan resolved
 *   POST /api/journey/checkbox      one checkbox
 *   POST /api/journey/kanban        one card's column and assignee
 *   POST /api/journey/copy          one copy section
 *   POST /api/journey/decision      one decision's status, choice and notes
 *   POST /api/journey/resources     the working-document links, replaced whole
 *   POST /api/journey/plan          the plan (weeks, tasks, decisions, intro,
 *                                   build partner), replaced whole
 *   POST /api/journey/owner         one task's owner
 *   POST /api/journey/owners/import owner choices a browser held, filling gaps
 *
 * THE READ IS GATED LIKE THE WRITES, and that is the property to keep. This
 * document is notes, decisions and a kanban about a village that has not
 * launched yet, and `GET /api/journey/state` was publicly readable while only
 * the mutations checked anything. Every route below opens with the same line.
 *
 * `isJourney` IS `isAdmin`, WHICH IS WHY IT ARRIVES RENAMED. server/index.ts
 * declares `const isJourney = isAdmin` and the handlers call it by that name,
 * so the destructure below renames rather than the six handler bodies.
 * Renaming inside a move is how a behaviour change hides in a diff. The alias
 * is also the point: this page has no gate of its own, and the resources
 * route's comment says why anything weaker would move the problem rather than
 * fix it.
 *
 * SOME HANDLERS DESTRUCTURE A `password` THEY NEVER USE. That is left exactly
 * as it was found. It is the shape of the shared-password gate this page had
 * before the admin gate replaced it, and removing it here would be a second
 * change riding inside a move. Worth a follow-up on its own.
 *
 * REGISTERED WHERE IT WAS, because Express matches in registration order.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import {
  cleanPlan,
  isDeliveryStatus,
  ownersProblems,
  PLAN_ID,
  planProblems,
  resolvePlan,
  type CommandCentrePlan,
  type DeliveryStatus,
} from "../../shared/commandCentrePlan";
import { DEFAULT_COMMAND_CENTRE_PLAN } from "../lib/commandCentrePlanDefault";

type Deps = Pick<AppDeps, "isAdmin" | "journeyRepo">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin: isJourney, journeyRepo } = deps;

  // Journey State: Public Read
  // GET /api/journey/state
  app.get("/api/journey/state", async (req, res) => {
    // S2: reads are gated like writes. This is the founding team's internal
    // tracker — notes, decisions, kanban — and it was publicly readable while
    // only mutations checked auth.
    if (!(await isJourney(req))) return res.status(401).json({ error: "auth_required" });
    const state = journeyRepo.get();
    // The plan arrives RESOLVED: a document written before the plan was data
    // has none and reads as today's plan, so its stored ticks keep matching.
    res.json({ ...state, plan: planOf(state), owners: ownersOf(state) });
  });

  // Journey State: Update Checkbox
  // POST /api/journey/checkbox  { password, id, state: 0|1|2 }
  app.post("/api/journey/checkbox", async (req, res) => {
    const { password, id, state } = req.body;
    if (!(await isJourney(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    if (!id || state === undefined || ![0, 1, 2].includes(state)) {
      return res.status(400).json({ error: "Missing or invalid fields" });
    }
    const journey = journeyRepo.get();
    journey.checkboxes[id] = state;
    await journeyRepo.put(journey);
    res.json({ success: true });
  });

  // Journey State: Update Kanban Card
  // POST /api/journey/kanban  { password, id, column, assignee }
  app.post("/api/journey/kanban", async (req, res) => {
    const { password, id, column, assignee } = req.body;
    if (!(await isJourney(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    const validColumns = ["assigned", "actioning", "needs-support", "completed"];
    if (!id || !validColumns.includes(column)) {
      return res.status(400).json({ error: "Missing or invalid fields" });
    }
    const journey = journeyRepo.get();
    if (!journey.kanban) journey.kanban = {};
    journey.kanban[id] = { column, assignee: assignee ?? "" };
    await journeyRepo.put(journey);
    res.json({ success: true });
  });

  // Journey State: Update Copy Section
  // POST /api/journey/copy  { password, sectionId, content }
  app.post("/api/journey/copy", async (req, res) => {
    const { password, sectionId, content } = req.body;
    if (!(await isJourney(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    if (!sectionId || content === undefined) {
      return res.status(400).json({ error: "Missing fields" });
    }
    const journey = journeyRepo.get();
    journey.copy[sectionId] = content;
    await journeyRepo.put(journey);
    res.json({ success: true });
  });

  // Journey State: Update Decision
  // POST /api/journey/decision  { password, id, status, chosen, notes }
  app.post("/api/journey/decision", async (req, res) => {
    const { password, id, status, chosen, notes } = req.body;
    if (!(await isJourney(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    const validStatuses = ["open", "decided"];
    if (!id || !validStatuses.includes(status)) {
      return res.status(400).json({ error: "Missing or invalid fields" });
    }
    const journey = journeyRepo.get();
    if (!journey.decisions) journey.decisions = {};
    journey.decisions[id] = { status, chosen: chosen ?? "", notes: notes ?? "" };
    await journeyRepo.put(journey);
    res.json({ success: true });
  });

  /**
   * Journey State: the founding team's own working documents.
   * POST /api/journey/resources  { resources: [{ label, url }] }
   *
   * Behind `isJourney`, which is `isAdmin`, the same gate the rest of this
   * document reads and writes through. That matters more than it looks: the
   * whole point of moving these links out of the client bundle is that a
   * route guard now decides who sees them, so serving them from anything
   * weaker than the page's own gate would move the problem rather than fix it.
   *
   * The list replaces wholesale, the way the admin screens edit the other
   * config documents. Only http and https survive: a `javascript:` href in an
   * anchor this page renders would run in the next admin's browser.
   */
  app.post("/api/journey/resources", async (req, res) => {
    if (!(await isJourney(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    const incoming = req.body?.resources;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: "Send a resources array" });
    }
    if (incoming.length > 40) {
      return res.status(400).json({ error: "That is more than 40 links. Trim the list first" });
    }
    const cleaned: Array<{ label: string; url: string }> = [];
    for (const raw of incoming) {
      const label = String(raw?.label ?? "").trim().slice(0, 120);
      const url = String(raw?.url ?? "").trim().slice(0, 2000);
      if (!label && !url) continue;
      if (!/^https?:\/\/\S/i.test(url)) {
        return res.status(400).json({ error: `"${label || url}" needs a web address starting http:// or https://` });
      }
      cleaned.push({ label: label || url, url });
    }
    // Copied rather than mutated in place. Before any row exists, `get()`
    // hands back the module-level default OBJECT, so writing a field onto it
    // edits the default every later reader in this process will see.
    const journey = { ...journeyRepo.get(), resources: cleaned };
    await journeyRepo.put(journey);
    res.json({ success: true, resources: cleaned });
  });

  /**
   * The plan, replaced whole: weeks, tasks, decisions, the intro line and the
   * build partner's name. `{ plan, revision }`.
   *
   * Three refusals, each one a property the page relies on:
   *   - a plan `planProblems` rejects (limits, ids, a link to no task) is a
   *     400 that says what to fix;
   *   - a plan that DROPS an item the current one holds is a 400 as well.
   *     Removing an item hides it, so its ticks, notes and decision answers
   *     stay stored under its id and come back if it is restored;
   *   - a `revision` that is not the current one is a 409. Two admins in two
   *     tabs would otherwise each save over the other's plan without a word.
   */
  app.post("/api/journey/plan", async (req, res) => {
    if (!(await isJourney(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    const current = planOf(journeyRepo.get());
    if (req.body?.revision !== current.revision) {
      return res.status(409).json({
        error: "Somebody saved the plan after you opened it. Reload the page to see their version, then make your change again.",
        revision: current.revision,
      });
    }
    const problems = planProblems(req.body?.plan, current);
    if (problems.length > 0) {
      return res.status(400).json({ error: problems[0], problems });
    }
    const plan: CommandCentrePlan = { ...cleanPlan(req.body.plan), revision: current.revision + 1 };
    await journeyRepo.put({ ...journeyRepo.get(), plan });
    res.json({ success: true, plan });
  });

  /**
   * One task's owner: the dropdown on each timeline row. `{ id, status }`.
   *
   * These used to live only in the browser that picked them, under a page
   * sentence saying everything here was shared and synced to the server.
   */
  app.post("/api/journey/owner", async (req, res) => {
    if (!(await isJourney(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    const { id, status } = req.body ?? {};
    if (typeof id !== "string" || !PLAN_ID.test(id) || !isDeliveryStatus(status)) {
      return res.status(400).json({ error: "Send a task id and one of the four owners" });
    }
    const journey = journeyRepo.get();
    const owners = { ...ownersOf(journey), [id]: status };
    await journeyRepo.put({ ...journey, owners });
    res.json({ success: true, owners });
  });

  /**
   * The one-time move of owner choices a browser kept locally. `{ owners }`.
   *
   * FILLS GAPS AND NEVER OVERWRITES. Whatever the server already holds is
   * what every other admin has been looking at, so a stale browser arriving
   * late cannot change it. The page clears its local copy once this lands.
   */
  app.post("/api/journey/owners/import", async (req, res) => {
    if (!(await isJourney(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    const incoming = req.body?.owners;
    const problems = ownersProblems(incoming);
    if (problems.length > 0) {
      return res.status(400).json({ error: problems[0], problems });
    }
    const journey = journeyRepo.get();
    const owners = { ...ownersOf(journey) };
    const imported: string[] = [];
    for (const [id, status] of Object.entries(incoming as Record<string, DeliveryStatus>)) {
      if (id in owners) continue;
      owners[id] = status;
      imported.push(id);
    }
    if (imported.length > 0) await journeyRepo.put({ ...journey, owners });
    res.json({ success: true, imported, owners });
  });
}

/** The stored plan over today's default. */
function planOf(journey: Record<string, unknown>): CommandCentrePlan {
  return resolvePlan(journey?.plan, DEFAULT_COMMAND_CENTRE_PLAN);
}

/** Owner choices by task id, only the ones that still read as owners. */
function ownersOf(journey: Record<string, unknown>): Record<string, DeliveryStatus> {
  const stored = journey?.owners;
  const out: Record<string, DeliveryStatus> = {};
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [id, status] of Object.entries(stored)) if (isDeliveryStatus(status)) out[id] = status;
  }
  return out;
}
