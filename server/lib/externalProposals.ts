/**
 * The vendor proposal inbox (0140).
 *
 * An outside service proposes structure. A steward reads it, edits it, and
 * accepts it. Nothing here is a fact about this village until that happens,
 * and nothing in this file writes to a domain table: accepting is somebody
 * else's job and it goes through the same creation function the admin form
 * calls, so every invariant is inherited instead of reimplemented.
 *
 * ── WHAT THIS FILE OWNS ──────────────────────────────────────────────────
 *
 * The two keys, the two refusals, and the landing write. The keys are here
 * rather than at the call site because a dedupe key computed in two places is
 * two dedupe keys, and the whole guarantee is that the same fact hashes the
 * same way whichever route it arrives through.
 *
 * ── THE TWO KEYS, AND WHY ONE IS NOT ENOUGH ──────────────────────────────
 *
 * `dedupeKey` covers (moduleId, kind, sourceRef, normalized claim). It answers
 * "have I already stored this exact thing", and it is the unique index.
 *
 * `identityKey` covers (moduleId, kind, sourceRef) and nothing else. It
 * answers "have I stored a DIFFERENT claim about the same thing", which is
 * what supersede needs. These cannot be one key: a mutated payload has to
 * produce a new dedupe key or the mutation would be swallowed as a duplicate,
 * and it has to produce the SAME identity key or the old row would never be
 * retired.
 *
 * NEITHER IS EVER TAKEN FROM THE WIRE. A vendor's own record id and a vendor's
 * own timestamp both move when the same source is extracted twice, so a key
 * built from either stores the same claim forever under new names. The
 * sentinel for an absent part is the literal string `none`, so a missing
 * source ref and an empty-string source ref cannot land as two rows.
 *
 * ── THE TWO REFUSALS, BOTH COUNTED ───────────────────────────────────────
 *
 * A record carrying an email address anywhere in its body is dropped whole and
 * never stored. Storing it in order to report it would be the leak. A record
 * whose kind is not on the allowlist is dropped the same way, and the
 * allowlist is a constant in this file rather than a database enum precisely
 * so that refusing a new kind costs a pull request and not a migration.
 *
 * Both increment a counter in `external_proposal_drops`, which holds a reason
 * and a number and no vendor content. Without it a steward reading an empty
 * queue cannot tell "nothing arrived" from "everything arrived and all of it
 * was refused", and those are opposite situations.
 *
 * ── AN UNRESOLVABLE REFERENCE NULLS THE FIELD AND KEEPS THE ROW ──────────
 *
 * A proposal asserting a circle id this village does not have is not a bad
 * proposal, it is a proposal about a circle that has been renamed or has not
 * been created yet. Refusing it would throw away the only record of what the
 * vendor believed. The reference is nulled, the field name is reported so the
 * steward can see what was dropped, and the row survives.
 */
import { createHash, randomUUID } from "crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { recordEvent } from "./events";
import { userIdForSubjectRef } from "./subjectRefs";

/**
 * What a vendor may propose. A closed vocabulary, checked in code.
 *
 * `kind` is varchar in the schema on purpose, so that the day a vendor sends
 * something new we can REFUSE it without shipping a migration to thirteen
 * instances first. This array is the refusal.
 */
export const EXTERNAL_PROPOSAL_KINDS = [
  "org.proposed",
  "role.proposed",
  "circle.proposed",
  "task.proposed",
  "quest.proposed",
  /*
   * `event.proposed` LANDS AND IS ACKNOWLEDGED, and does not create a calendar
   * entry. The distinction is deliberate and worth stating where somebody will
   * look for it.
   *
   * Creating an event is an inline admin route rather than an extracted
   * function, so there is nothing an accept could call the way a quest accept
   * calls `questsRepo.add`. Writing the insert here instead would be a second
   * write path into the calendar, which is the one thing this whole surface is
   * built to avoid: two writers of the same table disagree eventually, and the
   * duplicate reward parsers in this repository are what that looks like after
   * a year.
   *
   * So an event proposal behaves like a task or a tension: it lands with its
   * evidence, a steward reads it and agrees it is true, and the decision is
   * recorded. Turning that into a calendar entry is a human act with the admin
   * form open, until somebody extracts a creation function worth calling.
   */
  "event.proposed",
  "risk.observed",
  "tension.observed",
  "commitment.observed",
] as const;
export type ExternalProposalKind = (typeof EXTERNAL_PROPOSAL_KINDS)[number];

/**
 * Three values and not two, and the middle one is the point.
 *
 * A record a vendor's own extraction marked confirmed because a transcript
 * recorded a decision is a different thing to a steward than a record a human
 * approved. Collapsing those two into one "confirmed" would tell a steward
 * that a machine's confidence and a person's signature are the same evidence.
 */
export const TRUST_TIERS = ["extracted_unreviewed", "machine_confirmed", "human_reviewed"] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

/** How well evidenced, computed here and never taken from the wire. */
export type EvidenceLevel = "quoted" | "anchored" | "absent";

export type ProposalStatus = "proposed" | "accepted" | "rejected" | "superseded";

export interface ExternalProposalRow {
  id: string;
  villageId: string;
  moduleId: string;
  batchId: string;
  correlationId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  quote: string | null;
  sourceRef: string | null;
  sourceOccurredAt: string | null;
  subjectRef: string | null;
  trustTier: string;
  significance: number | null;
  /** Null means the vendor did not score it. Readers print "not stated". */
  confidence: number | null;
  evidence: EvidenceLevel;
  audience: "steward" | "member";
  dedupeKey: string;
  identityKey: string;
  status: ProposalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedNote: string | null;
  createdRef: string | null;
  receivedAt: string;
}

/**
 * The separator between hashed parts, and the reason it is not a space.
 *
 * Every part is hashed as text and joined, so a separator that can appear
 * INSIDE a part lets two different inputs produce one string: a module id of
 * "a b" with kind "c" and a module id of "a" with kind "b c" would be the
 * same bytes and therefore the same row. A unit separator cannot appear in a
 * module id, a kind, a source ref or JSON output.
 *
 * Written as an escape rather than as the character itself. It was a literal
 * NUL in the first version of this file, which made grep report the source as
 * a binary file and would have made it invisible to half the tooling in the
 * repository, this project's own guards included.
 */
const SEP = "\u001f";
const ABSENT = "none";

function hash(parts: string[]): string {
  return createHash("sha256").update(parts.join(SEP), "utf8").digest("hex");
}

function part(v: unknown): string {
  if (v === null || v === undefined) return ABSENT;
  const s = String(v).trim();
  return s === "" ? ABSENT : s;
}

/**
 * The claim, reduced to the thing two extractions of the same fact agree on.
 *
 * Keys are sorted at every depth, so a vendor that reorders its JSON does not
 * produce a second row. Strings are trimmed, their inner whitespace collapsed
 * and lowercased, so a re-extraction that changes "Land  Steward" to "land
 * steward" is the same claim. Nothing else is normalised: numbers, booleans
 * and nulls are rendered as themselves, because a vendor changing 3 to 4 has
 * changed the claim and should supersede.
 */
export function normalizeClaim(payload: unknown): string {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.trim().replace(/\s+/g, " ").toLowerCase();
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v ?? null;
  };
  return JSON.stringify(walk(payload) ?? null);
}

export function dedupeKeyFor(input: {
  moduleId: string;
  kind: string;
  sourceRef?: string | null;
  payload: unknown;
}): string {
  return hash([part(input.moduleId), part(input.kind), part(input.sourceRef), normalizeClaim(input.payload)]);
}

export function identityKeyFor(input: { moduleId: string; kind: string; sourceRef?: string | null }): string {
  return hash([part(input.moduleId), part(input.kind), part(input.sourceRef)]);
}

/**
 * An email address anywhere in the body, at any depth, in a value or in a key.
 *
 * Keys are searched as well as values, because a payload shaped
 * `{ "ada@example.org": "land steward" }` carries the address just as surely
 * as one shaped the other way round, and a scanner that reads only values
 * would pass it.
 */
export function containsEmail(v: unknown): boolean {
  const RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const seen = new Set<unknown>();
  const walk = (x: unknown): boolean => {
    if (typeof x === "string") return RE.test(x);
    if (typeof x !== "object" || x === null) return false;
    if (seen.has(x)) return false;
    seen.add(x);
    if (Array.isArray(x)) return x.some(walk);
    for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
      if (RE.test(k)) return true;
      if (walk(val)) return true;
    }
    return false;
  };
  return walk(v);
}

/**
 * Payload keys that name a row somewhere else, and where to look.
 *
 * A fixed map, never built from a payload key, for the same reason
 * `SEAT_FIELDS` in orgDrafts.ts is a fixed map: a key that reaches a table
 * name or a column name is an injection whatever else is true of it.
 */
const REFERENCE_KEYS: Record<string, { table: string; column: string }> = {
  circleId: { table: "circles", column: "id" },
  parentCircleId: { table: "circles", column: "id" },
  orgRoleId: { table: "org_roles", column: "id" },
  seatId: { table: "org_roles", column: "id" },
  requiresRole: { table: "roles", column: "id" },
  questId: { table: "quests", column: "id" },
};

/**
 * Null every reference this village cannot resolve, and say which.
 *
 * The row survives. See the header: a proposal about a circle that was renamed
 * is still the most useful record of what the vendor believed, and refusing it
 * would leave a steward with nothing to correct.
 */
export async function resolveReferences(
  pool: Pool,
  payload: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; nulled: string[] }> {
  const out: Record<string, unknown> = { ...payload };
  const nulled: string[] = [];
  for (const [key, target] of Object.entries(REFERENCE_KEYS)) {
    const raw = out[key];
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 AS ok FROM \`${target.table}\` WHERE \`${target.column}\` = ? LIMIT 1`,
      [String(raw)],
    );
    if (!rows.length) {
      out[key] = null;
      nulled.push(key);
    }
  }
  return { payload: out, nulled };
}

/**
 * Every subject a record names, deduped, in order, with the singular
 * accepted as a one-element list so an older sender keeps working.
 */
export function subjectList(input: { subjectRef?: string | null; subjectRefs?: string[] | null }): string[] {
  const raw = [...(input.subjectRefs ?? []), input.subjectRef];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t === "" || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Quote and anchor, or anchor, or neither. Computed, never sent. */
export function evidenceLevel(quote?: string | null, sourceRef?: string | null): EvidenceLevel {
  const hasQuote = typeof quote === "string" && quote.trim() !== "";
  const hasRef = typeof sourceRef === "string" && sourceRef.trim() !== "";
  if (hasQuote && hasRef) return "quoted";
  if (hasRef) return "anchored";
  return "absent";
}

/**
 * The vendor's clock, in something MySQL will take.
 *
 * THE ENVELOPE SPECIFIES ISO 8601 and a DATETIME column REFUSES IT. Sending
 * "2026-08-14T09:00:00.000Z" straight through raises ER_TRUNCATED_WRONG_VALUE
 * ("Incorrect datetime value"), which means the INSERT throws, the whole
 * proposal is lost, and the vendor gets a 500 for sending exactly what the
 * work order asked them for. Measured against real MySQL, not reasoned about:
 * the ISO form fails and "2026-08-14 09:00:00" succeeds.
 *
 * A Date object is what mysql2 formats correctly, so that is what this hands
 * back. AN UNREADABLE DATE IS NULL AND NEVER A REFUSAL: a proposal whose
 * source timestamp is malformed is still a proposal, and losing the whole
 * record over one field would be the wrong trade every time.
 */
function vendorInstant(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * WHAT AN OVER-LONG FIELD COSTS, and why there are two answers to it.
 *
 * MySQL runs STRICT_TRANS_TABLES by default and refuses an over-long string
 * with ER_DATA_TOO_LONG. Measured, not assumed. So a vendor sending a 500
 * character subtitle into a varchar(300) does not get a truncated subtitle, it
 * gets an exception inside the INSERT, and the WHOLE proposal is lost with a
 * 500 answered to a vendor that did nothing wrong. Every sized column in this
 * schema was that failure until it was tested for.
 *
 * The two answers, and the line between them is what a field is FOR.
 *
 * `clip` is for CONTENT: a quote, a source reference, a subject reference,
 * prose. Losing four hundred characters off the end of a quote is a small
 * loss; losing the record it was evidence for is a large one, and a steward
 * reads the clipped version and can still act on it.
 *
 * `exact` is for IDENTITY: a module id, a batch id, a correlation id. These
 * must NEVER be clipped. A silently shortened batch id merges two batches into
 * one review, and a shortened module id attributes one integration's work to
 * another, which is precisely the attribution this whole table exists to make
 * possible. An over-long one is refused and counted, and the vendor finds out.
 */
function clip(v: unknown, n: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, n);
}

function tooLong(v: unknown, n: number): boolean {
  return v !== null && v !== undefined && String(v).trim().length > n;
}

export interface LandInput {
  villageId: string;
  moduleId: string;
  batchId: string;
  correlationId?: string | null;
  kind: string;
  payload: Record<string, unknown>;
  quote?: string | null;
  sourceRef?: string | null;
  /** The vendor's clock: when the thing actually happened. */
  sourceOccurredAt?: string | null;
  subjectRef?: string | null;
  /**
   * Every person a record is about, in the order the vendor sent them.
   * The work order publishes `subject_refs` as an array and a vendor's
   * ordinary case names more than one: a risk about a named person where
   * only the pattern stays in the record. Taking the first and dropping
   * the rest makes the row invisible to everybody after the first, which
   * their export and their erasure both depend on finding.
   */
  subjectRefs?: string[] | null;
  trustTier?: string | null;
  significance?: number | null;
  confidence?: number | null;
  audience?: "steward" | "member";
}

export type DropReason =
  | "contained_an_email"
  | "unknown_kind"
  | "unknown_trust_tier"
  | "empty_payload"
  | "identifier_too_long";

export type LandResult =
  | {
      ok: true;
      id: string;
      /** `stored` is new, `duplicate` means the same claim was already here. */
      outcome: "stored" | "duplicate";
      /** How many open rows about the same thing this one retired. */
      superseded: number;
      /** Reference fields this village could not resolve, now null on the row. */
      nulled: string[];
    }
  | { ok: false; reason: DropReason; message: string };

const DROP_SENTENCES: Record<DropReason, string> = {
  contained_an_email: "This record carried an email address, so none of it was stored.",
  unknown_kind: "This village does not know that kind of proposal, so nothing was stored.",
  unknown_trust_tier: "That trust tier is not one of the three this village reads.",
  empty_payload: "A proposal with no payload has nothing for a steward to read.",
  identifier_too_long:
    "One of the identifiers on this record is longer than 64 characters. Shortening it here would merge two batches, so nothing was stored.",
};

/** One row per (module, day, reason), incremented. Content-free by design. */
export async function countDrop(
  pool: Pool,
  input: { villageId: string; moduleId: string; reason: DropReason },
): Promise<void> {
  try {
    await pool.query( // module-review-ok: external_proposals has no repo cache above it, and this file is the table's one enumerable home (the ballots.ts pattern)
      "INSERT INTO external_proposal_drops (id, village_id, module_id, on_day, reason, dropped) " +
        "VALUES (?,?,?,CURRENT_DATE,?,1) " +
        "ON DUPLICATE KEY UPDATE dropped = dropped + 1, last_at = CURRENT_TIMESTAMP",
      [`xpdrop-${randomUUID().slice(0, 12)}`, input.villageId, input.moduleId, input.reason],
    );
  } catch (err) {
    // A counter that fails must never turn a refusal into an acceptance, and
    // must never turn one into a 500 either. Same contract recordEvent holds.
    console.error("[externalProposals] could not count a drop", err);
  }
}

/**
 * Take one proposal in, or refuse it and say why.
 *
 * INSERT FIRST, SUPERSEDE SECOND, both inside one transaction. The order is
 * load-bearing: a re-delivery of an identical record must be a no-op, and if
 * superseding ran first it would have retired the very row it then failed to
 * replace, so a vendor's retry would empty the steward's queue.
 */
export async function landProposal(pool: Pool, input: LandInput): Promise<LandResult> {
  const refuse = async (reason: DropReason): Promise<LandResult> => {
    await countDrop(pool, { villageId: input.villageId, moduleId: input.moduleId, reason });
    return { ok: false, reason, message: DROP_SENTENCES[reason] };
  };

  // Identity first, before the payload is even looked at. See the note above
  // `clip`: these are the fields a truncation would corrupt rather than
  // shorten, so an over-long one is a refusal and never a quiet fix.
  if (
    tooLong(input.villageId, 64) ||
    tooLong(input.moduleId, 64) ||
    tooLong(input.batchId, 64) ||
    tooLong(input.correlationId, 64)
  ) {
    return refuse("identifier_too_long");
  }
  if (!(EXTERNAL_PROPOSAL_KINDS as readonly string[]).includes(input.kind)) return refuse("unknown_kind");
  const tier = input.trustTier ?? "extracted_unreviewed";
  if (!(TRUST_TIERS as readonly string[]).includes(tier)) return refuse("unknown_trust_tier");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    return refuse("empty_payload");
  }
  // Before anything is normalised, hashed or written. A scan that ran after
  // the first write would be reporting a leak it had already caused.
  // Every subject, not only the first. A record whose SECOND reference is an
  // email address used to land with that address stored.
  const subjects = subjectList(input);
  if (
    containsEmail(input.payload) ||
    containsEmail(input.quote ?? null) ||
    subjects.some((r) => containsEmail(r))
  ) {
    return refuse("contained_an_email");
  }

  const { payload, nulled } = await resolveReferences(pool, input.payload);
  const evidence = evidenceLevel(input.quote, input.sourceRef);
  // A record with no verbatim quote behind it is never shown to a member,
  // whatever audience the vendor asked for. The house evidence rule, applied
  // at the door instead of at every renderer that might forget it.
  const audience = evidence === "quoted" ? (input.audience ?? "steward") : "steward";

  const dedupeKey = dedupeKeyFor({
    moduleId: input.moduleId,
    kind: input.kind,
    sourceRef: input.sourceRef,
    payload,
  });
  const identityKey = identityKeyFor({
    moduleId: input.moduleId,
    kind: input.kind,
    sourceRef: input.sourceRef,
  });

  const id = `xprop-${randomUUID().slice(0, 12)}`;
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    try {
      await conn.query( // module-review-ok: external_proposals has no repo cache above it, and this file is the table's one enumerable home (the ballots.ts pattern)
        "INSERT INTO external_proposals (id, village_id, module_id, batch_id, correlation_id, kind, payload, " +
          "quote, source_ref, source_occurred_at, subject_ref, trust_tier, significance, confidence, evidence, " +
          "audience, dedupe_key, identity_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          input.villageId,
          input.moduleId,
          input.batchId,
          input.correlationId ?? null,
          input.kind,
          JSON.stringify(payload),
          // Clipped to the columns they land in. `quote` is TEXT, which is
          // 65,535 BYTES rather than characters, so the ceiling is set well
          // under it: a quote is one thing somebody said, and 8,000 characters
          // is already far past that.
          clip(input.quote, 8000),
          clip(input.sourceRef, 400),
          vendorInstant(input.sourceOccurredAt),
          clip(subjects[0] ?? input.subjectRef, 200),
          tier,
          input.significance ?? null,
          input.confidence ?? null,
          evidence,
          audience,
          dedupeKey,
          identityKey,
        ],
      );
    } catch (err: any) {
      if (err?.code !== "ER_DUP_ENTRY") throw err;
      // The same claim, already here. Nothing is superseded and nothing is
      // written: a redelivery is a no-op, which is what makes a vendor safe to
      // retry.
      await conn.rollback();
      const [[existing]] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM external_proposals WHERE dedupe_key = ?",
        [dedupeKey],
      );
      return { ok: true, id: String(existing?.id ?? ""), outcome: "duplicate", superseded: 0, nulled };
    }
    // EVERY SUBJECT, RESOLVED ONCE, THROUGH THE ONE RESOLVER.
    //
    // Resolution happens here and not at read time because a reference that
    // resolves today may name a member who leaves tomorrow, and the answer
    // this village acted on is the one worth keeping. A reference that does
    // not resolve is stored with a NULL member_id, which is an honest
    // 'this village cannot attribute this record' rather than an absence
    // that reads as nobody being named.
    //
    // IT RESOLVES A SUBJECT REFERENCE, NOT A MEMBER ID. This used to read
    // `SELECT id FROM users WHERE id = ?`, which could only ever match if a
    // vendor sent our internal member id, and the whole point of the reference
    // scheme is that they never have it. So it resolved nothing a real vendor
    // would send, and every honest reference landed unattributed.
    //
    // `userIdForSubjectRef` returns null both for a malformed reference and
    // for one that does not resolve, and this caller deliberately does not
    // tell them apart: the difference between "never existed" and "existed
    // and was erased" is itself information about a person.
    //
    // Read on the pool rather than on `conn` on purpose. `subject_refs` is not
    // written by this transaction, so there is nothing here to read back, and
    // going through the shared resolver is worth more than keeping one extra
    // statement inside the transaction.
    for (let i = 0; i < subjects.length; i += 1) {
      const ref = clip(subjects[i], 200);
      if (ref === null) continue;
      const memberId = await userIdForSubjectRef(pool, ref);
      await conn.query( // module-review-ok: this file is the enumerable home of external_proposals and its subject rows, per 0140's note
        "INSERT IGNORE INTO external_proposal_subjects (id, proposal_id, subject_ref, member_id, position) VALUES (?,?,?,?,?)",
        [`eps-${randomUUID().slice(0, 12)}`, id, ref, memberId, i],
      );
    }

    let res: any;
    try {
      [res] = await conn.query( // module-review-ok: external_proposals has no repo cache above it, and this file is the table's one enumerable home (the ballots.ts pattern)
        "UPDATE external_proposals SET status = 'superseded' " +
          "WHERE identity_key = ? AND status = 'proposed' AND dedupe_key <> ?",
        [identityKey, dedupeKey],
      );
      await conn.commit();
    } catch (err) {
      // WITHOUT THIS the connection went back to the pool with an open
      // transaction on it. `finally` releases; it does not roll back, and
      // mysql2 does not do it for you. The next borrower of that connection
      // inherits the uncommitted INSERT and either sees a row nobody
      // committed or deadlocks against it.
      await conn.rollback();
      throw err;
    }
    await conn.commit();
    const superseded = Number(res?.affectedRows ?? 0);

    // The journal line that makes revocation by integration real. `actorKind`
    // says a machine did it and `originModuleId` says WHICH machine, which is
    // the grain a village can actually act on.
    void recordEvent(pool, {
      kind: "external_proposal",
      text: `proposal received: ${input.kind} in batch ${input.batchId}` +
        (superseded ? `, superseding ${superseded}` : "") +
        (nulled.length ? `, unresolved reference(s) cleared: ${nulled.join(", ")}` : ""),
      actorKind: "agent",
      originModuleId: input.moduleId,
      entityType: "external_proposal",
      entityRef: id,
      audience: "admin",
    });

    return { ok: true, id, outcome: "stored", superseded, nulled };
  } finally {
    conn.release();
  }
}

const COLS =
  "id, village_id, module_id, batch_id, correlation_id, kind, payload, quote, source_ref, source_occurred_at, " +
  "subject_ref, trust_tier, significance, confidence, evidence, audience, dedupe_key, identity_key, status, " +
  "decided_by, decided_at, decided_note, created_ref, received_at";

function asJson(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toRow(r: RowDataPacket): ExternalProposalRow {
  return {
    id: String(r.id),
    villageId: String(r.village_id),
    moduleId: String(r.module_id),
    batchId: String(r.batch_id),
    correlationId: r.correlation_id ? String(r.correlation_id) : null,
    kind: String(r.kind),
    payload: asJson(r.payload),
    quote: r.quote ? String(r.quote) : null,
    sourceRef: r.source_ref ? String(r.source_ref) : null,
    sourceOccurredAt: iso(r.source_occurred_at),
    subjectRef: r.subject_ref ? String(r.subject_ref) : null,
    trustTier: String(r.trust_tier),
    significance: num(r.significance),
    confidence: num(r.confidence),
    evidence: (["quoted", "anchored", "absent"] as const).includes(r.evidence) ? r.evidence : "absent",
    audience: r.audience === "member" ? "member" : "steward",
    dedupeKey: String(r.dedupe_key),
    identityKey: String(r.identity_key),
    status: String(r.status) as ProposalStatus,
    decidedBy: r.decided_by ? String(r.decided_by) : null,
    decidedAt: iso(r.decided_at),
    decidedNote: r.decided_note ? String(r.decided_note) : null,
    createdRef: r.created_ref ? String(r.created_ref) : null,
    receivedAt: iso(r.received_at) ?? "",
  };
}

/**
 * What is waiting, oldest batch first.
 *
 * Oldest first and not newest first, which is the opposite of the assistant
 * draft queue and is deliberate. That queue is a conversation a founder is
 * having right now. This one is a backlog, and a backlog read newest-first
 * grows a tail nobody ever reaches.
 */
export async function proposalQueue(
  pool: Pool,
  status: ProposalStatus = "proposed",
  limit = 500,
): Promise<ExternalProposalRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLS} FROM external_proposals WHERE status = ? ORDER BY received_at ASC, id ASC LIMIT ?`,
    [status, Math.max(1, Math.min(1000, limit))],
  );
  return rows.map(toRow);
}

export async function proposalById(pool: Pool, id: string): Promise<ExternalProposalRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${COLS} FROM external_proposals WHERE id = ?`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function proposalsInBatch(pool: Pool, batchId: string): Promise<ExternalProposalRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLS} FROM external_proposals WHERE batch_id = ? ORDER BY received_at ASC, id ASC`,
    [batchId],
  );
  return rows.map(toRow);
}

/**
 * Record the human's decision, and the edited payload when there was one.
 *
 * THE EDITED PAYLOAD IS STORED. A steward who redacted a name out of a
 * proposal before accepting it has done the single most important thing this
 * surface exists for, and a queue that kept the vendor's original and threw
 * away the correction would leave the redacted text in the table as the only
 * version of the record.
 */
export async function markProposalDecided(
  pool: Pool,
  input: {
    id: string;
    status: Extract<ProposalStatus, "accepted" | "rejected">;
    decidedBy: string;
    note?: string | null;
    createdRef?: string | null;
    editedPayload?: Record<string, unknown> | null;
  },
): Promise<boolean> {
  const sets = ["status = ?", "decided_by = ?", "decided_at = CURRENT_TIMESTAMP", "decided_note = ?"];
  const args: unknown[] = [input.status, input.decidedBy, input.note ?? null];
  if (input.createdRef !== undefined) {
    sets.push("created_ref = ?");
    args.push(input.createdRef ?? null);
  }
  if (input.editedPayload) {
    sets.push("payload = ?");
    args.push(JSON.stringify(input.editedPayload));
  }
  args.push(input.id);
  const [res]: any = await pool.query( // module-review-ok: external_proposals has no repo cache above it, and this file is the table's one enumerable home (the ballots.ts pattern)
    `UPDATE external_proposals SET ${sets.join(", ")} WHERE id = ? AND status = 'proposed'`,
    args,
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

export interface DropCount {
  moduleId: string;
  reason: string;
  dropped: number;
  lastAt: string | null;
}

/** What was refused and never stored, so an empty queue can be read honestly. */
export async function recentDrops(pool: Pool, days = 30): Promise<DropCount[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT module_id, reason, SUM(dropped) AS dropped, MAX(last_at) AS last_at FROM external_proposal_drops " +
      "WHERE on_day >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY) GROUP BY module_id, reason ORDER BY dropped DESC",
    [Math.max(1, Math.min(365, days))],
  );
  return rows.map((r) => ({
    moduleId: String(r.module_id),
    reason: String(r.reason),
    dropped: Number(r.dropped ?? 0),
    lastAt: iso(r.last_at),
  }));
}

/**
 * Return every proposal that was accepted into one draft to the queue.
 *
 * The other half of `withdrawDraft`. Accepting marks each proposal 'accepted'
 * and stamps `created_ref` with the draft id, so withdrawing that draft
 * without this would leave those proposals accepted, out of the queue, and
 * pointing at a draft that no longer applies. The steward would have no way
 * back to them and the vendor would have no reason to resend: from their side
 * the records were accepted.
 *
 * Scoped to `status = 'accepted'` so a proposal that was rejected, or
 * superseded by a newer claim while the draft sat open, is left alone.
 */
export async function reopenProposalsFor(pool: Pool, createdRef: string): Promise<number> {
  const [r] = await pool.query<any>(
    "UPDATE external_proposals SET status = 'proposed', decided_by = NULL, decided_at = NULL, " +
      "decided_note = NULL, created_ref = NULL WHERE created_ref = ? AND status = 'accepted'",
    [createdRef],
  );
  return Number(r?.affectedRows) || 0;
}

/**
 * Every vendor record this village can see is about one member.
 *
 * The export half of the leaving-well promise. `GET /api/profile/export` says
 * "everything the village holds about me", and until this existed a vendor
 * record naming somebody, holding a verbatim quote about them, was absent from
 * it. Joined through the subject rows, so a record naming three people is
 * found by all three rather than only the first.
 */
export async function proposalsAboutMember(pool: Pool, memberId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT p.id, p.module_id, p.kind, p.quote, p.source_ref, p.source_occurred_at, p.status, " +
      "p.received_at, s.subject_ref FROM external_proposals p " +
      "JOIN external_proposal_subjects s ON s.proposal_id = p.id WHERE s.member_id = ? " +
      "ORDER BY p.received_at DESC",
    [memberId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    module: String(r.module_id),
    kind: String(r.kind),
    quote: r.quote ? String(r.quote) : null,
    sourceRef: r.source_ref ? String(r.source_ref) : null,
    sourceOccurredAt: r.source_occurred_at ?? null,
    status: String(r.status),
    receivedAt: r.received_at ?? null,
    subjectRef: String(r.subject_ref),
  }));
}

/**
 * Take a departing member out of every vendor record that names them.
 *
 * TWO WRITES, AND THE SECOND IS THE ONE THAT MATTERS. Dropping the subject row
 * de-attributes the record. It does not remove the person from it, and
 * `anonymizeMember` already carries the reason in its own comment: the TEXT
 * restates the person. A verbatim quote is the most restating thing a vendor
 * ever sends, so it goes.
 *
 * The quote is cleared even when the record names somebody else too. A record
 * about two people whose quote is about one of them cannot be half-kept, and
 * between keeping words about a departed member and losing a sentence of
 * context for a record that still has its payload, the promise wins.
 *
 * Returns what it did, because an erasure that reports nothing is the silent
 * all-clear `memberDrivers.ts` was written to prevent.
 */
export async function forgetMemberInProposals(
  pool: Pool,
  memberId: string,
): Promise<{ records: number; quotesCleared: number }> {
  const [about] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT proposal_id FROM external_proposal_subjects WHERE member_id = ?",
    [memberId],
  );
  const ids = about.map((r) => String(r.proposal_id));
  if (!ids.length) return { records: 0, quotesCleared: 0 };

  const holes = ids.map(() => "?").join(",");
  const [q] = await pool.query<any>(
    `UPDATE external_proposals SET quote = NULL WHERE id IN (${holes}) AND quote IS NOT NULL`,
    ids,
  );
  await pool.query("DELETE FROM external_proposal_subjects WHERE member_id = ?", [memberId]); // module-review-ok: external_proposal_subjects has no repo cache above it, and this file is the table's one enumerable home (the ballots.ts pattern)
  return { records: ids.length, quotesCleared: Number(q?.affectedRows) || 0 };
}

/**
 * How many stored records name somebody this village cannot resolve.
 *
 * Not a defect report, a visibility one. A vendor sends its own opaque
 * references and this village can only act on the ones it resolves, so an
 * erasure or an export is complete only with respect to what could be
 * attributed. A count of what could not is the difference between a promise
 * kept and a promise that looks kept.
 */
export async function unattributedSubjectCount(pool: Pool): Promise<number> {
  const [[r]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM external_proposal_subjects WHERE member_id IS NULL",
  );
  return Number(r?.n) || 0;
}

/**
 * Re-resolve subject references that were stored before this village could
 * resolve them, and say exactly what changed.
 *
 * WHY IT IS AN ACTION AND NOT A MIGRATION. Rows landed before the reference
 * scheme existed carry a NULL attribution, which was TRUE at the time: the
 * village genuinely could not say who the record was about. Filling that in
 * later is not rewriting history, because the archival fact is `subject_ref`
 * and this only fills an operational index. But doing it silently, inside a
 * migration, across rows a steward may already have decided on, is the half of
 * the objection that was right. So it is deliberate, counted, and somebody
 * presses it.
 *
 * WHAT IT DOES NOT DO. It never clears an attribution. A row that resolves to
 * nobody today is left exactly as it is, because the reason may be that the
 * member has since been erased and their reference retired, and rewriting that
 * to NULL again would say the same thing while destroying the evidence that it
 * once resolved. Only NULL to a member id, never the reverse.
 *
 * `apply: false` is the "before" number: it counts what WOULD change and
 * writes nothing, so the same call answers "is this worth doing" and "what did
 * it do".
 */
export async function reresolveSubjects(
  pool: Pool,
  opts: { apply: boolean },
): Promise<{ resolvable: number; updated: number }> {
  // ONE SET-BASED STATEMENT, not a lookup per row. The landing path resolves
  // one reference at a time through `userIdForSubjectRef`, which is right
  // there because it resolves exactly one and wants that function's malformed
  // guard. Here the question is asked of every unattributed row at once, and a
  // join answers it identically: a malformed reference simply fails to join,
  // which is the same null the resolver would have returned.
  //
  // It also never clears an attribution. `WHERE member_id IS NULL` is the whole
  // safety property: a row that resolves to nobody today is left as it is,
  // because the reason may be that the member was erased and their reference
  // retired, and rewriting that to NULL would say the same thing while
  // destroying the evidence that it once resolved.
  const sql = opts.apply
    ? "UPDATE external_proposal_subjects eps JOIN subject_refs sr ON sr.ref = eps.subject_ref " +
      "SET eps.member_id = sr.user_id WHERE eps.member_id IS NULL"
    : "SELECT COUNT(*) AS n FROM external_proposal_subjects eps " +
      "JOIN subject_refs sr ON sr.ref = eps.subject_ref WHERE eps.member_id IS NULL";
  const [r] = await pool.query<any>(sql); // module-review-ok: external_proposal_subjects has no repo above it, and this file is that table's one enumerable home, per 0140's note
  const n = opts.apply ? Number(r?.affectedRows) || 0 : Number(r?.[0]?.n) || 0;
  return { resolvable: n, updated: opts.apply ? n : 0 };
}
