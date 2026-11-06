/**
 * A companion's look: one of the four pets in a body colour, or the member's
 * own portrait from the studio (approved design, 2026-10-30, "Companion pet").
 *
 * Every colour is a dashboard token, so a village that re-tints the sheet
 * re-tints the pets with it (index.css, the `dash-*` set).
 */
import type { CompanionLook, PetKind, PetTint } from "@shared/companionItems";

const TINT: Record<PetTint, string> = {
  gold: "var(--color-dash-gold)",
  leaf: "var(--color-dash-voice)",
  rose: "var(--color-dash-thanks)",
  lilac: "var(--color-dash-session)",
};

const LIT = "var(--color-dash-gold-lit)";
const INK = "var(--color-dash-gold-ink)";
const BLUSH = "var(--color-dash-thanks)";
const SHINE = "var(--color-foreground)";

function Crown({ kind, tint }: { kind: PetKind; tint: string }) {
  if (kind === "sprout") {
    return (
      <>
        <path d="M50 36 C50 28 50 24 50 18" stroke="var(--color-dash-voice)" strokeWidth="4" fill="none" strokeLinecap="round" />
        <ellipse cx="40" cy="20" rx="10" ry="5" fill="var(--color-dash-voice)" transform="rotate(-25 40 20)" />
        <ellipse cx="60" cy="16" rx="10" ry="5" fill="var(--color-dash-cash)" transform="rotate(25 60 16)" />
      </>
    );
  }
  if (kind === "horns") {
    return (
      <>
        <path d="M30 40 C22 30 22 20 30 14" stroke={LIT} strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M70 40 C78 30 78 20 70 14" stroke={LIT} strokeWidth="6" fill="none" strokeLinecap="round" />
      </>
    );
  }
  if (kind === "ears") {
    return (
      <>
        <path d="M24 44 L28 14 L44 36 Z" fill={tint} />
        <path d="M76 44 L72 14 L56 36 Z" fill={tint} />
        <path d="M29 36 L30 22 L38 33 Z" fill={INK} opacity="0.35" />
        <path d="M71 36 L70 22 L62 33 Z" fill={INK} opacity="0.35" />
      </>
    );
  }
  return <path d="M50 6 L54 17 L66 17 L56 24 L60 35 L50 28 L40 35 L44 24 L34 17 L46 17 Z" fill={LIT} />;
}

/** The pet alone, drawn to `size` pixels. Decorative: the name beside it says who it is. */
export function PetDrawing({ kind, tint, size }: { kind: PetKind; tint: PetTint; size: number }) {
  const body = TINT[tint];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" focusable="false">
      <Crown kind={kind} tint={body} />
      <ellipse cx="50" cy="62" rx="34" ry="30" fill={body} />
      <ellipse cx="50" cy="72" rx="20" ry="15" fill={SHINE} opacity="0.28" />
      <circle cx="39" cy="57" r="6" fill={INK} />
      <circle cx="61" cy="57" r="6" fill={INK} />
      <circle cx="41" cy="55" r="2" fill={SHINE} />
      <circle cx="63" cy="55" r="2" fill={SHINE} />
      <ellipse cx="31" cy="67" rx="5" ry="3" fill={BLUSH} opacity="0.7" />
      <ellipse cx="69" cy="67" rx="5" ry="3" fill={BLUSH} opacity="0.7" />
      <path d="M45 68 Q50 72 55 68" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="32" cy="90" rx="8" ry="4" fill={body} />
      <ellipse cx="68" cy="90" rx="8" ry="4" fill={body} />
    </svg>
  );
}

/** A companion's look at a size: its portrait when it has one, its pet otherwise. */
export default function CompanionPet({ look, url, size }: { look: CompanionLook; url?: string | null; size: number }) {
  if (look.source !== "choose" && url) {
    return <img src={url} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return <PetDrawing kind={look.pet ?? "horns"} tint={look.tint ?? "gold"} size={size} />;
}
