/**
 * The restorative intake's rules that need no database: who it reaches, what
 * each notice says, and what the email for this kind is allowed to carry.
 *
 * The email half drives the REAL spine (`insertNotification` in ./notify.ts)
 * over a fake pool and a fake mailer, so the assertion is about the HTML the
 * spine actually builds rather than about a flag. Every "carries nothing" check
 * sits beside a check that something WAS sent, because an absence asserted over
 * an email that never went out passes for the wrong reason.
 *
 * The end-to-end half, against the built server and a captured Resend request,
 * is the RESTORATIVE INTAKE block in server/loop.e2e.test.ts.
 */
import { describe, expect, it } from "vitest";
import { emailCarriesBody, insertNotification, READ_IN_THE_BELL, type NotifyDeps, type NotifyInput } from "./notify";
import { liveHolderCount } from "./roleGrants";
import {
  INTAKE_LINK,
  INTAKE_MAX_CHARS,
  INTAKE_TITLE,
  intakeNotice,
  intakeRoleNamed,
  liveIntakeRecipients,
  sendRestorativeIntake,
  type IntakeDeps,
  type IntakeHolding,
} from "./restorativeIntake";

const NOW = new Date("2026-09-24T12:00:00Z");
const PAST = "2026-09-01T00:00:00Z";
const FUTURE = "2026-12-01T00:00:00Z";

const SENDER = { id: "u-sender", name: "Marisol Okonkwo" };
/** Distinctive words, so a leak cannot hide behind a common one. */
const MESSAGE = "Zephyrine shoved Quillon beside the orchard gate after the harvest meeting";
const WORDS = MESSAGE.split(/\s+/).filter((w) => w.length >= 4);

/** Everything a leak could look like: the sender's name, either half of it, and every real word they wrote. */
function leaks(text: string): string[] {
  const hay = text.toLowerCase();
  const needles = [SENDER.name, ...SENDER.name.split(" "), ...WORDS];
  return needles.filter((n) => hay.includes(n.toLowerCase()));
}

const HOLDERS: IntakeHolding[] = [
  { roleId: "care", userId: "u-live-open", termEndsAt: null },
  { roleId: "care", userId: "u-live-term", termEndsAt: FUTURE },
  { roleId: "care", userId: "u-lapsed", termEndsAt: PAST },
  { roleId: "other", userId: "u-other-role", termEndsAt: null },
];

describe("who an intake reaches", () => {
  it("reaches the role's live holders and nobody whose seat has lapsed", () => {
    expect(liveIntakeRecipients(HOLDERS, "care", NOW)).toEqual(["u-live-open", "u-live-term"]);
  });

  it("counts exactly as the gate counts, through the same lapse rule", () => {
    expect(liveIntakeRecipients(HOLDERS, "care", NOW)).toHaveLength(liveHolderCount(HOLDERS, "care", NOW));
  });

  it("a seat that ends at this instant has lapsed", () => {
    const edge: IntakeHolding[] = [{ roleId: "care", userId: "u-edge", termEndsAt: NOW.toISOString() }];
    expect(liveIntakeRecipients(edge, "care", NOW)).toEqual([]);
  });

  it("one person holding the role twice is reached once", () => {
    const twice: IntakeHolding[] = [
      { roleId: "care", userId: "u-a", termEndsAt: null },
      { roleId: "care", userId: "u-a", termEndsAt: FUTURE },
    ];
    expect(liveIntakeRecipients(twice, "care", NOW)).toEqual(["u-a"]);
  });
});

describe("the role a member sees before sending", () => {
  const roles = [{ id: "care", name: "Care Circle" }, { id: "bare" }];

  it("names the role the published policy points at", () => {
    expect(intakeRoleNamed("care", roles)).toEqual({ id: "care", name: "Care Circle" });
  });

  it("is null when no role is set, or the stored id names no role", () => {
    expect(intakeRoleNamed("", roles)).toBeNull();
    expect(intakeRoleNamed(undefined, roles)).toBeNull();
    expect(intakeRoleNamed("gone", roles)).toBeNull();
  });

  it("falls back to the id when a role has no name", () => {
    expect(intakeRoleNamed("bare", roles)).toEqual({ id: "bare", name: "bare" });
  });
});

describe("one recipient's notice", () => {
  const notice = intakeNotice({ intakeId: "ri-1", recipientId: "u-live-open", sender: SENDER, message: MESSAGE });

  it("the title and the link name no one and quote nothing", () => {
    expect(notice.title).toBe(INTAKE_TITLE);
    expect(leaks(notice.title)).toEqual([]);
    expect(leaks(String(notice.link))).toEqual([]);
  });

  it("links to a page every member can open, never the admin panel", () => {
    expect(notice.link).toBe(INTAKE_LINK);
    expect(String(notice.link).startsWith("/admin")).toBe(false);
  });

  it("the in-app row keeps the sender's name and every word, for its recipient", () => {
    expect(notice.userId).toBe("u-live-open");
    expect(notice.type).toBe("restorative_intake");
    expect(notice.body).toBe(`${SENDER.name} wrote: ${MESSAGE}`);
    expect(notice.actorUserId).toBe(SENDER.id);
    expect(notice.dedupeKey).toBe("restorative:ri-1:u-live-open");
  });

  it("keeps at most the same number of characters it always kept", () => {
    const long = "x".repeat(INTAKE_MAX_CHARS + 500);
    const n = intakeNotice({ intakeId: "ri-2", recipientId: "r", sender: SENDER, message: long });
    expect(String(n.body)).toBe(`${SENDER.name} wrote: ${"x".repeat(INTAKE_MAX_CHARS)}`);
  });

  it("a sender with no name reads as a member", () => {
    const n = intakeNotice({ intakeId: "ri-3", recipientId: "r", sender: { id: "u-x", name: null }, message: "hello there" });
    expect(n.body).toBe("A member wrote: hello there");
  });
});

/** The real spine, over a fake pool and a mailer that keeps what it was handed. */
function spine() {
  const sent: Array<{ to: string[]; subject: string; html: string }> = [];
  const deps: NotifyDeps = {
    pool: {
      query: async (sql: string) => (/COUNT\(\*\)/.test(sql) ? [[{ n: 0 }]] : [{ affectedRows: 1 }]),
    } as any,
    memberById: async (id) => ({ id, email: `${id}@example.test`, prefs: {} }),
    sendEmail: async (opts) => {
      sent.push(opts);
    },
    origin: () => "https://village.example.test",
    projectName: () => "Test Village",
    isPresent: () => true,
  };
  return { deps, sent };
}

describe("the email for this kind", () => {
  it("carries the title alone: no name, no words, and it was sent", async () => {
    const { deps, sent } = spine();
    const notice = intakeNotice({ intakeId: "ri-9", recipientId: "u-care", sender: SENDER, message: MESSAGE });
    const r = await insertNotification(deps, notice);
    expect(r.fresh).toBe(true);
    expect(sent, "the intake is emailed at once, so exactly one email went").toHaveLength(1);
    expect(sent[0].to).toEqual(["u-care@example.test"]);
    expect(sent[0].subject).toBe(INTAKE_TITLE);
    expect(sent[0].html).toContain(INTAKE_TITLE);
    expect(leaks(sent[0].subject)).toEqual([]);
    expect(leaks(sent[0].html)).toEqual([]);
  });

  it("says where the words can be read, since it does not carry them", async () => {
    const { deps, sent } = spine();
    await insertNotification(deps, intakeNotice({ intakeId: "ri-10", recipientId: "u-care", sender: SENDER, message: MESSAGE }));
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain(READ_IN_THE_BELL);
    expect(leaks(READ_IN_THE_BELL)).toEqual([]);
  });

  it("the rule is this kind's alone: another kind's email still carries its body", async () => {
    const { deps, sent } = spine();
    const other: NotifyInput = { userId: "u-care", type: "moderation", title: "A report is waiting", body: MESSAGE, dedupeKey: "m-1" };
    await insertNotification(deps, other);
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain(MESSAGE);
    expect(emailCarriesBody("moderation")).toBe(true);
    expect(emailCarriesBody("restorative_intake")).toBe(false);
  });
});

/** The route's whole path, with the spine, the caches and the limiter faked. */
function intakeDeps(over: Partial<IntakeDeps> = {}) {
  const notices: NotifyInput[] = [];
  const deps: IntakeDeps = {
    readExitPolicy: () => ({ restorative: { intakeContactRole: "care" } }),
    roleHolders: () => HOLDERS,
    notify: async (input) => {
      notices.push(input);
      return { fresh: true, id: `ntf-${notices.length}` };
    },
    overLimit: async () => false,
    now: () => NOW,
    ...over,
  };
  return { deps, notices };
}

describe("sending an intake", () => {
  it("reaches the live holders only, and says how many people it reached", async () => {
    const { deps, notices } = intakeDeps();
    const answer = await sendRestorativeIntake(deps, SENDER, `  ${MESSAGE}  `);
    expect(answer).toEqual({ status: 200, body: { success: true, reached: 2 } });
    expect(notices.map((n) => n.userId)).toEqual(["u-live-open", "u-live-term"]);
    for (const n of notices) {
      expect(n.title).toBe(INTAKE_TITLE);
      expect(leaks(n.title)).toEqual([]);
      expect(n.body).toContain(MESSAGE);
    }
  });

  it("counts only the rows actually written", async () => {
    let calls = 0;
    const { deps } = intakeDeps({ notify: async () => ({ fresh: ++calls === 1 }) });
    expect(await sendRestorativeIntake(deps, SENDER, MESSAGE)).toEqual({ status: 200, body: { success: true, reached: 1 } });
  });

  it("a send that wrote nothing reached nobody and says so", async () => {
    const { deps } = intakeDeps({ notify: async () => ({ fresh: false }) });
    const answer = await sendRestorativeIntake(deps, SENDER, MESSAGE);
    expect(answer.status).toBe(503);
    expect(String(answer.body.error)).toContain("nobody has it yet");
  });

  it("a sender who holds the role is not sent their own intake, and is not counted as reached", async () => {
    const withSender: IntakeHolding[] = [...HOLDERS, { roleId: "care", userId: SENDER.id, termEndsAt: FUTURE }];
    const { deps, notices } = intakeDeps({ roleHolders: () => withSender });
    expect(await sendRestorativeIntake(deps, SENDER, MESSAGE)).toEqual({ status: 200, body: { success: true, reached: 2 } });
    expect(notices.map((n) => n.userId)).toEqual(["u-live-open", "u-live-term"]);
  });

  it("a sender who is the role's only live holder is told nobody else would read it, and nothing is sent", async () => {
    const soleHolder: IntakeHolding[] = [
      { roleId: "care", userId: SENDER.id, termEndsAt: null },
      { roleId: "care", userId: "u-lapsed", termEndsAt: PAST },
    ];
    const { deps, notices } = intakeDeps({ roleHolders: () => soleHolder });
    expect(await sendRestorativeIntake(deps, SENDER, MESSAGE)).toEqual({
      status: 409,
      body: { error: "You are the only person holding the intake role right now, so nobody else would read this. Write to the stewards directly" },
    });
    expect(notices).toEqual([]);
  });

  it("a role whose every seat has lapsed keeps the existing refusal", async () => {
    const { deps, notices } = intakeDeps({ roleHolders: () => [{ roleId: "care", userId: "u-lapsed", termEndsAt: PAST }] });
    expect(await sendRestorativeIntake(deps, SENDER, MESSAGE)).toEqual({
      status: 409,
      body: { error: "The intake role has no holders right now. Write to the stewards directly" },
    });
    expect(notices).toEqual([]);
  });

  it("no configured role, an empty message and the daily limit keep their sentences", async () => {
    const unset = intakeDeps({ readExitPolicy: () => ({ restorative: { intakeContactRole: "" } }) });
    expect(await sendRestorativeIntake(unset.deps, SENDER, MESSAGE)).toEqual({
      status: 409,
      body: { error: "No intake contact role is configured yet. Write to the stewards directly" },
    });
    const blank = intakeDeps();
    expect(await sendRestorativeIntake(blank.deps, SENDER, "   ")).toEqual({
      status: 400,
      body: { error: "Say what happened, in your own words" },
    });
    const limited = intakeDeps({ overLimit: async () => true });
    expect(await sendRestorativeIntake(limited.deps, SENDER, MESSAGE)).toEqual({
      status: 429,
      body: { error: "Three intakes a day. The stewards are already listening" },
    });
    expect([...unset.notices, ...blank.notices, ...limited.notices]).toEqual([]);
  });
});
