/**
 * OUR REVIEW'S WORDS AND PATH (Phase A, lane A2): pure, no database.
 *   - APPLICANT_STEPS is the one list of the applicant's steps, six, in order, in every language
 *   - the reviewed status path: review, invitation, conversations, decision, first cycle
 *   - the status page's words for it, in English and Spanish
 *   - the invitation lists the role's conversations as given; the not-invited letter is never personal
 */
import { describe, expect, it } from "vitest";
import { APPLICANT_LANGUAGES, APPLICANT_STEP_KEYS, APPLICANT_STEPS, applicantSteps, statusView } from "./applicantWords";
import { reviewedStatusFor, reviewStageOf, statusFor } from "./applicationReview";
import { invitedLetter, letterHref, notInvitedLetter } from "./openProposalDecide";

const T0 = new Date("2026-11-11T12:00:00Z");
const ivs = (states: Array<"waiting" | "open" | "scored">) =>
  states.map((state, i) => ({ position: i + 1, state, roleName: ["Ops Role", "Hiring Role", "Vision Role"][i], minutes: [60, 30, 30][i], final: i === 2, dueAt: null }));
const base = { firstReplyAt: null, confirmedAt: T0, consentOpen: false, consentClosesAt: null, timeZone: "UTC" };

describe("the one list of the applicant's steps", () => {
  it("names six steps in order, in every applicant language, each with a when line", () => {
    expect(APPLICANT_STEP_KEYS).toEqual(["received", "review", "invitation", "conversations", "decision", "first_cycle"]);
    for (const lang of APPLICANT_LANGUAGES) {
      const steps = applicantSteps(lang, 7);
      expect(steps.map((s) => s.key)).toEqual([...APPLICANT_STEP_KEYS]);
      for (const s of steps) expect(s.name && s.when).toBeTruthy();
    }
    expect(applicantSteps("en", 5)[1].when).toContain("Within 5 days");
    expect(applicantSteps("es", 1)[1].when).toContain("1 día");
    expect(APPLICANT_STEPS.es.first_cycle.name).toBe("Primer ciclo");
  });
});

describe("the reviewed status path", () => {
  it("before the invitation: our review is now, the conversations wait, and the first cycle is last", () => {
    const s = statusFor({ ...base, decided: null, reviewFirst: true, interviews: ivs(["waiting", "waiting", "waiting"]) });
    expect(s.step).toBe("review");
    expect(s.path.map((p) => `${p.label}:${p.state}`)).toEqual([
      "Received:done", "Our review:now", "Invitation:later",
      "Conversation with Ops Role (60 minutes):later", "Conversation with Hiring Role (30 minutes):later", "Conversation with Vision Role (30 minutes):later",
      "Decision:later", "First cycle:later",
    ]);
    // CONTROL: the older path has no review step.
    expect(statusFor({ ...base, decided: null, interviews: ivs(["open", "waiting", "waiting"]) }).path.map((p) => p.label)).not.toContain("Our review");
  });

  it("after the conversations the decision is now; adopted, the first cycle is where they stand", () => {
    const at = statusFor({ ...base, decided: null, reviewFirst: true, invitedAt: T0, interviews: ivs(["scored", "scored", "scored"]) });
    expect(at.step).toBe("consent");
    expect(at.path.find((p) => p.label === "Decision")?.state).toBe("now");
    const yes = reviewedStatusFor({ ...base, decided: "adopted", reviewFirst: true, invitedAt: T0, interviews: ivs(["scored", "scored", "scored"]) });
    expect(yes.path[yes.path.length - 1]).toEqual({ label: "First cycle", state: "now" });
    const view = statusView("en", { step: yes.step, actsNext: yes.actsNext, path: yes.path, booking: null, mode: "block", outcome: "adopted", reviewFirst: true });
    expect(view.path[view.path.length - 1]).toEqual({ label: "First cycle", state: "now" });
  });

  it("not invited: only Received and Our review, and the page says so in the applicant's language", () => {
    const s = statusFor({ ...base, decided: "declined", reviewFirst: true, notInvited: true, interviews: ivs(["waiting", "waiting", "waiting"]) });
    expect(s.path.map((p) => p.label)).toEqual(["Received", "Our review"]);
    const es = statusView("es", { step: s.step, actsNext: s.actsNext, path: s.path, booking: null, mode: "block", outcome: "declined", reviewFirst: true, notInvited: true });
    expect(es.notInvited).toBe(true);
    expect(es.heading).toBe("Dónde está tu postulación");
    expect(es.path.map((p) => p.label)).toEqual(["Recibida", "Nuestra revisión"]);
    expect(es.move).toBe("No hace falta nada más de tu parte. Ya te escribimos.");
  });

  it("reads the stage from ONE review step's answer", () => {
    const confirmed = { kind: "confirmed", detail: { reviewFirst: true } };
    expect(reviewStageOf([confirmed])).toBe("review");
    expect(reviewStageOf([confirmed, { kind: "review", detail: { answer: "invited" } }])).toBe("invited");
    expect(reviewStageOf([confirmed, { kind: "review", detail: { answer: "not_invited" } }])).toBe("not_invited");
    expect(reviewStageOf([{ kind: "confirmed", detail: {} }])).toBeNull();
  });
});

describe("the letters", () => {
  it("the invitation lists the conversations exactly as the role gives them, with the total", () => {
    const l = invitedLetter({ firstName: "Rowan", village: "V", roleNames: ["Lead Role"], conversations: [{ role: "A", minutes: 60 }, { role: "B", minutes: 30 }], statusLink: "https://v.test/s", lang: "en" });
    expect(l.text).toContain("1. A, 60 minutes\n2. B, 30 minutes\nAbout 90 minutes in all.");
    expect(l.text).toContain("https://v.test/s");
    const es = invitedLetter({ firstName: null, village: "V", roleNames: ["Rol"], conversations: [{ role: "A", minutes: 60 }], statusLink: null, lang: "es" });
    expect(es.subject).toBe("Una invitación a conversar con V");
    expect(es.text).toContain("1. A, 60 minutos");
  });

  it("the not-invited letter thanks, says it is not personal, and points only where the village has a door", () => {
    const l = notInvitedLetter({ firstName: "Rowan", village: "V", roleNames: ["Lead Role"], site: "https://v.test/", stayClose: { program: { name: "Seeders", href: "/resident" }, quests: true, events: false }, lang: "en" });
    expect(l.text).toContain("it is not personal");
    expect(l.text).toContain("Seeders: https://v.test/resident");
    expect(l.text).toContain("Take a quest: https://v.test/quests");
    expect(l.text).not.toContain("/events");
    const bare = notInvitedLetter({ firstName: null, village: "V", roleNames: [], site: "https://v.test", stayClose: { program: null, quests: false, events: false }, lang: "es" });
    expect(bare.text).not.toContain("caminos abiertos");
    expect(bare.text).toContain("no es algo personal");
  });

  it("a link is made the site's own unless it is https", () => {
    expect(letterHref("https://v.test/", "/a")).toBe("https://v.test/a");
    expect(letterHref("https://v.test", "https://x.test/p")).toBe("https://x.test/p");
  });
});
