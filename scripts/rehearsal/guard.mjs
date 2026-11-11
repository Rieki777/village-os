/**
 * The rehearsal's two refusals. It walks made-up people through a village and
 * writes as it goes (proposals, decisions, accounts), so it must never be able
 * to reach a real one.
 *
 *   1. The base URL must be a loopback address. Anything else is refused before
 *      a browser starts. The browser contexts also abort every request that
 *      leaves loopback (page.mjs), so a link to a real site is recorded and
 *      never followed.
 *   2. The database must be a scratch schema on a loopback MySQL, named with the
 *      `village_rehearsal` prefix. The run DROPS and recreates it, so a name
 *      that could be an app schema is refused outright.
 *
 * Both are pure functions so rehearsal.test.mjs can hold them to it.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const SCRATCH_PREFIX = "village_rehearsal";

/** True when a URL points at this machine. */
export function isLoopbackUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return LOOPBACK.has(u.hostname);
}

/** Throws unless the rehearsal's base URL is local. */
export function assertLocalBase(raw) {
  if (!isLoopbackUrl(raw)) {
    throw new Error(`refusing to rehearse against ${raw}: the base URL must be localhost or 127.0.0.1`);
  }
}

/**
 * Throws unless `serverUrl` is a loopback MySQL and `schema` is a rehearsal
 * scratch schema. `serverUrl` is the connection string WITHOUT the schema
 * (mysql://user:pass@127.0.0.1:3306).
 */
export function assertScratchDb(serverUrl, schema) {
  let u;
  try {
    u = new URL(serverUrl);
  } catch {
    throw new Error("refusing: the rehearsal database URL does not parse");
  }
  if (u.protocol !== "mysql:") throw new Error("refusing: the rehearsal database must be mysql://");
  if (!LOOPBACK.has(u.hostname)) throw new Error(`refusing: the rehearsal database must be on this machine, got host ${u.hostname}`);
  if (!new RegExp(`^${SCRATCH_PREFIX}(_[a-z0-9]+)*$`).test(schema)) {
    throw new Error(`refusing: the scratch schema must start with ${SCRATCH_PREFIX}, got ${schema}`);
  }
}
