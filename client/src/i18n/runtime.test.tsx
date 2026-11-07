// @vitest-environment jsdom
import { Trans, useLingui } from "@lingui/react/macro";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "./LocaleProvider";

function Probe() {
  const { t } = useLingui();
  return (
    <button aria-label={t`Close the panel now`}>
      <Trans>Hello from a component</Trans>
    </button>
  );
}

describe("the Lingui runtime outside a provider", () => {
  it("renders English instead of throwing, so a component renders on its own (tests, portals)", () => {
    render(<Probe />);
    expect(screen.getByText("Hello from a component")).toBeTruthy();
    expect(screen.getByLabelText("Close the panel now")).toBeTruthy();
  });

  it("inside the provider it still renders, through the provider's context", async () => {
    render(
      <LocaleProvider sources={{ browser: ["en"], villageDefault: null }} fetchCatalog={async () => ({ messages: {} })}>
        <Probe />
      </LocaleProvider>,
    );
    expect(await screen.findByText("Hello from a component")).toBeTruthy();
  });
});
