// @vitest-environment jsdom
/**
 * Two seats, one person, and the SVG id they used to share.
 *
 * An `id` in SVG is document-wide, and `url(#id)` resolves to the FIRST
 * element carrying it in document order. The face clip was keyed on the
 * holder and the seat's coordinates:
 *
 *     `seat-face-${h.userId ?? i}-${x.toFixed(0)}-${y.toFixed(0)}`
 *
 * and BOTH map call sites pass `x={0} y={0}`, placing the glyph with a
 * transform instead. So every seat on the map emitted the same string,
 * `seat-face-<userId>-0-0`, and a person holding two seats put two clipPaths
 * with one id into the page.
 *
 * WHY NOBODY SAW IT. The geometry matched too, so the wrong clip and the right
 * clip were the same circle. They stop matching the moment the two seats fan a
 * different number of faces: alone, a face fills the seat; one of three sits at
 * 62% off-centre. The second seat is then clipped by the FIRST seat's circle,
 * at the wrong size and the wrong place. Rare while few people hold two seats.
 * Ordinary once faces can be dragged onto seats, which is the point of the
 * people inventory.
 *
 * So the test is about UNIQUENESS, not about pixels: no two clipPaths in one
 * document may share an id, and every `clipPath="url(#…)"` must point at one
 * that exists.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import SeatGlyph from "./SeatGlyph";
import type { PowerHolder } from "./types";

const holder = (userId: string, over: Partial<PowerHolder> = {}): PowerHolder =>
  ({ userId, name: "Bo", avatar: "/uploads/bo.webp", lapsed: false, ...over }) as PowerHolder;

/** Both map call sites pass x=0, y=0 and place the glyph with a transform. */
const glyph = (holders: PowerHolder[], key: string) => (
  <g key={key} transform={`translate(${key === "a" ? 10 : 200} 40)`}>
    <SeatGlyph x={0} y={0} r={12} state="filled" held={holders.length} seats={3} holders={holders} showAvatars />
  </g>
);

const idsIn = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("clipPath")).map((c) => c.getAttribute("id") ?? "");

describe("a face clip is unique to the glyph that drew it", () => {
  it("gives two seats held by ONE person two different clip ids", () => {
    // The exact shape that collided: same userId, both call sites at 0,0.
    const { container } = render(
      <svg>
        {glyph([holder("u-bo")], "a")}
        {glyph([holder("u-bo")], "b")}
      </svg>,
    );
    const ids = idsIn(container as unknown as HTMLElement);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size, `two clipPaths shared an id: ${ids.join(", ")}`).toBe(2);
  });

  it("keeps every id unique when the two seats fan different numbers of faces", () => {
    // The case where the collision stops being invisible: alone a face fills
    // the seat, one of three sits off-centre, so the shared clip would be the
    // wrong circle rather than a duplicate of the right one.
    const { container } = render(
      <svg>
        {glyph([holder("u-bo")], "a")}
        {glyph([holder("u-bo"), holder("u-ada"), holder("u-kit")], "b")}
      </svg>,
    );
    const ids = idsIn(container as unknown as HTMLElement);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("points every image at a clipPath that is actually in the document", () => {
    // Uniqueness is only half of it: the reference has to resolve, and an id
    // React returns looks like `:r1:`, which is not a legal fragment.
    const { container } = render(
      <svg>
        {glyph([holder("u-bo"), holder("u-ada")], "a")}
        {glyph([holder("u-bo")], "b")}
      </svg>,
    );
    const ids = new Set(idsIn(container as unknown as HTMLElement));
    const refs = Array.from(container.querySelectorAll("image[clip-path]")).map(
      (im) => (im.getAttribute("clip-path") ?? "").replace(/^url\(#/, "").replace(/\)$/, ""),
    );
    expect(refs).toHaveLength(3);
    for (const r of refs) {
      expect(r, `${r} is not a legal id fragment`).toMatch(/^[A-Za-z][A-Za-z0-9-]*$/);
      expect(ids.has(r), `${r} points at no clipPath in this document`).toBe(true);
    }
  });
});
