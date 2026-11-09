/**
 * IS THE GOVERNANCE CANVAS ON, AND IS CONFLICT EVOLUTION ON? (Rye's module
 * ruling, 2026-10-01.)
 *
 * The routes of both modules sit behind `requireModule` (server/routes/
 * canvasModuleGates.ts). These two answers are for everything that is not a
 * route: the key-moment notices and the canvas moon, the companion's canvas
 * readers and prompt, and the exit policy, whose restorative block the
 * conflict agreement answers only while Conflict Evolution is on.
 *
 * "ON" MEANS OPEN TO MEMBERS: `members` or `public`. Every caller here reaches
 * somebody who is not an admin (a member's bell and digest, the public
 * `/api/exit-policy`, the intake's routing, Departures, the guide's prompt).
 * `requireModule` serves `preview` to admins alone, so a founder trying the
 * canvas in preview must not start sending members notices about a canvas
 * they cannot open (review of 2026-11-05). The launch rows read the module
 * differently on purpose: `appliesWhenModule` in server/lib/launch.ts counts
 * preview, because the launch checklist is an admin surface.
 */
import { CANVAS_MODULE_ID, CONFLICT_EVOLUTION_MODULE_ID } from "../../shared/launchRequirements";
import type { ModuleLifecycle } from "../../shared/modules";
import { effectiveLifecycle } from "./modules";

/** Whether a lifecycle opens a module to members: the only reading these answers use. */
export function openToMembers(lifecycle: ModuleLifecycle): boolean {
  return lifecycle === "members" || lifecycle === "public";
}

export function canvasOn(): boolean {
  return openToMembers(effectiveLifecycle(CANVAS_MODULE_ID));
}

export function conflictEvolutionOn(): boolean {
  return openToMembers(effectiveLifecycle(CONFLICT_EVOLUTION_MODULE_ID));
}
