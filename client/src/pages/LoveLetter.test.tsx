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
 *   - a visitor with no account fills in the form and signs it as before;
 *   - the thank-you says what happens next, and nothing the product does not do.
 *
 * Every name is made up.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { letterParts, letterSourceFrom, renderMembershipLetter } from "@shared/membershipLetter";

let signedIn: { id: string; name: string; email: string; handle?: string } | null = null;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Fernhollow" }));
vi.mock("@/hooks/useVillageContent", () => ({ useVillageContent: () => ({ content: null, loading: false, isPlaceholder: false }) }));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => (signedIn ? "a-token" : null),
  gameFetch: (path: string, init?: RequestInit) => fetch(path, init),
  useGameConfig: () => ({ project: { name: "Fernhollow", commitmentName: "Love Letter", memberName: "Elderling" }, currency: { name: "Seeds" } }),
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
/** What `GET /api/me/vouches` answers: one vouch of three, in a village that counts them. */
const ONE_OF_THREE = {
  state: { count: 1, needed: 3, met: false, bySuper: false, off: false, vouchers: ["u-inviter"] },
  sentence: "1 of 3 vouches. 2 more people to go.",
};
let vouchesNow: unknown = ONE_OF_THREE;

beforeEach(() => {
  signedIn = null;
  posts = [];
  answers = [];
  letterNow = FIRST;
  vouchesNow = ONE_OF_THREE;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/membership-letter") return json(letterNow);
    if (url === "/api/me/vouches") return vouchesNow === null ? json({ error: "unavailable" }, 500) : json(vouchesNow);
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
    // The village's own word for a member (Admin, Make This Yours), with its article.
    expect(
      screen.getByText("Read the letter above, add a few words about yourself, and align from your account to join Fernhollow as an Elderling."),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Full Name/)).toBeNull();
    expect(screen.queryByLabelText(/Email Address/)).toBeNull();
    expect(screen.queryByText("Sign Your Membership")).toBeNull();
    expect(screen.getByText(/Read\. Reflect\. Align\./)).toBeTruthy();
    expect(screen.queryByText(/Read\. Reflect\. Sign\./)).toBeNull();
    // Every commitment is the server's, line for line.
    for (const c of FIRST.parts.commitments) expect(screen.getByText(c)).toBeTruthy();

    const user = await fillIn();
    await user.click(screen.getByRole("button", { name: "Align and join Fernhollow" }));
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
    await user.click(screen.getByRole("button", { name: "Align and join Fernhollow" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The letter changed while you were reading it. Read it again, then align.");
    expect(await screen.findByText(NEWER.parts.opening)).toBeTruthy();
    expect(screen.queryByText(FIRST.parts.opening)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Align and join Fernhollow" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].data.letterVersion).toBe(NEWER.version);
  });

  it("the form's own words align; only the letter's own sentence says sign", async () => {
    render(<LoveLetter />);
    await screen.findByText(FIRST.parts.opening);
    const form = screen.getByRole("button", { name: "Align and join Fernhollow" }).closest("form")!;
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
    expect(await screen.findByRole("heading", { name: "Thank you, Juno." })).toBeTruthy();
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

/**
 * THE THANK-YOU SAYS WHAT HAPPENS NEXT, AND ONLY THAT.
 *
 * It told every signer "You are now part of the community", promised a welcome
 * email "within 48 hours" and a personal welcome call, and an invitation to a
 * first Community Circle. Membership waits on the people who look after joining
 * accepting the letter, or on enough vouches, and no code sends any of those.
 * Every case here reads the old promises first, so each one fails on the old
 * words for that reason and no other.
 */
describe("the thank-you says what happens next", () => {
  const OLD_PROMISES = [/now part of/i, /48 hours/i, /welcome email/i, /welcome call/i, /Community Circle/i, /Welcome to the .* Family/i];
  const promisesNothingFalse = () => {
    const page = (document.body.textContent ?? "").replace(/\s+/g, " ");
    for (const promise of OLD_PROMISES) expect(page, `the thank-you still says ${promise}`).not.toMatch(promise);
  };
  const steps = () =>
    Array.from(document.querySelectorAll("[data-next-steps] p")).map((p) => (p.textContent ?? "").replace(/\s+/g, " ").trim());
  const askedForVouches = () => fetchMock.mock.calls.some((c) => c[0] === "/api/me/vouches");
  const settle = () => new Promise((r) => setTimeout(r, 20));

  async function alignAsMember() {
    signedIn = { id: "u-tam", name: "Tamsin Reedwarbler", email: "tam@examples.invalid", handle: "tamsin" };
    render(<LoveLetter />);
    await screen.findByText(FIRST.parts.opening);
    const user = await fillIn();
    await user.click(screen.getByRole("button", { name: "Align and join Fernhollow" }));
    await screen.findByRole("heading", { name: "What happens next" });
  }

  it("a member: the letter waits with the people who look after joining, a notice brings the answer, and members who know them can vouch", async () => {
    await alignAsMember();
    promisesNothingFalse();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Thank you, Tamsin.");
    await waitFor(() => expect(steps()).toHaveLength(3));
    expect(steps()).toEqual([
      "Your letter is with the people who look after joining Fernhollow.",
      "You will get a notice when they answer, and your profile shows where it stands.",
      "Members who know you can also vouch for you on your page. 1 of 3 vouches. 2 more people to go.",
    ]);
    expect(screen.getByRole("link", { name: "your page" }).getAttribute("href")).toBe("/profile/tamsin");
    // The alignment's own words stay as wave 2 wrote them.
    expect(screen.getByRole("link", { name: /kept under What you have aligned with/ }).getAttribute("href")).toBe("/profile");
  });

  it("a member in a village that has turned vouching off is not sent to gather vouches", async () => {
    vouchesNow = { state: { ...ONE_OF_THREE.state, off: true, needed: 0 }, sentence: "This village does not admit by vouches." };
    await alignAsMember();
    promisesNothingFalse();
    await waitFor(() => expect(askedForVouches()).toBe(true));
    await settle();
    expect(steps()).toEqual([
      "Your letter is with the people who look after joining Fernhollow.",
      "You will get a notice when they answer, and your profile shows where it stands.",
    ]);
    expect(screen.queryByRole("link", { name: "your page" })).toBeNull();
  });

  it("a member whose vouches cannot be read is told nothing about them", async () => {
    vouchesNow = null;
    await alignAsMember();
    promisesNothingFalse();
    await waitFor(() => expect(askedForVouches()).toBe(true));
    await settle();
    expect(steps()).toHaveLength(2);
  });

  it("a visitor: somebody writes to the address they gave, and nothing is said about a notice or a page they do not have", async () => {
    render(<LoveLetter />);
    await screen.findByText(FIRST.parts.opening);
    const user = await fillIn(true);
    await user.click(screen.getByRole("button", { name: /Sign the Love Letter/ }));
    await screen.findByRole("heading", { name: "What happens next" });
    promisesNothingFalse();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Thank you, Juno.");
    expect(steps()).toEqual([
      "Your letter is with the people who look after joining Fernhollow.",
      "Someone will write to you at juno@example.test.",
    ]);
    expect(askedForVouches(), "a visitor has no vouches to read").toBe(false);
  });
});
