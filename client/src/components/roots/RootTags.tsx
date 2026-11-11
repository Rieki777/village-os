/**
 * WHICH ROOTS A ROLE OR QUEST GROWS FROM, drawn as small roots (the five
 * archetypes as roots, 11 Nov 2026: "present archetypes as roots, and show on
 * each role or quest which roots it grows from").
 *
 * Each tag is a little root system under a soil line, seeded by the root's key
 * so the same root always has the same shape, with a gold seed of light at
 * the crown. The names are the village's own (`GET /api/archetypes`), so a
 * village that renames a root sees its own word on every tag.
 *
 * Phone and desktop, each at its best:
 *   - a phone gets the root and the short name, wrapping onto a second line
 *     before anything is cut, at a size a thumb can read beside a card;
 *   - a desktop has the width, so a `md` tag also says the root's second name
 *     ("Researching & Designing"), and hovering a tag shows its one line
 *     ("Researches and designs the structure of things") as the title.
 *
 * Accessible names: the list is named "Grows from" and each item's text is
 * the root's name, so a screen reader hears "Grows from, list, 2 items,
 * Builder, Architect". The drawing is decoration and is hidden from it.
 *
 * Still by design: a tag is a label beside words, so nothing here moves.
 */
import { useMemo } from "react";
import { useLingui } from "@lingui/react/macro";
import { shortRootName } from "@shared/archetypeRoots";
import { rootGlyph } from "./rootGlyph";
import { useRootCast } from "./rootCast";

export interface RootTagsProps {
  /** Archetype keys, in the order they matter most. */
  roots: string[];
  size?: "sm" | "md";
  className?: string;
}

export function RootGlyph({ rootKey, className = "" }: { rootKey: string; className?: string }) {
  const g = useMemo(() => rootGlyph(rootKey), [rootKey]);
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`} data-root-glyph={rootKey}>
      <path d={g.soil} fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={1} className="text-muted-foreground" strokeOpacity={0.6} />
      <g fill="none" stroke="currentColor" strokeLinecap="round" className="text-open">
        {g.strokes.map((s, i) => (
          <path key={i} d={s.d} strokeWidth={s.width} />
        ))}
      </g>
      <circle cx={g.crown.x} cy={g.crown.y} r={1.9} className="fill-notice" />
    </svg>
  );
}

export default function RootTags({ roots, size = "sm", className = "" }: RootTagsProps) {
  const { t } = useLingui();
  const cast = useRootCast();
  const keys = useMemo(() => roots.filter((k, i) => typeof k === "string" && k.trim() && roots.indexOf(k) === i), [roots]);
  if (!keys.length) return null;
  const md = size === "md";
  return (
    <ul
      aria-label={t({ message: "Grows from", context: "roots on a role or quest, the list's name" })}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${md ? "text-sm" : "text-xs"} ${className}`.trim()}
      data-testid="root-tags"
    >
      {keys.map((k) => {
        const root = cast.find((c) => c.key === k);
        const name = shortRootName(root?.name ?? k);
        return (
          <li key={k} className="inline-flex min-w-0 items-center gap-1.5" title={root?.blurb || undefined}>
            <RootGlyph rootKey={k} className={md ? "size-6" : "size-5"} />
            <span className="font-medium text-foreground">{name}</span>
            {md && root?.subtitle ? <span className="hidden text-muted-foreground lg:inline">{root.subtitle}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
