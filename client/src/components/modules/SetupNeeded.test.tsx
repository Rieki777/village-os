// @vitest-environment jsdom
/**
 * The setup hint: it appears when there is something to say, it never blocks,
 * and it never sends a founder somewhere that cannot answer them yet.
 *
 * The last one is the subtle case. Settings live on the module card and are
 * editable while a module is off, so a dial link works at any lifecycle. But
 * content — a room, a product, a circle — is made on the module's OWN admin
 * screen, which the nav rail hides while the module is off and whose routes
 * answer 404 behind requireModule. A link straight there would land on a
 * screen that cannot help, so an off module gets the card and a sentence
 * saying to turn it on first.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SetupNeeded from "./SetupNeeded";

const dial = {
  ready: false,
  hint: "Say which hemisphere this village is in first",
  target: { kind: "setting" as const, key: "calendar.hemisphere", label: "Hemisphere" },
};
const content = {
  ready: false,
  hint: "Post one room and a price first",
  target: { kind: "tab" as const, tab: "stays-admin", label: "Stays" },
};

describe("SetupNeeded", () => {
  it("names the control rather than 'settings'", () => {
    render(<SetupNeeded moduleId="events" setup="required" ready={dial} lifecycle="public" />);
    expect(screen.getByText(/Say which hemisphere/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set Hemisphere" }).getAttribute("href")).toBe(
      "/admin?tab=modules&module=events&setting=calendar.hemisphere",
    );
  });

  it("says nothing when the module is ready, or declares no setup, or has no answer yet", () => {
    const { container: ready } = render(
      <SetupNeeded moduleId="events" setup="required" ready={{ ...dial, ready: true }} lifecycle="public" />,
    );
    expect(ready).toBeEmptyDOMElement();
    const { container: none } = render(
      <SetupNeeded moduleId="forum" setup="none" ready={null} lifecycle="public" />,
    );
    expect(none).toBeEmptyDOMElement();
    const { container: unknown } = render(
      <SetupNeeded moduleId="events" setup="required" ready={null} lifecycle="public" />,
    );
    expect(unknown).toBeEmptyDOMElement();
  });

  it("sends content to the module's own screen while it is on", () => {
    render(<SetupNeeded moduleId="stays" setup="required" ready={content} lifecycle="preview" />);
    expect(screen.getByRole("link", { name: "Open Stays" }).getAttribute("href")).toBe(
      "/admin?tab=stays-admin",
    );
    expect(screen.queryByText(/Turn it on in preview first/)).toBeNull();
  });

  it("sends content to the card while the module is off, and says why", () => {
    render(<SetupNeeded moduleId="stays" setup="required" ready={content} lifecycle="off" />);
    expect(screen.getByRole("link", { name: "Open its settings" }).getAttribute("href")).toBe(
      "/admin?tab=modules&module=stays",
    );
    expect(screen.getByText(/Turn it on in preview first/)).toBeInTheDocument();
  });

  it("says out loud that an optional module can go live anyway", () => {
    // The standing rule is that a warning warns. `required` gates the Go-live
    // card and nothing else; `optional` does not even do that, and saying so
    // is the difference between a nudge and a founder thinking they are stuck.
    render(<SetupNeeded moduleId="tools" setup="optional" ready={content} lifecycle="preview" />);
    expect(screen.getByText(/It can go live without this/)).toBeInTheDocument();
  });
});
