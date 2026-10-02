/**
 * WHERE A COMMS TRIGGER GOES (the comms build spec sections 2 and 7).
 *
 * The server registers this as the sink's one handler at boot
 * (`commsSink.register(createCommsDispatcher(...))` in server/index.ts), and
 * every lane that acts on a trigger adds its case HERE, never in
 * server/index.ts: event emails (C2), guests and recaps (C3), the time vote
 * (C4), paths (D1). The switch is over the trigger's own union, so a case for
 * a trigger that does not exist is a compile error.
 *
 * TODAY IT DISPATCHES NOWHERE. It notes each trigger at debug level, with the
 * type and never the contents, so a founder watching the log can see the
 * hooks firing before any automation is built on them.
 *
 * Runs after the caller has moved on (server/lib/commsSink.ts), so a handler
 * here may take its time and may fail without undoing anything.
 */
import type { Pool } from "mysql2/promise";
import type { CommsTrigger } from "../../../shared/comms/contracts";
import type { PostOfficeDeps } from "./postOffice";

/** What the lanes that fill this in will reach. Grows one entry per lane. */
export interface CommsDispatchDeps {
  getPool(): Pool;
  postOffice: PostOfficeDeps;
}

export function createCommsDispatcher(_deps: CommsDispatchDeps): (t: CommsTrigger) => Promise<void> {
  return async (t: CommsTrigger): Promise<void> => {
    switch (t.type) {
      default:
        console.debug(`[comms] ${t.type} fired; nothing is listening to it yet`);
    }
  };
}
