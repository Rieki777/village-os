// @vitest-environment jsdom
/**
 * The character select, audited and held.
 *
 * Five separate defects met on this page, and four of them are invisible to
 * anyone testing with a mouse, a working network and their eyes:
 *
 *   - a failed paths read left the word "Looking." on screen permanently;
 *   - the pronoun and skin-tone toggles carried selection in COLOUR ALONE,
 *     so a screen reader could not tell which was live before or after
 *     pressing;
 *   - the thirty class buttons took their names from the image inside them,
 *     so one broken sprite renamed the whole rail to single letters;
 *   - the Leave button fired an irreversible DELETE on the first tap of a
 *     28px target four pixels from its Front twin, and said nothing when it
 *     failed;
 *   - nothing on the page was announced at all.
 *
 * Each of those is a test below, and each asserts the BEHAVIOUR, so a later
 * refactor that keeps the class names and loses the fix still fails.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Rowan Fell" } }),
}));

import { TOKEN_KEY } from "@/lib/gameApi";
import { PROFILE_REFRESH_EVENT } from "@/lib/profileRefresh";
import Characters from "./Characters";

const archetypes = [
  {
    key: "steward",
    name: "The Steward",
    subtitle: "Keeper of what is held in common",
    blurb: "You look after what everyone depends on.",
    examples: ["Tends the water system"],
  },
  {
    key: "weaver",
    name: "The Weaver",
    subtitle: "Maker of connection",
    blurb: "You put people in the same room.",
    examples: [],
  },
];
const party = [
  {
    id: "c1",
    archetypeKey: "steward",
    presentation: "f",
    tone: "olive",
    avatar: "/images/a.webp",
    isPrimary: true,
  },
];

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const boom = { ok: false, status: 500, json: async () => ({}) };

const store = new Map<string, string>();
const stubStorage = () =>
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  });

type Answer = (path: string, init?: RequestInit) => Promise<any>;

/** Every read this page makes lands, unless a test says otherwise. */
const happy: Answer = async (path) => {
  if (path.includes("/paths")) return ok({ roles: [], questCount: 4 });
  if (path === "/api/archetypes") return ok(archetypes);
  if (path.includes("/api/me/characters")) return ok({ party });
  return ok({});
};

const routing = (answer: Answer) =>
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => answer(String(path), init)),
  );

const live = (container: HTMLElement) =>
  container.querySelector("[aria-live='polite']")?.textContent ?? "";

beforeEach(() => {
  store.clear();
  store.set(TOKEN_KEY, "a-session");
  stubStorage();
  window.history.pushState({}, "", "/profile/characters");
});

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

describe("Characters: a failure is not an emptiness", () => {
  it("leaves 'Looking.' on screen only while the paths read is out", async () => {
    routing(async (path) => {
      if (path.includes("/paths")) return new Promise(() => {});
      return happy(path);
    });
    const { container } = render(<Characters />);

    await waitFor(() => expect(container.textContent).toContain("Looking."));
  });

  it("replaces 'Looking.' with a failure and a retry when the paths read dies", async () => {
    let fail = true;
    routing(async (path) => {
      if (path.includes("/paths")) return fail ? boom : ok({ roles: [], questCount: 4 });
      return happy(path);
    });
    const { container } = render(<Characters />);

    await waitFor(() => expect(container.textContent).toContain("The open paths did not load"));
    expect(container.textContent).not.toContain("Looking.");
    // And it does NOT claim the village has no roles for this class, which is
    // what the same absence used to render as further down.
    expect(container.textContent).not.toContain("No roles carry this tag yet");

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(container.textContent).toContain("No roles carry this tag yet"));
  });

  it("says the party did not load instead of drawing no party section", async () => {
    routing(async (path, init) => {
      if (path === "/api/me/characters" && !init?.method) return boom;
      return happy(path, init);
    });
    const { container } = render(<Characters />);

    await waitFor(() => expect(container.textContent).toContain("Your party did not load"));
  });
});

describe("Characters: the two toggles say what is selected", () => {
  it("puts both groups in a labelled radiogroup with a checked radio", async () => {
    routing(happy);
    render(<Characters />);

    // The party read resets presentation and tone to the saved look, so wait
    // for it to land before pressing anything: otherwise the assertion races
    // an effect that is doing its job.
    await screen.findByRole("button", { name: "Leave The Steward" });
    const pronouns = await screen.findByRole("radiogroup", { name: "Presentation" });
    const she = within(pronouns).getByRole("radio", { name: "She" });
    const he = within(pronouns).getByRole("radio", { name: "He" });
    expect(she.getAttribute("aria-checked")).toBe("true");
    expect(he.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(he);
    expect(he.getAttribute("aria-checked")).toBe("true");
    expect(she.getAttribute("aria-checked")).toBe("false");
  });

  it("moves and selects on the arrow keys, and rovers the tabindex", async () => {
    routing(happy);
    render(<Characters />);
    await screen.findByRole("button", { name: "Leave The Steward" });

    const pronouns = await screen.findByRole("radiogroup", { name: "Presentation" });
    const she = within(pronouns).getByRole("radio", { name: "She" });
    const he = within(pronouns).getByRole("radio", { name: "He" });

    // Only the selected radio is in the tab order, which is what makes a
    // radiogroup one stop rather than N.
    expect(she.getAttribute("tabindex")).toBe("0");
    expect(he.getAttribute("tabindex")).toBe("-1");

    // Saying role="radio" promises arrow-key selection. It has to be real.
    fireEvent.keyDown(she, { key: "ArrowRight" });
    expect(he.getAttribute("aria-checked")).toBe("true");
    expect(he.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(he);

    // And it wraps, in both directions.
    fireEvent.keyDown(he, { key: "ArrowRight" });
    expect(she.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(she, { key: "ArrowUp" });
    expect(he.getAttribute("aria-checked")).toBe("true");
  });

  it("gives the three swatches the same arrow-key behaviour", async () => {
    routing(happy);
    render(<Characters />);
    await screen.findByRole("button", { name: "Leave The Steward" });

    const tones = await screen.findByRole("radiogroup", { name: "Skin tone" });
    const olive = within(tones).getByRole("radio", { name: "Olive skin tone" });
    const light = within(tones).getByRole("radio", { name: "Light skin tone" });
    const deep = within(tones).getByRole("radio", { name: "Deep skin tone" });

    expect(olive.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(olive, { key: "ArrowRight" });
    expect(light.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(light, { key: "ArrowRight" });
    expect(deep.getAttribute("aria-checked")).toBe("true");
  });

  it("names each swatch as a skin tone, and holds the 44px floor", async () => {
    routing(happy);
    render(<Characters />);

    const tones = await screen.findByRole("radiogroup", { name: "Skin tone" });
    const deep = within(tones).getByRole("radio", { name: "Deep skin tone" });
    const olive = within(tones).getByRole("radio", { name: "Olive skin tone" });
    expect(within(tones).getByRole("radio", { name: "Light skin tone" })).toBeTruthy();
    // "Deep" on its own said nothing about what it was deep about.
    expect(within(tones).queryByRole("radio", { name: "Deep" })).toBeNull();

    expect(olive.getAttribute("aria-checked")).toBe("true");
    expect(deep.getAttribute("aria-checked")).toBe("false");
    // h-10/w-10 was 40px. Every sibling control on this page is already 44.
    expect(deep.className).toContain("h-11");
    expect(deep.className).toContain("w-11");
    expect(deep.className).not.toContain("h-10");
  });
});

describe("Characters: the class rail keeps its names", () => {
  it("names each class button on the button, so a broken portrait cannot rename it", async () => {
    routing(happy);
    const { container } = render(<Characters />);

    const steward = await screen.findByRole("button", { name: /^The Steward/ });
    expect(steward.getAttribute("aria-label")).toBe("The Steward");

    // Break every portrait in the rail. The names must survive it.
    for (const img of Array.from(container.querySelectorAll("nav img"))) {
      fireEvent.error(img);
    }
    await waitFor(() =>
      expect(container.querySelectorAll("nav img").length).toBe(0),
    );
    expect(screen.getByRole("button", { name: /^The Steward/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^The Weaver/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "S" })).toBeNull();
    expect(screen.queryByRole("button", { name: "W" })).toBeNull();
  });

  it("says in text that a class is already in the party", async () => {
    routing(happy);
    render(<Characters />);

    // `description` computes the accessible description the way an assistive
    // technology does, through aria-describedby, so this is the fact rather
    // than the markup that carries it.
    expect(
      await screen.findByRole("button", { name: "The Steward", description: "In your party" }),
    ).toBeTruthy();
    // The star was the only signal, and an icon carries no text.
    const weaver = screen.getByRole("button", { name: "The Weaver" });
    expect(weaver.getAttribute("aria-describedby")).toBeNull();
    expect(weaver.textContent).not.toContain("In your party");
  });
});

describe("Characters: leaving a character asks first", () => {
  it("does not DELETE on the first tap", async () => {
    const spy = vi.fn((path: string, init?: RequestInit) => happy(String(path), init));
    vi.stubGlobal("fetch", spy);
    const { container } = render(<Characters />);

    fireEvent.click(await screen.findByRole("button", { name: "Leave The Steward" }));

    expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(
      false,
    );
    expect(container.textContent).toContain("Leaving removes The Steward from your party for good");
  });

  it("DELETEs on the confirm, and announces it", async () => {
    const spy = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return ok({ party: [] });
      return happy(String(path), init);
    });
    vi.stubGlobal("fetch", spy);
    const heard = vi.fn();
    window.addEventListener(PROFILE_REFRESH_EVENT, heard);
    const { container } = render(<Characters />);

    fireEvent.click(await screen.findByRole("button", { name: "Leave The Steward" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() =>
      expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(
        true,
      ),
    );
    await waitFor(() => expect(live(container)).toContain("The Steward left your party"));
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(PROFILE_REFRESH_EVENT, heard);
  });

  it("backs out of the armed state on Keep, with no request", async () => {
    const spy = vi.fn((path: string, init?: RequestInit) => happy(String(path), init));
    vi.stubGlobal("fetch", spy);
    const { container } = render(<Characters />);

    fireEvent.click(await screen.findByRole("button", { name: "Leave The Steward" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    await waitFor(() =>
      expect(container.textContent).not.toContain("Leaving removes The Steward"),
    );
    expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(
      false,
    );
  });

  it("says so when the DELETE is refused, instead of changing nothing in silence", async () => {
    routing(async (path, init) => (init?.method === "DELETE" ? boom : happy(path, init)));
    const { container } = render(<Characters />);

    fireEvent.click(await screen.findByRole("button", { name: "Leave The Steward" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    // The page's existing role="alert" is where a refusal belongs.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("could not leave"),
    );
    expect(live(container)).toContain("could not leave");
  });

  it("keeps both corner controls at the coarse-pointer floor", async () => {
    routing(happy);
    render(<Characters />);

    const leave = await screen.findByRole("button", { name: "Leave The Steward" });
    const front = screen.getByRole("button", { name: "Front The Steward" });
    for (const b of [leave, front]) {
      expect(b.className).toContain("pointer-coarse:min-h-11");
      expect(b.className).toContain("pointer-coarse:min-w-11");
    }
  });
});

describe("Characters: the page speaks", () => {
  it("announces the class that took the stage", async () => {
    routing(happy);
    const { container } = render(<Characters />);

    fireEvent.click(await screen.findByRole("button", { name: /^The Weaver/ }));
    await waitFor(() => expect(live(container)).toContain("The Weaver is on the stage"));
  });

  it("announces a path walked, and tells the rest of the profile to re-read", async () => {
    const heard = vi.fn();
    window.addEventListener(PROFILE_REFRESH_EVENT, heard);
    routing(async (path, init) => {
      if (path === "/api/me/characters" && init?.method === "POST") return ok({});
      return happy(path, init);
    });
    const { container } = render(<Characters />);

    fireEvent.click(await screen.findByRole("button", { name: /^The Weaver/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Walk this path" }));

    await waitFor(() => expect(live(container)).toContain("The Weaver joined your party"));
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(PROFILE_REFRESH_EVENT, heard);
  });

  it("announces a save that did not land", async () => {
    routing(async (path, init) => {
      if (path === "/api/me/characters" && init?.method === "POST") {
        throw new TypeError("network");
      }
      return happy(path, init);
    });
    const { container } = render(<Characters />);

    fireEvent.click(await screen.findByRole("button", { name: /^The Weaver/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Walk this path" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("did not save"));
    expect(live(container)).toContain("did not save");
  });
});
