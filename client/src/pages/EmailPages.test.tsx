// @vitest-environment jsdom
/**
 * The pages an email links to. The contract held here is the one link
 * scanners make necessary: arriving on a page calls only GETs, and the only
 * thing that changes anything is a person pressing something. And a switch
 * follows the server's answer: a refused change leaves it where the village
 * holds it and says why.
 *
 * `Layout` is mocked to a passthrough: the site shell is not what is under
 * test here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { EmailAction, EmailPreferences, EmailUnsubscribe } from "./EmailPages";

type Call = { url: string; method: string; body: any };

const view = (over: Record<string, unknown> = {}) => ({
  village: "Test Village",
  addressHint: "r•••@example.test",
  member: false,
  kinds: [
    { kind: "events", on: true, basis: "implied", source: "a yes to a gathering", changeable: true, note: null },
    { kind: "paths", on: false, basis: null, source: null, changeable: true, note: null },
    { kind: "letters", on: false, basis: null, source: null, changeable: true, note: "We send you an email to confirm first." },
  ],
  pausedUntil: null,
  stopped: false,
  blocked: null,
  ...over,
});

let calls: Call[];

function stubFetch(answer: (call: Call) => { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const call = { url: String(url), method: String(init?.method ?? "GET"), body: init?.body ? JSON.parse(init.body) : null };
      calls.push(call);
      const a = answer(call);
      return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body };
    }),
  );
}

const at = (path: string) => window.history.replaceState({}, "", path);
const writes = () => calls.filter((c) => c.method !== "GET");

describe("the pages an email links to", () => {
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    at("/");
  });

  it("opens the preferences page with a read alone, and changes a switch only when it is pressed", async () => {
    at("/email/preferences?t=tok-prefs");
    stubFetch((c) =>
      c.method === "GET"
        ? { status: 200, body: { view: view() } }
        : { status: 200, body: { view: view({ kinds: view().kinds.map((k) => (k.kind === "paths" ? { ...k, on: true } : k)) }), notice: null } },
    );
    render(<EmailPreferences />);
    expect(await screen.findByRole("heading", { name: "Your email from Test Village" })).toBeTruthy();
    expect(screen.getByText("For r•••@example.test")).toBeTruthy();
    expect(calls).toEqual([{ url: "/api/comms/preferences?t=tok-prefs", method: "GET", body: null }]);

    const paths = screen.getByRole("button", { name: /Path emails/ });
    expect(paths.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(paths);
    await waitFor(() => expect(screen.getByRole("button", { name: /Path emails/ }).getAttribute("aria-pressed")).toBe("true"));
    expect(writes()).toEqual([{ url: "/api/comms/preferences?t=tok-prefs", method: "POST", body: { kind: "paths", on: true } }]);
  });

  it("leaves a refused switch where the village holds it, and says why", async () => {
    at("/email/preferences?t=tok-refused");
    stubFetch((c) =>
      c.method === "GET" ? { status: 200, body: { view: view() } } : { status: 409, body: { error: "You asked us to stop every email." } },
    );
    render(<EmailPreferences />);
    const letters = await screen.findByRole("button", { name: /Letters/ });
    await userEvent.click(letters);
    expect((await screen.findByRole("alert")).textContent).toBe("You asked us to stop every email. Nothing changed.");
    expect(screen.getByRole("button", { name: /Letters/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("asks before stopping everything, and offers only a fresh start once stopped", async () => {
    at("/email/preferences?t=tok-stop");
    stubFetch((c) =>
      c.method === "GET"
        ? { status: 200, body: { view: view() } }
        : { status: 200, body: { view: view({ stopped: true }), notice: "Done. The only email that still comes is the kind you ask for." } },
    );
    render(<EmailPreferences />);
    await userEvent.click(await screen.findByRole("button", { name: "Stop everything" }));
    expect(writes()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Yes, stop everything" }));
    await screen.findByRole("button", { name: "Start again" });
    expect(writes()).toEqual([{ url: "/api/comms/preferences?t=tok-stop", method: "POST", body: { stopEverything: true } }]);
    expect(screen.queryByRole("button", { name: /Path emails/ })).toBeNull();
  });

  it("says what an unsubscribe link stops, and stops it only on the press", async () => {
    at("/email/unsubscribe?t=tok-unsub");
    stubFetch((c) =>
      c.method === "GET"
        ? { status: 200, body: { view: { village: "Test Village", kind: "events", label: "Gathering reminders", done: false, preferencesToken: "tok-p" } } }
        : { status: 200, body: { ok: true, sentence: "Done. You will not get gathering reminders from Test Village." } },
    );
    render(<EmailUnsubscribe />);
    expect(await screen.findByRole("heading", { name: "Stop gathering reminders?" })).toBeTruthy();
    expect(writes()).toEqual([]);
    expect(screen.getByRole("link", { name: "Choose which emails you get" }).getAttribute("href")).toBe("/email/preferences?t=tok-p");
    await userEvent.click(screen.getByRole("button", { name: "Stop gathering reminders" }));
    expect(await screen.findByText("Done. You will not get gathering reminders from Test Village.")).toBeTruthy();
    expect(writes()).toEqual([{ url: "/api/comms/unsubscribe?t=tok-unsub", method: "POST", body: null }]);
  });

  it("draws whatever a purpose describes on the action page, and posts the answer chosen", async () => {
    at("/email/a?t=tok-action");
    const described = {
      purpose: "letters_confirm",
      title: "Letters from Test Village",
      paragraphs: ["Press the button and you will get letters from Test Village."],
      choices: [
        { value: "yes", label: "Yes, send me letters", primary: true },
        { value: "no", label: "No thanks" },
      ],
      current: null,
    };
    stubFetch((c) =>
      c.method === "GET"
        ? { status: 200, body: { purpose: "letters_confirm", description: described } }
        : {
            status: 200,
            body: {
              outcome: {
                ok: true,
                title: "Your letters are on",
                paragraphs: ["Thank you."],
                description: { ...described, title: "You get letters", choices: [{ value: "no", label: "Stop my letters" }], current: "yes" },
              },
            },
          },
    );
    render(<EmailAction />);
    expect(await screen.findByRole("heading", { name: "Letters from Test Village" })).toBeTruthy();
    expect(writes()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Yes, send me letters" }));
    expect(await screen.findByRole("heading", { name: "Your letters are on" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop my letters" })).toBeTruthy();
    expect(writes()).toEqual([{ url: "/api/comms/action?t=tok-action", method: "POST", body: { choice: "yes", text: null } }]);
  });

  it("says how to get a link when there is none, and calls nothing", async () => {
    at("/email/preferences");
    stubFetch(() => ({ status: 500, body: null }));
    render(<EmailPreferences />);
    expect(screen.getByText(/This page needs the link from an email/)).toBeTruthy();
    expect(calls).toEqual([]);
  });
});
