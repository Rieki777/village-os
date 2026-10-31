/**
 * A MEMBER'S WHOLE BADGE ROSTER, opened from the flower on their portrait.
 *
 * On your own profile it is also where you pick which badges show on your
 * card. That choice already had a door: PUT /api/badges/featured (B10), which
 * takes the whole list and is capped by `badges.max_featured`, the same cap
 * /api/badges/of hands back as `maxFeatured`. Nothing new on the server: a
 * toggle here sends the current picks plus or minus one, exactly as the Badges
 * page's "Pin to byline" does.
 *
 * Somebody else's roster is read-only and marks the ones they chose to show.
 * Warnings never arrive here: /api/badges/of does not serve them to anybody.
 *
 * Dialog on a wide screen and a sheet from the bottom on a phone, the split
 * GeneKeysSeal makes.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { gameFetch } from "@/lib/gameApi";
import { petalColour, type FlowerBadge } from "./BadgeFlower";

const KIND_WORD: Record<string, string> = {
  earned: "Earned",
  granted: "Granted",
  self: "Self-claimed",
  hypha: "Mirrored",
};

function wideScreen(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 768px)").matches;
}

export default function BadgeRoster({
  open,
  onOpenChange,
  badges,
  maxFeatured,
  whose,
  editable,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  badges: FlowerBadge[];
  maxFeatured: number | null;
  /** Their first name on somebody else's roster, or null on your own. */
  whose: string | null;
  /** Your own roster: the picks can change. */
  editable: boolean;
  /** After a pick lands, so the page re-reads. */
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");

  const picked = badges.filter((b) => b.featured).map((b) => b.id);
  const max = maxFeatured ?? 0;

  const toggle = async (b: FlowerBadge) => {
    const next = b.featured ? picked.filter((id) => id !== b.id) : [...picked, b.id];
    setBusy(b.id);
    setError("");
    try {
      const r = await gameFetch("/api/badges/featured", { method: "PUT", body: JSON.stringify({ badgeIds: next }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message ?? d?.error ?? "That didn't go through. Try again.");
      setSaid(b.featured ? `${b.name} is off your card.` : `${b.name} now shows on your card.`);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const title = whose ? `${whose}'s badges` : "Your badges";
  const lead = editable
    ? max > 0
      ? `Pick up to ${max} to show on your card. ${picked.length} of ${max} picked.`
      : "Showing badges on cards is off in this village."
    : `${badges.length} held. The ones with a star show on ${whose ?? "their"} card.`;

  const body: ReactNode = (
    <div className="mt-2 flex flex-col gap-3">
      <p className="m-0 text-sm text-muted-foreground">{lead}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {badges.map((b) => {
          const full = !b.featured && picked.length >= max;
          return (
            <li key={b.id} className="flex items-start gap-3 rounded-[14px] border border-dash-edge bg-dash-raised p-3">
              <svg viewBox="-2 -12 44 24" className="mt-1 h-4 w-7 shrink-0" aria-hidden="true">
                <path d="M0 0Q15 -10 40 0Q15 10 0 0Z" fill={petalColour(b.kind)} stroke="var(--color-dash-gold-edge)" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="m-0 break-words font-medium text-foreground">
                  {b.name}
                  {!editable && b.featured ? <span className="ml-1.5 text-dash-gold-lit" aria-label="shown on their card">★</span> : null}
                </p>
                <p className="m-0 text-xs uppercase tracking-[0.12em] text-muted-foreground">{KIND_WORD[b.kind] ?? b.kind}</p>
                {b.description ? <p className="m-0 mt-1 break-words text-sm text-foreground/85">{b.description}</p> : null}
              </div>
              {editable && max > 0 ? (
                <button
                  type="button"
                  onClick={() => toggle(b)}
                  disabled={busy !== null || full}
                  aria-pressed={!!b.featured}
                  title={full ? `You have picked ${max}. Take one off first.` : undefined}
                  className={`min-h-11 shrink-0 rounded-xl border px-3 text-sm font-medium disabled:opacity-50 ${
                    b.featured
                      ? "border-dash-gold bg-dash-gold text-dash-gold-ink"
                      : "border-border bg-transparent text-foreground hover:bg-muted"
                  }`}
                >
                  {b.featured ? "On your card" : "Show on card"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="m-0 text-sm text-dash-thanks">
          {error}
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      <Link href="/badges" className="text-sm text-dash-gold-lit underline underline-offset-2 hover:text-foreground">
        Every badge in the village
      </Link>
    </div>
  );

  if (!open) return null;
  return wideScreen() ? (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sheet-night max-h-[90vh] overflow-y-auto rounded-2xl border-border bg-card p-6 text-card-foreground sm:max-w-xl">
        <DialogTitle className="font-display text-3xl font-normal text-foreground">{title}</DialogTitle>
        <DialogDescription className="sr-only">{lead}</DialogDescription>
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="sheet-night max-h-[90vh] overflow-y-auto rounded-t-2xl border-border bg-card px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground"
      >
        <SheetTitle className="font-display text-3xl font-normal text-foreground">{title}</SheetTitle>
        <SheetDescription className="sr-only">{lead}</SheetDescription>
        {body}
      </SheetContent>
    </Sheet>
  );
}
