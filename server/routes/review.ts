/**
 * The steward review surface: what a machine proposed, and what a human does
 * about it.
 *
 * ── WHY THIS IS A ROUTE MODULE AND NOT /api/admin ────────────────────────
 *
 * A steward who is not an admin is exactly who this is for. Every org route in
 * the tree is admin-gated, which is why a village that wants somebody to keep
 * its queues without handing them the whole panel has had nowhere to send
 * them.
 *
 * The dead end this is careful not to repeat: the server already accepts a
 * non-admin holding `quest.consent` on three routes, and the only client
 * surface for it sits behind an `isAdmin` check, so that capability is
 * exercisable today only with curl. A gate nobody can reach through the
 * product is a gate that does not exist. So the route is capability-gated AND
 * the page at /review is capability-gated, and neither asks about admin.
 *
 * ── THE GATES, AND WHY TWO ───────────────────────────────────────────────
 *
 * `intake.moderate` opens the queue and decides ordinary proposals. Its own
 * label is "work the queues strangers and members put things into", which is
 * this queue exactly, and it already exists.
 *
 * `quest.approve` is separate and is new. Accepting a quest proposal is the
 * moment somebody types what the work pays, and under the default cap mode the
 * advertised label IS the payout contract. Reading a queue and creating a
 * payout obligation are different powers, and a village should be able to hand
 * out the first without the second.
 *
 * ── WHAT ACCEPTING DOES, WHICH IS NEVER A DIRECT WRITE ───────────────────
 *
 * An accepted org proposal becomes an ORG DRAFT. Not a seat. The draft
 * machinery in server/lib/orgDrafts.ts already has preview, publish in one
 * transaction, and revert from state captured at publish time, and it is the
 * most complete thing in the repository. Accepting into it means a steward
 * gets the preview and the undo for free, and it means this file adds no
 * second write path into the org plane.
 *
 * An accepted quest proposal goes through `questsRepo.add`, the same function
 * POST /api/admin/quests calls.
 *
 * ── NOTHING HERE PUBLISHES, AND THAT BOUNDARY IS LOAD-BEARING ────────────
 *
 * No route in this file calls `publishDraft`, writes `org_roles`, or writes
 * `org_role_assignments`. Accepting produces a draft and stops.
 *
 * That is not tidiness, it is where a governance line falls. Under the model
 * landing in this release, every change to the live Game after the Birthing is
 * a proposal with a veto window, and roles and seats are Game changes.
 * Accepting INTO a draft is a capability holder's act and stays here.
 * PUBLISHING a draft into the live chart once `readGameStart().started` is
 * true has to go through the proposal path, and the direct route has to
 * refuse and redirect the way `PATCH /api/admin/economy/rules/:id` already
 * does after launch.
 *
 * So: if a later change adds a publish call to this file, it needs that
 * launch-state refusal in the same commit. A quest is a different matter and
 * needs none of this, because a quest is activity rather than structure.
 *
 * ── EDIT BEFORE ACCEPT IS THE CENTRE OF THIS, NOT A CONVENIENCE ──────────
 *
 * The server has always re-validated an edited payload at accept and no client
 * has ever sent one. It is the only path by which a proposal naming a person
 * can be redacted before it lands, so the edited payload is what gets written
 * AND what gets stored back on the proposal row: a queue that kept the
 * vendor's original would leave the un-redacted text in the table as the only
 * surviving version.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import {
  markProposalDecided,
  proposalById,
  proposalQueue,
  proposalsInBatch,
  reopenProposalsFor,
  reresolveSubjects,
  unattributedSubjectCount,
  recentDrops,
  type ExternalProposalRow,
} from "../lib/externalProposals";
import {
  addChange,
  createDraft,
  draftChangeCap,
  openDraftCap,
  previewDraft,
  withdrawDraft,
} from "../lib/orgDrafts";
import {
  acceptQuestProposal,
  questProposalQueue,
  rejectQuestProposal,
  type HumanReward,
} from "../lib/questProposals";

type Deps = Pick<
  AppDeps,
  "isAdmin" | "authedUser" | "guardCapability" | "mayAct" | "adminActor" | "getPool" | "members" | "questsRepo"
>;

/** The kinds whose accept builds an org draft. Everything else is a record. */
const ORG_KINDS = new Set(["org.proposed", "role.proposed", "circle.proposed"]);

/** A seat as a proposal may describe it. Nothing here names a holder. */
interface ProposedSeat {
  id?: string;
  name?: string;
  circleId?: string | null;
  aim?: string | null;
  domain?: string | null;
  accountabilities?: string[];
  whyItMatters?: string | null;
  seats?: number;
  criticality?: string;
  recruiting?: boolean;
}

/**
 * The seats a payload describes, whether it carries one or a list.
 *
 * `org.proposed` is a whole structure and `role.proposed` is one seat, and
 * both arrive through the same table. Reading them here rather than in two
 * branches means the field allowlist below is applied once.
 */
function seatsIn(payload: Record<string, unknown>): ProposedSeat[] {
  const raw = Array.isArray(payload.seats) ? payload.seats : [payload];
  return raw.filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s));
}

/**
 * What a proposal is allowed to say about a seat.
 *
 * A SECOND ALLOWLIST, and it is narrower than `SEAT_FIELDS` on purpose. That
 * one governs what a DRAFT may change and is already correct, excluding
 * `represents_circle`, `how_chosen`, `status_override` and
 * `compensation_reality` by construction. This one governs what a PROPOSAL may
 * put into a draft, and the difference is that a founder writing a draft by
 * hand is a person deciding, while everything arriving here was written by
 * something that read a transcript.
 *
 * Nothing is renamed and nothing is coerced: a key not on this list is simply
 * not carried across, and `previewDraft` refuses a change that ends up naming
 * nothing.
 */
const PROPOSABLE_SEAT_FIELDS = [
  "name",
  "circleId",
  "aim",
  "domain",
  "accountabilities",
  "whyItMatters",
  "seats",
  "criticality",
  "recruiting",
] as const;

/**
 * The id a proposed seat gets, which is never the vendor's string as sent.
 *
 * `org_roles.id` DOUBLES AS A URL SLUG AND AS A PATH SEGMENT. The public org
 * export builds filesystem-shaped paths from it and refuses anything that is
 * not `^[a-z0-9][a-z0-9-]{0,63}$`, because there is no legitimate seat called
 * `../../etc/passwd`. That guard is right and it fails CLOSED in the wrong
 * direction for us: a seat whose id a vendor supplied as "Water Steward!"
 * would be created, would render on the map, and would then be silently absent
 * from every federated document forever, with nothing anywhere saying why.
 *
 * So the vendor's id is slugified rather than trusted or refused. Slugified
 * and not dropped, because a batch describing relations between its own seats
 * needs those references to keep pointing at the same rows; and never used raw,
 * because a namespace we do not control has no business minting ids in ours.
 * A string with nothing slug-shaped left in it falls back to one derived from
 * the proposal, which is always a valid slug by construction.
 */
function seatIdFor(vendorId: unknown, fallback: string): string {
  const slug = String(vendorId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) ? slug : fallback;
}

function seatPayload(seat: ProposedSeat): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PROPOSABLE_SEAT_FIELDS) {
    const v = (seat as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** The shape the review page reads. Evidence forward, machinery behind. */
function toCard(p: ExternalProposalRow) {
  return {
    id: p.id,
    batchId: p.batchId,
    moduleId: p.moduleId,
    kind: p.kind,
    payload: p.payload,
    // The Calls tab's grammar: the evidence is a quoted verbatim string and a
    // formatted time, or the card says plainly that there is none.
    quote: p.quote,
    sourceRef: p.sourceRef,
    sourceOccurredAt: p.sourceOccurredAt,
    evidence: p.evidence,
    audience: p.audience,
    trustTier: p.trustTier,
    // Null and not zero. A vendor that did not score its output has said
    // nothing, and the page prints "not stated".
    confidence: p.confidence,
    significance: p.significance,
    subjectRef: p.subjectRef,
    receivedAt: p.receivedAt,
    correlationId: p.correlationId,
  };
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, getPool, members, questsRepo, adminActor } = deps;

  const actorId = async (req: any): Promise<string | null> =>
    (await authedUser(req))?.id ?? adminActor(req)?.id ?? null;

  const activeMembers = async (): Promise<number> => {
    try {
      return ((await members.all()) as any[]).length;
    } catch {
      return 0;
    }
  };

  /**
   * The whole queue, grouped by batch.
   *
   * BATCHES ARE THE UNIT. The first import from an outside service is one
   * screen and one decision, and forty separate cards is the same information
   * arranged so that nobody finishes reading it.
   *
   * `drops` rides along and is the reason an empty queue can be read honestly:
   * without it, "nothing arrived today" and "everything arrived and all of it
   * was refused for carrying an email address" look identical.
   */
  app.get("/api/review/queue", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const pool = getPool();
    const [proposals, quests, drops] = await Promise.all([
      proposalQueue(pool, "proposed"),
      questProposalQueue(pool, "proposed"),
      recentDrops(pool, 30),
    ]);

    const batches = new Map<string, ReturnType<typeof toCard>[]>();
    for (const p of proposals) {
      batches.set(p.batchId, [...(batches.get(p.batchId) ?? []), toCard(p)]);
    }

    res.json({
      batches: Array.from(batches.entries()).map(([batchId, items]) => ({
        batchId,
        moduleId: items[0]?.moduleId ?? null,
        receivedAt: items[0]?.receivedAt ?? null,
        items,
      })),
      quests: quests.map((q) => ({
        id: q.id,
        batchId: q.batchId,
        moduleId: q.moduleId,
        prose: q.prose,
        rationale: q.rationale,
        quote: q.quote,
        sourceRef: q.sourceRef,
        proposedByKind: q.proposedByKind,
        receivedAt: q.receivedAt,
      })),
      drops,
      counts: { proposals: proposals.length, quests: quests.length },
    });
  });

  /**
   * Turn a set of accepted proposals into ONE org draft.
   *
   * ── ONE DRAFT PER DECISION, NOT PER PROPOSAL ────────────────────────────
   *
   * A batch is one proposed reorganisation that happened to arrive as forty
   * rows, and the work order describes the first import as one screen and one
   * decision. Building forty drafts from it would give a steward forty
   * previews, forty publish buttons and forty separate undos for a change they
   * made once, and the org draft machinery's whole promise is that a
   * reorganisation applies or does not apply as a whole.
   *
   * The volume cap falls out of the same choice, and it is the reason this is
   * worth saying twice. A cap counted per draft means nothing if every
   * proposal gets its own, because each draft then holds one change and no
   * draft is ever over. Counted across the decision, it means what it says.
   *
   * NON-ORG KINDS ARE NOT IN THE DRAFT. A risk, a tension, a commitment or a
   * task has no domain table behind it yet, and accepting one means a steward
   * has read it and agrees it is true. Recording that honestly beats inventing
   * a destination for it, and it is why this reports a count of each.
   *
   * THE EDITED PAYLOAD IS WHAT IS USED AND WHAT IS STORED. See the file
   * header: this is the redaction path, and a queue that kept the vendor's
   * original would leave the text a steward removed as the only surviving
   * version of the record.
   *
   * ── ONE LIMIT, STATED RATHER THAN PAPERED OVER ──────────────────────────
   *
   * This is NOT one transaction. `createDraft`, `addChange` and
   * `markProposalDecided` each take a pool and open their own, and giving them
   * a shared connection would mean changing three functions other lanes call.
   * So a process that dies halfway through a batch leaves an OPEN draft
   * carrying some of the seats, with some proposals marked accepted and the
   * rest still in the queue, and accepting the rest afterwards would build a
   * second draft duplicating nothing but describing half the same
   * reorganisation.
   *
   * What makes that survivable rather than silent: the draft is `open`, which
   * means it is inert, previewable and withdrawable, and every seat in it is
   * a `create_seat` that `previewDraft` blocks on an id collision. So the
   * damage is a steward seeing two half-drafts and withdrawing one, and never
   * a village whose chart quietly gained twelve seats twice. Worth fixing when
   * `orgDrafts` grows a connection-taking variant; not worth changing three
   * shared functions for today.
   */
  const acceptInto = async (
    proposals: ExternalProposalRow[],
    edits: Record<string, Record<string, unknown> | null>,
    actor: string,
  ): Promise<
    | { ok: true; draftId: string | null; seats: number; blocked: number; noted: number }
    | { ok: false; error: string }
  > => {
    const roster = await activeMembers();
    const org = proposals.filter((p) => ORG_KINDS.has(p.kind));
    const notes = proposals.filter((p) => !ORG_KINDS.has(p.kind));

    for (const p of notes) {
      await markProposalDecided(getPool(), {
        id: p.id,
        status: "accepted",
        decidedBy: actor,
        editedPayload: edits[p.id] ?? null,
      });
    }
    if (!org.length) return { ok: true, draftId: null, seats: 0, blocked: 0, noted: notes.length };

    const first = org[0];
    const firstPayload = edits[first.id] ?? first.payload;
    const made = await createDraft(getPool(), {
      title: String(firstPayload.title ?? `Proposed by ${first.moduleId}`).slice(0, 200),
      rationale: org.length === 1 ? String(firstPayload.rationale ?? "") || null : null,
      createdBy: actor,
      // The provenance 0143 added. A steward opening this draft next month can
      // see that a machine wrote it and which one, which is what makes
      // revocation by integration mean anything.
      sourceKind: "agent",
      sourceModuleId: first.moduleId,
      sourceProposalId: first.id,
      cites: Array.from(
        new Set(org.flatMap((p) => [p.sourceRef, p.quote]).filter((v): v is string => !!v)),
      ),
      openCap: openDraftCap(roster),
    });
    if (!made.ok) return { ok: false, error: made.error };

    /*
     * EVERY CHANGE FIRST, THEN EVERY DECISION. The two loops are not one loop,
     * and the order is the whole reason.
     *
     * Interleaved, a failure partway through leaves some proposals marked
     * accepted against a draft that does not describe them and the rest still
     * waiting, which is a state no screen can explain and no button can undo.
     * Separated, the worst case is an open draft with fewer changes than it
     * should have and NOT ONE PROPOSAL DECIDED: the steward sees the batch
     * still in the queue, tries again, and the draft they can see is the only
     * thing to tidy.
     *
     * `addChange` refuses only a draft that is not open, and this one was
     * created two lines up, so this is defensive rather than expected. It is
     * written this way because the cost of the ordering is nothing and the
     * cost of being wrong about "cannot happen" is a queue nobody can reason
     * about.
     */
    let seats = 0;
    for (const p of org) {
      const payload = edits[p.id] ?? p.payload;
      for (const seat of seatsIn(payload)) {
        seats += 1;
        const seatId = seatIdFor(seat.id, `orgrole-${p.id.toLowerCase()}-${seats}`);
        const r = await addChange(getPool(), made.id, {
          op: "create_seat",
          orgRoleId: seatId,
          payload: seatPayload(seat),
        });
        if (!r.ok) return { ok: false, error: r.error };
      }
    }
    for (const p of org) {
      await markProposalDecided(getPool(), {
        id: p.id,
        status: "accepted",
        decidedBy: actor,
        createdRef: made.id,
        editedPayload: edits[p.id] ?? null,
      });
    }

    // Previewed here so a steward is never handed a draft that cannot apply.
    // Nothing is written by this and nothing refuses on it: a blocked line is
    // reported back, which is where the steward will read it.
    const preview = await previewDraft(getPool(), made.id, draftChangeCap(roster));

    void recordEvent(getPool(), {
      kind: "org",
      text:
        `${org.length} proposal(s) accepted into draft ${made.id}: ${seats} seat(s)` +
        (preview.blocked ? `, ${preview.blocked} blocked` : ""),
      actorUserId: actor,
      // The ACCEPT is a human act even though a machine wrote the proposal.
      // The row records both: origin_module_id says where it came from, and
      // actor_user_id says who let it in.
      actorKind: "human",
      originModuleId: first.moduleId,
      entityType: "draft",
      entityRef: made.id,
      audience: "admin",
    });

    return { ok: true, draftId: made.id, seats, blocked: preview.blocked, noted: notes.length };
  };

  app.post("/api/review/proposals/:id/accept", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const actor = await actorId(req);
    if (!actor) return res.status(401).json({ error: "auth_required", message: "Accepting a proposal needs a named person" });
    const proposal = await proposalById(getPool(), String(req.params.id));
    if (!proposal) return res.status(404).json({ error: "No such proposal" });
    if (proposal.status !== "proposed") {
      return res.status(409).json({ error: `That proposal was already ${proposal.status}` });
    }
    const edited =
      req.body?.payload && typeof req.body.payload === "object" && !Array.isArray(req.body.payload)
        ? (req.body.payload as Record<string, unknown>)
        : null;
    const r = await acceptInto([proposal], { [proposal.id]: edited }, actor);
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ success: true, createdRef: r.draftId, seats: r.seats, blocked: r.blocked });
  });

  app.post("/api/review/proposals/:id/reject", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const actor = await actorId(req);
    if (!actor) return res.status(401).json({ error: "auth_required", message: "Rejecting a proposal needs a named person" });
    const ok = await markProposalDecided(getPool(), {
      id: String(req.params.id),
      status: "rejected",
      decidedBy: actor,
      // The reasons are the useful half of this queue, and the one thing an
      // outside service cannot get from anywhere else.
      note: String(req.body?.note ?? "").slice(0, 2000),
    });
    if (!ok) return res.status(409).json({ error: "That proposal was already decided" });
    res.json({ success: true });
  });

  /** One decision for a whole batch, after per-item edits. */
  /**
   * Withdraw a draft this queue produced, and put its proposals back.
   *
   * THE DEADLOCK THIS OPENS. A draft carrying any blocked line cannot publish,
   * no change can be removed from an open draft, and until this route nothing
   * could close one, so it held an openDraftCap slot forever. A first import
   * from a vendor reaches that on the ordinary path: everything past
   * draftChangeCap is blocked, and so is any seat naming a circle that does
   * not exist yet, which is what a first org batch looks like.
   *
   * IT LIVES HERE AND NOT BESIDE publish AND revert, which are admin routes,
   * because the person who hits this is the steward who just accepted the
   * batch, and /review is capability-gated rather than admin-gated. Sending
   * them to find an administrator to undo their own last action is how a
   * queue stops being worked. check-admin-reach records the two admin draft
   * routes as deliberately doorless: the org-draft flow has no admin surface,
   * so putting this one there would have made a fix nobody could reach.
   */
  /**
   * How many vendor records this village cannot attribute to anybody, and the
   * action that fixes the ones it now can.
   *
   * A record landed before the subject-reference scheme existed carries a NULL
   * attribution, which was true when it was written and is no longer. Until it
   * is filled in, that record is invisible to its subject's export and to
   * their erasure, which is the same harm as dropping a reference at the door,
   * with a date instead of an array position deciding who it happens to.
   *
   * GET reports. POST changes something. The GET is the "before" number and
   * runs the same resolution without writing, so a steward can see what the
   * button would do before pressing it, and see the number move afterwards.
   * A backfill nobody watched is the thing this was deliberately not made.
   */
  app.get("/api/review/subjects/unattributed", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const total = await unattributedSubjectCount(getPool());
    const dry = await reresolveSubjects(getPool(), { apply: false });
    res.json({ unattributed: total, resolvableNow: dry.resolvable });
  });

  app.post("/api/review/subjects/reresolve", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const actor = await actorId(req);
    if (!actor) return res.status(401).json({ error: "auth_required", message: "This needs a named person" });
    const before = await unattributedSubjectCount(getPool());
    const r = await reresolveSubjects(getPool(), { apply: true });
    const after = await unattributedSubjectCount(getPool());
    void recordEvent(getPool(), {
      kind: "audit",
      text: `subject references re-resolved: ${r.updated} record(s) now attributed, ${after} still not`,
      actorUserId: actor,
      audience: "admin",
    });
    res.json({ before, after, updated: r.updated });
  });
  app.post("/api/review/drafts/:id/withdraw", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const actor = await actorId(req);
    if (!actor) return res.status(401).json({ error: "auth_required", message: "Withdrawing a draft needs a named person" });
    const draftId = String(req.params.id);
    const r = await withdrawDraft(getPool(), draftId);
    if (!r.ok) return res.status(409).json({ error: r.error });
    const reopened = await reopenProposalsFor(getPool(), draftId);
    void recordEvent(getPool(), {
      kind: "org",
      text: `a proposed reorganisation was withdrawn` + (reopened ? `, ${reopened} proposal(s) back in the queue` : ""),
      actorUserId: actor,
      audience: "admin",
    });
    res.json({ success: true, reopened });
  });
  app.post("/api/review/batches/:batchId/accept", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const actor = await actorId(req);
    if (!actor) return res.status(401).json({ error: "auth_required", message: "Accepting a batch needs a named person" });
    const batchId = String(req.params.batchId);
    const rows = (await proposalsInBatch(getPool(), batchId)).filter((p) => p.status === "proposed");
    if (!rows.length) return res.status(404).json({ error: "Nothing in that batch is waiting for a decision" });

    // Per-item edits, keyed by proposal id. An item the steward did not touch
    // is accepted exactly as it arrived.
    const raw: Record<string, unknown> =
      req.body?.edits && typeof req.body.edits === "object" ? req.body.edits : {};
    const edits: Record<string, Record<string, unknown> | null> = {};
    for (const p of rows) {
      const e = raw[p.id];
      edits[p.id] = e && typeof e === "object" && !Array.isArray(e) ? (e as Record<string, unknown>) : null;
    }

    const r = await acceptInto(rows, edits, actor);
    if (!r.ok) return res.status(409).json({ error: r.error });

    res.json({
      success: true,
      accepted: rows.length,
      draftId: r.draftId,
      seats: r.seats,
      // Reported and never swallowed. A blocked line means the draft cannot
      // publish until somebody deals with it, and a steward who is not told
      // finds out at the publish button with no idea why.
      blocked: r.blocked,
      noted: r.noted,
    });
  });

  /**
   * Put a proposed quest on the board.
   *
   * `quest.approve` and not `intake.moderate`, because this is the write that
   * creates a payout obligation. The reward comes from the request body, which
   * means a person typed it, and `acceptQuestProposal` refuses without one.
   */
  app.post("/api/review/quests/:id/accept", async (req, res) => {
    if (!(await guardCapability(req, res, "quest.approve"))) return;
    const actor = await actorId(req);
    if (!actor) return res.status(401).json({ error: "auth_required", message: "Putting a quest on the board needs a named person" });
    const reward: HumanReward = {
      gratitude: String(req.body?.reward?.gratitude ?? ""),
      stayCreditReward: req.body?.reward?.stayCreditReward ?? null,
      minStage: req.body?.reward?.minStage ?? null,
      requiresRole: req.body?.reward?.requiresRole ?? null,
    };
    const r = await acceptQuestProposal(getPool(), questsRepo, {
      id: String(req.params.id),
      decidedBy: actor,
      reward,
      edits: req.body?.edits ?? null,
      note: req.body?.note ?? null,
    });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ success: true, questId: r.questId });
  });

  app.post("/api/review/quests/:id/reject", async (req, res) => {
    if (!(await guardCapability(req, res, "quest.approve"))) return;
    const actor = await actorId(req);
    if (!actor) return res.status(401).json({ error: "auth_required", message: "Rejecting a quest proposal needs a named person" });
    const ok = await rejectQuestProposal(getPool(), {
      id: String(req.params.id),
      decidedBy: actor,
      note: String(req.body?.note ?? "").slice(0, 2000),
    });
    if (!ok) return res.status(409).json({ error: "That proposal was already decided" });
    res.json({ success: true });
  });
}
