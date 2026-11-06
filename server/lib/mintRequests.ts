/**
 * DECIDING A GRANT THAT WAITS FOR A SECOND STEWARD, BY A STEWARD OR BY THE
 * VILLAGE (vote-path gap 8, Rye 2026-11-06: "EVERYTHING can change with the
 * highest village vote").
 *
 * ── WHAT WAS STUCK ──────────────────────────────────────────────────────────
 *
 * A hand-mint over `ledger.admin_mint_cosign_over` is recorded as a pending
 * `admin_mint_requests` row and waits for a second admin to sign it
 * (`POST /api/admin/mint-requests/:id/approve`). A village with one admin, or
 * with the admin who could sign gone, held a request nobody could ever decide,
 * and the pending amount kept its share of the per-cycle cap until a person
 * acted. So the village can now put the request to a vote.
 *
 * ── THE MONEY LOGIC LIVES HERE, ONCE ────────────────────────────────────────
 *
 * `approveMintRequest` is the body the admin approve route ran, moved here
 * unchanged in what it checks and in what it posts. The admin route and the
 * ballot closer below both call it, so there is one claim, one transfer and
 * one idempotency key (`admin_mint:req:<id>`), whoever decides:
 *
 *   - the claim is taken first, guarded on `status = 'pending'`;
 *   - the tokens move through `postTransfer` under `mintCapGuard`, which
 *     re-reads the per-cycle cap inside the transfer's own lock;
 *   - a refused transfer puts the claim back so the grant can be decided again.
 *
 * The person this pays can never be the person who asked, on either door. The
 * second-steward rule (the signer is somebody other than the asker) is a rule
 * about a SIGNER, so it binds the admin door and has no meaning for a vote: the
 * village is not the asker.
 *
 * ── WHILE THE VILLAGE VOTES, THE ADMIN DOOR WAITS ──────────────────────────
 *
 * A steward signing a grant the village is still voting on would answer the
 * question out from under the roll. So both decisions refuse on the admin door
 * while a ballot on the request is open, the way an org draft under a vote is
 * frozen. Once the vote closes the admin door opens again, and the shared
 * idempotency key means a grant approved on both doors still posts once.
 */
import type { Pool } from "mysql2/promise";
import { dialsForSubject, MINT_REQUEST, thresholdSettingsFrom, thresholdsForSubject } from "../../shared/ballotSubjects";
import { GRATITUDE_ONLY_SENT } from "../../shared/workValue";
import type { CloseRouting, SubjectCloser } from "./applyDue";
import { decisionLink } from "./ballotNotices";
import { openBallot, openBallotFor, type BallotRow } from "./ballots";
import { HEARTS, toLedgerUnits } from "./economy";
import { recordEvent } from "./events";
import { EXAMPLE_REFUSAL_BODY } from "./examples";
import { mintRecipientRefusal } from "./gratitude";
import { memberAccount, postTransfer, tokenDef } from "./ledger";
import { mintCapGuard } from "./mintCap";
import type { BallotSetup } from "./orgDraftDecide";
import { numberVar, stringVar } from "./variables";
import {
  claimForApproval,
  claimForDecline,
  mintRequestById,
  releaseApprovalClaim,
  type MintRequestRow,
} from "../repos/adminMintRequests";

export { MINT_REQUEST };
export type { MintRequestRow };

export interface MintRequestDeps {
  pool: Pool;
  members: {
    byId(id: string): Promise<any | null>;
    update(id: string, mutate: (u: any) => void): Promise<any | null>;
  };
  notify(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    actorUserId?: string | null;
    dedupeKey: string;
  }): Promise<unknown>;
}

export type MintDecision =
  | { ok: true; request: MintRequestRow | null; toBalance?: number }
  | { ok: false; status: number; body: { error: string; code?: string } };

const no = (status: number, error: string, code?: string): MintDecision => ({
  ok: false,
  status,
  body: code ? { code, error } : { error },
});

/** Who a vote decided by, in the 64 characters `decided_by` holds. */
export const villageDecider = (ballotId: string): string => `village:${ballotId}`.slice(0, 64);

const UNDER_A_VOTE =
  "The village is voting on this grant, so it waits for that vote. Read the decision page for where it stands.";

/**
 * Every refusal a grant can meet before anything is claimed, in the order the
 * admin route always asked them. Asked at the put-to-village door too, so a
 * vote is never opened on a grant that could not be signed if it carried.
 */
async function grantRefusal(
  deps: MintRequestDeps,
  request: MintRequestRow,
): Promise<{ refused: MintDecision; target: null } | { refused: null; target: any }> {
  const def = tokenDef(request.tokenSlug);
  if (!def) return { refused: no(404, `unknown token "${request.tokenSlug}"`), target: null };
  if (def.isExample) return { refused: { ok: false, status: 409, body: EXAMPLE_REFUSAL_BODY }, target: null };
  if (def.governance !== "platform") {
    return { refused: no(400, `${request.tokenSlug} is issued on Hypha and cannot be minted here`), target: null };
  }
  // A grant queued before Gratitude stopped being mintable is refused at the second door too.
  if (request.tokenSlug === HEARTS) return { refused: no(400, GRATITUDE_ONLY_SENT), target: null };
  const target = await deps.members.byId(request.toUserId);
  const recipient = mintRecipientRefusal(target);
  if (!target || recipient) {
    return {
      refused: recipient ? { ok: false, status: recipient.status, body: recipient.body } : no(404, "Member not found"),
      target: null,
    };
  }
  // The rule that has no exception: the person this pays cannot be the person
  // who asked for it, whoever signs, and whatever the village votes.
  if (String(target.id) === request.requestedBy) {
    return { refused: no(403, "This grant pays the steward who asked for it. It cannot be signed", "self_grant_refused"), target: null };
  }
  const cap = numberVar("ledger.admin_mint_cycle_cap"); // whole tokens, and only weighed against 0 here
  if (cap <= 0) return { refused: no(403, "Manual minting is disabled (ledger.admin_mint_cycle_cap is 0)"), target: null };
  return { refused: null, target };
}

export interface ApproveInput {
  requestId: string;
  /** Recorded as `decided_by`: the signing admin, or `village:<ballot>`. */
  decidedBy: string;
  /** The admin signing it, held to the second-steward rule. Null for a vote. */
  signer: string | null;
  /** Set when a carried vote is landing it. */
  viaBallotId?: string;
}

/**
 * THE SECOND STEWARD AGREES, OR THE VILLAGE DOES, and the tokens move here and
 * nowhere else.
 *
 * The token, the recipient and the amount all come from the stored row, so
 * what was agreed to is exactly what was asked for. Every guard the raise ran
 * is run again, because a token can be retired, a member can leave, and a
 * village can lower its cap between the asking and the agreeing.
 */
export async function approveMintRequest(deps: MintRequestDeps, input: ApproveInput): Promise<MintDecision> {
  const { pool } = deps;
  const request = await mintRequestById(pool, input.requestId);
  if (!request) return no(404, "No such grant");
  if (request.status !== "pending") return no(409, `This grant is already ${request.status}`);
  if (input.signer !== null && request.requestedBy === input.signer) {
    return no(409, "A second steward means somebody else. You asked for this grant", "second_steward_required");
  }
  if (!input.viaBallotId && (await openBallotFor(pool, MINT_REQUEST, request.id))) return no(409, UNDER_A_VOTE, "under_a_vote");
  const checked = await grantRefusal(deps, request);
  if (checked.refused) return checked.refused;
  const target = checked.target;

  /*
   * CLAIM THE ROW FIRST. Two deciders pressing at the same moment both pass
   * the read above; only one wins this UPDATE. If the transfer then fails, the
   * claim is put back so the grant can be decided again rather than sitting
   * approved with no tokens behind it. The transfer's idempotency key is the
   * request id, so even a retry that raced past this cannot write a second
   * ledger row.
   */
  const note = input.viaBallotId ? "Carried by a village vote." : null;
  if (!(await claimForApproval(pool, request.id, input.decidedBy, note))) {
    return no(409, "This grant has just been decided by somebody else");
  }

  const units = toLedgerUnits(request.tokenSlug, request.amount);
  let r: Awaited<ReturnType<typeof postTransfer>>;
  try {
    r = await postTransfer(pool, {
      from: "sys:mint",
      to: memberAccount(target.id),
      tokenType: request.tokenSlug,
      amount: units,
      source: "admin_mint",
      sourceRef: request.id,
      description: request.reason.slice(0, 500),
      idempotencyKey: `admin_mint:req:${request.id}`,
    }, mintCapGuard(request.tokenSlug, units));
  } catch (e) {
    await releaseApprovalClaim(pool, request.id);
    throw e;
  }
  if (!r.ok) {
    await releaseApprovalClaim(pool, request.id);
    return no(r.error?.includes("mint cap") ? 409 : 400, String(r.error ?? "refused"));
  }
  // Recognition minted by hand still updates the profile's cached balance.
  if (request.tokenSlug === "gratitude") {
    await deps.members.update(target.id, (u: any) => { u.recognitionBalance = r.toBalance; });
  }
  void recordEvent(pool, {
    kind: "audit",
    text: `${input.viaBallotId ? "mint-voted" : "mint-cosigned"}:${request.amount}:${request.tokenSlug}`,
    actorUserId: input.signer,
    entityType: "user",
    entityRef: target.id,
    audience: "admin",
  });
  return { ok: true, request: await mintRequestById(pool, request.id), toBalance: r.toBalance };
}

export interface DeclineInput {
  requestId: string;
  decidedBy: string;
  /** The admin declining it, for the audit line. Null for a vote. */
  actor: string | null;
  note: string | null;
  viaBallotId?: string;
}

/** A steward or the village says no, and the cap gets its room back. */
export async function declineMintRequest(deps: MintRequestDeps, input: DeclineInput): Promise<MintDecision> {
  const { pool } = deps;
  const request = await mintRequestById(pool, input.requestId);
  if (!request) return no(404, "No such grant");
  if (request.status !== "pending") return no(409, `This grant is already ${request.status}`);
  if (!input.viaBallotId && (await openBallotFor(pool, MINT_REQUEST, request.id))) return no(409, UNDER_A_VOTE, "under_a_vote");
  const note = input.note ? input.note.trim().slice(0, 500) || null : null;
  if (!(await claimForDecline(pool, request.id, input.decidedBy, note))) {
    return no(409, "This grant has just been decided by somebody else");
  }
  void recordEvent(pool, {
    kind: "audit",
    text: `${input.viaBallotId ? "mint-voted-down" : "mint-declined"}:${request.amount}:${request.tokenSlug}`,
    actorUserId: input.actor,
    entityType: "user",
    entityRef: request.toUserId,
    audience: "admin",
  });
  return { ok: true, request: await mintRequestById(pool, request.id) };
}

// ── The vote ────────────────────────────────────────────────────────────────

export type PutToVillage =
  | { ok: true; ballot: BallotRow; electorate: string[] }
  | { ok: false; status: number; body: Record<string, unknown> };

const firstNameOf = (m: any): string => String(m?.name ?? "").trim().split(/\s+/)[0] || "a member";

/**
 * Open the vote. The caller has already decided this member may.
 *
 * Every refusal the approval would meet is asked first, so the village is
 * never asked a question whose yes could carry nothing. The cap itself is not
 * pre-checked: it moves with every mint, and the landing re-reads it under the
 * transfer's lock, which is the only reading that counts.
 */
export async function putMintRequestToVillage(
  deps: MintRequestDeps,
  input: { requestId: string; openedBy: string; setup: BallotSetup; at?: Date },
): Promise<PutToVillage> {
  const fail = (status: number, body: Record<string, unknown>): PutToVillage => ({ ok: false, status, body });
  const { pool } = deps;
  const request = await mintRequestById(pool, input.requestId);
  if (!request) return fail(404, { error: "No such grant" });
  if (request.status !== "pending") return fail(409, { error: `This grant is already ${request.status}` });
  const running = await openBallotFor(pool, MINT_REQUEST, request.id);
  if (running) return fail(409, { error: "The village is already voting on this grant.", ballotId: running.id });
  const checked = await grantRefusal(deps, request);
  if (checked.refused) {
    const r = checked.refused as Extract<MintDecision, { ok: false }>;
    return fail(r.status, r.body);
  }
  const { setup } = input;
  if (setup.tokenProblem) return fail(409, { error: setup.tokenProblem });
  // The subject fixes its method (`custom`, so the structural unity is read).
  const method = thresholdsForSubject(MINT_REQUEST)?.method ?? setup.method;
  const dials = dialsForSubject(
    MINT_REQUEST,
    method,
    setup.dials,
    thresholdSettingsFrom((key) => Number(numberVar(key)), (key) => stringVar(key)),
  );
  const tokenName = tokenDef(request.tokenSlug)?.name ?? request.tokenSlug;
  const asker = await deps.members.byId(request.requestedBy);
  const who = firstNameOf(checked.target);
  const title = `A grant of ${request.amount} ${tokenName} to ${who}: the village decides`;
  const doc = [
    `# ${title}`,
    "",
    "## What was asked",
    "",
    `${firstNameOf(asker)} asked for ${request.amount} ${tokenName} to be minted to ${who}. A grant this size waits for a second steward to agree, and the village is deciding it instead.`,
    "",
    "## Why, in the words of the person who asked",
    "",
    request.reason,
    "",
    "## If this carries",
    "",
    `${request.amount} ${tokenName} are minted to ${who}, once, under the village's per-cycle cap on minting. If the cap is full when the vote lands, nothing is minted and the grant waits again.`,
    "",
    "## If it does not carry",
    "",
    "The grant is declined and the cap gets its room back. If too few vote, it keeps waiting.",
    "",
    `Put to the village on ${(input.at ?? new Date()).toISOString().slice(0, 10)}.`,
    "",
  ].join("\n");
  const opened = await openBallot(pool, {
    subjectType: MINT_REQUEST,
    subjectRef: request.id,
    title,
    docMarkdown: doc,
    method,
    weightMode: setup.snapshot.mode,
    weightToken: setup.snapshot.token,
    unityPct: dials.unityPct,
    quorumPct: dials.quorumPct,
    durationDays: setup.durationDays,
    openedBy: input.openedBy,
    electorate: setup.electorate,
  });
  if (!opened.ok) return fail(409, { error: opened.error, ballotId: opened.alreadyOpen?.id ?? null });
  return { ok: true, ballot: opened.ballot, electorate: setup.electorate.map((e) => e.userId) };
}

/**
 * WHAT CLOSING A VOTE ON A GRANT DOES. Written into `SUBJECT_CLOSERS` by
 * server/routes/mintRequestVotes.ts.
 *
 *   carried        `execute` approves it through `approveMintRequest`.
 *   not carried    `settle` declines it, recorded as the village's decision.
 *   too few voted  nothing: the grant keeps waiting, as it did before.
 *
 * IDEMPOTENT. A second `execute` finds the grant approved by THIS ballot and
 * reports it landed without posting; the transfer's idempotency key would
 * refuse a second row anyway. A refusal at landing (the cap is full, the
 * member left, the token was retired) is held with the reason and the claim
 * is put back, never thrown.
 */
export function mintRequestCloser(deps: MintRequestDeps): SubjectCloser {
  const told = async (b: BallotRow, title: string, body: string, key: string, actorId: string) => {
    try {
      await deps.notify({ userId: b.openedBy, type: "governance", title, body, link: decisionLink(b), actorUserId: actorId, dedupeKey: `bal:${b.id}:${key}` });
    } catch (e) {
      console.error("[mint] could not tell the opener how a grant vote ended:", b.id, e);
    }
  };
  return {
    settle: async (b, outcome, outcomeNote, actorId) => {
      const out: CloseRouting = { applied: [], held: null, proposerTold: null };
      if (outcome === "passed") return out;
      out.proposerTold = b.openedBy;
      if (outcome === "no_quorum") {
        await told(b, `Too few of the village voted: ${b.title}`, "Nothing was minted and the grant is still waiting.", "mint-request-quiet", actorId);
        return out;
      }
      const declined = await declineMintRequest(deps, {
        requestId: b.subjectRef,
        decidedBy: villageDecider(b.id),
        actor: null,
        note: `The village voted no. ${outcomeNote}`.trim(),
        viaBallotId: b.id,
      });
      if (!declined.ok) out.held = declined.body.error;
      await told(b, `The village did not carry this one: ${b.title}`, "Nothing was minted. The grant is declined.", "mint-request-declined", actorId);
      return out;
    },
    execute: async (b, actorId) => {
      const out: CloseRouting = { applied: [], held: null, proposerTold: null };
      const before = await mintRequestById(deps.pool, b.subjectRef);
      if (before && before.status === "approved" && before.decidedBy === villageDecider(b.id)) {
        out.applied = [`mint_request:${before.id}`];
        return out;
      }
      const r = await approveMintRequest(deps, {
        requestId: b.subjectRef,
        decidedBy: villageDecider(b.id),
        signer: null,
        viaBallotId: b.id,
      });
      out.proposerTold = b.openedBy;
      if (!r.ok) {
        out.held = `The village carried this and the grant could not be minted: ${r.body.error}`;
        await told(b, `A carried grant could not be minted: ${b.title}`, out.held, "mint-request-held", actorId);
        return out;
      }
      out.applied = [`mint_request:${b.subjectRef}`];
      await told(b, `The village carried this: ${b.title}`, "The grant is minted.", "mint-request-minted", actorId);
      return out;
    },
  };
}
