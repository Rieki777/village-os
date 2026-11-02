/**
 * Whether the outside governance service's agent can answer as a guide here,
 * and why not when it cannot.
 *
 * Rye, 2026-10-24: members choose who they talk to, the village's own guide
 * or the service's agent (shared/guideChoice.ts). A page offers the agent only
 * when a call would actually reach it, because a button that does not work is
 * never drawn. Four things have to hold, and each one missing is named:
 *
 *   module-off      the `saberra` module is not open to members
 *   not-connected   the service's key is not stored and usable here
 *   no-address      no https address for the service is saved
 *   no-guide-call   the village has not been given a call that answers as a
 *                   guide. The connection reads records for the sync and
 *                   nothing yet calls the agent on a member's behalf. What
 *                   that call is was asked of the Operations role on
 *                   2026-10-24, and this stays the answer until it is built.
 *
 * The first three read exactly what the sync reads (server/lib/saberraSync.ts),
 * so this cannot say ready while the sync says not connected.
 */
import { effectiveLifecycle, moduleConfig } from "./modules";
import { readConnection } from "./saberraConnection";
import { secretStatus, villageSecretsConfigured, villageSecretsKeyProblem } from "./secrets";
import { httpsAddress } from "@shared/modules";

const MODULE_ID = "saberra";
const SECRET_KEY = "sera_api_secret";
/** The name the service's agent answers under when the module says none. */
export const SABERRA_AGENT_NAME = "Sera";

export type SaberraGuideGap = "module-off" | "not-connected" | "no-address" | "no-guide-call";

export interface SaberraGuideReach {
  available: boolean;
  /** The first thing missing, or null when the agent can answer. */
  gap: SaberraGuideGap | null;
  name: string;
}

/** The name the agent answers under: the module's own `agentName`, or the default. */
export function saberraAgentName(): string {
  const cfg = (moduleConfig(MODULE_ID) as Record<string, unknown> | null) ?? {};
  return typeof cfg.agentName === "string" && cfg.agentName.trim() ? cfg.agentName.trim() : SABERRA_AGENT_NAME;
}

/**
 * Whether the module is open to members, the first of the four things above.
 * A live session's proposal check (0297, shared/sessionCheck.ts) is offered
 * on this alone: its own read needs no call to the service.
 */
export function saberraOpenToMembers(): boolean {
  const life = effectiveLifecycle(MODULE_ID);
  return life === "members" || life === "public";
}

/** Whether the agent can answer a signed-in member right now. */
export function saberraGuideReach(): SaberraGuideReach {
  const cfg = (moduleConfig(MODULE_ID) as Record<string, unknown> | null) ?? {};
  const name = saberraAgentName();
  const gap: SaberraGuideGap | null =
    !saberraOpenToMembers()
      ? "module-off"
      : !readConnection(secretStatus(SECRET_KEY), villageSecretsConfigured(), villageSecretsKeyProblem()).mayCall
        ? "not-connected"
        : httpsAddress(cfg.apiUrl) === null
          ? "no-address"
          : "no-guide-call";
  return { available: gap === null, gap, name };
}
