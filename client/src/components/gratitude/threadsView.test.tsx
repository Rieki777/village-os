// @vitest-environment jsdom
/**
 * THE THREADS AS A READER MEETS THEM: a card with no amount, a web with no
 * number, faces in alphabetical order, a vesica where a thanks went both
 * ways, and a lantern only in its two moments.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { WallEntry, WallPerson } from "@shared/gratitudeVoices";

vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));

import WallEntryCard, { whenLabel } from "./WallEntryCard";
import ThreadWeb from "./ThreadWeb";
import Lantern from "./Lantern";
import { pairKey, personKey } from "./threads";

i18n.load("en", {});
i18n.activate("en");
const wrap = (ui: React.ReactElement) => render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

const p = (name: string): WallPerson => ({ name, handle: name.toLowerCase(), avatar: null });
const entry = (from: WallPerson, to: WallPerson, at = "2026-11-05T10:00:00Z", amount = 37): WallEntry => ({
  id: `${from.name}-${to.name}-${at}`,
  from,
  to,
  amount,
  message: `${from.name} saw ${to.name}`,
  at,
});

describe("WallEntryCard", () => {
  it("shows the words and the two people, and never the amount", () => {
    const { container } = wrap(<WallEntryCard entry={entry(p("Mara"), p("Ana"))} />);
    expect(container.textContent).toContain("Mara saw Ana");
    expect(screen.getByRole("link", { name: "Mara" }).getAttribute("href")).toBe("/profile/mara");
    expect(screen.getByRole("link", { name: "Ana" }).getAttribute("href")).toBe("/profile/ana");
    expect(container.textContent).not.toMatch(/37/);
  });

  it("meets in a vesica and says both ways when the pair thanked each other", () => {
    const { container } = wrap(<WallEntryCard entry={entry(p("Mara"), p("Ana"))} mutual />);
    expect(screen.getByRole("img", { name: "They thanked each other both ways" })).toBeTruthy();
    expect(container.textContent).toContain("Both ways");
    expect(container.querySelector("[data-mutual='true']")).toBeTruthy();
  });

  it("draws a plain thread and no vesica for a thanks one way", () => {
    const { container } = wrap(<WallEntryCard entry={entry(p("Mara"), p("Ana"))} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.textContent).not.toContain("Both ways");
  });

  it("dates a thanks by weekday within the week and by day and month before it", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(whenLabel("2026-11-10T12:00:00Z", "en-US", now)).toBe("Tuesday");
    expect(whenLabel("2026-10-01T12:00:00Z", "en-US", now)).toBe("October 1");
    expect(whenLabel("nonsense", "en-US", now)).toBe("");
  });
});

describe("ThreadWeb", () => {
  const zoe = p("Zoe");
  const ana = p("Ana");
  const bo = p("Bo");
  const rows = [entry(zoe, ana), entry(zoe, bo), entry(ana, zoe), entry(zoe, ana, "2026-11-06T00:00:00Z")];

  it("sets the faces in alphabetical order, whoever is busiest", () => {
    const { container } = wrap(<ThreadWeb entries={rows} />);
    const faces = Array.from(container.querySelectorAll("[data-face]")).map((g) => g.getAttribute("data-face"));
    expect(faces).toEqual(["@ana", "@bo", "@zoe"]);
  });

  it("draws one thread per pair, all at one weight, and lights only the one asked for", () => {
    const { container } = wrap(<ThreadWeb entries={rows} lit={pairKey(zoe, bo)} />);
    const paths = Array.from(container.querySelectorAll("path[data-pair]"));
    expect(paths).toHaveLength(2);
    const lit = paths.filter((x) => x.getAttribute("data-lit") === "true").map((x) => x.getAttribute("data-pair"));
    expect(lit).toEqual([pairKey(zoe, bo)]);
  });

  it("carries no number anywhere a reader or a screen reader meets it", () => {
    const { container } = wrap(<ThreadWeb entries={rows} me={personKey(ana)} />);
    const svg = screen.getByTestId("thread-web");
    expect(svg.getAttribute("aria-label")).not.toMatch(/\d/);
    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe("Lantern", () => {
  it("is on its way while a thanks is carried, with no thread yet", () => {
    wrap(<Lantern moment="carrying" toName="Ana" />);
    expect(screen.getByRole("status").textContent).toBe("Carrying your thanks to Ana");
    expect(screen.queryByTestId("lantern-thread")).toBeNull();
  });

  it("rests over its thread when it arrives, drawn still and whole under reduced motion", () => {
    wrap(<Lantern moment="arrived" toName="Ana" after="It is a thread on the web now." />);
    expect(screen.getByRole("status").textContent).toBe("Your lantern reached Ana");
    expect(screen.getByTestId("lantern-thread")).toBeTruthy();
    expect(screen.getByTestId("lantern").getAttribute("data-motion")).toBe("still");
  });
});
