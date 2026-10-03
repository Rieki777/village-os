// @vitest-environment jsdom
/**
 * A mic that cannot listen must not be shown, and a mic that was refused must
 * say so.
 *
 * Found by the journal QA run on 2026-10-02: the server sent
 * `Permissions-Policy: microphone=()`, every tap failed with `not-allowed`, and
 * the button reset without a word. The header is fixed in server/index.ts; this
 * file holds the button to the two promises that would have made the failure
 * visible.
 *
 * `SR` is read when the module loads, so each case stubs the engine first and
 * imports the component fresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {}
  stop() {
    this.onend?.();
  }
  abort() {}
}

async function loadButton() {
  vi.resetModules();
  return (await import("./MicButton")).default;
}

beforeEach(() => {
  FakeRecognition.last = null;
  vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (document as any).featurePolicy;
});

describe("MicButton", () => {
  it("shows the mic where the engine exists and the policy allows it", async () => {
    (document as any).featurePolicy = { allowsFeature: (f: string) => f === "microphone" };
    const MicButton = await loadButton();
    render(<MicButton onText={() => {}} />);
    expect(screen.getByRole("button", { name: "Speak instead of typing" })).toBeTruthy();
  });

  it("renders nothing when the page's policy denies the microphone", async () => {
    (document as any).featurePolicy = { allowsFeature: () => false };
    const MicButton = await loadButton();
    const { container } = render(<MicButton onText={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("says out loud that the microphone was refused", async () => {
    const MicButton = await loadButton();
    render(<MicButton onText={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak instead of typing" }));
    act(() => {
      FakeRecognition.last?.onerror?.({ error: "not-allowed" });
    });
    expect(screen.getByRole("status").textContent).toContain("The microphone is blocked for this site");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("blocked");
  });

  it("names the connection when speech fails offline", async () => {
    const MicButton = await loadButton();
    render(<MicButton onText={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak instead of typing" }));
    act(() => {
      FakeRecognition.last?.onerror?.({ error: "network" });
    });
    expect(screen.getByRole("status").textContent).toContain("Speaking needs a connection");
  });

  it("appends each finished phrase", async () => {
    const MicButton = await loadButton();
    const heard: string[] = [];
    render(<MicButton onText={(t) => heard.push(t)} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak instead of typing" }));
    act(() => {
      FakeRecognition.last?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: " slept well " }], { isFinal: true })] });
    });
    expect(heard).toEqual(["slept well"]);
  });
});
