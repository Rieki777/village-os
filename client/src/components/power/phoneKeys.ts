/**
 * THE NUMBERS ON A PHONE MAP, and the order they are counted in.
 *
 * On a phone a circle is 40 to 55px across and its name does not fit inside it,
 * so the map used to draw anonymous discs: seven of nine unnamed on a village
 * shaped like this one. The answer chosen (2026-09-21) is a KEY: each circle the
 * reader is looking at carries a number, and a list under the map names every
 * number. Tapping a circle names it on the map too.
 *
 * WHICH CIRCLES GET A NUMBER. The ones at the deepest level the phone draws,
 * under whatever the camera is inside. Those are the circles too small to carry
 * their own name, and they are the level a reader is choosing between. The
 * container above them is named in words at its own top edge, so it needs no
 * number; circles outside the camera's subject are dimmed context and are not
 * counted either.
 *
 * WHAT ORDER. Clockwise from twelve o'clock around the circle that holds them,
 * so "3" is found by reading round the ring the way a clock is read, not by
 * hunting a layout order the reader cannot see. Ties break on id so the same
 * village always numbers the same way.
 */

/** What this reads from `layout.circles`. */
export interface KeyedPosition {
  id: string;
  x: number;
  y: number;
  depth: number;
}

export interface PhoneKey {
  id: string;
  key: number;
}

export function phoneKeysFor(
  positions: readonly KeyedPosition[],
  parentOf: (id: string) => string | null,
  focusId: string | null,
  maxDepth: number,
): PhoneKey[] {
  const byId = new Map(positions.map((p) => [p.id, p]));

  // Under the camera: the focus itself is the container, so its descendants
  // are the subject. With no focus, everything is under the village.
  const underCamera = (id: string): boolean => {
    if (!focusId) return true;
    const seen = new Set<string>();
    let at = parentOf(id);
    while (at && !seen.has(at)) {
      if (at === focusId) return true;
      seen.add(at);
      at = parentOf(at);
    }
    return false;
  };

  const keyed = positions.filter((p) => p.depth === maxDepth && p.id !== focusId && underCamera(p.id));
  if (!keyed.length) return [];

  // Read round the circle that holds them. When they share one parent that is
  // the centre; otherwise their own centroid, which is where the eye settles.
  const parents = new Set(keyed.map((p) => parentOf(p.id)));
  const onlyParent = parents.size === 1 ? Array.from(parents)[0] : null;
  const holder = onlyParent ? byId.get(onlyParent) : undefined;
  const cx = holder ? holder.x : keyed.reduce((s, p) => s + p.x, 0) / keyed.length;
  const cy = holder ? holder.y : keyed.reduce((s, p) => s + p.y, 0) / keyed.length;

  // Clockwise from twelve o'clock. Screen y grows downward, so "up" is -y, and
  // atan2(dx, -dy) is 0 at the top and grows clockwise.
  const clock = (p: KeyedPosition) => {
    const a = Math.atan2(p.x - cx, -(p.y - cy));
    return a < 0 ? a + Math.PI * 2 : a;
  };

  return [...keyed]
    .sort((a, b) => clock(a) - clock(b) || a.id.localeCompare(b.id))
    .map((p, i) => ({ id: p.id, key: i + 1 }));
}
