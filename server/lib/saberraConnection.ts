/**
 * What to say about this village's connection to the outside service, read off
 * the secret status and nothing else.
 *
 * ── WHY THIS IS NOT A BOOLEAN ────────────────────────────────────────────
 *
 * The obvious build asks `configured` and shows "connected" or "not
 * connected". That is wrong in a way nobody finds by testing the happy path,
 * and the admin lane found it by reading `server/lib/secrets.ts`:
 *
 * When a value IS stored and this process cannot open it, `secretStatus` falls
 * through to the environment branch and answers `configured: false`, which is
 * byte for byte what a village that never set one up answers. The state is
 * carried by `unreadable` instead. That is what a changed or lost
 * `VILLAGE_SECRETS_KEY` produces, and the sealed credential is sitting in the
 * database the whole time.
 *
 * So a founder whose key rotated would be told they never connected, would set
 * a key again, and would still have the old unopenable row underneath. The
 * field's own docblock says the panel needs it "to say the village-secrets key
 * changed instead of silently losing a credential". This is the module obeying
 * that.
 *
 * ── THE STATE THAT IS NOT ABOUT THIS MODULE AT ALL ───────────────────────
 *
 * With no `VILLAGE_SECRETS_KEY` on the deployment, a write REFUSES instead of
 * storing plaintext, and the refusal is an honest 503. A founder finds that
 * out by typing a key and having it bounce. Knowing beforehand is
 * instance-wide information, so the caller passes it in: no secret can be
 * stored on such a deployment, and this module's key is not a special case.
 *
 * A refused write stores nothing, so there is deliberately NO state here for
 * "somebody tried and was refused". Inventing one would mean persisting a
 * record of a write we chose not to perform.
 *
 * Pure: no pool, no clock, no network. The caller hands in what it read.
 */
import type { SecretStatus } from "./secrets";

export type ConnectionState = "ready" | "key-changed" | "cannot-store" | "not-connected";

export interface ConnectionReading {
  state: ConnectionState;
  /** What a steward reads on the module card. */
  sentence: string;
  /**
   * True only when a call could actually carry a credential. `key-changed` is
   * false: a key exists and this process cannot use it.
   */
  mayCall: boolean;
  /**
   * A live exposure, kept separate from the state because it is true alongside
   * a perfectly working connection. A plaintext row is readable in any
   * database dump and is waiting for a boot with the key set.
   */
  finding: "plaintext-at-rest" | null;
}

/**
 * One reading.
 *
 * `canStoreSecrets` is whether this deployment holds a village secrets key at
 * all. It is instance-wide and this module cannot see it, so it arrives as an
 * argument.
 */
export function readConnection(status: SecretStatus, canStoreSecrets: boolean): ConnectionReading {
  const finding = status.atRest === "plaintext" ? ("plaintext-at-rest" as const) : null;

  // FIRST, always. A stored but unopenable key answers `configured: false`, so
  // any check that asks that question first gets this case wrong.
  if (status.unreadable) {
    return {
      state: "key-changed",
      sentence:
        "A key for this service is stored here and this deployment cannot open it. " +
        "That happens when the village secrets key changes. Ask your operator to restore " +
        "the old key, or set this service up again to replace what is stored.",
      mayCall: false,
      finding,
    };
  }

  if (status.configured) {
    const where = status.source === "env" ? "set on the host" : "set in the admin panel";
    const tail = status.last4 ? ` It ends ${status.last4}.` : "";
    return {
      state: "ready",
      sentence: `Connected. The key is ${where}.${tail}`,
      mayCall: true,
      finding,
    };
  }

  // Said BEFORE a founder types a key and eats the refusal, which is the whole
  // reason this arrives as an argument.
  if (!canStoreSecrets) {
    return {
      state: "cannot-store",
      sentence:
        "This deployment has no village secrets key, so no integration key can be stored " +
        "on it at all. Ask your operator to set one before connecting this service.",
      mayCall: false,
      finding,
    };
  }

  return {
    state: "not-connected",
    sentence: "No key is set for this service yet.",
    mayCall: false,
    finding,
  };
}
