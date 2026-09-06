/**
 * The deletion and export bridge (module library, phase 2).
 *
 * `anonymizeMember` is an exhaustive LOCAL sweep across roughly thirty tables
 * and it signals nothing outward. `GET /api/profile/export` carries a comment
 * saying that "everything the village holds about me" has to mean everything.
 * `shared/constitution.ts` publishes "Leaving well is guaranteed" on a public
 * page. The day an outside service holds a copy of member data all three
 * become false at once, and nothing anywhere goes red.
 *
 * This registry is the seam that keeps them true. A listing that touches
 * member data registers a driver here; the local sweep calls it, the export
 * reads it, and a driver that cannot CONFIRM produces a visible failure.
 *
 * THE FAILURE MODE IS THE DESIGN. Three rules, and none of them is optional:
 *
 *   1. Silence is not confirmation. A driver returns `{confirmed: true}` or
 *      it did not confirm. A throw, a timeout, a 500 and a 200 carrying an
 *      ambiguous body are all the same answer here: not confirmed.
 *   2. A member is never told "deleted" when an outside store did not answer.
 *      The local scrub still runs and still completes, because a village
 *      holding the data one moment longer helps nobody. What changes is what
 *      the member is TOLD: the outcome names every store that has not
 *      confirmed, and the village keeps owing them that confirmation.
 *   3. A partial export says so, in the document. An export that quietly
 *      omits a store a driver could not read is the same defect the comment
 *      on the export route was written about, arriving by a new road.
 *
 * WHAT A DRIVER IS GIVEN, AND WHY IT IS NOT A MEMBER ID. Both methods receive
 * an OPAQUE SUBJECT REFERENCE (`server/lib/subjectRefs.ts`), never our internal
 * member id. The module library contract has promised vendors exactly that
 * since its first revision, and until the reference scheme existed this file
 * quietly did the opposite: it handed `userId` to every driver.
 *
 * The reason this mattered more than it looked is ordering. The first driver
 * ever registered will belong to an outside company, and the shape it takes on
 * that day is the shape every later vendor copies. Changing it after one vendor
 * has stored our member ids is not a refactor, it is a data recall.
 *
 * WHAT IS RECORDED. Every call runs through `callVendor`, so an unconfirmed
 * erasure lands in `integration_health` as a failure with a correlation id,
 * exactly like any other failed outbound call. The caller additionally writes
 * an admin-audience audit event, because an erasure that did not complete is
 * a fact about an obligation and not only about an integration.
 */
import type { Pool } from "mysql2/promise";
import { callVendor } from "./integrations";
import { dropSubjectRef, markErasurePending, subjectRefFor } from "./subjectRefs";

export interface ForgetOutcome {
  confirmed: boolean;
  /** Why not, in one sentence, when it is not confirmed. */
  detail?: string;
}

/**
 * The two methods of the five-method driver interface that the platform calls
 * on a member's behalf. `read`, `write` and `health` belong to the module that
 * owns the domain; these two belong to the member, which is why they live in
 * a registry the member's own routes reach rather than inside a module.
 */
export interface MemberDriver {
  /**
   * Delete this member's data in the outside store and CONFIRM it. Confirming
   * means having checked, not having sent. Contract stage 4 proves this by
   * reading back and getting nothing.
   */
  forgetMember(subjectRef: string): Promise<ForgetOutcome>;
  /** Everything the outside store holds about this member, as plain data. */
  exportMember(subjectRef: string): Promise<unknown>;
}

const drivers = new Map<string, MemberDriver>();

/**
 * Register at boot, once per module. Re-registering the same module id is a
 * wiring bug rather than a hot swap, so it throws: two drivers behind one
 * domain is the exact thing the domain rule refuses.
 */
export function registerMemberDriver(moduleId: string, driver: MemberDriver): void {
  if (drivers.has(moduleId)) {
    throw new Error(`member driver for "${moduleId}" is already registered; one driver per module`);
  }
  drivers.set(moduleId, driver);
}

/** Test seam only. Production registers at boot and never unregisters. */
export function clearMemberDrivers(): void {
  drivers.clear();
}

export function registeredMemberDrivers(): string[] {
  return Array.from(drivers.keys()).sort();
}

export interface ErasureOutcome {
  /** Module ids a driver was asked. Empty means nothing outside holds anything. */
  asked: string[];
  confirmed: string[];
  unconfirmed: Array<{ module: string; detail: string }>;
}

/** True when there is something the village still owes this member. */
export function erasureIncomplete(o: ErasureOutcome): boolean {
  return o.unconfirmed.length > 0;
}

/**
 * One sentence for the member, honest in both directions. Deliberately says
 * what is still outstanding and who is chasing it, and never uses the word
 * deleted about a store that has not answered.
 */
export function erasureSentence(o: ErasureOutcome): string {
  if (o.asked.length === 0) return "Your data is removed from this village. Nothing outside it held a copy.";
  if (o.unconfirmed.length === 0) {
    return `Your data is removed from this village, and ${o.confirmed.length} connected service${o.confirmed.length === 1 ? "" : "s"} confirmed the same.`;
  }
  return (
    `Your data is removed from this village. ${o.unconfirmed.length} connected service${o.unconfirmed.length === 1 ? " has" : "s have"} not confirmed yet, ` +
    "so this village is not finished on your behalf. Your admins can see exactly which, and they keep asking until it is done."
  );
}

/**
 * Ask every registered driver to forget this member. Never throws: one
 * refusing driver must not stop the others being asked, and must not stop the
 * local sweep that runs around this call.
 */
export async function forgetMemberEverywhere(pool: Pool, userId: string): Promise<ErasureOutcome> {
  const out: ErasureOutcome = { asked: registeredMemberDrivers(), confirmed: [], unconfirmed: [] };

  // Nothing outside holds anything, so there is nothing to ask and no reason to
  // keep a reference alive for a conversation that will never happen.
  if (out.asked.length === 0) {
    await dropSubjectRef(pool, userId);
    return out;
  }

  // Issue one if this member has never been referenced. It costs a row that
  // this same call usually deletes again, and it buys the property that every
  // registered driver is ALWAYS asked. Skipping the ask because we believe no
  // vendor could know this member would make the deletion guarantee depend on
  // an invariant holding perfectly everywhere else.
  const ref = await subjectRefFor(pool, userId);

  for (const moduleId of out.asked) {
    const driver = drivers.get(moduleId)!;
    try {
      const r = await callVendor(moduleId, "forgetMember", async () => {
        const answer = await driver.forgetMember(ref);
        // An unconfirmed answer is a FAILED call, so it lands in the health
        // record as one. A driver that returns "no" quietly would otherwise
        // look, to every later reader, exactly like a driver that succeeded.
        if (!answer?.confirmed) throw new Error(answer?.detail || "the service did not confirm the deletion");
        return answer;
      });
      if (r.confirmed) out.confirmed.push(moduleId);
    } catch (e: any) {
      out.unconfirmed.push({ module: moduleId, detail: String(e?.message ?? e).slice(0, 300) });
    }
  }

  // THE MAPPING GOES LAST, AND ONLY WHEN THERE IS NOTHING LEFT TO CHASE.
  //
  // Rule 2 above says the village keeps owing an unconfirmed store that
  // confirmation, and chasing it later means asking about this member again,
  // which needs the reference to still resolve. Dropping it here would leave
  // the village holding an obligation it can no longer name anybody in, which
  // is a worse state than the one rule 2 was written to avoid.
  //
  // So the reference outlives a failed erasure ON PURPOSE, and dies with a
  // complete one.
  if (out.unconfirmed.length === 0) {
    await dropSubjectRef(pool, userId);
  } else {
    // Kept, and RECORDED as kept. An obligation nobody can see is one nobody
    // ends, and the stores that did not answer are named here because a date
    // alone tells a steward the scale and gives them nobody to press.
    await markErasurePending(pool, userId, out.unconfirmed);
  }

  return out;
}

export interface ExternalExport {
  /** Module id to whatever that store returned. */
  stores: Record<string, unknown>;
  /** Stores that could not be read, so the document is honest about being partial. */
  unavailable: Array<{ module: string; detail: string }>;
}

/**
 * Read every registered driver's copy for this member. A store that cannot be
 * read is NAMED in the document. An export that silently drops one is the
 * defect the export route's own comment was written about.
 */
export async function exportMemberEverywhere(pool: Pool, userId: string): Promise<ExternalExport> {
  const out: ExternalExport = { stores: {}, unavailable: [] };
  const moduleIds = registeredMemberDrivers();

  // A village with no connected module issues no reference for a member who
  // simply asked what is held about them.
  if (moduleIds.length === 0) return out;

  const ref = await subjectRefFor(pool, userId);

  for (const moduleId of moduleIds) {
    const driver = drivers.get(moduleId)!;
    try {
      out.stores[moduleId] = await callVendor(moduleId, "exportMember", () => driver.exportMember(ref));
    } catch (e: any) {
      out.unavailable.push({ module: moduleId, detail: String(e?.message ?? e).slice(0, 300) });
    }
  }
  return out;
}
