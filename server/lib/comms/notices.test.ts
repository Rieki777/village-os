import { describe, expect, it } from "vitest";
import { emailCadenceFor, resolveNotifyPrefs, type NotifyInput } from "../notify";
import { noticeHostRecap, noticePathHandoff } from "./notices";

const capture = () => {
  const sent: NotifyInput[] = [];
  const notify = async (input: NotifyInput) => {
    sent.push(input);
    return { fresh: true, id: `ntf-${sent.length}` };
  };
  return { sent, notify };
};

describe("the comms notices", () => {
  it("asks a path's contact person to write, once per enrollment", async () => {
    const { sent, notify } = capture();
    await noticePathHandoff(notify, { contactUserId: "u-steward", enrollmentId: "enr-1", firstName: "Ana", pathName: "Resident" });
    expect(sent).toEqual([
      {
        userId: "u-steward",
        type: "comms_path_handoff",
        title: "Ana has been on the Resident path for three weeks. Write to them.",
        link: null,
        dedupeKey: "comms_path_handoff:enr-1",
      },
    ]);
  });

  it("asks a host for one evening's recap, keyed by the evening", async () => {
    const { sent, notify } = capture();
    await noticeHostRecap(notify, { hostUserId: "u-host", eventId: "ev-1", occurrenceKey: "2026-10-09", title: "Seed swap", link: "/events" });
    expect(sent[0]).toMatchObject({
      userId: "u-host",
      type: "comms_host_recap",
      link: "/events",
      dedupeKey: "comms_host_recap:ev-1:2026-10-09",
    });
    expect(sent[0].title).toContain("Seed swap");
  });

  it("emails both at once, because each asks a person to act today", () => {
    const prefs = resolveNotifyPrefs({});
    expect(emailCadenceFor("comms_path_handoff", prefs)).toBe("immediate");
    expect(emailCadenceFor("comms_host_recap", prefs)).toBe("immediate");
    // Somebody who turned every email off still means it.
    expect(emailCadenceFor("comms_host_recap", { ...prefs, emailsOff: true })).toBe("off");
  });
});
