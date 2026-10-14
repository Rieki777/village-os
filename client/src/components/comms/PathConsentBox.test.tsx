// @vitest-environment jsdom
/**
 * The "walk me through the next steps" box on the public path forms (the
 * comms build spec 5.11). Pinned: it reads the village's own words, it is
 * drawn unticked, ticking it reaches the form, and while the village's email
 * is off (or the read fails) no box is drawn at all, so nothing is promised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PathConsentBox, { FORM_CONSENT_FIELD } from "./PathConsentBox";

const fetchMock = vi.fn();
const answer = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

let seen: boolean[] = [];
function Form() {
  const [consent, setConsent] = useState(false);
  seen.push(consent);
  return <PathConsentBox checked={consent} onChange={setConsent} />;
}

beforeEach(() => {
  seen = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the path consent box", () => {
  it("shows the village's own words, unticked, and a tick reaches the form", async () => {
    fetchMock.mockReturnValue(answer({ show: true, text: "Send me the next steps. Stop any time." }));
    render(<Form />);
    const box = await screen.findByRole("checkbox", { name: "Send me the next steps. Stop any time." });
    expect(fetchMock).toHaveBeenCalledWith("/api/comms/consent");
    expect((box as HTMLInputElement).checked).toBe(false);
    await userEvent.click(box);
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(seen.at(-1)).toBe(true);
  });

  it("draws nothing while the village's email is off", async () => {
    fetchMock.mockReturnValue(answer({ show: false, text: "" }));
    const { container } = render(<Form />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("input")).toBeNull();
  });

  it("draws nothing when the words cannot be read", async () => {
    fetchMock.mockReturnValue(answer({ error: "nope" }, 500));
    const { container } = render(<Form />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("input")).toBeNull();
  });

  it("names the field the server reads", () => {
    expect(FORM_CONSENT_FIELD).toBe("commsConsent");
  });
});
