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
 * 1. THE RING SHRINKS WHEN A VILLAGE SUCCEEDS, ON AN OLDER HUB. A hub at
 *    crowdpool contract 1 sums pledged value filtering on the accepted status
 *    alone, and delivered and thanked are later states of the same lifecycle,
 *    so a confirmed delivery leaves the number. There `pledgedTotal` is a FLOOR,
 *    and no surface here may present it as a total. Contract 2 (hub b835c28)
 *    counts all three. The hub publishes which one it speaks at `meta.contract`
 *    (hub commit 3c70b12c, ruled 2026-09-14), the server serves it as
 *    `hubContract`, and the pieces below word the figure off that reading. No
 *    correction is computed anywhere: a guess at the delivered value would be
 *    worse than an honest gap.
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
  MiniRing,
  SlotMeter,
  capitalTint,
  isOverDelivered,
  pledgedFloorParagraph,
  pledgedFloorTip,
  pledgedIsFloor,
  pooledLine,
  ringTip,
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

// ── Defect 1: the ring is a floor on an older hub and says so ────────────────

const ringOf = (floor: boolean) => {
  const { container } = render(
    <GoldRing percentPledged={19} percentDelivered={4} label="Gathering the pool" floor={floor} />,
  );
  return {
    texts: Array.from(container.querySelectorAll("text")).map((t) => t.textContent),
    spoken: container.querySelector("svg")!.getAttribute("aria-label"),
  };
};

const miniOf = (floor: boolean) =>
  render(<MiniRing percent={19} floor={floor} />).container.querySelector("svg")!.getAttribute("aria-label");

describe("one reading of the hub contract decides whether the figure is a floor", () => {
  /**
   * The rule the old constant served, now per campaign: only a hub that has
   * SAID it counts delivered pledges gets its figure printed as a total.
   * Absent is a floor, and so is anything that is not an integer of 2 or more.
   */
  it("is a total only at contract 2 or later, and a floor otherwise", () => {
    expect(pledgedIsFloor({ crowdpool: 2 })).toBe(false);
    expect(pledgedIsFloor({ crowdpool: 3 })).toBe(false);
    expect(pledgedIsFloor({ crowdpool: 1 })).toBe(true);
    expect(pledgedIsFloor(undefined)).toBe(true);
    expect(pledgedIsFloor(null)).toBe(true);
    expect(pledgedIsFloor({})).toBe(true);
    expect(pledgedIsFloor({ crowdpool: 0 })).toBe(true);
    expect(pledgedIsFloor({ crowdpool: "2" })).toBe(true);
    expect(pledgedIsFloor({ crowdpool: 2.5 })).toBe(true);
    expect(pledgedIsFloor({ crowdpool: Number.NaN })).toBe(true);
  });
});

describe("at hub contract 2 the pledged figure is a total and carries no qualifier", () => {
  const floor = pledgedIsFloor({ crowdpool: 2 });

  it("says nothing extra inside the ring or in what a screen reader hears", () => {
    const ring = ringOf(floor);
    expect(ring.texts).toContain("19%");
    expect(ring.texts).toContain("pooled");
    expect(ring.texts).not.toContain("pooled or more");
    expect(ring.spoken).toBe("19 percent pledged, 4 percent delivered");
  });

  it("says nothing extra on the list page's small ring", () => {
    expect(miniOf(floor)).toBe("19 percent pooled");
  });

  it("prints the money line both pages print with no at least", () => {
    expect(pooledLine(20700, 107400, "USD", floor)).toBe("$20,700 of $107,400");
  });

  it("drops the floor explanation, plaque and paragraph both", () => {
    // The paragraph exists only to explain the hedge, so it is null and the
    // page renders nothing in its place. The plaque keeps explaining what
    // pooled MEANS, which is true on any hub.
    expect(ringTip(floor)).not.toContain("floor");
    expect(pledgedFloorTip(floor)).toBe("This is everything pledged to the raising so far.");
    expect(pledgedFloorParagraph(floor)).toBeNull();
  });
});

describe("at hub contract 1, or with no contract served, the figure is named a floor", () => {
  for (const [what, hubContract] of [
    ["contract 1", { crowdpool: 1 }],
    ["no contract served", undefined],
  ] as const) {
    const floor = pledgedIsFloor(hubContract);

    it(`${what}: names the floor inside the ring and in what a screen reader hears`, () => {
      const ring = ringOf(floor);
      expect(ring.texts).toContain("19%");
      expect(ring.texts).toContain("pooled or more");
      expect(ring.spoken).toBe("at least 19 percent pledged, 4 percent delivered");
    });

    it(`${what}: names it on the list page's small ring too`, () => {
      expect(miniOf(floor)).toBe("at least 19 percent pooled");
    });

    it(`${what}: qualifies the money line both pages print`, () => {
      expect(pooledLine(20700, 107400, "USD", floor)).toBe("at least $20,700 of $107,400");
    });

    it(`${what}: explains the floor in the tip and the paragraph`, () => {
      expect(pledgedFloorTip(floor)).toContain("Read the figure as a floor");
      expect(ringTip(floor)).toContain("Read the figure as a floor");
      expect(pledgedFloorParagraph(floor)).toContain("what this page shows is a floor");
    });
  }

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
