/**
 * MAIA SPEAKS YOUR TYPE: one line under a suggestion, in the words of how this
 * member decides best.
 *
 * Built on the lean put to Rye on 2026-10-23, which he asked to talk through
 * and then to build (2026-10-30): VISIBLE (it says it is Maia, and why), LIGHT
 * (the suggestion is the same one everyone gets; only the words around it
 * change), and it NUDGES THE CIRCLE rather than inviting on the member's
 * behalf. It draws nothing unless the member let Maia use their lines, and
 * nothing once they asked her to talk to them plainly.
 */
import type { GeneKeysView } from "@shared/geneKeys";
import { useGuideName } from "@/hooks/useGuideName";
import { useMyGeneKeys } from "./useMyGeneKeys";

/** The line for a member's type and authority. Emotional authority leads: waiting is the one thing to say first. */
export function maiaTypeLine(view: Pick<GeneKeysView, "type" | "authority">): string {
  if (view.authority === "Emotional") return "No rush on this one. You decide best after a night, so sleep on it.";
  switch (view.type) {
    case "Generator":
      return "Notice your gut as you read it. If it lights you up, that is your yes.";
    case "Manifesting Generator":
      return "If it lights you up, go, and tell the circle what you are starting.";
    case "Projector":
      return "If this calls you, tell its circle you would welcome an invitation.";
    case "Manifestor":
      return "If you start it, give the circle a heads up first so they can make room.";
    case "Reflector":
      return "No rush. See how it sits with you across this moon.";
    default:
      return "";
  }
}

export default function MaiaTypeLine({ className = "" }: { className?: string }) {
  const { mine } = useMyGeneKeys();
  // The village's own name for its guide (shared/guideName.ts), never a borrowed one.
  const guide = useGuideName();
  if (!mine || !mine.maia || mine.maiaPlain) return null;
  const line = maiaTypeLine(mine);
  if (!line) return null;
  return (
    <p className={`text-sm text-muted-foreground ${className}`}>
      <span className="font-semibold text-foreground">From {guide.name}:</span> {line}
    </p>
  );
}
