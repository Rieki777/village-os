/**
 * WHAT A NEW ACCOUNT MUST CARRY: the password and the name, one spelling for
 * every door that makes or changes an account (readiness R117).
 *
 * The email sign-up door (server/routes/register.ts) took any password, one
 * character included, while `/api/auth/set-password` has asked for 8 all
 * along. The name was stored exactly as sent, untrimmed; the claim door caps
 * a name at 120. The form reads these too (client/src/pages/Register.tsx), so
 * the browser stops a short password before it is sent.
 *
 * PASSWORD_MAX bounds the work: bcrypt reads only the first 72 bytes, and a
 * megabyte "password" would still be read, hashed and held for nothing.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const NAME_MAX = 120;

export const ACCOUNT_WORDS = {
  passwordShort: `Choose a password of at least ${PASSWORD_MIN} characters.`,
  passwordLong: `Choose a password under ${PASSWORD_MAX} characters.`,
  nameNeeded: "Add your name.",
  nameLong: `Keep your name under ${NAME_MAX} characters.`,
} as const;

export type AccountRefusal = { field: "password" | "name"; error: string };

/** Why this password cannot hold an account, or null. Only a string counts. */
export function passwordProblem(raw: unknown): AccountRefusal | null {
  if (typeof raw !== "string" || raw.trim().length < PASSWORD_MIN) return { field: "password", error: ACCOUNT_WORDS.passwordShort };
  if (raw.length > PASSWORD_MAX) return { field: "password", error: ACCOUNT_WORDS.passwordLong };
  return null;
}

/** The name as it is stored, trimmed, or why it cannot be. Only a string counts. */
export function cleanName(raw: unknown): { ok: true; name: string } | { ok: false; refusal: AccountRefusal } {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return { ok: false, refusal: { field: "name", error: ACCOUNT_WORDS.nameNeeded } };
  if (name.length > NAME_MAX) return { ok: false, refusal: { field: "name", error: ACCOUNT_WORDS.nameLong } };
  return { ok: true, name };
}
