/**
 * THE STEP ENGINE: how a type's walk is pruned, and how you move along it.
 *
 * Hypha's whole navigation is one line (harvest section 1):
 *
 *     nextStep() { while (steps[stepIndex].skip) stepIndex += 1 }
 *
 * That line is correct forward and wrong backward, which is the bug this file
 * exists to not have: walking BACK across a skipped step with the same loop
 * runs off the front of the array, and clicking a stepper circle with a raw
 * index lands on a step the type does not have. So the walk is expressed once,
 * as the pruned list, and every movement is an index into THAT list.
 *
 * The rule that makes it safe: a stored `stepIndex` (a draft resumed weeks
 * later, possibly after this config changed) is CLAMPED into the pruned walk
 * rather than trusted. A draft that reopens one step early is a small
 * annoyance; one that reopens on a step its type does not have is a blank
 * screen with no way out.
 *
 * Everything here is pure and index-free at the call site: callers hold a
 * StepKey, never a number.
 */
import { WIZARD_STEPS, typeConfig, type StepKey, type TypeStepOverride } from "./wizardConfig";

export interface WalkStep {
  key: StepKey;
  /** The type's own label where it gave one, else the canonical label. */
  label: string;
  intro?: string;
}

/**
 * The steps this type actually walks, in order.
 *
 * An unknown type walks the type step alone: that is the screen where they
 * pick a known one, so an unrecognised draft lands somewhere it can recover
 * from instead of on an empty stepper.
 */
export function walkFor(typeId: string | null | undefined): WalkStep[] {
  const cfg = typeId ? typeConfig(typeId) : null;
  if (!cfg) return [{ key: "type", label: WIZARD_STEPS[0].label }];
  return WIZARD_STEPS.filter((s) => !cfg.steps[s.key]?.skip).map((s) => {
    const over: TypeStepOverride | undefined = cfg.steps[s.key];
    return { key: s.key, label: over?.label ?? s.label, intro: over?.intro };
  });
}

/** The fields this type renders in this step, in order. Empty is legal. */
export function fieldsFor(typeId: string | null | undefined, step: StepKey) {
  const cfg = typeId ? typeConfig(typeId) : null;
  return cfg?.steps?.[step]?.fields ?? [];
}

/** Where a step sits in this type's walk, or -1 when the type skips it. */
export function positionOf(typeId: string | null | undefined, step: StepKey): number {
  return walkFor(typeId).findIndex((s) => s.key === step);
}

/**
 * The step after this one, or null at the end. A step the type does not have
 * answers from the front of the walk rather than from nowhere, so a stale
 * pointer moves the member forward instead of stranding them.
 */
export function nextStep(typeId: string | null | undefined, from: StepKey): StepKey | null {
  const walk = walkFor(typeId);
  const at = walk.findIndex((s) => s.key === from);
  if (at < 0) return walk[0]?.key ?? null;
  return walk[at + 1]?.key ?? null;
}

/** The step before this one, or null at the start. Symmetric with nextStep. */
export function prevStep(typeId: string | null | undefined, from: StepKey): StepKey | null {
  const walk = walkFor(typeId);
  const at = walk.findIndex((s) => s.key === from);
  if (at < 0) return walk[0]?.key ?? null;
  return at === 0 ? null : walk[at - 1].key;
}

/**
 * Resolve a stored index into a step this type really has.
 *
 * Drafts outlive config changes. A negative, oversized or fractional index
 * lands on the nearest real step, and the walk's first step is always the
 * fallback, so continuing a draft can never render nothing.
 */
export function stepAtIndex(typeId: string | null | undefined, index: number): StepKey {
  const walk = walkFor(typeId);
  if (walk.length === 0) return "type";
  const n = Number.isFinite(index) ? Math.trunc(index) : 0;
  return walk[Math.min(Math.max(0, n), walk.length - 1)].key;
}

/** Every problem across every visible step, in walk order. */
export interface WizardProblem {
  step: StepKey;
  field: string;
  label: string;
  message: string;
}

/**
 * Validate the whole walk, not only the step in front of the member.
 *
 * The review step renders this list, and each entry carries the step it came
 * from so the member can jump straight to the field rather than hunting. A
 * field with no `problem` validator is never wrong, which is how optional
 * fields stay optional without a flag.
 */
export function problemsFor(typeId: string | null | undefined, answers: Record<string, unknown>): WizardProblem[] {
  const out: WizardProblem[] = [];
  for (const step of walkFor(typeId)) {
    for (const field of fieldsFor(typeId, step.key)) {
      if (!field.problem) continue;
      const message = field.problem(answers[field.key], answers);
      if (message) out.push({ step: step.key, field: field.key, label: field.label, message });
    }
  }
  return out;
}

/** Problems belonging to one step, for the inline hints as someone types. */
export function problemsInStep(
  typeId: string | null | undefined,
  step: StepKey,
  answers: Record<string, unknown>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of problemsFor(typeId, answers)) {
    if (p.step === step) map.set(p.field, p.message);
  }
  return map;
}

/** True when every step of this type's walk is answered well enough to publish. */
export function readyToPublish(typeId: string | null | undefined, answers: Record<string, unknown>): boolean {
  return !!typeId && !!typeConfig(typeId) && problemsFor(typeId, answers).length === 0;
}
