/**
 * CHANGE REQUESTS: GATHERING (Rye, 2026-11-06; spec
 * village-os-ops/internal/spec/change-requests/, US1, US2.3, R4, R22, R23).
 *
 *   POST   /api/change-requests                                  start one
 *   GET    /api/change-requests                                  mine, and everyone's in review or in a vote
 *   GET    /api/change-requests/:id                              one, with its changes before and after
 *   PATCH  /api/change-requests/:id                              its title or its why
 *   DELETE /api/change-requests/:id                              throw away one still gathering
 *   POST   /api/change-requests/:id/changes                      add a change
 *   PUT    /api/change-requests/:id/changes/:position            edit a change
 *   DELETE /api/change-requests/:id/changes/:position            take a change out
 *   POST   /api/change-requests/:id/changes/:position/split      move a change into a change request of its own
 *
 * WHO. Starting and editing ask `mechanics.propose` through the one gate
 * (R4), which brings the village's rung and the warning-badge deny with it.
 * A member who has left the village is refused, as #961 refuses one. Only the
 * author edits; nobody else, an admin included, edits or deletes somebody
 * else's change request (R10). Reading is for anyone signed in (I.2, US1.6).
 *
 * EVERY EDIT IS CHECKED AS A WHOLE. A change is added, edited or removed, and
 * then the whole new list goes through the same validator a proposal's change
 * set goes through (`validate`, injected from server/index.ts where its readers
 * live), with the village's cap. A set that would be refused at the vote is
 * refused here, with the validator's own sentences (R13 of the spec, Q13).
 *
 * EVERY EDIT NAMES THE REVISION IT READ, and the store moves only from that
 * revision, so a second tab's edit is told the page is out of date instead of
 * quietly undoing the first.
 *
 * Gathering only. The review round, the vote and the rest are later slices.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { hasCapability } from "../../shared/capabilities";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { holderFirstName } from "../../shared/roleHolderLabel";
import {
  GATHERING_LIMIT_DEFAULT,
  GATHERING_LIMIT_KEY,
  changeKeyOf,
  changeLabel,
  changeRequestTextProblem,
  withChangeAdded,
  withChangeRemoved,
  withChangeReplaced,
  type ChangeLike,
  type ListResult,
} from "../../shared/changeRequests";
import { changeSetCapFrom, CHANGE_SET_CAP_KEY } from "../../shared/changeSetCap";
import { leftTheVillage } from "../lib/formerMember";
import { numberVar } from "../lib/variables";
import { rolesHeldBy } from "../repos/companions";
import { changeRequestStore, type ChangeRequestRow, type ChangeRequestStore, type ReviewNote, type StoredChange } from "../repos/changeRequests";
import { MODULES } from "../../shared/modules";
import { REVIEW_DAYS_DEFAULT, REVIEW_DAYS_KEY, notePostProblem, powersTouchedBy, readiness, reviewEndsAt, type NoteKind } from "../../shared/changeRequestReview";
import type { Capability } from "../../shared/capabilities";

/** What the shared validator answers: refusals, and each change with the value it starts from. */
export interface ValidationResult {
  problems: { key: string; problem: string }[];
  normalized: { key: string; from: string }[];
}

type Deps = Pick<AppDeps, "authedUser" | "capabilityCtx" | "getPool" | "members" | "overLimit"> & {
  /** `validateChangeSet` with the village's readers and cap, as the proposal route calls it. */
  validate: (changes: readonly ChangeLike[]) => Promise<ValidationResult>;
  store?: ChangeRequestStore;
  isFormerMember?: (user: any) => Promise<boolean>;
  /** The names of the live roles a member holds now (III.2). Injected for the tests. */
  rolesOf?: (userId: string) => Promise<string[]>;
  /** A number dial's value. Injected for the tests. */
  numberVar?: (key: string) => number;
  newId?: () => string;
  /** Live holders of a power, bridged, no admin short-circuit (server/index.ts). */
  liveHoldersOf?: (cap: Capability) => Promise<string[]>;
  notify?: AppDeps["notify"];
  /** When the current cycle began, for the flooding count. */
  cycleStart?: () => Date;
  /** Plain proposals this member opened since an instant (`proposalsOpenedSince`). */
  proposalsOpenedSince?: (userId: string, since: Date) => Promise<number>;
  /** True when the request comes from an agent acting for the member (R4). No agent session exists yet. */
  byAgent?: (req: any) => boolean;
  now?: () => Date;
};

const WRITES_PER_WINDOW = 120;
const STARTS_PER_WINDOW = 20;
const WINDOW_MS = 60 * 60 * 1000;

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, getPool, members, overLimit } = deps;
  const store = deps.store ?? changeRequestStore(() => getPool());
  const isFormer = deps.isFormerMember ?? ((user: any) => leftTheVillage(getPool(), user));
  const readNumber = deps.numberVar ?? numberVar;
  const rolesOf = deps.rolesOf ?? (async (id: string) => (await rolesHeldBy(getPool(), id)).map((r) => r.name));
  const newId = deps.newId ?? (() => `cr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const cap = () => changeSetCapFrom(readNumber(CHANGE_SET_CAP_KEY));
  const gatheringLimit = () => {
    const n = Math.trunc(Number(readNumber(GATHERING_LIMIT_KEY)));
    return Number.isFinite(n) && n >= 1 ? n : GATHERING_LIMIT_DEFAULT;
  };

  const now = () => (deps.now ? deps.now() : new Date());
  const byAgent = deps.byAgent ?? (() => false);
  const reviewDaysNow = () => {
    const n = Math.trunc(Number(readNumber(REVIEW_DAYS_KEY)));
    return Number.isFinite(n) && n >= 0 ? n : REVIEW_DAYS_DEFAULT;
  };
  const endsAt = (cr: ChangeRequestRow) =>
    reviewEndsAt(new Date(cr.reviewOpenedAt ?? cr.updatedAt), cr.reviewDaysAtOpen ?? reviewDaysNow(), reviewDaysNow());

  /** The capabilities of the module that owns a dial, or null (C9). */
  const moduleCapsOf = (dialKey: string): readonly string[] | null => {
    const owner = MODULES.find((m) => m.variableKeys.includes(dialKey));
    return owner && owner.capabilities.length ? owner.capabilities : null;
  };

  /**
   * REVIEW REQUESTS, LIKE CODE OWNERS (US4, C9, R3, R22). Every live holder of
   * a power the changes touch is asked once per revision, never the author:
   * one notice per person per revision, whatever number of those powers they
   * hold. The notice names no person (III.2).
   */
  async function askReviewers(cr: ChangeRequestRow): Promise<void> {
    if (!deps.liveHoldersOf || !deps.notify) return;
    const powers = new Set<Capability>();
    for (const c of cr.changes) for (const p of powersTouchedBy(c.item as any, moduleCapsOf)) powers.add(p);
    const people = new Set<string>();
    for (const p of Array.from(powers)) {
      for (const holder of await deps.liveHoldersOf(p).catch(() => [] as string[])) {
        if (holder !== cr.authorUserId) people.add(holder);
      }
    }
    for (const userId of Array.from(people)) {
      await deps
        .notify({
          userId,
          type: "change_request_review",
          title: `You are asked to review "${cr.title}"`,
          body: `It changes ${cr.changes.length} setting${cr.changes.length === 1 ? "" : "s"}, and some touch what your role looks after. Ask, raise a concern or an objection, suggest an edit, or say you can live with it.`,
          link: `/changes/${cr.id}`,
          dedupeKey: `cr-review:${cr.id}:r${cr.revision}:${userId}`,
        } as any)
        .catch(() => undefined);
    }
  }

  /** Tells one member about somebody else's act. Never the person who did it. */
  async function tellUser(userId: string | null, actorId: string, title: string, body: string, crId: string, dedupeKey: string): Promise<void> {
    if (!userId || userId === actorId || !deps.notify) return;
    await deps.notify({ userId, type: "change_request", title, body, link: `/changes/${crId}`, dedupeKey } as any).catch(() => undefined);
  }

  async function signedIn(req: any, res: any): Promise<any | null> {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in to see what your village is weighing." });
      return null;
    }
    return user;
  }

  /** Signed in, still in the village, and holding `mechanics.propose`, or null after answering. */
  async function proposer(req: any, res: any): Promise<any | null> {
    const user = await signedIn(req, res);
    if (!user) return null;
    if (await isFormer(user)) {
      res.status(403).json({ error: "former_member", message: "Change requests are for members of the village." });
      return null;
    }
    const ctx = await capabilityCtx(user);
    if (!hasCapability("mechanics.propose", ctx)) {
      res.status(403).json({ error: "cannot_propose", message: "Gathering changes opens at the member rung, and a standing warning pauses it." });
      return null;
    }
    if (await overLimit(`change-requests:${user.id}`, WRITES_PER_WINDOW, WINDOW_MS)) {
      res.status(429).json({ error: "too_many", message: "That is a lot in one hour. Wait a little and try again." });
      return null;
    }
    return user;
  }

  /** The author's own gathering change request at the revision they read, or null after answering. */
  async function editable(req: any, res: any, user: any, states: readonly string[] = ["gathering", "in_review"]): Promise<ChangeRequestRow | null> {
    const cr = await store.byId(String(req.params.id ?? ""));
    if (!cr) {
      res.status(404).json({ error: "not_found", message: "There is no change request by that id." });
      return null;
    }
    if (cr.authorUserId !== String(user.id)) {
      res.status(403).json({ error: "not_yours", message: "Only the member who started a change request edits it. Suggest an edit in its review instead." });
      return null;
    }
    if (!states.includes(cr.state)) {
      res.status(409).json({
        error: cr.state === "in_review" ? "in_review" : "not_gathering",
        message:
          cr.state === "in_review"
            ? "This change request is in review. Its changes can still be edited, and that starts the review again."
            : "This change request is in the vote or closed, so its changes are fixed.",
      });
      return null;
    }
    const read = Number(req.body?.revision ?? req.query?.revision);
    if (!Number.isInteger(read) || read !== cr.revision) {
      res.status(409).json({ error: "out_of_date", message: "This change request changed since you opened it. Reload it to see what is there now.", revision: cr.revision });
      return null;
    }
    return cr;
  }

  /** The whole new list, checked the way the vote will check it, or null after answering. */
  async function checked(res: any, next: ListResult<ChangeLike>, previous: readonly StoredChange[], userId: string): Promise<StoredChange[] | null> {
    if (!next.ok) {
      res.status(400).json({ error: "change_refused", message: next.problem });
      return null;
    }
    const max = cap();
    if (next.items.length > max) {
      res.status(400).json({
        error: "cap_reached",
        message: `This change request already carries ${max} change${max === 1 ? "" : "s"}, the most this village allows in one vote. Start another one, or ask the village to raise the number.`,
        cap: max,
        dial: CHANGE_SET_CAP_KEY,
      });
      return null;
    }
    if (next.items.length === 0) return [];
    const { problems, normalized } = await deps.validate(next.items);
    if (problems.length) {
      res.status(400).json({ error: "change_refused", message: problems.map((p) => p.problem).join(". "), problems });
      return null;
    }
    const kept = new Map(previous.map((c) => [c.changeKey, c]));
    return next.items.map((item, position) => {
      const key = changeKeyOf(item);
      const old = kept.get(key);
      // A change that was already here keeps who added it and what it started from.
      return {
        position,
        item: item as Record<string, unknown>,
        changeKey: key,
        beforeValue: old && JSON.stringify(old.item) === JSON.stringify(item) ? old.beforeValue : normalized[position]?.from ?? null,
        addedBy: old?.addedBy ?? userId,
      };
    });
  }

  async function authorName(cr: ChangeRequestRow): Promise<string> {
    if (cr.authorKind === "agent") return "Sera (outside service)";
    if (!cr.authorUserId) return "A former member";
    const m = await members.byId(cr.authorUserId);
    if (!m) return "A former member";
    // III.2: the role first, the first name in parentheses, for signed-in readers only.
    const first = holderFirstName(String(m.name ?? "")) || "A member";
    const roles = await rolesOf(cr.authorUserId);
    return roles.length ? `${roles.join(", ")} (${first})` : first;
  }

  /** Who wrote a note, by III.2: "Role (FirstName)" for a signed-in reader, at render time. */
  async function personLabel(userId: string | null, cache: Map<string, string>): Promise<string> {
    if (!userId) return "A former member";
    const hit = cache.get(userId);
    if (hit) return hit;
    const m = await members.byId(userId);
    let label = "A former member";
    if (m) {
      const first = holderFirstName(String(m.name ?? "")) || "A member";
      const roles = await rolesOf(userId);
      label = roles.length ? `${roles.join(", ")} (${first})` : first;
    }
    cache.set(userId, label);
    return label;
  }

  async function reviewView(cr: ChangeRequestRow, viewerId: string) {
    if (cr.state === "gathering") return { review: null };
    const cache = new Map<string, string>();
    const notes = await store.notesOf(cr.id);
    const end = endsAt(cr);
    const objections = notes
      .filter((n) => n.kind === "objection")
      .map((n) => ({ answered: n.outcome !== "open", postedAfterEnd: new Date(n.createdAt).getTime() > end.getTime() }));
    const ready = readiness({ now: now(), endsAt: end, changes: cr.changes.length, objections, forAuthor: cr.authorUserId === viewerId });
    const shown = [];
    for (const n of notes) {
      if (n.kind === "system") continue;
      shown.push({
        id: n.id,
        kind: n.kind,
        revision: n.revision,
        position: n.position,
        body: n.body,
        proposed: n.proposedItem,
        answers: n.answersNoteId,
        outcome: n.outcome,
        by: await personLabel(n.authorUserId, cache),
        yours: n.authorUserId === viewerId,
        at: n.createdAt,
      });
    }
    return {
      review: {
        endsAt: end.toISOString(),
        ready: ready.ready,
        checklist: ready.lines,
        consents: notes.filter((n) => n.kind === "consent" && n.revision === cr.revision).length,
        notes: shown,
      },
    };
  }

  const served = async (cr: ChangeRequestRow, viewerId: string) => ({
    ...(await reviewView(cr, viewerId)),
    id: cr.id,
    title: cr.title,
    why: cr.why,
    state: cr.state,
    revision: cr.revision,
    relation: cr.relation,
    relatesTo: cr.relatesTo,
    yours: cr.authorUserId === viewerId,
    author: await authorName(cr),
    cap: cap(),
    createdAt: cr.createdAt,
    updatedAt: cr.updatedAt,
    changes: cr.changes.map((c) => {
      const item = c.item as Record<string, unknown>;
      const def = VARIABLES_BY_KEY[c.changeKey];
      return {
        position: c.position,
        key: c.changeKey,
        kind: String(item.kind ?? "dial"),
        label: changeLabel(c.changeKey),
        withheld: !!def?.withheld,
        before: def?.withheld ? null : c.beforeValue,
        after: def?.withheld ? null : String(item.to ?? ""),
        change: def?.withheld ? null : item,
      };
    }),
  });

  const position = (req: any) => Number(req.params.position);

  app.post("/api/change-requests", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    if (await overLimit(`change-requests-start:${user.id}`, STARTS_PER_WINDOW, WINDOW_MS)) {
      return res.status(429).json({ error: "too_many", message: "That is a lot of new change requests in one hour. Wait a little and try again." });
    }
    const problem = changeRequestTextProblem({ title: req.body?.title, why: req.body?.why });
    if (problem) return res.status(400).json({ error: "words", message: problem });
    const limit = gatheringLimit();
    if ((await store.countGathering(String(user.id))) >= limit) {
      return res.status(409).json({
        error: "gathering_limit",
        message: `You are gathering ${limit} change request${limit === 1 ? "" : "s"} already, the most this village allows at once. Open one for review or delete one first.`,
        dial: GATHERING_LIMIT_KEY,
      });
    }
    const id = newId();
    await store.create({ id, authorUserId: String(user.id), title: String(req.body.title).trim(), why: String(req.body.why).trim() });
    res.status(201).json({ id, revision: 1 });
  });

  app.get("/api/change-requests", async (req, res) => {
    const user = await signedIn(req, res);
    if (!user) return;
    const [mine, open] = await Promise.all([store.byAuthor(String(user.id)), store.open()]);
    const summary = async (cr: ChangeRequestRow) => ({
      id: cr.id,
      title: cr.title,
      state: cr.state,
      changes: cr.changes.length,
      author: await authorName(cr),
      yours: cr.authorUserId === String(user.id),
      updatedAt: cr.updatedAt,
    });
    res.json({
      mine: await Promise.all(mine.map(summary)),
      open: await Promise.all(open.filter((cr) => cr.authorUserId !== String(user.id)).map(summary)),
    });
  });

  app.get("/api/change-requests/:id", async (req, res) => {
    const user = await signedIn(req, res);
    if (!user) return;
    const cr = await store.byId(String(req.params.id ?? ""));
    if (!cr) return res.status(404).json({ error: "not_found", message: "There is no change request by that id." });
    res.json(await served(cr, String(user.id)));
  });

  app.patch("/api/change-requests/:id", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    const cr = await editable(req, res, user);
    if (!cr) return;
    const title = req.body?.title !== undefined ? String(req.body.title).trim() : cr.title;
    const why = req.body?.why !== undefined ? String(req.body.why).trim() : cr.why;
    const problem = changeRequestTextProblem({ title, why });
    if (problem) return res.status(400).json({ error: "words", message: problem });
    if (!(await store.revise(cr.id, cr.revision, { title, why }))) return res.status(409).json({ error: "out_of_date", message: "This change request changed since you opened it. Reload it to see what is there now." });
    res.json({ id: cr.id, revision: cr.revision + 1 });
  });

  app.delete("/api/change-requests/:id", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    const cr = await editable(req, res, user, ["gathering"]);
    if (!cr) return;
    if (!(await store.remove(cr.id, cr.revision))) return res.status(409).json({ error: "out_of_date", message: "This change request changed since you opened it. Reload it to see what is there now." });
    res.json({ deleted: true });
  });

  const writeChanges = async (req: any, res: any, user: any, cr: ChangeRequestRow, next: ListResult<ChangeLike>) => {
    const changes = await checked(res, next, cr.changes, String(user.id));
    if (!changes) return;
    if (!(await store.revise(cr.id, cr.revision, { changes }))) {
      return res.status(409).json({ error: "out_of_date", message: "This change request changed since you opened it. Reload it to see what is there now." });
    }
    const after = (await store.byId(cr.id))!;
    if (after.state === "in_review") await askReviewers(after);
    res.json(await served(after, String(user.id)));
  };

  const items = (cr: ChangeRequestRow) => cr.changes.map((c) => c.item as ChangeLike);
  const changeIn = (req: any): ChangeLike | null => {
    const c = req.body?.change;
    return c && typeof c === "object" && !Array.isArray(c) ? (c as ChangeLike) : null;
  };

  app.post("/api/change-requests/:id/changes", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    const cr = await editable(req, res, user);
    if (!cr) return;
    const change = changeIn(req);
    if (!change) return res.status(400).json({ error: "no_change", message: "Say which setting to change, and to what." });
    await writeChanges(req, res, user, cr, withChangeAdded(items(cr), change));
  });

  app.put("/api/change-requests/:id/changes/:position", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    const cr = await editable(req, res, user);
    if (!cr) return;
    const change = changeIn(req);
    if (!change) return res.status(400).json({ error: "no_change", message: "Say which setting to change, and to what." });
    await writeChanges(req, res, user, cr, withChangeReplaced(items(cr), position(req), change));
  });

  app.delete("/api/change-requests/:id/changes/:position", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    const cr = await editable(req, res, user);
    if (!cr) return;
    await writeChanges(req, res, user, cr, withChangeRemoved(items(cr), position(req)));
  });

  /*
   * SPLIT (US2.3, R23). The change moves into a NEW gathering change request
   * with the same why and a link back, and leaves this one. The new one counts
   * against the gathering limit and starts its own clock. Neither half's price
   * can fall below its own hardest change, because every change is priced at
   * its own tier wherever it sits.
   */
  app.post("/api/change-requests/:id/changes/:position/split", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    const cr = await editable(req, res, user, ["gathering"]);
    if (!cr) return;
    const at = position(req);
    const moved = cr.changes[at];
    const rest = withChangeRemoved(items(cr), at);
    if (!moved || !rest.ok) return res.status(400).json({ error: "change_refused", message: "There is no change at that place." });
    if (rest.items.length === 0) return res.status(400).json({ error: "last_change", message: "That is the only change here, so it is already on its own." });
    const limit = gatheringLimit();
    if ((await store.countGathering(String(user.id))) >= limit) {
      return res.status(409).json({
        error: "gathering_limit",
        message: `You are gathering ${limit} change request${limit === 1 ? "" : "s"} already, the most this village allows at once. Open one for review or delete one first.`,
        dial: GATHERING_LIMIT_KEY,
      });
    }
    const remaining = await checked(res, rest, cr.changes, String(user.id));
    if (!remaining) return;
    if (!(await store.revise(cr.id, cr.revision, { changes: remaining }))) {
      return res.status(409).json({ error: "out_of_date", message: "This change request changed since you opened it. Reload it to see what is there now." });
    }
    const id = newId();
    const label = changeLabel(moved.changeKey);
    const title = `${label}`.slice(0, 120);
    await store.create({
      id,
      authorUserId: String(user.id),
      title,
      why: cr.why,
      relation: "split_from",
      relatesTo: cr.id,
      changes: [{ ...moved, position: 0 }],
    });
    res.status(201).json({ id, from: cr.id, revision: cr.revision + 1 });
  });

  // ── THE REVIEW ROUND (US3, R2, R3, R9, R40) ──────────────────────────────

  app.post("/api/change-requests/:id/open-review", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    const cr = await editable(req, res, user, ["gathering"]);
    if (!cr) return;
    if (cr.changes.length === 0) return res.status(400).json({ error: "no_changes", message: "Add at least one change before the village reviews it." });
    // Counted once, here, against the village's ceiling on proposals per cycle (R2).
    const since = deps.cycleStart ? deps.cycleStart() : new Date(0);
    const opened =
      (await store.openedForReviewSince(String(user.id), since)) +
      (deps.proposalsOpenedSince ? await deps.proposalsOpenedSince(String(user.id), since) : 0);
    const ceiling = Math.max(1, Math.trunc(Number(readNumber("governance.proposals_per_member_per_cycle")) || 1));
    if (opened >= ceiling) {
      return res.status(429).json({
        error: "cycle_ceiling",
        message: `You have opened ${opened} this cycle, the village's ceiling. Reviewing and supporting other change requests is never limited.`,
      });
    }
    const whole = await deps.validate(cr.changes.map((c) => c.item as ChangeLike));
    if (whole.problems.length) {
      return res.status(400).json({ error: "change_refused", message: whole.problems.map((p) => p.problem).join(". "), problems: whole.problems });
    }
    if (!(await store.openReview(cr.id, cr.revision, reviewDaysNow()))) {
      return res.status(409).json({ error: "out_of_date", message: "This change request changed since you opened it. Reload it to see what is there now." });
    }
    await store.addNote({ id: newId(), changeRequestId: cr.id, revision: cr.revision, kind: "system", authorUserId: String(user.id), body: "opened for review" });
    const inReviewNow = (await store.byId(cr.id))!;
    await askReviewers(inReviewNow);
    res.json(await served(inReviewNow, String(user.id)));
  });

  /** Signed in and still in the village, or null after answering. Reviewing needs no rung (I.2). */
  async function reviewer(req: any, res: any): Promise<any | null> {
    const user = await signedIn(req, res);
    if (!user) return null;
    if (await isFormer(user)) {
      res.status(403).json({ error: "former_member", message: "You left this village. You can read this, and posting is closed." });
      return null;
    }
    if (await overLimit(`change-request-notes:${user.id}`, WRITES_PER_WINDOW, WINDOW_MS)) {
      res.status(429).json({ error: "too_many", message: "That is a lot in one hour. Wait a little and try again." });
      return null;
    }
    return user;
  }

  async function found(req: any, res: any): Promise<ChangeRequestRow | null> {
    const cr = await store.byId(String(req.params.id ?? ""));
    if (!cr) {
      res.status(404).json({ error: "not_found", message: "There is no change request by that id." });
      return null;
    }
    return cr;
  }

  app.post("/api/change-requests/:id/notes", async (req, res) => {
    const user = await reviewer(req, res);
    if (!user) return;
    const cr = await found(req, res);
    if (!cr) return;
    const kind = String(req.body?.kind ?? "") as NoteKind;
    const body = String(req.body?.body ?? "").trim();
    const notes = await store.notesOf(cr.id);
    const problem = notePostProblem({
      kind,
      body,
      state: cr.state,
      byAgent: byAgent(req),
      openObjectionThisRevision: notes.some(
        (n) => n.kind === "objection" && n.outcome === "open" && n.revision === cr.revision && n.authorUserId === String(user.id),
      ),
    });
    if (problem) return res.status(cr.state === "in_review" ? 400 : 409).json({ error: "note_refused", message: problem });
    if (kind === "consent" && notes.some((n) => n.kind === "consent" && n.revision === cr.revision && n.authorUserId === String(user.id))) {
      return res.json(await served(cr, String(user.id)));
    }
    const at = req.body?.position === undefined || req.body?.position === null ? null : Number(req.body.position);
    if (at !== null && (!Number.isInteger(at) || at < 0 || at >= cr.changes.length)) {
      return res.status(400).json({ error: "note_refused", message: "There is no change at that place." });
    }
    const id = newId();
    if (!(await store.addNote({ id, changeRequestId: cr.id, revision: cr.revision, kind, authorUserId: String(user.id), position: at, body }))) {
      return res.status(409).json({ error: "note_refused", message: "This change request is not in review any more." });
    }
    if (kind !== "consent") {
      const words = kind === "objection" ? "New objection" : kind === "question" ? "New question" : "New concern";
      await tellUser(cr.authorUserId, String(user.id), `${words} on "${cr.title}"`, "Open the change request to read it and answer.", cr.id, `cr-note:${id}`);
    }
    res.status(201).json(await served((await store.byId(cr.id))!, String(user.id)));
  });

  /** "Suggest an edit": a proposed replacement, removal or addition the author may take in (US3.3). */
  app.post("/api/change-requests/:id/suggestions", async (req, res) => {
    const user = await reviewer(req, res);
    if (!user) return;
    const cr = await found(req, res);
    if (!cr) return;
    if (cr.state !== "in_review") return res.status(409).json({ error: "note_refused", message: "This change request is not in review." });
    const op = String(req.body?.op ?? "");
    const at = req.body?.position === undefined || req.body?.position === null ? null : Number(req.body.position);
    const change = changeIn(req);
    const body = String(req.body?.body ?? "").trim().slice(0, 2000);
    if (!["replace", "remove", "add"].includes(op)) {
      return res.status(400).json({ error: "note_refused", message: "Say whether to change, remove or add a change." });
    }
    if (op !== "add" && (at === null || !Number.isInteger(at) || at < 0 || at >= cr.changes.length)) {
      return res.status(400).json({ error: "note_refused", message: "There is no change at that place." });
    }
    if (op !== "remove" && !change) return res.status(400).json({ error: "no_change", message: "Say which setting to change, and to what." });
    const next =
      op === "add" ? withChangeAdded(items(cr), change!) : op === "remove" ? withChangeRemoved(items(cr), at!) : withChangeReplaced(items(cr), at!, change!);
    if (!next.ok) return res.status(400).json({ error: "change_refused", message: next.problem });
    const v = await deps.validate(next.items);
    if (v.problems.length) return res.status(400).json({ error: "change_refused", message: v.problems.map((p) => p.problem).join(". "), problems: v.problems });
    const id = newId();
    const proposedItem = { op, position: at, change: change ?? null } as Record<string, unknown>;
    if (!(await store.addNote({ id, changeRequestId: cr.id, revision: cr.revision, kind: "edit", authorUserId: String(user.id), position: at, body, proposedItem }))) {
      return res.status(409).json({ error: "note_refused", message: "This change request is not in review any more." });
    }
    await tellUser(cr.authorUserId, String(user.id), `A suggested edit on "${cr.title}"`, "Open the change request to take it in or turn it down.", cr.id, `cr-note:${id}`);
    res.status(201).json(await served((await store.byId(cr.id))!, String(user.id)));
  });

  const noteOf = async (cr: ChangeRequestRow, noteId: string) => (await store.notesOf(cr.id)).find((n) => n.id === noteId) ?? null;

  app.post("/api/change-requests/:id/suggestions/:noteId/take-in", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    const cr = await editable(req, res, user, ["in_review"]);
    if (!cr) return;
    const note = await noteOf(cr, String(req.params.noteId));
    if (!note || note.kind !== "edit" || note.outcome !== "open") {
      return res.status(404).json({ error: "not_found", message: "That suggested edit is not waiting." });
    }
    const p = note.proposedItem as any;
    const op = String(p?.op);
    const next =
      op === "add"
        ? withChangeAdded(items(cr), p.change)
        : op === "remove"
          ? withChangeRemoved(items(cr), Number(p.position))
          : withChangeReplaced(items(cr), Number(p.position), p.change);
    const changes = await checked(res, next, cr.changes, String(note.authorUserId ?? user.id));
    if (!changes) return;
    if (!(await store.revise(cr.id, cr.revision, { changes }))) {
      return res.status(409).json({ error: "out_of_date", message: "This change request changed since you opened it. Reload it to see what is there now." });
    }
    await store.settleNote(note.id, "taken_in");
    await tellUser(note.authorUserId, String(user.id), `Your edit to "${cr.title}" was taken in`, "The review starts again with it.", cr.id, `cr-taken:${note.id}`);
    const after = (await store.byId(cr.id))!;
    await askReviewers(after);
    res.json(await served(after, String(user.id)));
  });

  app.post("/api/change-requests/:id/suggestions/:noteId/turn-down", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    const cr = await editable(req, res, user, ["in_review"]);
    if (!cr) return;
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason || /[\r\n]/.test(reason) || reason.length > 280) {
      return res.status(400).json({ error: "reason", message: "Turning down an edit needs a one-line reason, at most 280 characters." });
    }
    const note = await noteOf(cr, String(req.params.noteId));
    if (!note || note.kind !== "edit" || note.outcome !== "open") {
      return res.status(404).json({ error: "not_found", message: "That suggested edit is not waiting." });
    }
    await store.addNote({ id: newId(), changeRequestId: cr.id, revision: cr.revision, kind: "answer", authorUserId: String(user.id), body: reason, answersNoteId: note.id });
    await store.settleNote(note.id, "turned_down");
    await tellUser(note.authorUserId, String(user.id), `Your edit to "${cr.title}" was turned down`, reason, cr.id, `cr-turned:${note.id}`);
    res.json(await served((await store.byId(cr.id))!, String(user.id)));
  });

  /** The author answers a question, a concern or an objection. Every objection needs one before the vote (US3.4). */
  app.post("/api/change-requests/:id/notes/:noteId/answer", async (req, res) => {
    const user = await proposer(req, res);
    if (!user) return;
    const cr = await editable(req, res, user, ["in_review"]);
    if (!cr) return;
    const body = String(req.body?.body ?? "").trim();
    if (!body || body.length > 2000) return res.status(400).json({ error: "answer", message: "Write an answer of up to 2000 characters." });
    const note = await noteOf(cr, String(req.params.noteId));
    if (!note || !["question", "concern", "objection"].includes(note.kind) || note.outcome !== "open") {
      return res.status(404).json({ error: "not_found", message: "That note is not waiting for an answer." });
    }
    await store.addNote({ id: newId(), changeRequestId: cr.id, revision: cr.revision, kind: "answer", authorUserId: String(user.id), body, answersNoteId: note.id });
    await store.settleNote(note.id, "answered");
    await tellUser(note.authorUserId, String(user.id), `An answer on "${cr.title}"`, "Open the change request to read it.", cr.id, `cr-answer:${note.id}`);
    res.json(await served((await store.byId(cr.id))!, String(user.id)));
  });
}
