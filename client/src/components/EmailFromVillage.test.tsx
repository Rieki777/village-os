// @vitest-environment jsdom
/**
 * A member's "Email from the village" switches. They are written as the
 * member, through their own account, and a switch follows the server's
 * answer: a refusal leaves it where the village holds it and says why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "member-token" }));

import EmailFromVillage from "./EmailFromVillage";

type Call = { url: string; method: string; body: any; auth: string | null };

const view = (letters: boolean) => ({
  village: "Test Village",
  addressHint: "m•••@example.test",
  member: true,
  kinds: [
    { kind: "events", on: true, basis: "implied", source: "a yes to a gathering", changeable: true, note: null },
    { kind: "paths", on: true, basis: "account", source: "a path chosen in their account", changeable: true, note: null },
    { kind: "letters", on: letters, basis: letters ? "account" : null, source: letters ? "profile" : null, changeable: true, note: null },
    { kind: "notices", on: true, basis: "account", source: "their notification settings", changeable: true, note: null },
  ],
  pausedUntil: null,
  stopped: false,
  blocked: null,
});

let calls: Call[];
let refuse = false;

describe("Email from the village", () => {
  beforeEach(() => {
    calls = [];
    refuse = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const call: Call = {
          url: String(url),
          method: String(init?.method ?? "GET"),
          body: init?.body ? JSON.parse(init.body) : null,
          auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
        };
        calls.push(call);
        if (call.method === "PUT" && refuse) return { ok: false, status: 409, json: async () => ({ error: "That address is stopped." }) };
        const body = call.method === "PUT" ? { view: view(true), notice: null } : { view: view(false), preferencesToken: "tok-p" };
        return { ok: true, status: 200, json: async () => body };
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers reminders, path emails and letters, and saves a switch through the member's own account", async () => {
    render(<EmailFromVillage />);
    const letters = (await screen.findByRole("checkbox", { name: /Letters/ })) as HTMLInputElement;
    expect(screen.getByRole("checkbox", { name: /Gathering reminders/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Path emails/ })).toBeTruthy();
    // Notification emails keep their own switches above this section.
    expect(screen.queryByRole("checkbox", { name: /Your notifications by email/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Every kind of email/ }).getAttribute("href")).toBe("/email/preferences?t=tok-p");
    expect(letters.checked).toBe(false);

    await userEvent.click(letters);
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /Letters/ }) as HTMLInputElement).checked).toBe(true));
    const put = calls.find((c) => c.method === "PUT");
    expect(put).toEqual({ url: "/api/comms/me", method: "PUT", body: { kind: "letters", on: true }, auth: "Bearer member-token" });
  });

  it("leaves a refused switch where it was, and says why", async () => {
    refuse = true;
    render(<EmailFromVillage />);
    const letters = (await screen.findByRole("checkbox", { name: /Letters/ })) as HTMLInputElement;
    await userEvent.click(letters);
    expect((await screen.findByRole("status")).textContent).toBe("That address is stopped. This setting is unchanged.");
    expect((screen.getByRole("checkbox", { name: /Letters/ }) as HTMLInputElement).checked).toBe(false);
  });
});
