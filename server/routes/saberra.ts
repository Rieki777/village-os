/**
 * The outside governance service, as five routes and one scheduled job: the
 * status, the sync, its run log, a seat's facts, and what the journal bridge
 * would send (nothing yet).
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
 *
 * ── THE DIFFERENCES, READ-ONLY ───────────────────────────────────────────
 *
 * Every read keeps a snapshot of the service's circles and roles
 * (`server/lib/saberraSnapshot.ts`). Two reads compute, at request time, how
 * that snapshot and the live chart differ (`shared/seraDifferences.ts`): a
 * count for any signed-in member, with no subject in it, and the full list
 * behind the review queue's key. Neither writes anything.
 */
import { boolVar } from "../lib/variables";
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { POLL_JOB, pollOnce, syncByHand, syncRunsAnswer } from "../lib/saberraSync";
import { readConnection } from "../lib/saberraConnection";
import { registerJob, TICK_MS } from "../lib/scheduler";
import { secretStatus, villageSecretsConfigured, villageSecretsKeyProblem } from "../lib/secrets";
import { moduleConfig } from "../lib/modules";
import { httpsAddress } from "@shared/modules";
import { factsForEntity, moduleFactCount } from "../repos/moduleFacts";
import { outboxView } from "../lib/saberraOutbox";
import { bridgeReading } from "../repos/saberraBridge";
import { privacyTokenSet } from "../lib/saberraPrivacy";
import { currentTokenUses } from "../lib/saberraTokens";
import { lastQuestFeed, runQuestFeed, QUEST_FEED_MODULE } from "../lib/seraQuestFeed";
import { waitingSeraQuests } from "../repos/seraQuestFeed";
import { recordEvent } from "../lib/events";
import { linkSeraPerson, linkedMember } from "../repos/memberTaskImport";
import { linkableMember, memberLinks, memberName, unlinkMember } from "../repos/seraPersonLinks";
import { LINK_WORDS, seraOwnerIdProblem } from "@shared/seraPersonLinks";
import { backfill, linksWithReviews } from "../lib/seraPersonMatch";
import { clearReview } from "../repos/seraLinkReviews";
import { changedHereAt, countAnswer, forgetCachedDifferences, listAnswer, readDifferences, wordsOf } from "../lib/seraDifferencesRead";
import { answerDifferences, readAnswerBody, readUndoBody, undoAnswers } from "../lib/seraAnswer";
import { doorHolders } from "../lib/seraDoors";
import { publishDoorFor } from "../lib/orgDraftDecide";
import { nameCheckFor } from "../lib/saberraNames";
import { rosterRows } from "../repos/peopleRoster";
import type { AnswerDoor } from "@shared/seraSettle";
import { pruneByAge, SNAPSHOT_MAX_AGE_DAYS } from "../lib/saberraSnapshot";
import { doorsNow, type Deciders } from "../lib/seraDoors";
import { waitingChartProposals } from "../repos/seraDifferences";
import { saberraAgentName } from "../lib/saberraGuide";
import { recentSnapshots } from "../repos/saberraSnapshots";
import { latestRolePay } from "../lib/saberraRolePay";
import { villageTimezone } from "../lib/villageReaders";

/**
 * `mayStillSee` and `overLimit` are taken when the caller hands them in. The
 * differences list asks `mayStillSee` (a look, never a break-glass), and both
 * differences reads are bounded per member by `overLimit`. Without them the list
 * falls back to `guardCapability` on the same key, which is the gate every
 * other read here asks and never a wider one, and the reads go unbounded the
 * way every other route here does.
 */
type Deps = Pick<AppDeps, "guardCapability" | "getPool" | "authedUser"> &
  Partial<Pick<AppDeps, "mayStillSee" | "overLimit" | "members" | "lapseContext" | "isAdmin">> & {
    /** The holder reads the count's "who decides" needs (review S2). Without them the count says nothing about it. */
    deciders?: Deciders;
    /**
     * Who holds a power live, the gate's own count, for the door an answer is
     * recorded through (R16, R17). Without it every answer is a moderator's,
     * which never claims a power nobody checked.
     */
    liveHoldersOf?: (capability: string) => Promise<string[]>;
  };

/** How often one member may ask, per minute: a page that polls, never a loop. */
const DIFFERENCES_COUNT_PER_MINUTE = 120;
const DIFFERENCES_LIST_PER_MINUTE = 60;
/** Answers per member per minute: a person working down the list with the keyboard, never a script. */
const ANSWERS_PER_MINUTE = 60;
const TOO_MANY = { error: "That is a lot of checks in a minute. Wait a moment and look again." };

const MODULE_ID = "saberra";
/**
 * The daily age-out. A cut of carried records changes rows without changing
 * their seq, which the cached list keys on, so the cache is forgotten whenever
 * anything was cut (review R3-5).
 */
export async function ageOutStoredReads(
  pool: Parameters<typeof pruneByAge>[0],
  prune: (pool: Parameters<typeof pruneByAge>[0]) => Promise<number> = (p) => pruneByAge(p),
  forget: () => void = forgetCachedDifferences,
): Promise<string> {
  const n = await prune(pool);
  if (n > 0) forget();
  return `removed ${n} stored read(s) past ${SNAPSHOT_MAX_AGE_DAYS} days`;
}

/** The daily job that ages stored reads out (spec R27). */
export const SNAPSHOT_AGE_JOB = "saberra-snapshot-age";
const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET_KEY = "sera_api_secret";

/** Whether the store holds an https address for the service. The rule is `httpsAddress`, as the sync's. */
function addressSet(): boolean {
  const cfg = (moduleConfig(MODULE_ID) as Record<string, unknown> | null) ?? {};
  return httpsAddress(cfg.apiUrl) !== null;
}

export function register(app: Express, deps: Deps): void {
  const { guardCapability, getPool, authedUser, mayStillSee, overLimit, members, deciders, lapseContext, isAdmin, liveHoldersOf } = deps;
  // The lapse context, so a lapsed holder is never named in a sentence (review N5).
  const read = () => readDifferences(getPool(), Date.now(), lapseContext?.());
  const listOpts = () => {
    const cfg = (moduleConfig(MODULE_ID) as Record<string, unknown> | null) ?? {};
    return { agent: saberraAgentName(), dashboard: cfg.dashboardUrl, timeZone: villageTimezone() };
  };

  /**
   * The door an answer comes through (R16, R17): `power` for a live holder of
   * `org.decide`, `admin` for the admin panel before launch, and `moderator`
   * for anyone else the review queue's key lets in.
   *
   * A HOLDER IS A HOLDER THROUGH A ROLE (K13). The gate's own count is
   * deny-aware and counts a power a badge grants; an admin can mint a badge, so
   * a holder here must be both in the gate's live count and holding the power
   * through a role. A badge holder's keep is set aside like any moderator's.
   * The role named is the one the public powers view gives them the power
   * through, for the record; names are read at view time (III.2).
   */
  const doorOf = async (req: unknown, userId: string): Promise<{ door: AnswerDoor; byRoleId: string | null }> => {
    const admin = isAdmin ? await isAdmin(req as never) : false;
    const roleHeld = deciders
      ? doorHolders({
          capability: "org.decide",
          roles: deciders.roles(),
          holdings: deciders.roleHolders(),
          nameOf: () => "",
          orgRoleName: () => undefined,
          villageHolder: await deciders.villageHolder("org.decide"),
        })
      : [];
    const live = liveHoldersOf ? await liveHoldersOf("org.decide") : [];
    const deciderIds = live.filter((id) => roleHeld.some((h) => h.userId === id));
    const door = await publishDoorFor(getPool(), { userId, isAdmin: admin }, deciderIds);
    if (door === "power") return { door, byRoleId: roleHeld.find((h) => h.userId === userId)?.roleId ?? null };
    return { door: door ?? "moderator", byRoleId: null };
  };
  /** A capability role's name by id, for "<role>'s words" on the draft card. */
  const roleName = (id: string): string | null => {
    const r = deciders?.roles().find((x) => String(x.id) === id);
    return r ? String(r.name ?? r.id) : null;
  };

  // The pool is read when the job RUNS, never when it is registered: this runs
  // during boot, before the pool is guaranteed to be the one the village uses.
  // Every tick, so a schedule saved in the panel is honoured within one; the
  // job itself decides whether anything is due, and off calls nothing.
  registerJob(POLL_JOB, TICK_MS, () => pollOnce(getPool()));
  // Stored reads age out daily whatever the schedule or the module, so a name
  // stored as sent cannot outlive an erasure (spec R27).
  registerJob(SNAPSHOT_AGE_JOB, DAY_MS, () => ageOutStoredReads(getPool()));

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
   * The bridge board: counts only, the same gate as the status read. Nothing
   * is sent to the service and nothing is written.
   */
  app.get("/api/saberra/bridge", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      const pool = getPool();
      const connection = readConnection(secretStatus(SECRET_KEY), villageSecretsConfigured(), villageSecretsKeyProblem());
      const held = await moduleFactCount(pool, MODULE_ID);
      const rest = await bridgeReading(pool, boolVar("memberTasks.listDefault"));
      const questFeed = { last: await lastQuestFeed(pool), waiting: await waitingSeraQuests(pool, QUEST_FEED_MODULE).catch(() => 0) };
      res.json({ connection: { mayCall: connection.mayCall, addressSet: addressSet(), held, privacySet: privacyTokenSet(), tokens: currentTokenUses(connection.mayCall) }, ...rest, questFeed });
    } catch {
      res.status(500).json({ error: "Could not read the bridge." });
    }
  });

  /**
   * What the service WOULD receive from the journal, for the setup panel.
   * Nothing is sent: the service has not named a write path.
   *
   * KIND, DATE, CODE-NAME, LENGTH AND STATUS, NEVER THE WORDS. Inside the
   * village an entry is its author's alone and no admin reads it, so the
   * payload never reaches this answer: the listing's SELECT does not name it
   * (server/repos/saberraOutbox.ts). The same gate as the status read, since
   * it is the same panel.
   */
  app.get("/api/saberra/outbox", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      res.json(await outboxView(getPool()));
    } catch {
      res.status(500).json({ error: "Could not read what would be sent." });
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
   * LINK TO SERA, BY HAND (end-of-moon spec, section 18). A steward pastes a
   * member's library owner id; nothing is imported. The same gate as the rest
   * of this panel. Owner ids come back only as a six-character tail.
   */
  app.get("/api/saberra/links", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      res.json({ members: await linksWithReviews(getPool()) });
    } catch {
      res.status(500).json({ error: "Could not read the links." });
    }
  });

  app.put("/api/saberra/links/:userId", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    const userId = String(req.params.userId ?? "").trim();
    const raw = (req.body ?? {}) as { seraOwnerId?: unknown };
    const problem = seraOwnerIdProblem(raw.seraOwnerId);
    if (problem) return res.status(400).json({ error: problem });
    const owner = String(raw.seraOwnerId).trim();
    try {
      const pool = getPool();
      const member = await linkableMember(pool, userId);
      if (!member.ok) {
        const words = member.why === "departed" ? LINK_WORDS.departed : member.why === "example" ? LINK_WORDS.example : LINK_WORDS.unknownMember;
        return res.status(member.why === "unknown" ? 404 : 409).json({ error: words });
      }
      const holder = await linkedMember(pool, owner);
      if (holder && holder !== userId) return res.status(409).json({ error: LINK_WORDS.takenBy(await memberName(pool, holder)) });
      // One library person per member: a relink replaces the old link whole.
      await unlinkMember(pool, userId);
      await linkSeraPerson(pool, owner, userId, String(actor.id));
      await clearReview(pool, userId).catch(() => {});
      void recordEvent(pool, {
        kind: "audit", text: `sera:link:${userId}`, actorUserId: actor.id,
        entityType: "sera_person_link", entityRef: userId, audience: "admin",
      });
      res.json({ ok: true, message: LINK_WORDS.linked(member.name), members: await linksWithReviews(pool) });
    } catch {
      res.status(500).json({ error: "Could not write the link." });
    }
  });

  app.delete("/api/saberra/links/:userId", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    const userId = String(req.params.userId ?? "").trim();
    try {
      const pool = getPool();
      await unlinkMember(pool, userId);
      void recordEvent(pool, {
        kind: "audit", text: `sera:unlink:${userId}`, actorUserId: actor.id,
        entityType: "sera_person_link", entityRef: userId, audience: "admin",
      });
      res.json({ ok: true, message: LINK_WORDS.unlinked(await memberName(pool, userId)), members: await linksWithReviews(pool) });
    } catch {
      res.status(500).json({ error: "Could not remove the link." });
    }
  });

  /**
   * Keyed-hash matching for members already here (docs/modules/sera-person-links.md).
   * A dry run unless the body says dryRun: false; the dry run counts and calls nothing.
   */
  app.post("/api/saberra/person-match/backfill", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    try {
      const pool = getPool();
      const dryRun = (req.body as { dryRun?: unknown } | undefined)?.dryRun !== false;
      const counts = await backfill(pool, dryRun);
      if (!dryRun && !counts.note) {
        void recordEvent(pool, {
          kind: "audit", text: `sera:match-backfill:${counts.linked}/${counts.review}/${counts.failed}`, actorUserId: actor.id,
          entityType: "sera_person_link", entityRef: "backfill", audience: "admin",
        });
      }
      res.json({ ...counts, members: await linksWithReviews(pool) });
    } catch {
      res.status(500).json({ error: "The match stopped on an error in this village's server." });
    }
  });

  /**
   * Sera's quest feed into the quest review queue. A dry run unless the body
   * says `dryRun: false` in so many words; nothing reaches the board until a
   * steward accepts a proposal and types its reward.
   */
  app.post("/api/saberra/quest-feed", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      res.json(await runQuestFeed(getPool(), { dryRun: (req.body as any)?.dryRun !== false }));
    } catch {
      res.status(500).json({ error: "The quest feed stopped on an error in this village's server." });
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
   * HOW MANY WAYS THE SERVICE AND THE CHART HERE DIFFER, for every member (R25).
   *
   * Its own payload: totals per lane, the conflicts, how many to check first,
   * how many of our changes the service has not caught up with, and when it was
   * last read. Never a subject, a name or a value, so it is safe for anybody
   * signed in, which is what lets every member see that something waits (I.3).
   * Computed at read time from the stored snapshots and the live chart, and
   * writes nothing.
   */
  app.get("/api/saberra/differences/count", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to see this." });
    if (overLimit && (await overLimit(`sera-differences-count:${user.id}`, DIFFERENCES_COUNT_PER_MINUTE, 60_000))) {
      return res.status(429).json(TOO_MANY);
    }
    try {
      const count = countAnswer(await read());
      // Who decides and who sets pay, by the holder test: role names and first names only (S2).
      const doors = deciders && members ? await doorsNow(getPool(), deciders, members) : null;
      // About this reader, outside the cache (QA Q5): the list's own gate, and whether they decide.
      const reader = {
        mayRead: mayStillSee ? await mayStillSee(req, "intake.moderate") : null,
        decides: !!doors && doors.deciderIds.includes(String(user.id)),
      };
      res.json({ ...count, decides: doors?.decides ?? null, paySetBy: doors?.paySetBy ?? null, reader });
    } catch {
      res.status(500).json({ error: "Could not read the differences." });
    }
  });

  /**
   * EVERY DIFFERENCE, with its words (R25): the service's values beside ours,
   * so the review queue's key. A LOOK asks `mayStillSee`, the rule the review
   * queue's own read follows: opening a list is looking, and there is no
   * break-glass on a GET. Computed at read time and writes nothing; taking or
   * keeping a difference is the next slice's, through the publish door.
   */
  app.get("/api/saberra/differences", async (req, res) => {
    if (mayStillSee) {
      if (!(await mayStillSee(req, "intake.moderate"))) return res.status(401).json({ error: "auth_required" });
    } else if (!(await guardCapability(req, res, "intake.moderate"))) {
      return;
    }
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (overLimit && (await overLimit(`sera-differences:${user.id}`, DIFFERENCES_LIST_PER_MINUTE, 60_000))) {
      return res.status(429).json(TOO_MANY);
    }
    try {
      const listed = await read();
      const waiting = await waitingChartProposals(getPool(), MODULE_ID);
      // When somebody here rewrote what each conflict is about, from published history only.
      const swap = nameCheckFor(await rosterRows(getPool())).swap;
      const changedHere = await changedHereAt(getPool(), listed.list, swap).catch(() => ({}));
      const viewer = await authedUser(req);
      res.json(listAnswer(listed, { ...listOpts(), waiting, changedHere, viewerId: viewer ? String(viewer.id) : null, roleName }));
    } catch {
      res.status(500).json({ error: "Could not read the differences." });
    }
  });

  /**
   * TAKE, KEEP OR EDIT (spec R12 to R16). Behind the review queue's own key,
   * because an answer writes a draft or a keep and never the chart: the
   * publish door is where the holder test stands (R17). Every item carries the
   * difference's key and both hashes as the person saw them, and the server
   * checks them again under its locks (R14). The rules and the writes are in
   * server/lib/seraAnswer.ts.
   */
  app.post("/api/saberra/differences/answer", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (overLimit && (await overLimit(`sera-answer:${user.id}`, ANSWERS_PER_MINUTE, 60_000))) return res.status(429).json(TOO_MANY);
    const body = readAnswerBody(req.body);
    if (!body) return res.status(400).json({ error: "Say what to answer, and how." });
    try {
      const userId = String(user.id);
      const opts = listOpts();
      const out = await answerDifferences(
        getPool(),
        {
          read,
          agent: opts.agent,
          describe: (d) => ({ ...d, words: wordsOf(d, { holders: {} }, opts) }),
          // R9: the wide match the snapshot flags with, over today's roster.
          namesAMember: async () => nameCheckFor(await rosterRows(getPool())).names,
        },
        { act: body.act, items: body.items, actor: { userId, ...(await doorOf(req, userId)) } },
      );
      res.status(out.status).json(out.body);
    } catch {
      res.status(500).json({ error: "Could not write the answer." });
    }
  });

  /** Take answers back (R15, R16): a keep waits again, and a take still in an open draft comes out of it. */
  app.post("/api/saberra/differences/undo", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (overLimit && (await overLimit(`sera-answer:${user.id}`, ANSWERS_PER_MINUTE, 60_000))) return res.status(429).json(TOO_MANY);
    const keys = readUndoBody(req.body);
    if (!keys) return res.status(400).json({ error: "Say which answers to undo." });
    try {
      const userId = String(user.id);
      // The undoer's own door and role, never the original answer's (R26).
      const out = await undoAnswers(getPool(), { agent: saberraAgentName() }, { keys, actor: { userId, ...(await doorOf(req, userId)) } });
      res.status(out.status).json(out.body);
    } catch {
      res.status(500).json({ error: "Could not undo the answer." });
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
      res.status(400).json({ error: "Say which role or circle to read." });
      return;
    }
    try {
      const facts = await factsForEntity(getPool(), kind, id);
      res.json({ facts });
    } catch {
      res.status(500).json({ error: "Could not read what the service holds." });
    }
  });
  /**
   * The newest pay range the service holds for each role, for the role
   * editor's "Use Sera's range" (role journey L10). Read-only: it writes no
   * term, and the editor copies a range into a role's terms only on a person's
   * own save. Gated like the terms themselves, `terms.read`, because a range
   * with its budget line is the same class of fact as the terms it informs.
   */
  app.get("/api/saberra/role-pay", async (req, res) => {
    if (!(await guardCapability(req, res, "terms.read"))) return;
    try {
      const reading = latestRolePay(await recentSnapshots(getPool(), 5));
      res.json({ readAt: reading?.readAt ?? null, byRole: reading?.byRole ?? {} });
    } catch {
      res.status(500).json({ error: "Could not read the ranges." });
    }
  });
}
