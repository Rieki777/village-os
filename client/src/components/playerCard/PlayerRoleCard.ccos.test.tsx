// @vitest-environment jsdom
/**
 * The CCOS sections of a role in full, drawn from the real model (0274, the
 * approved CCOS card, Rye 2026-10-22):
 *
 *   - with every word written: each section in the card's order, "This role
 *     exists while" inside the Purpose block, "What I look after" and "What I
 *     can decide on my own" in one box, the time and review chips;
 *   - with none written: nothing extra, and no empty box;
 *   - each heading's CCOS term on hover, tap or focus, and none at all where
 *     the village turned the terms off;
 *   - "Edit my card" opens the unwritten ones with their edit controls, and a
 *     proposal goes through the card's route, refused first in the browser
 *     with the parser's sentence.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PlayerRoleCardView } from "./PlayerRoleCard";
import { FIXTURE_ROLE_TITLE, fixturePayload, fixtureRole } from "@/test/playerCardFixture";
import { ROLE_CCOS_WORDS } from "@shared/roleCcos";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WORDS = {
  existsWhile: "people are still arriving and need a clear way in.",
  authorities: ["Manage applicant onboarding and role invitations.", "Front operations questions in partner discussions."],
  responsibilities: ["Answer role applications within 2 business days.", "Run onboarding calls with newcomers."],
  signsStretched: "Applications waiting longer than 2 business days.",
  flowsBack: "Runbooks and the intake agent from the Operations role.",
  stepBack: "Name it at the Friday check-in.",
  timeCommitment: "Part of a full-time season",
};
const NONE = {
  existsWhile: null,
  authorities: null,
  responsibilities: null,
  signsStretched: null,
  flowsBack: null,
  stepBack: null,
  timeCommitment: null,
};

const payload = (words: Record<string, unknown>, frameworkTerms = true) =>
  fixturePayload(1, "self", { roles: [{ ...fixtureRole(1), ...words }], frameworkTerms });

const article = () => document.getElementById("role-r1")!;
const TITLE = FIXTURE_ROLE_TITLE(1);

describe("a role with every CCOS word written", () => {
  it("draws each section where the approved card puts it", () => {
    render(<PlayerRoleCardView data={payload(WORDS, false)} />);
    const text = article().textContent ?? "";
    const at = (s: string) => {
      const i = text.indexOf(s);
      expect(i, s).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = [
      TITLE,
      "Review week of 16 Nov",
      "Part of a full-time season",
      "Purpose",
      "This role exists while people are still arriving",
      "What I look after",
      "What I can decide on my own",
      "Manage applicant onboarding",
      "Bring me",
      "What you can count on me for",
      "What I do regularly",
      "Answer role applications within 2 business days.",
      "How we'll know it's working",
      "Holding this role well",
      "Signs I'm stretched",
      "What flows back",
      "How I can step back",
      "Not mine to hold",
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("puts the domain and what the role can decide on its own in one box, and the exists-while line in the purpose", () => {
    render(<PlayerRoleCardView data={payload(WORDS, false)} />);
    const box = article().querySelector('[data-role-section="decide"]')!;
    expect(within(box as HTMLElement).getByText("What I look after")).toBeTruthy();
    expect(box.querySelector('[data-role-section="authorities"]')).not.toBeNull();
    const exists = article().querySelector('[data-role-section="existsWhile"]')!;
    expect(exists.closest(".border-l-notice")).not.toBeNull();
    expect(article().querySelector('[data-role-chip="time"]')!.textContent).toBe("Part of a full-time season");
    expect(screen.getByRole("list", { name: "About this role" }).textContent).toContain("Review week of 16 Nov");
  });
});

describe("a role with none of the CCOS words written", () => {
  it("shows nothing extra: no section, no box, no chip", () => {
    render(<PlayerRoleCardView data={payload(NONE)} />);
    const a = article();
    for (const k of ["existsWhile", "authorities", "responsibilities", "holdingWell", "timeCommitment"]) {
      expect(a.querySelector(`[data-role-section="${k}"]`), k).toBeNull();
    }
    expect(a.querySelector('[data-role-chip="time"]')).toBeNull();
    const text = a.textContent ?? "";
    for (const s of ["This role exists while", "What I can decide on my own", "What I do regularly", "Holding this role well"]) {
      expect(text, s).not.toContain(s);
    }
    // The sections that were there before still are.
    expect(text).toContain("What I look after");
    expect(text).toContain("What you can count on me for");
  });

  it("opens each unwritten one with its edit control in Edit my card", () => {
    render(<PlayerRoleCardView data={payload(NONE)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    for (const heading of [
      "This role exists while",
      "What I can decide on my own",
      "What I do regularly",
      "Signs I'm stretched",
      "What flows back",
      "How I can step back",
      "Time",
    ]) {
      expect(screen.getByRole("button", { name: `Edit: ${heading}, ${TITLE}` }), heading).toBeTruthy();
    }
    expect(article().querySelector('[data-role-section="holdingWell"]')).not.toBeNull();
  });
});

describe("the CCOS term behind each plain heading", () => {
  it("shows the term when the heading takes focus, and describes the heading with it", () => {
    render(<PlayerRoleCardView data={payload(WORDS)} />);
    const trigger = screen.getByRole("button", { name: "What I can decide on my own" });
    const tip = document.getElementById(trigger.getAttribute("aria-describedby")!)!;
    expect(tip.textContent).toBe("CCOS: Authorities");
    expect(tip.hidden).toBe(true);
    fireEvent.focus(trigger);
    expect(tip.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.blur(trigger);
    expect(tip.hidden).toBe(true);
  });

  it("gives each heading its own term, the ARC lines and the time chip included", () => {
    render(<PlayerRoleCardView data={payload(WORDS)} />);
    const termOf = (name: string) => {
      const b = screen.getByRole("button", { name });
      return document.getElementById(b.getAttribute("aria-describedby")!)!.textContent;
    };
    expect(termOf("What I look after")).toBe("CCOS: Domains");
    expect(termOf("What you can count on me for")).toBe("CCOS: Accountabilities / Outcomes");
    expect(termOf("What I do regularly")).toBe("CCOS: Responsibilities / Actions");
    expect(termOf("This role exists while")).toBe("CCOS: Purpose, when the role should evolve or dissolve");
    expect(termOf("Signs I'm stretched")).toBe("CCOS: ARC Awareness, and the Energy & Sustainability Check");
    expect(termOf("What flows back")).toBe("CCOS: ARC Reciprocity");
    expect(termOf("How I can step back")).toBe("CCOS: ARC Choice");
    expect(termOf("Part of a full-time season")).toBe("CCOS: Time Commitment");
    expect(termOf("Not mine to hold")).toBe("CCOS: the edges of Domains and Authorities");
    expect(screen.getByText("Underlined headings show the matching CCOS term when you hover or tap them.")).toBeTruthy();
  });

  it("draws plain headings and no CCOS words where the village turned the terms off", () => {
    render(<PlayerRoleCardView data={payload(WORDS, false)} />);
    expect(screen.queryByRole("button", { name: "What I can decide on my own" })).toBeNull();
    expect(document.body.textContent).not.toContain("CCOS");
  });
});

describe("proposing the CCOS words from the card", () => {
  it("sends one role word through the card's route, one item per line", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, draftId: "d1", key: "authorities", review: "/review" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PlayerRoleCardView data={payload(NONE)} reload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    fireEvent.click(screen.getByRole("button", { name: `Edit: What I can decide on my own, ${TITLE}` }));
    fireEvent.change(screen.getByLabelText(`What I can decide on my own, ${TITLE}`), { target: { value: "Invite to a role\nSet the intake form" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose this change" }));
    await screen.findAllByText("Proposed, waiting for consent");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/people/me/role-card/roles/r1/propose");
    expect(JSON.parse(String(init.body))).toEqual({ key: "authorities", text: "Invite to a role\nSet the intake form" });
  });

  it("refuses nine lines and two accountabilities in the browser, with the preview's own sentences", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PlayerRoleCardView data={payload(NONE)} reload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    fireEvent.click(screen.getByRole("button", { name: `Edit: What I do regularly, ${TITLE}` }));
    fireEvent.change(screen.getByLabelText(`What I do regularly, ${TITLE}`), {
      target: { value: Array.from({ length: 9 }, (_, i) => `Task ${i + 1}`).join("\n") },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose this change" }));
    expect(screen.getByText(ROLE_CCOS_WORDS.tooMany)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Edit: What you can count on me for, ${TITLE}` }));
    fireEvent.change(screen.getByLabelText(`What you can count on me for, ${TITLE}`), { target: { value: "One\nTwo" } });
    const countOnMe = article().querySelector('[data-role-section="countOnMe"]') as HTMLElement;
    fireEvent.click(within(countOnMe).getByRole("button", { name: "Propose this change" }));
    expect(within(countOnMe).getByText(ROLE_CCOS_WORDS.accountabilities)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
