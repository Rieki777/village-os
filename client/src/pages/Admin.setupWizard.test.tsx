// @vitest-environment jsdom
/**
 * The Setup Wizard has to survive being typed into.
 *
 * WHAT THE FOUNDER REPORTED. "Every time I type a single letter into the forms
 * here it takes down my dialogue keyboard box on mobile." One letter, keyboard
 * gone, on the first screen every new village meets.
 *
 * WHAT WAS ACTUALLY HAPPENING. `Section` was declared with `const Section =
 * ({...}) => ...` INSIDE `SetupWizard`'s body, so every render produced a new
 * function value, and a new function value is a new component TYPE. React
 * matches an element against the previous tree by type identity, and a type
 * that never matches cannot be updated, only replaced: the whole subtree is
 * unmounted and a fresh one mounted in its place. Typing a letter calls
 * `setField`, `setField` calls `setBrand`, the re-render throws away the
 * `<input>` the founder was typing into and inserts a different DOM node with
 * the same markup. A browser gives focus to a NODE, so focus dies with the old
 * node. On a desktop that reads as a cursor that will not stay put. On a phone
 * the on-screen keyboard is bound to the focused element, so it drops.
 *
 * WHY THE ASSERTIONS ARE ABOUT NODE IDENTITY AND NOT ABOUT A KEYBOARD. jsdom
 * has no on-screen keyboard to observe, and neither does any headless browser.
 * The keyboard is downstream of one fact the DOM does expose: whether the
 * element the founder focused is still the element in the document, still
 * focused, after the state update. Assert the cause, not the symptom, because
 * the cause is the thing a future edit can silently reintroduce.
 *
 * `toBe` and not `toEqual` throughout, deliberately. Two different `<input>`
 * nodes carrying identical attributes are `toEqual` each other and are exactly
 * the bug. Only reference identity can tell a survived node from a replacement.
 *
 * THIS TEST WAS RED FIRST. Run against the nested `Section`, the first
 * keystroke assertion failed with the input detached and `document.activeElement`
 * back on `<body>`. A regression test that has never failed is a test of
 * nothing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SetupWizard } from "./Admin";

/**
 * Placeholders are the handle these inputs give a test. The labels in the
 * wizard are bare `<label>` elements with no `htmlFor` and the inputs carry no
 * id, so `getByLabelText` cannot reach them; the placeholder is the platform
 * default and is rendered straight onto the input. These fixture values are
 * deliberately unlike anything the real defaults hold, so a query can never
 * match by accident.
 */
const PLACEHOLDER_NAME = "FIXTURE-PROJECT-NAME";
const PLACEHOLDER_TAGLINE = "FIXTURE-TAGLINE";

const IMAGE_KEYS = [
  "hero", "investorHero", "residentHero", "stewardHero", "prosperityHero",
  "masterPlanHero", "logo", "heartLogo", "favicon",
];

const brandDoc = () => ({
  project: { name: "", tagline: "", memberName: "", location: "", siteUrl: "", eventsUrl: "", contactEmail: "", footerBlurb: "" },
  currency: { name: "", nameLower: "" },
  images: Object.fromEntries(IMAGE_KEYS.map((k) => [k, ""])),
  setup: {},
});

const defaultsDoc = () => ({
  project: {
    name: PLACEHOLDER_NAME,
    tagline: PLACEHOLDER_TAGLINE,
    memberName: "FIXTURE-MEMBER",
    location: "FIXTURE-LOCATION",
    siteUrl: "",
    eventsUrl: "",
    contactEmail: "",
    footerBlurb: "",
  },
  currency: { name: "FIXTURE-CURRENCY", nameLower: "fixture-currency" },
  images: Object.fromEntries(IMAGE_KEYS.map((k) => [k, ""])),
});

/**
 * One stub for every route this screen reaches. The wizard itself only needs
 * `/api/admin/brand`; the rest of the answers are for the panels it renders
 * inside its steps (look, typography, identity pack, map skin, walk editor,
 * map vocabulary), which each load on mount. They are not what is under test,
 * and a stub that answers them with an empty document keeps them quiet without
 * mocking away parts of the tree the real screen renders.
 */
const stubFetch = () => {
  // The stub holds the village's record and applies writes to it, the way the
  // real route does. A stub that answered every PUT with the same blank
  // document would silently undo whatever the test had just saved, and the
  // assertion about a ticked box would then be measuring the stub.
  const current: any = brandDoc();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const path = String(url);
      if (path.includes("/admin/brand")) {
        if (init?.method === "PUT") Object.assign(current, JSON.parse(init.body));
        return { ok: true, json: async () => ({ brand: current, defaults: defaultsDoc() }) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
};

describe("SetupWizard keeps focus while a founder types", () => {
  beforeEach(stubFetch);
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const openWizard = async () => {
    render(<SetupWizard password="secret" onOpenTab={() => {}} />);
    return await screen.findByPlaceholderText(PLACEHOLDER_NAME);
  };

  it("holds the same input node, still focused, after every keystroke", async () => {
    const user = userEvent.setup();
    const input = await openWizard();

    input.focus();
    expect(document.activeElement).toBe(input);

    // Five letters, checked one at a time. The founder's report is about the
    // FIRST letter, so each keystroke gets its own assertion and the failure
    // message names the exact one that broke.
    const letters = ["A", "m", "o", "r", "a"];
    for (let i = 0; i < letters.length; i += 1) {
      await user.keyboard(letters[i]);

      const now = screen.getByPlaceholderText(PLACEHOLDER_NAME);
      expect(now, `input node was replaced on keystroke ${i + 1} ("${letters[i]}")`).toBe(input);
      expect(
        document.activeElement,
        `focus left the input on keystroke ${i + 1} ("${letters[i]}"), which is what drops the phone keyboard`,
      ).toBe(input);
      expect(input).toHaveValue(letters.slice(0, i + 1).join(""));
    }
  });

  it("keeps the surrounding step mounted, so nothing inside it is rebuilt mid-edit", async () => {
    const user = userEvent.setup();
    const input = await openWizard();

    // The step header is the top of the subtree that was being thrown away.
    // Pinning it as well as the input says the fix hoisted the section rather
    // than papering over the symptom at one field.
    const heading = screen.getByRole("heading", { name: "Identity" });
    const step = heading.closest("div.border");
    expect(step).not.toBeNull();

    input.focus();
    await user.keyboard("x");

    expect(screen.getByRole("heading", { name: "Identity" })).toBe(heading);
    expect(screen.getByRole("heading", { name: "Identity" }).closest("div.border")).toBe(step);
  });

  /**
   * The one thing the hoist genuinely rewired. Inside `SetupWizard`'s body the
   * checkbox read `brand.setup?.[id]` and called `toggleStep(id)` straight out
   * of the closure; at module scope both arrive as props. A step that stopped
   * ticking, or that ticked without saving, would be a silent regression the
   * focus tests above could never see.
   */
  it("still ticks a self-reported step and saves it", async () => {
    const user = userEvent.setup();
    await openWizard();

    const numbers = screen.getByRole("heading", { name: "Numbers" }).closest("div.border")!;
    const box = within(numbers as HTMLElement).getByRole("checkbox");
    expect(box).not.toBeChecked();

    await user.click(box);

    const put = (globalThis.fetch as any).mock.calls.find((c: any[]) => c[1]?.method === "PUT");
    expect(put, "ticking the box saved nothing").toBeTruthy();
    expect(JSON.parse(put[1].body)).toEqual({ setup: { numbers: true } });
    expect(within(numbers as HTMLElement).getByRole("checkbox")).toBeChecked();
  });

  it("holds focus in a second field too, so the fix is the section and not one input", async () => {
    const user = userEvent.setup();
    await openWizard();
    const tagline = screen.getByPlaceholderText(PLACEHOLDER_TAGLINE);

    tagline.focus();
    await user.keyboard("healing");

    expect(screen.getByPlaceholderText(PLACEHOLDER_TAGLINE)).toBe(tagline);
    expect(document.activeElement).toBe(tagline);
    expect(tagline).toHaveValue("healing");
  });
});
