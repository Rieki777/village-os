// @vitest-environment jsdom
/**
 * The sealing-key banner at the top of Admin, Integrations, and the Save button
 * on each card.
 *
 * On 2026-10-02 a founder set VILLAGE_SECRETS_KEY in the wrong shape and every
 * message said "not set". The page now says what the server says is wrong,
 * before anybody types a key, with the steps that fix it; and a card's Save
 * says why it will refuse instead of taking a pasted key and bouncing it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SecretsKeyBanner, { SECRETS_KEY_BANNER_ID, SealedSaveButton } from "./SecretsKeyBanner";

const PROBLEM =
  "VILLAGE_SECRETS_KEY is set, but it is 66 characters with quotes around it. " +
  "It must be exactly 64 characters, using only 0-9 and a-f, with nothing else in the value.";

afterEach(() => cleanup());

describe("SecretsKeyBanner", () => {
  it("shows the server's problem sentence and the five steps when the key is not usable", () => {
    const { container } = render(<SecretsKeyBanner status={{ configured: false, problem: PROBLEM }} />);
    expect(screen.getByText(PROBLEM)).toBeTruthy();
    const steps = Array.from(container.querySelectorAll("ol > li")).map((li) => li.textContent ?? "");
    expect(steps).toHaveLength(5);
    expect(steps[0]).toContain("openssl rand -hex 32");
    // PowerShell has no openssl, so Windows gets the node one-liner.
    expect(steps[0]).toContain(`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
    expect(steps[1]).toContain("password manager");
    expect(steps[1]).toContain("unreadable");
    // The Railway path, the service it belongs on, and the exact value shape.
    expect(steps[2]).toContain("then Variables, then New Variable");
    expect(steps[2]).toContain("never the database");
    expect(steps[2]).toContain("VILLAGE_SECRETS_KEY");
    expect(steps[2]).toContain("no quotes, no spaces, no name");
    expect(steps[2]).toContain("Deploy if Railway shows staged changes");
    expect(steps[2]).toContain("Active");
    expect(steps[3]).toContain("restart");
    expect(steps[4]).toContain("save your keys");
    expect(container.querySelector(`#${SECRETS_KEY_BANNER_ID}`)).toBeTruthy();
  });

  it("renders nothing when the key is usable", () => {
    const { container } = render(<SecretsKeyBanner status={{ configured: true, problem: null }} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing before the server has answered, or from a server that does not say", () => {
    // Loading, and an older server with no `villageSecretsKey` in its payload,
    // are not a missing key and must not be announced as one.
    expect(render(<SecretsKeyBanner status={undefined} />).container.innerHTML).toBe("");
    expect(render(<SecretsKeyBanner status={null} />).container.innerHTML).toBe("");
  });
});

describe("SealedSaveButton", () => {
  it("says why it will refuse, and stays shut, while the key is not usable", () => {
    const onSave = vi.fn();
    render(<SealedSaveButton status={{ configured: false, problem: PROBLEM }} busy={false} empty={false} onSave={onSave} />);
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Save needs VILLAGE_SECRETS_KEY");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBe(SECRETS_KEY_BANNER_ID);
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("is the ordinary Save once the key is usable, and saves", () => {
    const onSave = vi.fn();
    render(<SealedSaveButton status={{ configured: true, problem: null }} busy={false} empty={false} onSave={onSave} />);
    const button = screen.getByRole("button", { name: "Save" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps the old rules otherwise: shut while busy or empty, open from a server that does not say", () => {
    const { rerender } = render(<SealedSaveButton status={undefined} busy={false} empty onSave={() => {}} />);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<SealedSaveButton status={undefined} busy empty={false} onSave={() => {}} />);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<SealedSaveButton status={undefined} busy={false} empty={false} onSave={() => {}} />);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
