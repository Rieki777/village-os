/**
 * IS THE GOVERNANCE CANVAS ON, AND IS CONFLICT EVOLUTION ON? (Rye's module
 * ruling, 2026-10-01.)
 *
 * The routes of both modules sit behind `requireModule` (server/routes/
 * canvasModuleGates.ts). These two answers are for everything that is not a
 * route: the key-moment notices and the canvas moon, the companion's canvas
 * readers, and the exit policy, whose restorative block the conflict
 * agreement answers only while Conflict Evolution is on.
 *
 * "On" is any lifecycle but off, which is how the platform reads a module
 * everywhere outside its routes (`moduleIsOn` in server/lib/villageReaders.ts,
 * `appliesWhenModule` in server/lib/launch.ts). A founder setting a module up
 * in preview sees what it will do.
 */
import { CANVAS_MODULE_ID, CONFLICT_EVOLUTION_MODULE_ID } from "../../shared/launchRequirements";
import { effectiveLifecycle } from "./modules";

export function canvasOn(): boolean {
  return effectiveLifecycle(CANVAS_MODULE_ID) !== "off";
}

export function conflictEvolutionOn(): boolean {
  return effectiveLifecycle(CONFLICT_EVOLUTION_MODULE_ID) !== "off";
}
