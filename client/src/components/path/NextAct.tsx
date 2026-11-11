/**
 * THE ONE NEXT ACT: the path's step as a button, with fireflies gathered on it
 * (the Root). There is one of these on a screen and no more, because the
 * fireflies are how a page says "this one".
 *
 * A step on the page the reader is already on is a plain in-page link, so the
 * browser scrolls to it and the tab that holds it opens.
 */
import { Link, useLocation } from "wouter";
import { ArrowRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { Fireflies } from "@/components/journey/nature";
import { BTN_PRIMARY } from "@/components/journey/look";
import type { PathState } from "@shared/yourPath";

/** The button's words, by what the step is. The sentence above it says the step; this says the act. */
export function useActWords(): (state: PathState) => string {
  const { t } = useLingui();
  return (state) => {
    switch (state) {
      case "agreements":
        return t({ message: `Read and align`, context: "your path, the next act" });
      case "terms-to-answer":
      case "held-for-seat":
      case "start-day":
        return t({ message: `Read the terms`, context: "your path, the next act" });
      case "visitor":
      case "closed":
        return t({ message: `See the roles`, context: "your path, the next act" });
      case "in-review":
      case "declined":
      case "membership-waiting":
      case "first-quest":
      case "finish-quest":
      case "explore":
        return t({ message: `Open the quests`, context: "your path, the next act" });
      case "recap-due":
      case "recap-returned":
      case "holder-moon":
        return t({ message: `Open my moon`, context: "your path, the next act" });
      case "first-days":
        return t({ message: `Open our first days`, context: "your path, the next act" });
      case "adopted-sign-in":
        return t({ message: `Sign in`, context: "your path, the next act" });
      case "session-live":
        return t({ message: `Join now`, context: "your path, the next act" });
      default:
        return t({ message: `Take this step`, context: "your path, the next act" });
    }
  };
}

export default function NextAct({ state, href, block = false, className = "" }: { state: PathState; href: string | null; block?: boolean; className?: string }) {
  const [location] = useLocation();
  const say = useActWords();
  if (!href) return null;
  const [path, hash] = href.split("#");
  const here = (location.split(/[?#]/)[0] || "/") === (path.split("?")[0] || "/");
  const cls = `${BTN_PRIMARY} ${block ? "w-full" : ""} ${className}`.trim();
  const inner = (
    <>
      {say(state)}
      <ArrowRight className="size-4" aria-hidden="true" />
    </>
  );
  return (
    <Fireflies block={block} count={7}>
      {here && hash ? (
        <a href={`#${hash}`} className={cls} data-next-act="">
          {inner}
        </a>
      ) : (
        <Link href={href} className={cls} data-next-act="">
          {inner}
        </Link>
      )}
    </Fireflies>
  );
}
