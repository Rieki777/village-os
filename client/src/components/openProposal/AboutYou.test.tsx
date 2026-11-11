// @vitest-environment jsdom
/**
 * ABOUT YOU, the pieces (joining lane PR 2): the deciders' view, the step's
 * verdict, what the member door sends, and the wording pinned to the shared
 * rules so the consent version moves when a word does.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ABOUT_WORDS, CHECK_WORDS, checkConsentVersion } from "@shared/proposalAbout";
import { AboutYouView, aboutYouBody, aboutYouOf, aboutYouProblem, consentRequired } from "./AboutYou";
import { doorAnswers } from "@/components/governance/roleApplicationType";
import { aboutYouReview, alwaysCheckedIn } from "@/components/governance/AboutYouField";
import { walkFor } from "@/components/governance/wizardWalk";

afterEach(cleanup);

const REF = { name: "Ines Vargas", how: "We built a fence", contact: "ines@example.org" };

describe("the deciders' view", () => {
  it("shows the facts, the references, the check line and the consent day", () => {
    render(
      <AboutYouView about={{ references: [REF], about: { based: "Uvita", languages: "Spanish" }, backgroundCheck: { needed: true, because: "role", consent: { at: "2026-11-10T09:00:00.000Z", version: checkConsentVersion() } } }} />,
    );
    expect(screen.getByText("Ines Vargas")).toBeTruthy();
    expect(screen.getByText("Uvita")).toBeTruthy();
    expect(screen.getByText(ABOUT_WORDS.checkNeededRole)).toBeTruthy();
    expect(screen.getByText(ABOUT_WORDS.consentGiven("10 Nov 2026"))).toBeTruthy();
    // No score, no summary: the page holds only what was given.
    expect(document.querySelector("[data-aboutyou]")?.textContent).not.toMatch(/score|rank|summary/i);
  });
  it("says a check is needed when no references were given", () => {
    render(<AboutYouView about={{ references: [], about: {}, backgroundCheck: { needed: true, because: "no_references" } }} />);
    expect(screen.getByText(ABOUT_WORDS.checkNeededNoReferences)).toBeTruthy();
    expect(screen.getByText(ABOUT_WORDS.noConsent)).toBeTruthy();
  });
  it("draws nothing for a reader who was sent nothing, and for a proposal from before the section", () => {
    const { container } = render(<AboutYouView about={null} />);
    expect(container.innerHTML).toBe("");
    cleanup();
    const legacy = render(<AboutYouView about={{ references: [], about: {}, backgroundCheck: null }} />);
    expect(legacy.container.innerHTML).toBe("");
  });
});

describe("the step's verdict and what it sends", () => {
  it("needs the tick with no references, or with an always-checked role", () => {
    expect(aboutYouProblem({ references: [] }, false)).toBe(ABOUT_WORDS.needConsent);
    expect(aboutYouProblem({ references: [], consent: true }, false)).toBeNull();
    expect(aboutYouProblem({ references: [REF] }, false)).toBeNull();
    expect(aboutYouProblem({ references: [REF] }, true)).toBe(ABOUT_WORDS.needConsent);
    expect(aboutYouProblem({ references: [REF], consent: true }, true)).toBeNull();
    expect(aboutYouProblem({ references: [{ name: "Ines", how: "", contact: "" }] }, false)).toBe(ABOUT_WORDS.referenceNeedsAll);
    expect(consentRequired(aboutYouOf({ references: [REF] }), true)).toBe(true);
  });
  it("sends the references, the facts and the tick with the wording version shown", () => {
    const body = aboutYouBody(aboutYouOf({ based: " Uvita ", references: [REF, { name: "", how: "", contact: "" }], consent: true }));
    expect(body).toEqual({ references: [REF], about: { based: "Uvita" }, checkConsent: { given: true, version: checkConsentVersion() } });
  });
  it("rides in the member door's answers, and a renewal asks nothing", () => {
    const a = { door: true, seatIds: ["r1"], aboutYou: { references: [REF], consent: false } };
    expect(doorAnswers(a)).toMatchObject({ references: [REF], about: {} });
    expect(walkFor("role_application", { door: true }).map((s) => s.key)).toContain("about");
    expect(walkFor("role_application", { seatIds: ["r1"] }).map((s) => s.key)).not.toContain("about");
  });
  it("reads a role's flag off the org chart, and the review line says what will be sent", () => {
    expect(alwaysCheckedIn([{ id: "a", alwaysChecked: true }, { id: "b" }], ["b"])).toBe(false);
    expect(alwaysCheckedIn([{ id: "a", alwaysChecked: true }, { id: "b" }], ["a", "b"])).toBe(true);
    expect(aboutYouReview({ references: [], consent: true })).toContain("none, so a background check");
  });
});

describe("the form's words are the shared rules' words", () => {
  it("every line of the consent is in the component, so the version cannot drift from what is shown", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "AboutYou.tsx"), "utf8");
    for (const line of [...CHECK_WORDS.lines, CHECK_WORDS.contactLine, CHECK_WORDS.roleLine, CHECK_WORDS.tick]) expect(source, line).toContain(line);
  });
});
