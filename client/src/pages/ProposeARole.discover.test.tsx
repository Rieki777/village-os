// @vitest-environment jsdom
/**
 * THE APPLICATION BODY AFTER THE DISCOVER STEP (role journey, lane L3).
 *
 * R-Ikigai answers reach "Why you" only when the person ticked, as words they
 * can edit. Human Design and Gene Keys values, and the answers themselves,
 * never appear in the submit body as anything but that text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OPEN_WORDS } from "@shared/openProposals";
import { IKIGAI_KEY } from "@shared/roleDiscover";

// fillGoals is audit B1's helper; the walk along the six stones is the test kit's.
import { fillGoals, sendNow } from "@/test/proposeStones";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: null }) }));

import ProposeARole from "./ProposeARole";

const FORM = { open: true, village: "Test Village", season: { id: "s", name: "S", startsOn: "2099-01-01" }, roles: [{ id: "r-gate", name: "Gate Keeper", circle: "Land Circle", aim: null }] };
/** The membership letter the form aligns with (PR-E, Rye's answer 8): its own sentence is the one box about it. */
const LETTER = { version: "lv-0123456789abcdef", title: "Membership agreement", body: "Dear friend, welcome home.", intent: "I align with the Membership agreement.", parts: {} };
let posted: any[] = [];

function serve() {
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted.push({ url, raw: String(init.body), body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ sent: true, message: OPEN_WORDS.sent("a@b.test") }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (String(url).startsWith("/api/membership-letter")) return new Response(JSON.stringify(LETTER), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(FORM), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

async function fillAndSend() {
  fireEvent.click((await screen.findByText("Gate Keeper")).closest("[data-role]")!.querySelector("input[type=checkbox]")!);
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Rowan" } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "a@b.test" } });
  // Form v2 (#1071): the aim and the commitment are required (the terms step, joining lane PR 3).
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "Food grown here." } });
  fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
  const why = screen.getByLabelText(OPEN_WORDS.whyLabel) as HTMLTextAreaElement;
  const before = why.value;
  // The agreements as PR-E draws them: the membership letter aligned with here, the NDA promised for once approved.
  fireEvent.click(await screen.findByLabelText(LETTER.intent));
  fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
  // About you: no references, so the background-check consent is ticked (joining lane PR 2).
  fireEvent.click(screen.getByLabelText(/agree to the background check/i));
  fillGoals();
  sendNow();
  await screen.findByRole("heading", { name: "Check your email" });
  return before;
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the open form after the discover step", () => {
  it("fills Why you from ticked answers, and the body holds them only there", async () => {
    // Values a Human Design step might have held are in the page's storage too; none may travel.
    localStorage.setItem("village.hd", JSON.stringify({ type: "Projector", lines: [3, 5] }));
    localStorage.setItem(IKIGAI_KEY, JSON.stringify({ answers: { love: "growing food", good: "", needs: "", pays: "" }, carry: true }));
    serve();
    render(<ProposeARole />);
    const before = await fillAndSend();
    expect(before).toContain("growing food");
    expect(posted).toHaveLength(1);
    const keys = Object.keys(posted[0].body).sort();
    // `membership` is PR-E's letter version (Rye's answer 8): an `lv-` fingerprint, never a discover value.
    expect(keys).toEqual(["about", "aim", "card", "checkConsent", "email", "hp", "link", "locale", "membership", "name", "references", "roles", "why"].filter((k) => keys.includes(k)));
    expect(posted[0].body.membership).toEqual({ letterVersion: LETTER.version });
    expect(posted[0].body.why).toContain("growing food");
    expect(posted[0].raw).not.toMatch(/Projector|humanDesign|geneKeys|ikigai/i);
  });

  it("does not fill Why you without the tick", async () => {
    localStorage.setItem(IKIGAI_KEY, JSON.stringify({ answers: { love: "growing food" }, carry: false }));
    serve();
    render(<ProposeARole />);
    await screen.findByText("Gate Keeper");
    expect((screen.getByLabelText(OPEN_WORDS.whyLabel) as HTMLTextAreaElement).value).toBe("");
  });
});
