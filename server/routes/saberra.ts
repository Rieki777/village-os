/**
 * The outside governance service, as three routes.
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
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { instanceIdentity } from "../lib/identity";
import { landProposal } from "../lib/externalProposals";
import { listOrgRoles } from "../lib/orgChart";
import { moduleConfig } from "../lib/modules";
import { MODULES_BY_ID } from "@shared/modules";
import { readConnection } from "../lib/saberraConnection";
import { splitStreams } from "../lib/saberraStreams";
import { proposeStructure } from "../lib/saberraProposals";
import { callTool, openSession } from "../lib/saberraClient";
import { secretStatus, secretValue, villageSecretsConfigured } from "../lib/secrets";
import { factsForEntity, moduleFactCount, upsertFacts } from "../repos/moduleFacts";
import type { VendorRecord } from "../lib/saberraProposals";
import type { SaberraRecordKind } from "../lib/saberraRecords";

type Deps = Pick<AppDeps, "guardCapability" | "getPool" | "authedUser">;

const MODULE_ID = "saberra";
const SECRET_KEY = "sera_api_secret";
/** Their own kinds, and the only ones a sync asks for. */
const KINDS: readonly SaberraRecordKind[] = ["circle", "role", "roleAssignment", "tension", "risk"];
/** `landProposal` refuses an identifier over this, so it is clipped rather than refused. */
const ID_MAX = 64;
/** Their page ceiling. More than this many pages is a village, not a sync. */
const MAX_PAGES = 20;

/**
 * The service's address for THIS village, from the store.
 *
 * An https scheme is required and checked with a real parse, because the
 * village's key is about to be sent to whatever comes back from here.
 */
function serviceUrl(): string | null {
  const cfg = (moduleConfig(MODULE_ID) as Record<string, unknown> | null) ?? {};
  const raw = typeof cfg.apiUrl === "string" ? cfg.apiUrl.trim() : "";
  if (raw === "") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Read one vendor record into the shape the boundary expects, believing nothing. */
function asVendorRecord(kind: SaberraRecordKind, raw: unknown): VendorRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() !== "" ? r.id.trim() : "";
  if (id === "") return null;
  const fields =
    r.fields && typeof r.fields === "object" && !Array.isArray(r.fields)
      ? (r.fields as Record<string, unknown>)
      : r;
  const url = typeof r.url === "string" ? r.url : undefined;
  return { id, kind, fields, url };
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function register(app: Express, deps: Deps): void {
  const { guardCapability, getPool, authedUser } = deps;

  /** What a steward needs before pressing anything. */
  app.get("/api/saberra/status", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      const connection = readConnection(secretStatus(SECRET_KEY), villageSecretsConfigured());
      const held = await moduleFactCount(getPool(), MODULE_ID);
      res.json({ connection, held, addressSet: serviceUrl() !== null });
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
    const baseUrl = serviceUrl();
    if (!token || !baseUrl) {
      res.status(409).json({
        error: "This village has no https address for the service yet. Set it on the module before syncing.",
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
    const truncated: string[] = [];
    for (const kind of KINDS) {
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r = await callTool(client, sessionId, "list_records", {
          kind,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        if (!r.ok) {
          failures.push({ kind, why: r.why, detail: r.detail });
          break;
        }
        for (const raw of r.records) {
          const rec = asVendorRecord(kind, raw);
          if (rec) records.push(rec);
        }
        cursor = r.cursor;
        pages += 1;
        // A cursor still in hand at the ceiling means we stopped early, and a
        // steward is told rather than handed a smaller number as a success.
        if (cursor && pages >= MAX_PAGES) {
          truncated.push(kind);
          break;
        }
      } while (cursor);
    }

    const pool = getPool();
    const reading = splitStreams(records);
    const villageId = instanceIdentity().instanceId;

    /*
     * ATTACH EACH FACT TO A SEAT THIS VILLAGE ALREADY HAS, by the name the
     * vendor used. Unresolved is a real state and stays null: a seat we have
     * not created yet is exactly what a proposal is for.
     */
    const liveRoles = await listOrgRoles(pool);
    const seatIdFor = (name: string | null): string | null => {
      if (!name) return null;
      const hit = liveRoles.find((r) => sameName(String(r.name ?? ""), name));
      return hit ? String(hit.id) : null;
    };

    await upsertFacts(
      pool,
      villageId,
      MODULE_ID,
      reading.facts.map((f) => {
        const isCircle = f.vendorKind === "circle";
        return {
          entityKind: isCircle ? "circle" : "org_role",
          entityId: isCircle ? null : seatIdFor(f.attachesTo),
          vendorKind: f.vendorKind,
          vendorRecordId: f.vendorRecordId,
          attachesTo: f.attachesTo,
          fields: f.fields,
          sourceUrl: f.url,
        };
      }),
    );

    /*
     * ONE `org.proposed` FOR THE WHOLE STRUCTURE, built by the translator.
     *
     * An earlier version landed each role as its own proposal carrying the
     * vendor's raw keys. `readProposedSeats` looks for `name`, `circleName` and
     * the rest, so every one of those arrived with no name and an unreadable
     * circle, and a steward could not have accepted any of them. The translator
     * existed the whole time and nothing called it.
     */
    const batchId = `sync-${sessionId}`.slice(0, ID_MAX);
    const sourceName = MODULES_BY_ID[MODULE_ID]?.name ?? "the connected service";
    const landed: { kind: string; ok: boolean; reason?: string }[] = [];

    const roleRecords = records.filter((r) => r.kind === "role");
    if (roleRecords.length > 0) {
      const structure = proposeStructure(roleRecords, { sourceName });
      if (structure.payload.seats.length > 0) {
        const r = await landProposal(pool, {
          villageId,
          moduleId: MODULE_ID,
          batchId,
          kind: structure.kind,
          payload: structure.payload,
          trustTier: "extracted_unreviewed",
        });
        landed.push(r.ok ? { kind: structure.kind, ok: true } : { kind: structure.kind, ok: false, reason: r.reason });
      }
    }

    // Tensions and risks land one apiece: each is a separate thing observed,
    // and the queue shows them as notes rather than as chart changes.
    for (const group of reading.structure) {
      if (group.kind === "org.proposed") continue;
      for (const rec of group.records) {
        const fact = reading.facts.find((f) => f.vendorRecordId === rec.id);
        const r = await landProposal(pool, {
          villageId,
          moduleId: MODULE_ID,
          batchId,
          kind: group.kind,
          payload: { ...(fact?.fields ?? {}), vendorRecordId: rec.id },
          sourceRef: (rec.url ?? rec.id).slice(0, 400),
          trustTier: "extracted_unreviewed",
        });
        landed.push(r.ok ? { kind: group.kind, ok: true } : { kind: group.kind, ok: false, reason: r.reason });
      }
    }

    res.json({
      landed: landed.filter((l) => l.ok).length,
      refused: landed.filter((l) => !l.ok),
      facts: reading.facts.length,
      attached: reading.facts.filter((f) => f.vendorKind !== "circle" && seatIdFor(f.attachesTo)).length,
      held: reading.held,
      unmapped: reading.unmapped,
      addressesSeen: reading.addressesSeen,
      truncated,
      failures,
    });
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
