/**
 * What `/health` says about a database that did not answer (R116).
 *
 * `/health` is unauthenticated, and a driver's message is not written for a
 * stranger: mysql2's access refusal reads "Access denied for user 'x'@'host'",
 * which names the account and where it connects from. The probe therefore
 * shows the error's CODE, which is what docs/RUNBOOK.md, "Reading /health",
 * tells an operator to look for (`ECONNREFUSED`, `ER_ACCESS_DENIED_ERROR`, a
 * timeout), and the full message stays in the server's own log.
 */
const CODE_SHAPE = /^[A-Z][A-Z0-9_]{2,63}$/;

export function publicDatabaseError(e: unknown): string {
  const code = String((e as { code?: unknown } | null | undefined)?.code ?? "");
  return CODE_SHAPE.test(code) ? code : "the database refused the probe";
}
