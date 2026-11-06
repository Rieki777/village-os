import type { ReactNode } from "react";
import { Link } from "wouter";
import type { JourneyAction } from "@/lib/journeyPage";

/** True when the button leaves this site (a new tab, or the mail app). */
export function leavesSite(action: JourneyAction): boolean {
  return action.kind === "external" || action.kind === "mail";
}

/**
 * One journey button, drawn as whatever its destination needs: a route link,
 * an anchor, a new tab, a mail link, or a button that opens one of the page's
 * own forms. The page decides how it looks.
 */
export function JourneyLink({
  action,
  className,
  children,
  onForm,
}: {
  action: JourneyAction;
  className: string;
  children: ReactNode;
  onForm?: (form: string) => void;
}) {
  switch (action.kind) {
    case "route":
      return (
        <Link href={action.href} className={className}>
          {children}
        </Link>
      );
    case "external":
      return (
        <a href={action.href} target="_blank" rel="noopener noreferrer" className={className}>
          {children}
        </a>
      );
    case "form":
      return (
        <button type="button" onClick={() => onForm?.(action.form)} className={className}>
          {children}
        </button>
      );
    default:
      return (
        <a href={action.href} className={className}>
          {children}
        </a>
      );
  }
}
