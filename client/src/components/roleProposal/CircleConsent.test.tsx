// @vitest-environment jsdom
/**
 * THE CIRCLE ANSWERS (role proposals PR D): the asked holder's Consent and
 * Object on the application page, and the state every reader sees.
 *
 *   - Consent and Object are drawn only while the server says `you.mayAnswer`
 *     and the application still waits; never for a decided proposal;
 *   - Consent sends `{ answer: "consent" }` and then shows the answer as final;
 *   - Object opens the reason box (at most 300 characters) with "Your
 *     objection goes to the circle's next meeting.", refuses to send with no
 *     reason, and sends the reason;
 *   - the route's own sentence is shown when it refuses;
 *   - the state's heading and sentence for each of the five states, and the
 *     decision record once adopted;
 *   - the tally: counts and role titles, never a name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CONSENT_STATES, CONSENT_WORDS, OBJECTION_MAX, type ConsentState } from "@shared/roleProposalConsent";
import { consentOf } from "@/test/roleProposalFixture";
import CircleConsent, { ConsentSummary } from "./CircleConsent";
import { ADOPTED_HEADING, STATE_HEADINGS } from "./proposalWords";

const APP = "sa-00000000000000d1";
const URL = `/api/governance/role-applications/${APP}/consent`;
const ASKED = { asked: true, answer: null, mayAnswer: true };
const ROLES = { asked: ["Gate keeper", "Orchard keeper"], consented: [], objected: [] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let posts: Array<{ url: string; body: any }> = [];
let reply: (body: any) => Response;

beforeEach(() => {
  posts = [];
  reply = (body) =>
    json({
      answer: body.answer,
      carried: body.answer === "object",
      carriedWords: null,
      consent: consentOf("open", {
        consented: body.answer === "consent" ? 1 : 0,
        objected: body.answer === "object" ? 1 : 0,
        roles: { asked: ROLES.asked, consented: body.answer === "consent" ? ["Gate keeper"] : [], objected: body.answer === "object" ? ["Gate keeper"] : [] },
        you: { asked: true, answer: body.answer, mayAnswer: false },
        ...(body.answer === "object" ? { state: "objected" as ConsentState, words: CONSENT_WORDS.objected, objections: [body.reason] } : {}),
      }),
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      posts.push({ url, body });
      return reply(body);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = (you = ASKED) => consentOf("open", { roles: ROLES, you });

describe("the asked holder's buttons", () => {
  it("are drawn when the server says you may answer", () => {
    render(<CircleConsent applicationId={APP} consent={open()} decided={null} waiting />);
    expect(screen.getByRole("button", { name: CONSENT_WORDS.consentButton })).toBeTruthy();
    expect(screen.getByRole("button", { name: CONSENT_WORDS.objectButton })).toBeTruthy();
    expect(screen.getByText("Your circle asks you to consent or object by 6 November 2026.")).toBeTruthy();
  });

  it.each([
    ["not asked", { asked: false, answer: null, mayAnswer: false }, true, null],
    ["asked, answered", { asked: true, answer: "consent", mayAnswer: false }, true, null],
    ["asked, the window closed", { asked: true, answer: null, mayAnswer: false }, true, null],
    ["asked, the application decided", ASKED, false, null],
    ["asked, adopted", ASKED, true, "Adopted on 9 Nov after the circle consented"],
  ] as const)("are hidden for a reader %s", (_label, you, waiting, decided) => {
    render(<CircleConsent applicationId={APP} consent={open(you as any)} decided={decided} waiting={waiting} />);
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.consentButton })).toBeNull();
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.objectButton })).toBeNull();
  });
});

describe("an answer", () => {
  it("consent sends the answer, then shows it as final", async () => {
    const answered = vi.fn();
    render(<CircleConsent applicationId={APP} consent={open()} decided={null} waiting onAnswered={answered} />);
    fireEvent.click(screen.getByRole("button", { name: CONSENT_WORDS.consentButton }));
    expect(await screen.findByText(CONSENT_WORDS.youConsented)).toBeTruthy();
    expect(posts).toEqual([{ url: URL, body: { answer: "consent" } }]);
    expect(screen.getByText(CONSENT_WORDS.answerStands)).toBeTruthy();
    // Answered once: no button to answer again, and the tally moved.
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.consentButton })).toBeNull();
    expect(within(document.querySelector('[data-tally="consented"]') as HTMLElement).getByText("1 (Gate keeper)")).toBeTruthy();
    expect(answered).toHaveBeenCalledTimes(1);
  });

  it("an objection opens the reason box, needs a reason, and sends it", async () => {
    render(<CircleConsent applicationId={APP} consent={open()} decided={null} waiting />);
    fireEvent.click(screen.getByRole("button", { name: CONSENT_WORDS.objectButton }));
    const box = screen.getByLabelText(CONSENT_WORDS.reasonLabel) as HTMLTextAreaElement;
    expect(screen.getByText("Your objection goes to the circle's next meeting.")).toBeTruthy();
    expect(box.maxLength).toBe(OBJECTION_MAX);
    expect(OBJECTION_MAX).toBe(300);
    expect(box.getAttribute("aria-describedby")).toContain(screen.getByText(CONSENT_WORDS.objectionGoes).id);

    // No reason: the page says why and the route is never asked.
    fireEvent.click(screen.getByRole("button", { name: CONSENT_WORDS.sendObjection }));
    expect(screen.getByRole("alert").textContent).toBe(CONSENT_WORDS.reasonNeeded);
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: CONSENT_WORDS.sendObjection }));
    expect(posts).toEqual([]);

    fireEvent.change(box, { target: { value: "  Two of us already keep the gate.  " } });
    fireEvent.click(screen.getByRole("button", { name: CONSENT_WORDS.sendObjection }));
    expect(await screen.findByText(CONSENT_WORDS.youObjected)).toBeTruthy();
    expect(posts).toEqual([{ url: URL, body: { answer: "object", reason: "Two of us already keep the gate." } }]);
    expect(screen.getByText(STATE_HEADINGS.objected)).toBeTruthy();
    expect(screen.getByText("Two of us already keep the gate.")).toBeTruthy();
    expect(screen.queryByLabelText(CONSENT_WORDS.reasonLabel)).toBeNull();
  });

  it("Not now closes the reason box and keeps both buttons", () => {
    render(<CircleConsent applicationId={APP} consent={open()} decided={null} waiting />);
    fireEvent.click(screen.getByRole("button", { name: CONSENT_WORDS.objectButton }));
    fireEvent.click(screen.getByRole("button", { name: CONSENT_WORDS.notNow }));
    expect(screen.queryByLabelText(CONSENT_WORDS.reasonLabel)).toBeNull();
    expect(screen.getByRole("button", { name: CONSENT_WORDS.consentButton })).toBeTruthy();
    expect(posts).toEqual([]);
  });

  it("says where an objection waits when the circle has no meeting to carry it to", async () => {
    reply = (body) =>
      json({ answer: body.answer, carried: false, carriedWords: CONSENT_WORDS.notCarried, consent: consentOf("objected", { you: { asked: true, answer: "object", mayAnswer: false } }) });
    render(<CircleConsent applicationId={APP} consent={open()} decided={null} waiting />);
    fireEvent.click(screen.getByRole("button", { name: CONSENT_WORDS.objectButton }));
    fireEvent.change(screen.getByLabelText(CONSENT_WORDS.reasonLabel), { target: { value: "The rota is full." } });
    fireEvent.click(screen.getByRole("button", { name: CONSENT_WORDS.sendObjection }));
    expect(await screen.findByText(CONSENT_WORDS.notCarried)).toBeTruthy();
  });

  it("shows the route's own sentence when it refuses, and keeps the buttons", async () => {
    reply = () => json({ error: CONSENT_WORDS.windowClosed }, 409);
    render(<CircleConsent applicationId={APP} consent={open()} decided={null} waiting />);
    fireEvent.click(screen.getByRole("button", { name: CONSENT_WORDS.consentButton }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(CONSENT_WORDS.windowClosed));
    expect(screen.queryByText(CONSENT_WORDS.youConsented)).toBeNull();
  });
});

describe("where it stands, for every reader", () => {
  it.each(CONSENT_STATES.map((s) => [s]))("%s: the heading and the server's sentence", (state) => {
    render(<ConsentSummary consent={consentOf(state)} decided={null} />);
    expect(screen.getByText(STATE_HEADINGS[state])).toBeTruthy();
    expect(screen.getByText(consentOf(state).words)).toBeTruthy();
    expect(document.querySelector("[data-consent-summary]")!.getAttribute("data-consent-summary")).toBe(state);
  });

  it("adopted: the decision record, which names a role", () => {
    render(<ConsentSummary consent={consentOf("consented")} decided="Adopted on 9 Nov after the circle consented" />);
    expect(screen.getByText(ADOPTED_HEADING)).toBeTruthy();
    expect(screen.getByText("Adopted on 9 Nov after the circle consented")).toBeTruthy();
  });

  it("the tally counts who was asked, consented and objected, by role title, naming nobody", () => {
    const consent = consentOf("objected", {
      asked: 3,
      consented: 1,
      objected: 1,
      objections: ["The kitchen needs a second keeper first."],
      roles: { asked: ["Gate keeper", "Orchard keeper", "Water keeper"], consented: ["Gate keeper"], objected: ["Orchard keeper"] },
    });
    render(<ConsentSummary consent={consent} decided={null} />);
    const row = (key: string) => (document.querySelector(`[data-tally="${key}"]`) as HTMLElement).textContent;
    expect(row("asked")).toBe("Asked3 (Gate keeper, Orchard keeper, Water keeper)");
    expect(row("consented")).toBe("Consented1 (Gate keeper)");
    expect(row("objected")).toBe("Objected1 (Orchard keeper)");
    expect(screen.getByText("The kitchen needs a second keeper first.")).toBeTruthy();
  });

  it("says None where nobody answered, and draws no tally for a circle nobody else holds a role in", () => {
    const { unmount } = render(<ConsentSummary consent={consentOf("open", { roles: ROLES })} decided={null} />);
    expect((document.querySelector('[data-tally="consented"]') as HTMLElement).textContent).toBe("ConsentedNone");
    expect((document.querySelector('[data-tally="objected"]') as HTMLElement).textContent).toBe("ObjectedNone");
    unmount();
    render(<ConsentSummary consent={consentOf("no-other-holders", { asked: 0 })} decided={null} />);
    expect(document.querySelector("[data-consent-tally]")).toBeNull();
    expect(screen.getByText(CONSENT_WORDS.noOtherHolders)).toBeTruthy();
  });

  it("reads a server from before the role titles as counts alone", () => {
    render(<ConsentSummary consent={consentOf("open", { consented: 1 })} decided={null} />);
    expect((document.querySelector('[data-tally="asked"]') as HTMLElement).textContent).toBe("Asked2");
    expect((document.querySelector('[data-tally="consented"]') as HTMLElement).textContent).toBe("Consented1");
  });
});
