/**
 * THE ONE IMPORT DOMAIN CODE USES TO TELL COMMS SOMETHING HAPPENED
 * (docs/comms/BUILD_SPEC.md sections 2 and 4).
 *
 * WHY A SINK. Gatherings, the waitlist, sign-up, profiles, housing, the
 * membrane and the forms all have something to tell the email system, and
 * none of them should know the email system exists. If `rsvp()` imported the
 * journey engine, the engine's imports would come with it into every test of
 * an RSVP, and the arrow would point both ways. So domain code imports this
 * file and nothing under server/lib/comms/, and the server hands the sink its
 * one real handler at boot (server/lib/comms/dispatch.ts). Until then
 * `fire()` is a no-op.
 *
 * THE PROMISE TO THE CALLER, which is the whole contract:
 *
 *   - `fire()` NEVER THROWS. A failure in an email cannot undo a seat that was
 *     taken or a path that was chosen. The caller's change already happened;
 *     the trigger is a trace of it.
 *   - `fire()` NEVER WAITS. The handler runs on `setImmediate`, after the
 *     caller has moved on, so an RSVP answers as fast as it did before comms
 *     existed. The caller fires AFTER its transaction commits, so a rolled-back
 *     change never tells anybody anything.
 *   - Everything the handler throws or rejects is caught and logged with the
 *     trigger's type, and never with its contents: a trigger can carry an
 *     address and a name, and a log line is read by more people than a table.
 */
import type { CommsTrigger } from "../../shared/comms/contracts";

type Handler = (t: CommsTrigger) => Promise<void>;

let handler: Handler | null = null;

function logFailure(t: CommsTrigger, err: unknown): void {
  console.error(`[comms] the ${t?.type ?? "unknown"} trigger was not handled (the change it reports stands)`, err);
}

export const commsSink: { fire(t: CommsTrigger): void; register(handler: Handler): void } = {
  fire(t: CommsTrigger): void {
    try {
      const run = handler;
      if (!run) return;
      setImmediate(() => {
        try {
          Promise.resolve(run(t)).catch((err) => logFailure(t, err));
        } catch (err) {
          logFailure(t, err);
        }
      });
    } catch (err) {
      logFailure(t, err);
    }
  },
  /** The one handler. A second registration replaces the first. */
  register(next: Handler): void {
    handler = next;
  },
};
