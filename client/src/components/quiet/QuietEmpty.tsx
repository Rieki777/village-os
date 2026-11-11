/**
 * AN EMPTY STATE, in the night world (Phase B, lane B3): one drawing, one
 * heading, one sentence, and at most one edged door.
 *
 * Empty is a resting place, never a zero. A list with nothing in it yet shows
 * a still drawing of the thing resting (soil with seeds asleep in it, a ring
 * of places nobody has named yet, a meadow with two croziers waiting), says
 * in a sentence what fills it, and keeps the door to filling it open
 * (docs/DESIGN_RULE.md, "Fields, empty and loading states": "the door still
 * offered"). Nothing here moves, so there is nothing to still under reduced
 * motion, and nothing here counts anybody.
 *
 * The door is edged (BTN_SECONDARY), never gold: an empty list is not the
 * page's main act, and a gold button would compete with the one the page
 * already has. When the act already sits beside the empty list (a composer
 * just above it), leave the door out; one door means one.
 *
 * Phone and desktop, each at its best: on a phone the drawing sits over the
 * words, centred, one thing at a time; from `sm` up the drawing stands
 * beside the words, larger, and the words read left to right with the door
 * under them.
 *
 * Errors are NOT empty states. "It did not load" stays plain words and a way
 * to try again, with no drawing and no light: growth beside a failure reads
 * as decoration over a problem.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { BTN_SECONDARY, HINT } from "@/components/journey/look";
import { crozierPath, ringOfPlaces, restingBed } from "./quietGeometry";
import { fx } from "@/components/journey/nature/geometry";

export type QuietDrawingKind = "bed" | "ring" | "meadow";

export type QuietDoor =
  | { label: string; href: string; onClick?: never }
  | { label: string; onClick: () => void; href?: never };

export interface QuietEmptyProps {
  drawing: QuietDrawingKind;
  title: string;
  /** The one sentence: what fills this place. */
  children?: ReactNode;
  /** The one door, edged. Leave it out when the act already sits beside the list. */
  door?: QuietDoor;
  /** Heading level, so the empty state fits the page's outline. */
  level?: 2 | 3;
  /** Draw inside its own panel. Off when the empty state already sits in one. */
  panel?: boolean;
  className?: string;
}

/** The drawing alone: decoration, hidden from a screen reader (the words carry it). */
export function QuietDrawing({ kind, className = "" }: { kind: QuietDrawingKind; className?: string }) {
  if (kind === "bed") {
    const bed = restingBed(220, 60, 3);
    return (
      <svg viewBox="0 0 220 80" aria-hidden="true" focusable="false" data-drawing="bed" className={`block h-auto w-48 sm:w-56 ${className}`.trim()}>
        <path d={bed.soil} fill="none" stroke="currentColor" strokeWidth={1.2} className="text-open" opacity={0.6} />
        {bed.seeds.map((s, i) => (
          <g key={i} className="text-open">
            <ellipse cx={fx(s.x)} cy={fx(s.y)} rx={4} ry={2.6} fill="currentColor" opacity={0.28} />
            <ellipse cx={fx(s.x)} cy={fx(s.y)} rx={4} ry={2.6} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.7} />
          </g>
        ))}
      </svg>
    );
  }
  if (kind === "ring") {
    const places = ringOfPlaces(8, 80, 60, 42);
    return (
      <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" data-drawing="ring" className={`block h-auto w-36 sm:w-44 ${className}`.trim()}>
        <circle cx={80} cy={60} r={42} fill="none" stroke="currentColor" strokeDasharray="2 5" className="text-muted-foreground" opacity={0.6} />
        {places.map((p, i) => (
          <circle key={i} cx={fx(p.x)} cy={fx(p.y)} r={7} fill="currentColor" stroke="currentColor" className="text-muted" strokeWidth={0} data-place="" />
        ))}
        {places.map((p, i) => (
          <circle key={`e${i}`} cx={fx(p.x)} cy={fx(p.y)} r={7} fill="none" stroke="currentColor" strokeWidth={1} className="text-muted-foreground" opacity={0.7} />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 90" aria-hidden="true" focusable="false" data-drawing="meadow" className={`block h-auto w-32 sm:w-40 ${className}`.trim()}>
      <path d="M0 70 C40 60 80 76 120 66 L120 90 L0 90 Z" fill="currentColor" className="text-muted" />
      <path d={crozierPath(40, 66, 26, 9)} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" className="text-open" />
      <path d={crozierPath(74, 70, 20, 7)} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" className="text-open" opacity={0.6} />
    </svg>
  );
}

function Door({ door }: { door: QuietDoor }) {
  if (door.onClick) {
    return (
      <button type="button" onClick={door.onClick} className={BTN_SECONDARY}>
        {door.label}
      </button>
    );
  }
  const href = door.href as string;
  // An in-page anchor stays a plain link, so the browser scrolls to it.
  if (href.startsWith("#")) {
    return (
      <a href={href} className={BTN_SECONDARY}>
        {door.label}
      </a>
    );
  }
  return (
    <Link href={href} className={BTN_SECONDARY}>
      {door.label}
    </Link>
  );
}

export default function QuietEmpty({ drawing, title, children, door, level = 2, panel = false, className = "" }: QuietEmptyProps) {
  const Heading = level === 3 ? "h3" : "h2";
  const frame = panel ? "rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8" : "py-10";
  return (
    <div
      className={`${frame} flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:gap-8 sm:text-left ${className}`.trim()}
      data-quiet="empty"
    >
      <QuietDrawing kind={drawing} className="shrink-0" />
      <div className="flex flex-col items-center gap-3 sm:items-start">
        <Heading className="font-display text-xl font-bold text-foreground">{title}</Heading>
        {children ? <p className={`${HINT} max-w-prose`}>{children}</p> : null}
        {door ? <Door door={door} /> : null}
      </div>
    </div>
  );
}
