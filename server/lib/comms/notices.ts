/**
 * The two notifications Village Comms sends through the spine.
 *
 * Both are a person being asked to do something a machine should not: write
 * to somebody three weeks into a path (docs/comms/BUILD_SPEC.md 5.11), and
 * write a gathering's recap while it is fresh (5.9). The journey engine and
 * the recap lanes call these; they live here, beside the kinds they produce
 * (`comms_path_handoff` and `comms_host_recap` in shared/notificationKinds.ts),
 * so the dedupe key and the words are spelled once.
 *
 * THE KEYS ARE ONE PER MOMENT, never per day. `notifications.dedupe_key` is
 * unique for ever, so a key carrying a date would re-fire forever, and one
 * per enrollment or per gathering evening is exactly as often as a person
 * should be asked.
 *
 * Both are `immediate` in `emailCadenceFor` (server/lib/notify.ts): a person
 * asked to act today is a day late if the ask arrives in tomorrow's digest.
 */
import type { NotifyInput, NotifyResult } from "../notify";

type Notify = (input: NotifyInput) => Promise<NotifyResult>;

/**
 * Ask a path's contact person to write to somebody who has walked it for
 * three weeks. The first name and the path's name are all the notice
 * carries: the address and the rest live on the People screen, which only
 * holders of `comms.manage` and admins can open.
 */
export function noticePathHandoff(
  notify: Notify,
  input: { contactUserId: string; enrollmentId: string; firstName: string; pathName: string; link?: string | null },
): Promise<NotifyResult> {
  return notify({
    userId: input.contactUserId,
    type: "comms_path_handoff",
    title: `${input.firstName} has been on the ${input.pathName} path for three weeks. Write to them.`,
    link: input.link ?? null,
    dedupeKey: `comms_path_handoff:${input.enrollmentId}`,
  });
}

/** Ask a host for the recap of one evening of a gathering. */
export function noticeHostRecap(
  notify: Notify,
  input: { hostUserId: string; eventId: string; occurrenceKey: string; title: string; link?: string | null },
): Promise<NotifyResult> {
  return notify({
    userId: input.hostUserId,
    type: "comms_host_recap",
    title: `${input.title} has ended. Write the recap while it is fresh.`,
    link: input.link ?? null,
    dedupeKey: `comms_host_recap:${input.eventId}:${input.occurrenceKey}`,
  });
}
