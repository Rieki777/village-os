/**
 * THE GOVERNANCE ROWS, CLEARED THE WAY A FOUNDER CLEARS THEM (2026-09-27).
 *
 * For the e2e suites that open a launch vote. Every one of them builds a
 * village whose checklist reads done before it asks the village to start, and
 * the launch checklist gained three blocking rows that no earlier setup
 * satisfied: every canvas block on record, a door for a conflict with a
 * promised reply, and governance open to members. The last is already done by
 * each suite (it turns governance on for members first). This file does the
 * other two through the real routes, so a suite passing here passed the same
 * doors a founder walks through.
 *
 *   recordEveryCanvasBlock   one reading per block, at Absent, with its
 *                            sentence: "not decided yet, because..." is a
 *                            reading, and it is the cheapest honest one.
 *   CONFLICT_DOOR_READY      spread into the exit policy's `restorative` body.
 *                            A named outside contact, which opens the door in
 *                            a village of any size, and a reply time the
 *                            village chose.
 *
 * The refusals themselves are not left unobserved by clearing them here: they
 * are driven row by row in server/lib/launchGovernance.db.test.ts.
 */
import { CANVAS_BLOCK_IDS } from "../../shared/governanceCanvas";

/** The call helper every launch e2e suite defines, as far as this file uses it. */
export type LaunchSuiteCall = (
  method: string,
  route: string,
  opts?: { body?: unknown; token?: string | null },
) => Promise<{ status: number; json: any }>;

/** The three conflict-door fields, answered. Spread into `restorative`. */
export const CONFLICT_DOOR_READY = {
  replyHours: 48,
  outsideContact: { name: "Jo Bell", organisation: "Cohort Care", howToReach: "ombuds@example.test" },
} as const;

/**
 * One reading of every canvas block, as the signed-in founder (who holds the
 * canvas pen before the handover). Throws naming the block on any refusal,
 * so a suite never proceeds on a checklist it believes is clear.
 */
export async function recordEveryCanvasBlock(call: LaunchSuiteCall): Promise<void> {
  for (const blockId of CANVAS_BLOCK_IDS) {
    const r = await call("POST", "/api/canvas/readings", {
      body: {
        blockId,
        level: 1,
        sentence: "Not decided yet, because we have not sat down with it together.",
        moment: "baseline",
      },
    });
    if (r.status !== 201) {
      throw new Error(`recording a reading of "${blockId}" answered ${r.status}: ${JSON.stringify(r.json)}`);
    }
  }
}
