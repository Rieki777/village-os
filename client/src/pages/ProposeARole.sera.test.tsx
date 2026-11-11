// @vitest-environment jsdom
/**
 * "ASK SERA FOR A FIRST DRAFT" on the open form (joining lane PR 5).
 *
 * A signed-in visitor presses the button for their aim, the draft arrives marked,
 * the proposal is not sent while it is unconfirmed, and "Keep this" (or an edit)
 * lets it go with no trace of the draft. With Sera down the form still sends.
 * A visitor with no account sees no button at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OPEN_WORDS } from "@shared/openProposals";
import { DRAFT_WORDS } from "@shared/seraDrafts";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const auth = vi.hoisted(() => ({ user: null as null | { name: string; email: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: auth.user }) }));

import ProposeARole from "./ProposeARole";

const FORM = {
  open: true,
  village: "Test Village",
  season: { id: "s-next", name: "Season of Roots", startsOn: "2099-01-01" },
  roles: [{ id: "r-gate", name: "Gate Keeper", circle: "Land Circle", aim: "Open the gate at dawn.", accountabilities: ["Open at dawn"] }],
};
const LETTER = { version: "lv-0123456789abcdef", title: "Membership agreement", body: "Dear friend.", intent: "I align with the Membership agreement.", parts: {} };
const GUIDE = { choice: null, options: [{ id: "saberra", name: "Sera", named: true, available: true }], answering: "saberra", note: null, canChoose: false };

let posted: any[] = [];
let asked: any[] = [];
let seraDown = false;

function serve() {
  posted = [];
  asked = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/governance/proposal-drafts") {
        asked.push(JSON.parse(String(init?.body)));
        return seraDown
          ? json({ error: DRAFT_WORDS.unavailable }, 503)
          : json({ guide: { id: "saberra", name: "Sera" }, note: null, kind: "aim", aim: "The gate opens at dawn, every day." });
      }
      if (init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return json({ sent: true, message: OPEN_WORDS.sent("rowan@example.test") });
      }
      if (String(url).startsWith("/api/guide")) return json(GUIDE);
      if (String(url).startsWith("/api/membership-letter")) return json(LETTER);
      if (String(url).startsWith("/api/profile/alignments")) return json({ alignments: [] });
      return json(FORM);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.user = null;
  seraDown = false;
});

const open = async () => {
  serve();
  render(<ProposeARole />);
  await screen.findByText("Gate Keeper");
  fireEvent.click(within(document.querySelector('[data-role="r-gate"]') as HTMLElement).getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.whyLabel), { target: { value: "The gate is always shut." } });
};
const fillRest = async () => {
  fireEvent.change(screen.getByLabelText("Your commitment"), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.nameLabel), { target: { value: "Rowan Field" } });
  fireEvent.change(screen.getByLabelText(OPEN_WORDS.emailLabel), { target: { value: "rowan@example.test" } });
  fireEvent.click(await screen.findByLabelText(LETTER.intent));
  fireEvent.click(screen.getByLabelText(/confidentiality agreement before I see/));
  fireEvent.click(screen.getByLabelText(/agree to the background check/i));
};

describe("the open form with Ask Sera", () => {
  it("draws no button for a visitor with no account", async () => {
    await open();
    expect(document.querySelector("[data-ask-sera]")).toBeNull();
  });

  it("marks a drafted aim, refuses to send it until it is kept, and sends it with no trace of the draft", async () => {
    auth.user = { name: "Rowan Field", email: "rowan@example.test" };
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Sera for a first draft", description: /a draft of your aim/ }));
    await waitFor(() => expect(screen.getByLabelText(OPEN_WORDS.aimLabel)).toHaveProperty("value", "The gate opens at dawn, every day."));
    // Exactly the allow-listed fields went out.
    expect(asked).toEqual([{ kind: "aim", roles: [{ roleId: "r-gate" }], why: "The gate is always shut.", aim: "" }]);
    expect(screen.getByText("Draft from Sera")).toBeTruthy();

    await fillRest();
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    expect((await screen.findByRole("alert")).textContent).toContain(DRAFT_WORDS.blocked(["aim"]));
    expect(posted).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Keep this" }));
    expect(screen.queryByText("Draft from Sera")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].aim).toBe("The gate opens at dawn, every day.");
    expect(JSON.stringify(posted[0])).not.toMatch(/sera|draft/i);
  });

  it("with Sera down says so plainly and still sends what the person wrote", async () => {
    auth.user = { name: "Rowan Field", email: "rowan@example.test" };
    seraDown = true;
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Sera for a first draft", description: /a draft of your aim/ }));
    expect(await screen.findByText(/Your form works without it/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(OPEN_WORDS.aimLabel), { target: { value: "My own aim." } });
    await fillRest();
    fireEvent.click(screen.getByRole("button", { name: OPEN_WORDS.send }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].aim).toBe("My own aim.");
  });
});
