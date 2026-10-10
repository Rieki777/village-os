/**
 * The structure review's circle map: the living map's own nested layout
 * (`layoutNestedMap`, shared/mapLayout.ts), drawn from a `MapModel`.
 *
 * The picture is one way to read it and the list under it is the other, with
 * the same model behind both. The list is the accessible equivalent and the
 * one a phone reaches first; the picture is labelled as an image and its seats
 * are not a second set of tab stops. Tapping a seat the batch touches jumps to
 * its row in the change list.
 *
 * Every colour is a token the night sheet already defines: the living green
 * for new, the earned gold for a seat that takes over a live one, the dim ink
 * dashed for what retires or moves out.
 */
import { useMemo, type ReactNode } from "react";
import { layoutNestedMap, wrapLabel, type NestedInput } from "@shared/mapLayout";
import type { MapModel, MapStatus } from "@/lib/structureMapModel";

const STROKE: Record<MapStatus, string> = {
  new: "var(--color-open)",
  match: "var(--color-notice)",
  retire: "var(--muted-foreground)",
  moved: "var(--muted-foreground)",
  same: "var(--border)",
};
const SEAT_FILL: Record<MapStatus, string> = {
  new: "var(--color-open)",
  match: "var(--color-notice)",
  retire: "none",
  moved: "none",
  same: "var(--muted-foreground)",
};
const DASHED = (s: MapStatus) => s === "retire" || s === "moved";

export const STATUS_WORDS: Record<MapStatus, string> = {
  new: "New",
  match: "Takes over a live seat",
  retire: "Retiring",
  moved: "Moves out",
  same: "Stays as it is",
};

export default function StructureMap({
  model,
  caption,
  highlight,
  onSeat,
}: {
  model: MapModel;
  caption: string;
  highlight: string | null;
  onSeat: (rowKey: string) => void;
}) {
  const drawn = useMemo(() => {
    const byCircle = new Map<string, MapModel["seats"]>();
    const village: MapModel["seats"] = [];
    const known = new Set(model.circles.map((c) => c.id));
    for (const s of model.seats) {
      if (s.circleId && known.has(s.circleId)) byCircle.set(s.circleId, [...(byCircle.get(s.circleId) ?? []), s]);
      else village.push(s);
    }
    const inputs: NestedInput[] = model.circles.map((c, i) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      order: i,
      memberCount: 0,
      questCount: 0,
      roles: (byCircle.get(c.id) ?? []).map((s) => ({ id: s.id, vacant: false })),
    }));
    const layout = layoutNestedMap(inputs, village.map((s) => ({ id: s.id, vacant: false })));
    const seatById = new Map(model.seats.map((s) => [s.id, s]));
    const circleById = new Map(model.circles.map((c) => [c.id, c]));
    const parents = new Set(model.circles.map((c) => c.parentId).filter(Boolean) as string[]);
    return { layout, seatById, circleById, parents };
  }, [model]);

  const { layout, seatById, circleById, parents } = drawn;
  const v = layout.village;
  const pad = 16;
  const size = Math.max(1, v.r * 2 + pad * 2);
  const dots = [
    ...layout.circles.flatMap((c) => c.roles),
    ...v.roles,
  ];

  return (
    <figure className="m-0">
      <svg
        viewBox={`${v.x - v.r - pad} ${v.y - v.r - pad} ${size} ${size}`}
        className="w-full h-auto block"
        role="img"
        aria-label={caption}
        data-testid="structure-map"
      >
        <circle cx={v.x} cy={v.y} r={v.r} fill="none" stroke="var(--border)" strokeOpacity={0.5} strokeWidth={2} />
        {layout.circles.map((pos) => {
          const c = circleById.get(pos.id);
          if (!c) return null;
          const label = wrapLabel(c.name, pos.r, pos.depth);
          const holds = parents.has(c.id);
          const top = holds ? pos.y - pos.r + label.fontSize + 8 : pos.y - ((label.lines.length - 1) * label.lineHeight) / 2;
          return (
            <g key={pos.id} data-status={c.status}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={pos.r}
                fill={c.status === "new" ? "var(--color-open)" : "var(--muted)"}
                fillOpacity={c.status === "new" ? 0.1 : DASHED(c.status) ? 0 : 0.55}
                stroke={STROKE[c.status]}
                strokeWidth={c.status === "same" ? 1.4 : 2}
                strokeDasharray={DASHED(c.status) ? "6 5" : undefined}
              />
              <title>{`${c.name}: ${STATUS_WORDS[c.status]}`}</title>
              {(holds ? label.lines.slice(0, 1) : label.lines).map((line, i) => (
                <text
                  key={i}
                  x={pos.x}
                  y={top + i * label.lineHeight}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={label.fontSize}
                  fontWeight={600}
                  fill={c.status === "retire" ? "var(--muted-foreground)" : "var(--foreground)"}
                  style={{ pointerEvents: "none" }}
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
        {dots.map((d) => {
          const s = seatById.get(d.id);
          if (!s) return null;
          const lit = highlight !== null && s.rowKey === highlight;
          return (
            <g key={d.id}>
              <circle
                cx={d.x}
                cy={d.y}
                r={lit ? 10 : 7}
                fill={SEAT_FILL[s.status]}
                stroke={lit ? "var(--foreground)" : STROKE[s.status]}
                strokeWidth={lit ? 2.5 : 1.6}
                strokeDasharray={DASHED(s.status) ? "3 3" : undefined}
                opacity={highlight !== null && !lit ? 0.6 : 1}
                style={{ cursor: s.rowKey ? "pointer" : "default" }}
                onClick={s.rowKey ? () => onSeat(String(s.rowKey)) : undefined}
                data-seat={s.id}
              />
              <title>{`${s.name}: ${STATUS_WORDS[s.status]}`}</title>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-sm text-muted-foreground mt-2">{caption}</figcaption>
    </figure>
  );
}

/** The same model as a list: every circle, its seats, and what happens to each. */
export function StructureMapList({ model, onSeat }: { model: MapModel; onSeat: (rowKey: string) => void }) {
  const known = new Set(model.circles.map((c) => c.id));
  const loose = model.seats.filter((s) => !s.circleId || !known.has(s.circleId));
  const kids = (parent: string | null) =>
    model.circles.filter((c) => (parent === null ? !c.parentId || !known.has(c.parentId) : c.parentId === parent));
  const seatItem = (s: MapModel["seats"][number]) => (
    <li key={s.id} className="text-sm">
      {s.rowKey ? (
        <button type="button" className="underline underline-offset-2 text-left min-h-[32px]" onClick={() => onSeat(String(s.rowKey))}>
          {s.name}
        </button>
      ) : (
        <span>{s.name}</span>
      )}{" "}
      <span className="text-muted-foreground">({STATUS_WORDS[s.status]})</span>
    </li>
  );
  const branch = (parent: string | null, depth: number): ReactNode => {
    const list = kids(parent);
    if (!list.length) return null;
    return (
      <ul className={depth ? "pl-4 border-l border-border space-y-2 mt-2" : "space-y-3"}>
        {list.map((c) => (
          <li key={c.id}>
            <span className="font-semibold">{c.name}</span>{" "}
            <span className="text-muted-foreground text-sm">({STATUS_WORDS[c.status]})</span>
            {model.seats.some((s) => s.circleId === c.id) && (
              <ul className="pl-4 mt-1 space-y-1">{model.seats.filter((s) => s.circleId === c.id).map(seatItem)}</ul>
            )}
            {branch(c.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };
  return (
    <div data-testid="structure-map-list">
      {branch(null, 0)}
      {loose.length > 0 && (
        <div className="mt-3">
          <p className="font-semibold">In no circle</p>
          <ul className="pl-4 mt-1 space-y-1">{loose.map(seatItem)}</ul>
        </div>
      )}
    </div>
  );
}
