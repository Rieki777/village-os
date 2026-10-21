// @vitest-environment jsdom
/**
 * THE LOVE LETTER PAGE, ALIGNING FROM THE ACCOUNT (seat settings PR9).
 *
 *   - the letter is drawn from the server's words (`GET /api/membership-letter`),
 *     and a member's signing sends back the version it drew;
 *   - a member types no name and no email: the account names them, and the
 *     form's own words say "align", never "sign";
 *   - the server refusing a changed letter (409) draws the new words and says
 *     so, and the next press sends the new version;
 *   - a visitor with no account fills in the form and signs it as before.
 *
 * Every name is made up.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { letterParts, letterSourceFrom, renderMembershipLetter } from "@shared/membershipLetter";

let signedIn: { id: string; name: string; email: string } | null = null;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Fernhollow" }));
vi.mock("@/hooks/useVillageContent", () => ({ useVillageContent: () => ({ content: null, loading: false, isPlaceholder: false }) }));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => (signedIn ? "a-token" : null),
  useGameConfig: () => ({ project: { name: "Fernhollow", commitmentName: "Love Letter" }, currency: { name: "Seeds" } }),
  useVillageLinks: () => ({ contactEmail: "" }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useOptionalAuth: () => (signedIn ? { user: signedIn } : undefined),
}));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import LoveLetter from "./LoveLetter";

/** The letter as the server renders it: its own covenant opening, so the page provably drew the server's words. */
const served = (opening: string, version: string) => {
  const src = letterSourceFrom({ project: { name: "Fernhollow", commitmentName: "Love Letter" }, currency: { name: "Seeds" } }, { covenant: { opening } });
  return { ...renderMembershipLetter(src), version };
};
const FIRST = served("The first grove was planted by the river.", "lv-1111111111111111");
const NEWER = served("The second grove was planted on the hill.", "lv-2222222222222222");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
let posts: Array<Record<string, any>> = [];
let answers: Array<() => Response> = [];
let letterNow = FIRST;

beforeEach(() => {
  signedIn = null;
  posts = [];
  answers = [];
  letterNow = FIRST;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/membership-letter") return json(letterNow);
    if (url === "/api/forms/submit") {
      posts.push(JSON.parse(String(init?.body ?? "{}")));
      return (answers.shift() ?? (() => json({ success: true, id: "1760000000000-abcde" })))();
    }
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fillIn(asVisitor = false) {
  const user = userEvent.setup();
  if (asVisitor) {
    await user.type(screen.getByLabelText(/Full Name/), "Juno Reed");
    await user.type(screen.getByLabelText(/Email Address/), "juno@example.test");
  }
  await user.click(screen.getByRole("button", { name: /Village Steward/ }));
  await user.selectOptions(screen.getByLabelText(/Monthly Membership Contribution/), "33");
  await user.type(screen.getByLabelText(/What called you to/), "The grove.");
  for (const box of screen.getAllByRole("checkbox")) await user.click(box);
  return user;
}

describe("a member aligns from their account", () => {
  beforeEach(() => {
    signedIn = { id: "u-tam", name: "Tamsin Reedwarbler", email: "tam@examples.invalid" };
  });

  it("draws the server's words, asks for no typed name, and sends back the version it drew", async () => {
    render(<LoveLetter />);
    expect(await screen.findByText(FIRST.parts.opening)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Align with the Love Letter" })).toBeTruthy();
    expect(screen.getByText("Aligning as Tamsin Reedwarbler, from your account. No typed name.")).toBeTruthy();
    expect(screen.queryByLabelText(/Full Name/)).toBeNull();
    expect(screen.queryByLabelText(/Email Address/)).toBeNull();
    expect(screen.queryByText("Sign Your Membership")).toBeNull();
    expect(screen.getByText(/Read\. Reflect\. Align\./)).toBeTruthy();
    expect(screen.queryByText(/Read\. Reflect\. Sign\./)).toBeNull();
    // Every commitment is the server's, line for line.
    for (const c of FIRST.parts.commitments) expect(screen.getByText(c)).toBeTruthy();

    const user = await fillIn();
    await user.click(screen.getByRole("button", { name: "Align and join the Fernhollow Family" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].type).toBe("membership-508");
    expect(posts[0].data).toMatchObject({ letterVersion: FIRST.version, name: "Tamsin Reedwarbler", email: "tam@examples.invalid" });
    // Sent with the member's token, so the server knows whose account aligns.
    expect((fetchMock.mock.calls.find((c) => c[0] === "/api/forms/submit")![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer a-token" });
    expect(await screen.findByText("You aligned with the letter. The village has your request.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /kept under What you have aligned with/ }).getAttribute("href")).toBe("/profile");
  });

  it("a letter that changed while they read is drawn again, said out loud, and the next press sends the new version", async () => {
    answers.push(() => json({ error: "letter_changed", message: "The letter changed while you were reading it. Read it again, then align.", letter: NEWER }, 409));
    render(<LoveLetter />);
    await screen.findByText(FIRST.parts.opening);
    const user = await fillIn();
    await user.click(screen.getByRole("button", { name: "Align and join the Fernhollow Family" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The letter changed while you were reading it. Read it again, then align.");
    expect(await screen.findByText(NEWER.parts.opening)).toBeTruthy();
    expect(screen.queryByText(FIRST.parts.opening)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Align and join the Fernhollow Family" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].data.letterVersion).toBe(NEWER.version);
  });

  it("the form's own words align; only the letter's own sentence says sign", async () => {
    render(<LoveLetter />);
    await screen.findByText(FIRST.parts.opening);
    const form = screen.getByRole("button", { name: "Align and join the Fernhollow Family" }).closest("form")!;
    const words = (form.textContent ?? "").replace(/\s+/g, " ");
    expect(words).not.toMatch(/\bsign/i);
  });
});

describe("a visitor with no account", () => {
  it("fills in the form and signs as before; nothing is aligned for them", async () => {
    render(<LoveLetter />);
    await screen.findByText(FIRST.parts.opening);
    expect(screen.getByRole("heading", { name: "Sign Your Membership" })).toBeTruthy();
    expect(screen.getByText(/Read\. Reflect\. Sign\./)).toBeTruthy();
    expect(screen.queryByText(/Aligning as/)).toBeNull();
    const user = await fillIn(true);
    await user.click(screen.getByRole("button", { name: /Sign the Love Letter/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].data).toMatchObject({ name: "Juno Reed", email: "juno@example.test" });
    expect(await screen.findByRole("heading", { name: /Welcome to the Fernhollow Family/ })).toBeTruthy();
    expect(screen.queryByText(/What you have aligned with/)).toBeNull();
  });

  it("CONTROL: before the server's letter lands, the page draws the same rendering from its own config", async () => {
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    render(<LoveLetter />);
    const local = letterParts(letterSourceFrom({ project: { name: "Fernhollow", commitmentName: "Love Letter" }, currency: { name: "Seeds" } }, null));
    expect(screen.getByText(local.greeting)).toBeTruthy();
    expect(screen.getByText(local.opening)).toBeTruthy();
    release(json(FIRST));
    expect(await screen.findByText(FIRST.parts.opening)).toBeTruthy();
    expect(within(document.body).queryByText(local.opening)).toBeNull();
  });
});
