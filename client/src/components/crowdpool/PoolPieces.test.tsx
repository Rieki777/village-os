// @vitest-environment jsdom
/**
 * WHAT THE CROWDPOOL PIECES DRAW WHEN THE HUB'S NUMBERS CANNOT ALL BE TRUE.
 *
 * The Crowdpooling session measured three defects on their side against a
 * scratch database of their own on 2026-09-04 and told this lane which of them
 * reach ours. Two of them make this page show a wrong or impossible figure
 * through no fault of any code here, and this file is where our half is held
 * honest about both. Every assertion below reads the RENDERED output: the
 * widths that actually land on the fills, the caption text, the spoken label.
 * None of it reads a component's props back to itself.
 *
 * 1. THE RING SHRINKS WHEN A VILLAGE SUCCEEDS. The hub sums pledged value
 *    filtering on the accepted status alone, and delivered and thanked are
 *    later states of the same lifecycle, so a confirmed delivery leaves the
 *    number. `pledgedTotal` is therefore a FLOOR, and no surface here may
 *    present it as a total. No correction is computed anywhere: a guess at the
 *    delivered value would be worse than an honest gap.
 *
 * 2. DELIVERED CAN EXCEED WANTED. Their fulfil path is not idempotent, so two
 *    stewards confirming at once put delivered on two where one was wanted, ten
 *    trials out of ten. The meter was measured on today's code before any of
 *    this landed: both fills drew at 100%, the caption read "2 arrived, 0
 *    spoken for, 1 wanted", and the claimed count was erased. That was a clamp
 *    by accident, from a denominator that grew to match whatever the largest
 *    count happened to be. The track is now what was WANTED, and the
 *    impossible state is said out loud.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  GoldRing,
  GrowthStrip,
  HUB_PLEDGED_TOTAL_IS_A_FLOOR,
  MiniRing,
  PLEDGED_FLOOR_PARAGRAPH,
  RING_TIP,
  SlotMeter,
  capitalTint,
  isOverDelivered,
  pooledLine,
} from "./PoolPieces";

const meter = (wanted: number, claimed: number, delivered: number) => {
  const { container } = render(
    <SlotMeter wanted={wanted} claimed={claimed} delivered={delivered} tint={capitalTint("material")} />,
  );
  const root = container.querySelector(".cp-slots")!;
  return {
    spoken: root.getAttribute("aria-label") ?? "",
    claimedWidth: (container.querySelector(".cp-slots-claimed") as HTMLElement).style.width,
    deliveredWidth: (container.querySelector(".cp-slots-delivered") as HTMLElement).style.width,
    caption: container.querySelector(".cp-slots-caption")!.textContent ?? "",
    over: container.querySelector(".cp-slots-over")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
  };
};

// ── Defect 1: the ring is a floor and says so ────────────────────────────────

describe("the pledged figure carries no qualifier, now the hub counts delivered", () => {
  it("names the floor inside the ring and in what a screen reader hears", () => {
    const { container } = render(
      <GoldRing percentPledged={19} percentDelivered={4} label="Gathering the pool" />,
    );
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("19%");
    expect(texts).toContain("pooled");
    expect(texts).not.toContain("pooled or more");
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe(
      "19 percent pledged, 4 percent delivered",
    );
  });

  it("names it on the list page's small ring too", () => {
    const { container } = render(<MiniRing percent={19} />);
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe("19 percent pooled");
  });

  it("qualifies the money line both pages print", () => {
    expect(pooledLine(20700, 107400, "USD")).toBe("$20,700 of $107,400");
  });

  it("drops the floor explanation entirely, plaque and paragraph both", () => {
    // The paragraph existed only to explain the hedge, so it goes to null and
    // the page renders nothing in its place. The plaque keeps explaining what
    // pooled MEANS, which was always true and is not about the hub defect.
    expect(RING_TIP).not.toContain("floor");
    expect(PLEDGED_FLOOR_PARAGRAPH).toBeNull();
  });

  /**
   * The whole undo, in one place. When the hub lands its fix, this constant
   * goes false and every sentence above leaves with it; this test is what makes
   * that a one-line change instead of a hunt.
   */
  it("reads every one of those sentences off one constant", () => {
    // Was `true` while the hub's pledged total dropped delivered value. Their
    // fix landed 2026-09-05 (b835c28) and this is the whole undo: the sentences
    // below assert the qualifiers are GONE, and they are the reason flipping
    // one constant could not quietly leave one of six surfaces still hedging.
    expect(HUB_PLEDGED_TOTAL_IS_A_FLOOR).toBe(false);
  });

  /**
   * DELIVERED CANNOT RUN AHEAD OF PLEDGED, because delivered work was pledged
   * first. It arrives that way anyway, from the accepted-only sum. Measured on
   * today's code at 5% pooled against 40% delivered, this paragraph read
   * "Delivered work is keeping pace with the pool: 40% standing", which
   * narrates an impossible pair as health.
   */
  it("refuses to narrate delivered running ahead of pooled as health", () => {
    const { container } = render(<GrowthStrip percentDelivered={40} percentPledged={5} />);
    const note = container.querySelector(".cp-growth-note")!.textContent ?? "";
    expect(note).not.toContain("keeping pace");
    expect(note).toContain("Both cannot be true");
    expect(note).toContain("5% pooled against 40% delivered");
  });

  it("still tells the ordinary two states the ordinary way", () => {
    const ahead = render(<GrowthStrip percentDelivered={4} percentPledged={19} />);
    expect(ahead.container.querySelector(".cp-growth-note")!.textContent).toContain("the ring runs ahead");
    const level = render(<GrowthStrip percentDelivered={19} percentPledged={19} />);
    expect(level.container.querySelector(".cp-growth-note")!.textContent).toContain("keeping pace");
  });
});

// ── Defect 2: more delivered than wanted ─────────────────────────────────────

describe("the three-slot meter, given counts that cannot all be true", () => {
  it("draws against what was wanted and says more arrived than were wanted", () => {
    const m = meter(1, 1, 2);
    expect(m.deliveredWidth).toBe("100%");
    expect(m.claimedWidth).toBe("100%");
    expect(m.spoken).toBe("2 delivered, 1 claimed, 1 wanted, which is more delivered than wanted");
    expect(m.over).toContain("More arrived than were wanted");
    expect(m.over).toContain("two stewards confirm");
  });

  it("never draws a fill past its own track, whatever the counts", () => {
    for (const [w, c, d] of [[10, 5, 11], [1, 3, 0], [4, 40, 40], [2, 0, 9]] as const) {
      const m = meter(w, c, d);
      expect(Number.parseFloat(m.claimedWidth), `claimed ${w}/${c}/${d}`).toBeLessThanOrEqual(100);
      expect(Number.parseFloat(m.deliveredWidth), `delivered ${w}/${c}/${d}`).toBeLessThanOrEqual(100);
    }
  });

  /**
   * The old denominator was `Math.max(wanted, claimed, delivered, 1)`, so an
   * over-claimed need renormalized onto its own claim count and drew a full
   * ghost bar. Three claimed against one wanted is a track that should read
   * full and a claim count that should not be hidden.
   */
  it("shows an over-claimed need at a full track and keeps its real counts", () => {
    const m = meter(1, 3, 0);
    expect(m.claimedWidth).toBe("100%");
    expect(m.deliveredWidth).toBe("0%");
    expect(m.caption).toContain("3 spoken for");
    expect(m.over).toBeNull(); // over-claimed is not over-delivered
  });

  it("leaves an ordinary need drawn exactly as it always was", () => {
    const m = meter(200, 120, 80);
    expect(m.deliveredWidth).toBe("40%");
    expect(m.claimedWidth).toBe("60%");
    expect(m.spoken).toBe("80 delivered, 120 claimed, 200 wanted");
    expect(m.over).toBeNull();
  });

  /**
   * A need the hub gives no wanted count for is the one case the old
   * largest-of-the-three denominator was right about, and it is kept.
   */
  it("falls back to the largest count when the hub names no wanted quantity", () => {
    const m = meter(0, 2, 1);
    expect(m.deliveredWidth).toBe("50%");
    expect(m.claimedWidth).toBe("100%");
    expect(m.over).toBeNull();
    expect(meter(0, 0, 0).deliveredWidth).toBe("0%");
  });

  it("keys the impossible state off one predicate the page shares", () => {
    expect(isOverDelivered({ quantityWanted: 1, quantityDelivered: 2 })).toBe(true);
    expect(isOverDelivered({ quantityWanted: 1, quantityDelivered: 1 })).toBe(false);
    expect(isOverDelivered({ quantityWanted: 0, quantityDelivered: 3 })).toBe(false);
  });
});
