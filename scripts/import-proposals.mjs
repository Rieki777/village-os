#!/usr/bin/env -S npx tsx
/**
 * Land a file of vendor proposals, without the vendor's webhook existing yet.
 *
 *   npx tsx scripts/import-proposals.mjs --file batch.json --url "mysql://..."
 *   npx tsx scripts/import-proposals.mjs --file batch.json --apply
 *
 * RUN IT UNDER tsx, NOT plain node. It imports `landProposal` from
 * server/lib/externalProposals.ts, and node cannot resolve a TypeScript module.
 * That is deliberate and it is the whole point of this script: it goes through
 * the SAME code path the webhook will, so a batch that lands here lands the
 * same way in production. A second importer that reimplemented the dedupe,
 * the redaction and the reference resolution would be a second answer to
 * questions that already have one.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `POST /api/webhooks/saberra` is the vendor's to build and does not exist.
 * The landing logic sits BEHIND it and takes a plain object, so nothing about
 * a first import actually depends on the receiver. A vendor can hand over a
 * JSON file and see their whole batch land, be reviewed, be edited and be
 * accepted, before they have written a line of the endpoint.
 *
 * That also makes this an acceptance test for their envelope. If a record is
 * refused here it would have been refused there, for the same reason and with
 * the same wording.
 *
 * ── DRY RUN BY DEFAULT ───────────────────────────────────────────────────
 *
 * Nothing is written without `--apply`. A first import is usually run in front
 * of people, and "here is what would land" is the version you want to read
 * aloud before "here is what landed". The dry run does everything except the
 * insert: it validates the envelope, reports what each record would become,
 * and names every refusal.
 *
 * A dry run CANNOT tell you about duplicates or supersedes, because both are
 * questions about rows that are already in the table, and it writes none. It
 * says so rather than implying a clean slate.
 */
import fs from "node:fs";
import mysql from "mysql2/promise";
import { landProposal, EXTERNAL_PROPOSAL_KINDS, TRUST_TIERS } from "../server/lib/externalProposals";

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const FILE = arg("file");
const URL_ = arg("url", process.env.DATABASE_URL);
const APPLY = has("apply");
const VILLAGE = arg("village", "local");

if (!FILE) {
  console.error("need --file <path to the batch json>");
  process.exit(2);
}
if (!URL_) {
  console.error("need --url or DATABASE_URL");
  process.exit(2);
}

/**
 * The envelope, as the work order specifies it, mapped onto what the landing
 * function takes.
 *
 * THIS FUNCTION IS THE CONTRACT, and it is the reason this script is worth
 * more than a one-off. Everything the vendor sends is named here exactly once,
 * so a field they get wrong shows up as a mapping that reads oddly rather than
 * as a mystery further down. `source_at` on the evidence block is accepted as
 * a fallback for `source_occurred_at`, because the document offers both and a
 * sender will reasonably use either.
 */
function fromEnvelope(e) {
  const ev = e.evidence ?? {};
  return {
    villageId: VILLAGE,
    // The integration's own name. This is the grain revocation works on, so it
    // comes from the record rather than from a flag on this command.
    moduleId: String(e.source ?? "unknown"),
    batchId: String(e.batch_id ?? ""),
    correlationId: e.correlation_id ?? null,
    kind: String(e.type ?? ""),
    payload: e.payload ?? {},
    quote: ev.quote ?? null,
    sourceRef: ev.source_ref ?? null,
    sourceOccurredAt: e.source_occurred_at ?? ev.source_at ?? null,
    // EVERY subject, not the first. This used to take subject_refs[0] and drop
    // the rest silently, which made a record naming two people a record about
    // one of them as far as any subject-keyed path is concerned: the second
    // person's export never found it and their erasure never cleared it. The
    // dropped references were written nowhere, so it was also the version that
    // could not be repaired later.
    subjectRefs: Array.isArray(e.subject_refs) ? e.subject_refs.filter((v) => typeof v === "string") : [],
    subjectRef: Array.isArray(e.subject_refs) ? (e.subject_refs[0] ?? null) : (e.subject_ref ?? null),
    trustTier: e.trust_tier ?? null,
    significance: e.significance ?? null,
    confidence: e.confidence ?? null,
    audience: e.audience === "member" ? "member" : "steward",
  };
}

/** What is obviously wrong before the database is asked. */
function shapeProblem(e, i) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return `record ${i} is not an object`;
  if (!e.type) return `record ${i} has no "type"`;
  if (!EXTERNAL_PROPOSAL_KINDS.includes(String(e.type))) {
    return `record ${i} names kind "${e.type}", which this village does not know. Known: ${EXTERNAL_PROPOSAL_KINDS.join(", ")}`;
  }
  if (!e.batch_id) return `record ${i} has no "batch_id", so a steward cannot review it as a set`;
  if (e.trust_tier && !TRUST_TIERS.includes(String(e.trust_tier))) {
    return `record ${i} names trust tier "${e.trust_tier}". Known: ${TRUST_TIERS.join(", ")}`;
  }
  if (!e.payload || typeof e.payload !== "object") return `record ${i} has no payload object`;
  return null;
}

const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
const records = Array.isArray(raw) ? raw : (raw.proposals ?? raw.records ?? raw.events ?? []);
if (!Array.isArray(records) || records.length === 0) {
  console.error(`${FILE} carries no records. Send an array, or an object with a "proposals" array.`);
  process.exit(2);
}

console.log(`\n${records.length} record(s) from ${FILE}`);
console.log(APPLY ? "APPLYING to the database.\n" : "DRY RUN. Nothing will be written. Add --apply to land it.\n");

const batches = new Map();
for (const e of records) {
  const b = String(e?.batch_id ?? "(none)");
  batches.set(b, (batches.get(b) ?? 0) + 1);
}
for (const [b, n] of batches) console.log(`  batch ${b}: ${n} record(s)`);
console.log("");

const pool = mysql.createPool({ uri: URL_, timezone: "Z", connectionLimit: 4 });
const tally = { stored: 0, duplicate: 0, refused: 0, wouldLand: 0, superseded: 0, nulled: 0 };
let shapeFailures = 0;

try {
  for (let i = 0; i < records.length; i += 1) {
    const e = records[i];
    const problem = shapeProblem(e, i);
    if (problem) {
      console.log(`  REFUSED  ${problem}`);
      shapeFailures += 1;
      continue;
    }
    const input = fromEnvelope(e);
    const label = `${input.kind} ${String(e.event_id ?? "").slice(0, 24) || `#${i}`}`;

    if (!APPLY) {
      // Everything except the write. The refusals that do not need the
      // database are the ones a sender can act on before the call.
      tally.wouldLand += 1;
      const ev = input.quote && input.sourceRef ? "quoted" : input.sourceRef ? "anchored" : "absent";
      const held = ev === "quoted" ? input.audience : "steward";
      console.log(`  would land  ${label}  evidence=${ev} audience=${held}`);
      continue;
    }

    const r = await landProposal(pool, input);
    if (!r.ok) {
      console.log(`  REFUSED  ${label}: ${r.message}`);
      tally.refused += 1;
      continue;
    }
    if (r.outcome === "duplicate") {
      console.log(`  duplicate  ${label} (already here, nothing written)`);
      tally.duplicate += 1;
      continue;
    }
    tally.stored += 1;
    tally.superseded += r.superseded;
    tally.nulled += r.nulled.length;
    const extra = [
      r.superseded ? `superseded ${r.superseded}` : null,
      r.nulled.length ? `cleared unresolved: ${r.nulled.join(", ")}` : null,
    ].filter(Boolean).join(", ");
    console.log(`  stored  ${label}${extra ? `  (${extra})` : ""}`);
  }

  console.log("");
  if (APPLY) {
    console.log(`  stored      ${tally.stored}`);
    console.log(`  duplicate   ${tally.duplicate}`);
    console.log(`  refused     ${tally.refused + shapeFailures}`);
    if (tally.superseded) console.log(`  superseded  ${tally.superseded} earlier row(s) about the same thing`);
    if (tally.nulled) console.log(`  ${tally.nulled} reference(s) this village could not resolve were cleared, and their rows survived`);
    console.log("\n  Open /review to read them.");
  } else {
    console.log(`  would land  ${tally.wouldLand}`);
    console.log(`  refused     ${shapeFailures}  (before the database was asked)`);
    console.log("\n  A dry run cannot tell you about duplicates or supersedes: both are questions");
    console.log("  about rows already in the table, and this wrote none. Re-run with --apply.");
  }
} finally {
  await pool.end();
}

// A refusal is not a crash. The exit code says whether everything landed, so a
// caller can branch on it, and the report above says what did not.
process.exit(tally.refused + shapeFailures > 0 ? 1 : 0);
