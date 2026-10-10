/**
 * Draft-and-confirm (S75): the only way the assistant changes anything.
 *
 * The sharp rule in this file is ESCALATION, and it took a second pass to get
 * right. The first design said "a role draft's capabilities must be a subset of
 * what the accepting admin holds", which sounds like a ceiling and is not one:
 * `hasCapability` short-circuits to true for admins, and the review queue is
 * admin-gated, so every accepter holds everything and the rule constrained
 * nothing at all.
 *
 * What protects a village is making escalation VISIBLE and PER ITEM:
 *
 *   - At draft time the server computes which capabilities no existing role
 *     already grants. Those are the escalations.
 *   - The review UI renders each one as its own checkbox with a plain sentence
 *     about what it lets a holder do. One Accept button on a role quietly
 *     carrying `exchange.manage` is how this goes wrong.
 *   - Accepting with a box unticked STRIPS that capability. It never fails
 *     silently and it never grants what was not ticked.
 *
 * `roles.capabilities` is a JSON column and roles are the platform's
 * appointment mechanism, so "write me a role for the water steward" is
 * otherwise a plausible path to `forum.moderate` and `proposal.decide`.
 */
import { randomUUID } from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { ALL_CAPABILITIES, type Capability } from "../../shared/capabilities";
import { DRAFT_KINDS, validateDraftPayload, type DraftKind } from "../../shared/draftKinds";
import { liveConsequence } from "./capabilityConsequence";

export interface Escalation {
  capability: Capability;
  /** What a holder could do. Written for a founder, never the key. */
  consequence: string;
}

export interface DraftRow {
  id: string;
  batchId: string;
  kind: DraftKind;
  payload: Record<string, unknown>;
  rationale: string;
  cites: string[];
  status: "proposed" | "accepted" | "rejected" | "superseded";
  proposedBy: string;
  proposedAt: string;
  capabilityCeiling: Capability[];
  escalations: Escalation[];
  decidedBy: string | null;
  decidedAt: string | null;
  decidedNote: string | null;
  createdRef: string | null;
}

// ── The pure core ────────────────────────────────────────────────────────────

/**
 * Capabilities this payload asks for that no existing role already grants.
 *
 * A role that carries what three other roles already carry is an ordinary
 * appointment. A role that introduces a power nothing else in the village has
 * is a governance change wearing a job title.
 */
export function computeEscalations(
  requested: readonly string[],
  alreadyGrantedByExistingRoles: readonly string[],
): Escalation[] {
  const held = new Set(alreadyGrantedByExistingRoles);
  return requested
    .filter((c): c is Capability => ALL_CAPABILITIES.includes(c as Capability))
    .filter((c) => !held.has(c))
    .map((capability) => ({ capability, consequence: liveConsequence(capability) }));
}

/**
 * What a draft may ask for at all: the intersection of the platform's
 * capabilities and what the PROPOSER holds. This is a real floor even though
 * the accepter's ceiling is not, because a non-admin drafting surface must not
 * be able to author a role more powerful than its author.
 */
export function capabilityCeiling(proposerHolds: readonly string[]): Capability[] {
  return ALL_CAPABILITIES.filter((c) => proposerHolds.includes(c));
}

export interface AcceptChoice {
  /** Escalated capabilities the human explicitly ticked. */
  grantedEscalations: readonly string[];
}

/**
 * The payload as it will actually be written, after the human's choices.
 *
 * Anything escalated and unticked is removed. An escalation the reviewer never
 * saw (because the list changed between propose and accept) is also removed:
 * silence is never consent here.
 */
export function applyEscalationChoices(
  requested: readonly string[],
  escalations: readonly Escalation[],
  choice: AcceptChoice,
): Capability[] {
  const escalated = new Set(escalations.map((e) => e.capability as string));
  const granted = new Set(choice.grantedEscalations);
  return requested
    .filter((c): c is Capability => ALL_CAPABILITIES.includes(c as Capability))
    .filter((c) => !escalated.has(c) || granted.has(c));
}

export interface DraftCheck {
  kind: string;
  payload: unknown;
  proposerHolds: readonly string[];
}

/** Every check a draft must pass before it is stored. */
export function checkDraft(input: DraftCheck): { ok: true } | { ok: false; error: string } {
  if (!(DRAFT_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, error: `unknown draft kind: ${String(input.kind)}` };
  }
  const shape = validateDraftPayload(input.kind, input.payload);
  if (shape) return { ok: false, error: shape };

  if (input.kind === "role") {
    const requested = ((input.payload as any).capabilities ?? []) as string[];
    const ceiling = new Set(capabilityCeiling(input.proposerHolds) as string[]);
    const over = requested.filter((c) => !ceiling.has(c));
    if (over.length > 0) {
      return { ok: false, error: `this draft asks for capabilities its author does not hold: ${over.join(", ")}` };
    }
  }
  return { ok: true };
}

/**
 * How many role drafts one batch may carry.
 *
 * "Seeding aspirational structure" is on the platform's never-build list, and
 * a conversational role generator is a machine for producing exactly that,
 * faster. Twenty-four seats over eight people is a chart nobody maintains.
 *
 * The floor of 3 exists so a village of one founder can still be given
 * somewhere to start.
 */
export function roleBatchCap(activeMembers: number): number {
  return Math.max(3, activeMembers);
}

// ── Storage ──────────────────────────────────────────────────────────────────

function toDraft(r: RowDataPacket): DraftRow {
  const parse = <T>(v: unknown, fallback: T): T => {
    if (v === null || v === undefined) return fallback;
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as T;
      } catch {
        return fallback;
      }
    }
    return v as T;
  };
  return {
    id: String(r.id),
    batchId: String(r.batch_id),
    kind: String(r.kind) as DraftKind,
    payload: parse<Record<string, unknown>>(r.payload, {}),
    rationale: String(r.rationale),
    cites: parse<string[]>(r.cites, []),
    status: String(r.status) as DraftRow["status"],
    proposedBy: String(r.proposed_by),
    proposedAt: new Date(r.proposed_at).toISOString(),
    capabilityCeiling: parse<Capability[]>(r.capability_ceiling, []),
    escalations: parse<Escalation[]>(r.escalations, []),
    decidedBy: r.decided_by ? String(r.decided_by) : null,
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    decidedNote: r.decided_note ? String(r.decided_note) : null,
    createdRef: r.created_ref ? String(r.created_ref) : null,
  };
}

export interface ProposeInput {
  batchId: string;
  kind: DraftKind;
  payload: Record<string, unknown>;
  rationale: string;
  cites?: string[];
  proposedBy: string;
  proposerHolds: readonly string[];
  /** Capabilities every existing role grants between them. */
  existingRoleCapabilities: readonly string[];
}

export async function proposeDraft(
  pool: Pool,
  input: ProposeInput,
): Promise<{ ok: true; draft: DraftRow } | { ok: false; error: string }> {
  const check = checkDraft(input);
  if (!check.ok) return check;
  const requested = input.kind === "role" ? ((input.payload as any).capabilities ?? []) : [];
  const escalations = computeEscalations(requested, input.existingRoleCapabilities);
  const id = `draft-${randomUUID().slice(0, 12)}`;
  await pool.query(
    "INSERT INTO assistant_drafts (id, batch_id, kind, payload, rationale, cites, proposed_by, capability_ceiling, escalations) " +
      "VALUES (?,?,?,?,?,?,?,?,?)",
    [
      id, input.batchId, input.kind, JSON.stringify(input.payload), input.rationale.slice(0, 4000),
      JSON.stringify(input.cites ?? []), input.proposedBy,
      JSON.stringify(capabilityCeiling(input.proposerHolds)), JSON.stringify(escalations),
    ],
  );
  const draft = await draftById(pool, id);
  if (!draft) return { ok: false, error: "the draft did not save" };
  return { ok: true, draft };
}

export async function draftById(pool: Pool, id: string): Promise<DraftRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM assistant_drafts WHERE id = ?", [id]);
  return rows[0] ? toDraft(rows[0]) : null;
}

export async function draftQueue(pool: Pool, status: DraftRow["status"] = "proposed"): Promise<DraftRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM assistant_drafts WHERE status = ? ORDER BY proposed_at DESC LIMIT 200",
    [status],
  );
  return rows.map(toDraft);
}

/** Record the human's decision. The domain write itself is the caller's job,
 *  through the SAME creation function the admin form uses. */
export async function markDecided(
  pool: Pool,
  input: { id: string; status: "accepted" | "rejected"; decidedBy: string; note?: string | null; createdRef?: string | null },
): Promise<void> {
  await pool.query(
    "UPDATE assistant_drafts SET status = ?, decided_by = ?, decided_at = NOW(), decided_note = ?, created_ref = ? " +
      "WHERE id = ? AND status = 'proposed'",
    [input.status, input.decidedBy, input.note ?? null, input.createdRef ?? null, input.id],
  );
}
