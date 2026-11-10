/**
 * A DOOR START: the wizard opened from a role card or the roles board, for
 * one kind only (`answers.door`, set by roleApplicationStart). It has no
 * "what kind of decision" step to walk back to, so Back from its first step
 * returns to where the member came from, and the role application asks what
 * the open form asks (Rye, 10 Nov 2026).
 *
 * Its own module, imported by both the step engine and the type config, so
 * neither imports the other.
 */
export function isDoor(answers: Record<string, unknown> | undefined): boolean {
  return answers?.door === true;
}
