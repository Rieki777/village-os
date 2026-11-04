/**
 * Which token reaches Sera for which act. Two of them, never mixed:
 *
 *  - the ROUTINE SYNC token (SABERRA_SYNC_TOKEN, an environment variable;
 *    when it is absent the connection's own stored token is used), for the
 *    six tools Sera's "sync" scope allows: list_voice_tasks,
 *    list_quest_proposals, submit_task_feedback, retract_task_feedback,
 *    reassign_voice_task and delete_feedback_for_person;
 *  - the PRIVACY token (SABERRA_PRIVACY_TOKEN, see ./saberraPrivacy), only for
 *    hard delete, export and the identity match, on a steward's click or a
 *    member's own sign-up.
 *
 * Neither value is ever logged, returned or written anywhere. The board is told
 * which token each act uses and whether it is set, nothing more.
 */
import { preflight } from "./saberraSync";
import type { TokenKind, TokenUse } from "@shared/seraBridgeBoard";

type Preflight = ReturnType<typeof preflight>;
import { PRIVACY_ENV, privacyTokenSet } from "./saberraPrivacy";

export const SYNC_ENV = "SABERRA_SYNC_TOKEN";

export function syncTokenSet(): boolean {
  return !!(process.env[SYNC_ENV] ?? "").trim();
}

/** The connection, with the routine sync token in place of the stored one when it is set. */
export function syncPreflight(): Preflight {
  const pre = preflight();
  const token = (process.env[SYNC_ENV] ?? "").trim();
  if (!pre.ok || !token) return pre;
  return { ...pre, client: { ...pre.client, token } };
}

export type { TokenKind, TokenUse };

const SYNC_ACTS = [
  "Read members' tasks (list_voice_tasks)",
  "Read quest proposals (list_quest_proposals)",
  "Send and undo task feedback (submit_task_feedback, retract_task_feedback)",
  "Hand a task to someone else (reassign_voice_task)",
  "Forget a person's feedback (delete_feedback_for_person)",
];
const PRIVACY_ACTS = [
  "Remove a member's tasks in Sera (hard_delete_person_tasks)",
  "Sera's export of a member's tasks",
  "Match a member to their Sera person (keyed hash)",
];

/** Pure over the two flags, so it can be tested without the environment. */
export function tokenUses(syncSet: boolean, connectionSet: boolean, privacySet: boolean): TokenUse[] {
  return [
    ...SYNC_ACTS.map((act) => ({ act, uses: (syncSet ? "sync" : "connection") as TokenKind, set: syncSet || connectionSet })),
    ...PRIVACY_ACTS.map((act) => ({ act, uses: "privacy" as TokenKind, set: privacySet })),
  ];
}

export function currentTokenUses(connectionSet: boolean): TokenUse[] {
  return tokenUses(syncTokenSet(), connectionSet, privacyTokenSet());
}

export { PRIVACY_ENV };
