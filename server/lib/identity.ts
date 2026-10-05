/**
 * Instance identity (S62): who THIS deployment is, to itself and to peers.
 *
 * Everything cross-instance — the feedback relay, the peer registry, needs &
 * offers, a future network dashboard — needs one stable answer to "which
 * village said that?". A URL is not it (domains change, staging exists) and
 * a name is not it (names are brand overlay, editable any afternoon). So the
 * identity is a UUID minted once, the first time a deployment boots, and
 * never regenerated: the row is INSERT-once and every later boot reads it.
 *
 * Deliberately NOT configurable. An admin-editable instance id would let two
 * deployments claim to be one another; an env var would silently mint a new
 * identity on every fresh container if the operator forgot to pin it. The
 * database row shares the deployment's lifetime, which is exactly the
 * lifetime an identity should have.
 *
 * PLATFORM_VERSION is the platform's semver, distinct from each fork's
 * BUILD_MARKER: the marker says what was deployed and when, the version says
 * which contract the deployment speaks. Peers and the hub compare versions;
 * humans read markers. Bump the MINOR for every additive endpoint/field
 * change, the MAJOR for anything a peer could break on.
 */
import { randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";

/**
 * 1.2.1: no change on the wire. The repository and the image moved to the
 * ReGen Civics organisation; a peer reads exactly what 1.2.0 served.
 *
 * 1.2.0: additive. `/api/platform/info` gained `product`, and `/api/game/config`
 * gained `brochurePages`. Nothing a peer already read changed shape.
 *
 * 1.1.0: additive. `/.well-known/village.json`, `/api/public/org.json` and the
 * `/org/**.md` mirror joined the public surface, and nothing a peer already
 * read changed shape. A peer must still branch on the discovery document's
 * `supports` array and never on this ordering: a fork that turned a module off
 * is not older, it is differently shaped, and semver cannot say that.
 */
export const PLATFORM_VERSION = "1.2.1";

/**
 * What this software is called, for people. NOT the wire identifier: the
 * `platform` string in `/api/platform/info` and in `/.well-known/village.json`
 * stays `custom-game-foundation` forever, because peers (server/lib/network.ts)
 * and the ReGen Civics hub match it exactly, and renaming it would make every
 * older village stop recognising this one.
 */
export const PRODUCT_NAME = "Village OS";

export interface InstanceIdentity {
  /** UUID minted at first boot, stable for the deployment's lifetime. */
  instanceId: string;
  /** ISO timestamp of first boot — how old this village's deployment is. */
  bornAt: string;
}

let cached: InstanceIdentity | null = null;

/** Read-or-mint, idempotent under concurrent boots (INSERT IGNORE + re-read). */
export async function ensureInstanceIdentity(pool: Pool): Promise<InstanceIdentity> {
  if (cached) return cached;
  const fresh = JSON.stringify({ instanceId: randomUUID(), bornAt: new Date().toISOString() });
  await pool.query(
    "INSERT IGNORE INTO app_config (config_key, value) VALUES ('instance-identity', ?)",
    [fresh],
  );
  const [[row]] = await pool.query<any[]>(
    "SELECT value FROM app_config WHERE config_key = 'instance-identity'",
  );
  const doc = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  if (!doc?.instanceId) throw new Error("instance-identity document exists but carries no instanceId, refusing to guess");
  cached = { instanceId: String(doc.instanceId), bornAt: String(doc.bornAt ?? "") };
  return cached;
}

/** Synchronous read for hot paths; boot must have called ensureInstanceIdentity. */
export function instanceIdentity(): InstanceIdentity {
  if (!cached) throw new Error("instance identity read before boot established it");
  return cached;
}
