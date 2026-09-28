/**
 * The outside governance service, as three routes.
 *
 * ── WHY A PULL AND NOT AN INBOX ──────────────────────────────────────────
 *
 * The obvious build is an endpoint the service POSTs into. That is not what
 * this is, and the reason came from the vendor: their connector is PULLED and
 * never pushes, which is also why their listing declares `on-demand` liveness.
 *
 * Building a push inbox would have meant issuing them an inbound credential,
 * standing up a second authenticated write path into the proposal spine, and
 * owning the question of what happens when somebody else finds it. A
 * steward-triggered pull needs none of that: the credential is ours, it goes
 * outward, and the only person who can make this village fetch anything is a
 * steward who already holds the queue.
 *
 * ── WHAT THE GATE IS AND WHY THIS ONE ────────────────────────────────────
 *
 * `intake.moderate`, the capability that already governs the review queue. A
 * sync produces proposals and nothing else, so the person allowed to cause one
 * is the person who reads them. A new capability would have been five edits
 * across four records in exchange for no additional safety.
 *
 * Reading the vendor's DETAIL is deliberately not gated on that. Rye's reason,
 * 2026-09-24: a member should be able to read what a role actually involves
 * before deciding whether to put their hand up for it. So the module's own
 * lifecycle is the gate there, which is what `requireModule` already enforces
 * at the mount, and no capability sits on top of it.
 *
 * ── WHAT A SYNC DOES NOT DO ──────────────────────────────────────────────
 *
 * It writes no seat, no circle and no seating. It lands proposals, which a
 * steward then reads, edits, accepts or refuses through the queue that already
 * exists. Nothing here shortens that path, and the change limit, the preview
 * and the publish step all apply exactly as they do to any other producer.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { instanceIdentity } from "../lib/identity";
import { landProposal } from "../lib/externalProposals";
import { readConnection } from "../lib/saberraConnection";
import { splitStreams } from "../lib/saberraStreams";
import { callTool, openSession } from "../lib/saberraClient";
import { secretStatus, villageSecretsConfigured } from "../lib/secrets";
import { secretValue } from "../lib/secrets";
import { factsForEntity, moduleFactCount, upsertFacts } from "../repos/moduleFacts";
import type { VendorRecord } from "../lib/saberraProposals";
import type { SaberraRecordKind } from "../lib/saberraRecords";

type Deps = Pick<AppDeps, "guardCapability" | "getPool" | "authedUser">;

const MODULE_ID = "saberra";
const SECRET_KEY = "sera_api_secret";
/** Their own kinds, and the only ones a sync asks for. */
const KINDS: readonly SaberraRecordKind[] = ["circle", "role", "roleAssignment", "tension", "risk"];

/** Their per-village endpoint. A village holds its own, so it is config. */
function baseUrlFrom(config: unknown): string {
  const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const v = typeof c.apiUrl === "string" ? c.apiUrl.trim() : "";
  return v;
}

/**
 * Read one vendor record into the shape the boundary expects, without
 * believing anything about it.
 */
function asVendorRecord(kind: SaberraRecordKind, raw: unknown): VendorRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() !== "" ? r.id.trim() : "";
  if (id === "") return null;
  const fields = r.fields && typeof r.fields === "object" && !Array.isArray(r.fields)
    ? (r.fields as Record<string, unknown>)
    : r;
  const url = typeof r.url === "string" ? r.url : undefined;
  return { id, kind, fields, url };
}

export function register(app: Express, deps: Deps): void {
  const { guardCapability, getPool, authedUser } = deps;

  /**
   * What a steward needs to know before pressing anything: whether this
   * village can reach the service at all, and how much it already holds.
   */
  app.get("/api/saberra/status", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      const connection = readConnection(secretStatus(SECRET_KEY), villageSecretsConfigured());
      const held = await moduleFactCount(getPool(), MODULE_ID);
      res.json({ connection, held });
    } catch {
      res.status(500).json({ error: "Could not read the connection." });
    }
  });

  /**
   * Fetch what the service holds and land it as proposals.
   *
   * Every refusal is NAMED. A sync that answers "nothing happened" is the
   * report that costs an afternoon, so an unreadable reply, a refused call and
   * a genuinely empty village are three different answers here.
   */
  app.post("/api/saberra/sync", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;

    const connection = readConnection(secretStatus(SECRET_KEY), villageSecretsConfigured());
    if (!connection.mayCall) {
      res.status(409).json({ error: connection.sentence, state: connection.state });
      return;
    }
    const token = secretValue(SECRET_KEY);
    const baseUrl = baseUrlFrom((req.body as Record<string, unknown> | undefined)?.config);
    if (!token || baseUrl === "") {
      res.status(409).json({
        error: "This village has no address for the service yet. Set it on the module before syncing.",
        state: "not-connected",
      });
      return;
    }

    const client = { baseUrl, token, fetchImpl: fetch as never };
    const sessionId = await openSession(client);
    if (!sessionId) {
      res.status(502).json({ error: "The service did not open a session. Its address or the key may be wrong." });
      return;
    }

    const records: VendorRecord[] = [];
    const failures: { kind: string; why: string; detail: string }[] = [];
    for (const kind of KINDS) {
      const r = await callTool(client, sessionId, "list_records", { kind, limit: 100 });
      if (!r.ok) {
        failures.push({ kind, why: r.why, detail: r.detail });
        continue;
      }
      for (const raw of r.records) {
        const rec = asVendorRecord(kind, raw);
        if (rec) records.push(rec);
      }
    }

    const reading = splitStreams(records);
    const villageId = instanceIdentity().instanceId;
    const pool = getPool();

    await upsertFacts(
      pool,
      villageId,
      MODULE_ID,
      reading.facts.map((f) => ({
        entityKind: f.vendorKind === "circle" ? "circle" : "org_role",
        entityId: null,
        vendorKind: f.vendorKind,
        vendorRecordId: f.vendorRecordId,
        attachesTo: f.attachesTo,
        fields: f.fields,
        sourceUrl: f.url,
      })),
    );

    const batchId = `sync-${sessionId}`;
    const landed: { kind: string; ok: boolean; reason?: string }[] = [];
    for (const group of reading.structure) {
      for (const rec of group.records) {
        const read = reading.facts.find((f) => f.vendorRecordId === rec.id);
        const result = await landProposal(pool, {
          villageId,
          moduleId: MODULE_ID,
          batchId,
          kind: group.kind,
          payload: { ...(read?.fields ?? {}), vendorRecordId: rec.id },
          sourceRef: rec.url ?? rec.id,
          trustTier: "extracted_unreviewed",
        });
        landed.push(result.ok ? { kind: group.kind, ok: true } : { kind: group.kind, ok: false, reason: result.reason });
      }
    }

    res.json({
      landed: landed.filter((l) => l.ok).length,
      refused: landed.filter((l) => !l.ok),
      facts: reading.facts.length,
      held: reading.held,
      unmapped: reading.unmapped,
      addressesSeen: reading.addressesSeen,
      failures,
    });
  });

  /**
   * What the service holds about one seat or circle, for the panel a member
   * opens before deciding whether to put their hand up.
   *
   * No capability gate on purpose. `requireModule` at the mount is the gate,
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
