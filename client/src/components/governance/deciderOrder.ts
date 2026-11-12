/**
 * THE ORDER A DECIDER READS IN: arrival, and nothing else (Phase D, decider calm).
 *
 * The pages where people decide list what waits on them in the order it
 * arrived, oldest first, so the thing that has waited longest is read first and
 * nothing is ever ordered by a count, a score or a guess at importance. A row
 * with no readable date goes last, in the order the server sent it, so a
 * missing date never pushes somebody ahead of the queue.
 *
 * Display only. It never filters: what goes in comes out, every row once.
 */
export function byArrival<T>(rows: readonly T[], arrivedAt: (row: T) => string | null | undefined): T[] {
  const at = (row: T) => {
    const iso = arrivedAt(row);
    const t = iso ? Date.parse(iso) : Number.NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  return rows
    .map((row, i) => ({ row, i, t: at(row) }))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : a.t < b.t ? -1 : 1))
    .map((x) => x.row);
}
