// @vitest-environment jsdom
/**
 * THE DEFECT THIS PINS: the closed plaque was read MID-SENTENCE.
 *
 * `InfoTip`'s wrapper is `relative inline-block`, so the plaque node sits in
 * the HOST PARAGRAPH'S INLINE FLOW. While closed it used to be `sr-only`,
 * which is out of the VISUAL flow and fully inside the reading order, so on
 * /campaigns a screen reader read the definition in the middle of the
 * sentence, let the host sentence resume as a fragment after a full stop, and
 * then read the same words AGAIN when the trigger took focus.
 *
 * Nothing that looks at pixels could catch it: it renders perfectly. So the
 * first test here reads the paragraph the way an assistive technology does,
 * skipping the subtrees a browser drops from the accessibility tree, and
 * asserts the sentence comes out whole. The second half of the requirement is
 * the one the old `sr-only` was protecting, and it is asserted beside it:
 * dropping the node entirely would break the description on focus, so the
 * trigger's `aria-describedby` must still resolve to the tip.
 *
 * Every assertion here is about a RELATIONSHIP - reading order, the described
 * -by target, the accessible description, visibility, focus - and never about
 * a class name, because the class name is the implementation and it has
 * already changed once.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import InfoTip from "./InfoTip";

// The real sentence from client/src/pages/Crowdpool.tsx, so this test names
// the copy that produced the reported defect rather than a stand-in.
const TIP =
  "A crowdpool gathers pledges of money, goods, tools and hands for one build. Nothing moves through this page; every claim finishes on the hub's own page.";

const HOST_SENTENCE =
  "What this village is gathering through the hub's crowdpool. Each ring fills as the pool does.";

/**
 * The text an assistive technology reads out of a subtree, in order.
 *
 * A node leaves the accessibility tree when it is `hidden`, when its computed
 * display is none, when it is `visibility: hidden`, or when it is
 * `aria-hidden`. Nothing else drops out - and that is exactly why `sr-only`
 * was the defect: it hides a node from EYES and from nothing else.
 */
function readingOrder(root: HTMLElement): string {
  const win = root.ownerDocument.defaultView;
  if (!win) throw new Error("no window");
  const out: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === child.TEXT_NODE) {
        out.push(child.textContent ?? "");
        continue;
      }
      if (!(child instanceof win.HTMLElement)) continue;
      if (child.hidden) continue;
      if (child.getAttribute("aria-hidden") === "true") continue;
      const style = win.getComputedStyle(child);
      if (style.display === "none" || style.visibility === "hidden") continue;
      walk(child);
    }
  };
  walk(root);
  return out.join("");
}

function renderInParagraph() {
  const view = render(
    <p data-testid="host">
      What this village is gathering through the hub's{" "}
      <InfoTip tip={TIP}>crowdpool</InfoTip>. Each ring fills as the pool does.
    </p>,
  );
  return { ...view, host: screen.getByTestId("host") };
}

describe("InfoTip, closed", () => {
  it("keeps the description out of the host paragraph's reading order", () => {
    const { host } = renderInParagraph();
    expect(readingOrder(host)).toBe(HOST_SENTENCE);
    expect(readingOrder(host)).not.toContain("A crowdpool gathers pledges");
  });

  it("still resolves aria-describedby to the tip, which is what the node is for", () => {
    const { host } = renderInParagraph();
    const trigger = screen.getByRole("button", { name: "crowdpool" });

    // The link itself: the id the trigger names is a node that is still in
    // the DOM, still inside this paragraph, and still carries the tip.
    const id = trigger.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    const target = document.getElementById(id as string);
    expect(target).not.toBeNull();
    expect(host.contains(target)).toBe(true);
    expect(target).toHaveTextContent(TIP);

    // And the computed description, which is what a screen reader announces
    // on focus. This is the half that dropping the node would have broken.
    expect(trigger).toHaveAccessibleDescription(TIP);
  });

  it("leaves the closed plaque out of the accessibility tree while keeping it in the DOM", () => {
    const { host } = renderInParagraph();
    // Role queries exclude inaccessible elements by default, so this pair
    // says "present in the document, absent from the tree" without naming
    // how the component achieves it.
    expect(within(host).queryByRole("tooltip")).toBeNull();
    expect(within(host).getByRole("tooltip", { hidden: true })).toHaveTextContent(TIP);
  });

  it("keeps the tip out of a host heading's accessible name", () => {
    // Fourteen call sites sit inside an h2, h3 or h4. A heading is named from
    // its content, so a closed tip that is still in the tree becomes part of
    // the heading's name, and a screen reader's list of headings read every
    // one of these with its whole definition attached.
    const weightTip =
      "Weight is how much a vote counts. It is read when a ballot opens and frozen there, so a later change never rewrites a vote in flight.";
    render(
      <h3>
        Your weight
        <InfoTip tip={weightTip} label="What voting weight is" />
      </h3>,
    );
    const heading = screen.getByRole("heading", { level: 3 });
    // Asserted as "the tip is not in the name" and not as an exact string:
    // Chromium names this heading "Your weight What voting weight is" (it
    // folds the nested button's label in, as accname says to), while the
    // jsdom-side implementation stops at "Your weight". Either is fine. What
    // is never fine is the tip in the heading.
    expect(heading).toHaveAccessibleName(/^Your weight\b/);
    expect(heading).not.toHaveAccessibleName(/Weight is how much a vote counts/);
    expect(screen.getByRole("button", { name: "What voting weight is" })).toHaveAccessibleDescription(weightTip);
  });

  it("names the bare trigger for screen readers without putting a mark in the sentence", () => {
    render(
      <p data-testid="bare">
        Voice decays each moon
        <InfoTip tip={TIP} label="What is voice decay?" />.
      </p>,
    );
    const host = screen.getByTestId("bare");
    const trigger = screen.getByRole("button", { name: "What is voice decay?" });
    expect(trigger).toHaveAccessibleDescription(TIP);
    expect(readingOrder(host)).toBe("Voice decays each moon.");
  });
});

describe("InfoTip, open", () => {
  it("renders the tip visibly and stays linked to the trigger", async () => {
    const user = userEvent.setup();
    const { host } = renderInParagraph();
    const trigger = screen.getByRole("button", { name: "crowdpool" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const plaque = within(host).getByRole("tooltip");
    expect(plaque).toBeVisible();
    expect(plaque).toHaveTextContent(TIP);
    expect(plaque.id).toBe(trigger.getAttribute("aria-describedby"));
    expect(trigger).toHaveAccessibleDescription(TIP);
    // Fixed from the measured rect, so an overflow-hidden ancestor cannot
    // clip it. Asserted as a computed style, not as a class.
    expect(plaque.style.position).toBe("fixed");
  });

  it("closes on a second tap, and the description survives the round trip", async () => {
    const user = userEvent.setup();
    const { host } = renderInParagraph();
    const trigger = screen.getByRole("button", { name: "crowdpool" });

    await user.click(trigger);
    expect(within(host).getByRole("tooltip")).toBeVisible();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(within(host).queryByRole("tooltip")).toBeNull();
    expect(readingOrder(host)).toBe(HOST_SENTENCE);
    expect(trigger).toHaveAccessibleDescription(TIP);
  });

  it("opens on hover and closes on mouse out for a visitor with a mouse", async () => {
    const user = userEvent.setup();
    const { host } = renderInParagraph();
    const trigger = screen.getByRole("button", { name: "crowdpool" });

    await user.hover(trigger);
    expect(within(host).getByRole("tooltip")).toBeVisible();

    await user.unhover(trigger);
    expect(within(host).queryByRole("tooltip")).toBeNull();
  });
});

describe("InfoTip, keyboard", () => {
  it("Tab reaches the trigger and focus opens the plaque", async () => {
    const user = userEvent.setup();
    const { host } = renderInParagraph();
    const trigger = screen.getByRole("button", { name: "crowdpool" });

    await user.tab();

    expect(trigger).toHaveFocus();
    expect(within(host).getByRole("tooltip")).toBeVisible();
  });

  it("Escape closes it and leaves the sentence whole again", async () => {
    const user = userEvent.setup();
    const { host } = renderInParagraph();
    const trigger = screen.getByRole("button", { name: "crowdpool" });

    await user.tab();
    expect(within(host).getByRole("tooltip")).toBeVisible();

    await user.keyboard("{Escape}");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(within(host).queryByRole("tooltip")).toBeNull();
    expect(readingOrder(host)).toBe(HOST_SENTENCE);
    expect(trigger).toHaveFocus();
  });

  it("Enter toggles the plaque", async () => {
    const user = userEvent.setup();
    const { host } = renderInParagraph();
    const trigger = screen.getByRole("button", { name: "crowdpool" });

    await user.tab();
    await user.keyboard("{Escape}");
    expect(within(host).queryByRole("tooltip")).toBeNull();

    await user.keyboard("{Enter}");
    expect(within(host).getByRole("tooltip")).toBeVisible();

    await user.keyboard("{Enter}");
    expect(within(host).queryByRole("tooltip")).toBeNull();
  });

  it("Space toggles the plaque", async () => {
    const user = userEvent.setup();
    const { host } = renderInParagraph();
    const trigger = screen.getByRole("button", { name: "crowdpool" });

    await user.tab();
    await user.keyboard("{Escape}");
    expect(within(host).queryByRole("tooltip")).toBeNull();

    await user.keyboard(" ");
    expect(within(host).getByRole("tooltip")).toBeVisible();

    await user.keyboard(" ");
    expect(within(host).queryByRole("tooltip")).toBeNull();
  });
});
