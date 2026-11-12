/**
 * YOUR TURN: the one light on a page where people decide (Phase D, decider calm).
 *
 * Fireflies mean "something here waits on you" (sitewide plan, part 1), and on
 * a decider's page that is exactly one thing: a vote or a consent round where
 * the reader is asked and has not answered. This door is where they gather.
 *
 * IT NEVER SITS ON AN ANSWER. The lights go on a door that leads to the round,
 * never on Yes, Consent, Accept or any one choice, because light on one answer
 * leans the reader toward it. The round itself stays as calm as it was.
 *
 * Two shapes, one element, so the lights are only ever in one place:
 *   "door"    an inline door, where it is placed.
 *   "sticky"  on a phone, a bar fixed under the thumb at the bottom of the
 *             screen; from `lg` up, the same door sits where it is placed (the
 *             decider's side panel), in view beside the words.
 *
 * Callers decide WHEN it shows (the reader is asked and has not answered); this
 * component only draws it. It changes nothing about the vote or the round.
 */
import type { MouseEvent } from "react";
import { Link } from "wouter";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Fireflies } from "@/components/journey/nature";
import { BTN_PRIMARY } from "@/components/journey/look";

export interface YourTurnProps {
  /** Where the door leads: "#id" for the round on this page, or a path. */
  to: string;
  /** The door's words. */
  label: string;
  /** One short line above the door. */
  line?: string;
  shape?: "door" | "sticky";
  className?: string;
}

/** Scroll to the round on this page and give it focus, so a keyboard lands where the eye does. */
function goTo(e: MouseEvent<HTMLAnchorElement>, hash: string) {
  const el = typeof document !== "undefined" ? document.getElementById(hash.slice(1)) : null;
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ block: "start", behavior: "smooth" });
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

export default function YourTurn({ to, label, line, shape = "door", className = "" }: YourTurnProps) {
  const local = to.startsWith("#");
  const Icon = local ? ArrowDown : ArrowRight;
  const inner = (
    <>
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </>
  );
  const door = local ? (
    <a href={to} onClick={(e) => goTo(e, to)} className={`${BTN_PRIMARY} w-full sm:w-auto`} data-your-turn-door="">
      {inner}
    </a>
  ) : (
    <Link href={to} className={`${BTN_PRIMARY} w-full sm:w-auto`} data-your-turn-door="">
      {inner}
    </Link>
  );

  const placed =
    shape === "sticky"
      ? "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-sm lg:static lg:z-auto lg:rounded-2xl lg:border lg:p-5"
      : "";
  return (
    <div className={`${placed} ${className}`.trim()} data-your-turn={shape}>
      {line && <p className="mb-2 text-sm text-muted-foreground">{line}</p>}
      <Fireflies block>{door}</Fireflies>
    </div>
  );
}
