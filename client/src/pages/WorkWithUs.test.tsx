// @vitest-environment jsdom
/**
 * The Work With Us page: its page fields (Admin, Pages, Work With Us), and
 * what an empty list of reciprocity options means.
 *
 * A founder who deleted every option in Make it yours, Work With Us saved an
 * empty list, and the page read the list's LENGTH, found zero and drew the
 * four compiled options straight back: the exact words just removed. Worse,
 * the form then demanded one of them be chosen. An empty list is an answer:
 * none, and nothing to choose.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", () => ({
  fetchConfigCached: () => Promise.resolve({ project: { name: "Willowbrook" } }),
  useGameConfig: () => ({ project: { name: "Willowbrook" }, currency: { name: "Thanks" } }),
}));
// Who is looking: null is a signed-out visitor. Reset before every test.
const viewer = vi.hoisted(() => ({ user: null as null | { name: string; email: string; role?: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: viewer.user }) }));
vi.mock("@/components/GuideChat", () => ({ default: () => null }));
vi.mock("@/components/comms/PathConsentBox", () => ({ default: () => null, FORM_CONSENT_FIELD: "commsConsent" }));
const sent = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/proposals", () => ({
  submitProposal: async (...args: unknown[]) => {
    sent.calls.push(args);
    return true;
  },
}));
// What GET /api/content/page-work-with-us answers (null = never saved).
const saved = vi.hoisted(() => ({ page: null as unknown }));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: () => Promise.resolve(saved.page),
}));

import WorkWithUs from "./WorkWithUs";
import { WORK_WITH_US_PAGE } from "@shared/pageContent/workWithUs";
import { markerDocument } from "@shared/pageContent/resolve";

let config: { ok: boolean; body: Record<string, unknown> };
let assistantOn = false;

beforeEach(() => {
  viewer.user = null;
  assistantOn = false;
  saved.page = null;
  sent.calls = [];
  localStorage.clear();
  config = {
    ok: true,
    body: {
      intro: "Bring what you have.",
      assistantName: "Guide",
      assistantGreeting: "",
      reciprocityOptions: [{ value: "Barter", title: "Barter", desc: "Goods for goods." }],
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/work-with-us-config")) {
        return { ok: config.ok, status: config.ok ? 200 : 500, json: async () => config.body };
      }
      if (String(url).includes("/api/assistant/status")) return { ok: true, status: 200, json: async () => ({ available: assistantOn }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch,
  );
});
afterEach(() => vi.unstubAllGlobals());

const FALLBACK_TITLES = ["Financial: Cash", "Tokens", "Joint Venture", "Memorandum of Understanding"];

/** Every required box, so a send gets as far as the reciprocity rule. */
const fillRequired = () => {
  const type = (id: string, value: string) => fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value } });
  type("work-name", "Ana");
  type("work-email", "ana@example.test");
  for (const key of ["work", "serves", "materialsCost", "timeToImplement", "needsFromUs", "maintenance"]) type(`work-${key}`, "Something real.");
};
const send = () => fireEvent.click(screen.getByRole("button", { name: /Send proposal/ }));

describe("every field in the Work With Us spec reaches the page", () => {
  it("renders a distinct marker typed into each field a visitor sees", async () => {
    const doc = markerDocument(WORK_WITH_US_PAGE) as Record<string, Record<string, string>>;
    saved.page = doc;
    render(<WorkWithUs />);

    // The lede shares its paragraph with "Select any that fit.", so match within it.
    expect(await screen.findByText(doc.reciprocity.lede, { exact: false })).toBeTruthy();
    fillRequired();
    fireEvent.click(await screen.findByRole("button", { name: /Barter/ }));
    send();

    expect(await screen.findByRole("heading", { level: 1, name: doc.thanks.heading })).toBeTruthy();
    expect(screen.getByText(doc.thanks.body)).toBeTruthy();
    // The `email` section is the acknowledgement email, which no page draws:
    // server/lib/workWithUsAck.test.ts follows those two markers into it.
  });

  it("says today's words until the village writes its own", async () => {
    render(<WorkWithUs />);
    expect(
      await screen.findByText(/^Willowbrook is built on reciprocity, and there's more than one way to be valued here\./),
    ).toBeTruthy();
    expect(screen.getByText(/Select any that fit\./)).toBeTruthy();
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: /Barter/ }));
    send();
    expect(await screen.findByRole("heading", { level: 1, name: "Your proposal is with us" })).toBeTruthy();
    const thanks = WORK_WITH_US_PAGE.sections.find((s) => s.id === "thanks")!.fields.find((f) => f.key === "body")!.default;
    expect(screen.getByText(thanks.replace("{village}", "Willowbrook"))).toBeTruthy();
    // A reply time is a promise only a village can make, so the starter makes none.
    expect(thanks).not.toMatch(/month|week|day|hour/i);
  });
});

describe("a village that deleted every reciprocity option", () => {
  beforeEach(() => {
    config.body.reciprocityOptions = [];
  });

  it("shows none, never the compiled four", async () => {
    render(<WorkWithUs />);
    await screen.findByText(/is built on reciprocity/);
    await waitFor(() => expect(screen.queryByText(/Select any that fit/)).toBeNull());
    for (const title of FALLBACK_TITLES) expect(screen.queryByText(title), title).toBeNull();
  });

  it("lets a person send without choosing one, since there is nothing to choose", async () => {
    render(<WorkWithUs />);
    await screen.findByText(/is built on reciprocity/);
    fillRequired();
    send();
    await screen.findByRole("heading", { level: 1, name: "Your proposal is with us" });
    expect(sent.calls).toHaveLength(1);
  });
});

describe("a village whose options could not be read", () => {
  it("falls back to the compiled four, so the form still offers something", async () => {
    config.ok = false;
    render(<WorkWithUs />);
    for (const title of FALLBACK_TITLES) expect(await screen.findByText(title)).toBeTruthy();
  });
});

describe("a village that lists options", () => {
  it("still asks for one before sending", async () => {
    render(<WorkWithUs />);
    await screen.findByRole("button", { name: /Barter/ });
    fillRequired();
    send();
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose at least one form of reciprocity that fits.");
    expect(sent.calls).toHaveLength(0);
  });
});

/*
 * THE VILLAGE'S OWN GUIDE, or a neutral label. "Maia" is one village's guide,
 * and this page used to fall back to it for every village that had not named
 * its own (Rye, 2026-10-22). An unnamed guide is never hidden: "the village
 * guide" to visitors and members, "your village guide" to a founder or admin,
 * and only a founder is asked to name it.
 */
describe("the guide's name on Work With Us", () => {
  const talkButton = () => screen.findByRole("button", { name: /Talk it through with/ });
  const prompt = () => screen.queryByRole("link", { name: /Name your guide/ });

  beforeEach(() => {
    assistantOn = true;
    config.body.assistantName = "";
  });

  it("calls an unnamed guide 'the village guide' on the public page, and asks a visitor nothing", async () => {
    render(<WorkWithUs />);
    expect((await talkButton()).textContent?.trim()).toBe("Talk it through with the village guide");
    expect(document.body.textContent).not.toContain("Maia");
    expect(prompt()).toBeNull();
  });

  it("says the same to a signed-in member", async () => {
    viewer.user = { name: "Ana", email: "ana@example.test", role: "member" };
    render(<WorkWithUs />);
    expect((await talkButton()).textContent?.trim()).toBe("Talk it through with the village guide");
    expect(prompt()).toBeNull();
  });

  it("says 'your village guide' to an admin, without the founder's prompt", async () => {
    viewer.user = { name: "Ana", email: "ana@example.test", role: "admin" };
    render(<WorkWithUs />);
    expect((await talkButton()).textContent?.trim()).toBe("Talk it through with your village guide");
    expect(prompt()).toBeNull();
  });

  it("asks a founder to name the guide, and links to the field that does it", async () => {
    viewer.user = { name: "Ana", email: "ana@example.test", role: "founder" };
    render(<WorkWithUs />);
    expect((await talkButton()).textContent?.trim()).toBe("Talk it through with your village guide");
    expect(await screen.findByText("Your village guide has no name yet")).toBeTruthy();
    expect(prompt()).toHaveAttribute("href", "/admin?tab=work-with-us");
  });

  it("uses the village's own name once it has one, and stops asking", async () => {
    config.body.assistantName = "Juniper";
    viewer.user = { name: "Ana", email: "ana@example.test", role: "founder" };
    render(<WorkWithUs />);
    expect((await talkButton()).textContent?.trim()).toBe("Talk it through with Juniper");
    expect(prompt()).toBeNull();
  });

  it("does not ask while the guide is not on the page at all", async () => {
    assistantOn = false;
    viewer.user = { name: "Ana", email: "ana@example.test", role: "founder" };
    render(<WorkWithUs />);
    await screen.findByText(/is built on reciprocity/);
    expect(screen.queryByText(/Talk it through with/)).toBeNull();
    expect(prompt()).toBeNull();
  });
});
