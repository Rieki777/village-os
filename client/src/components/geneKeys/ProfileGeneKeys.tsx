/**
 * Gene Keys on profiles: the member's own seal and card, and another member's.
 *
 * Every export renders nothing while the gene-keys module is off for this
 * viewer. Another member's lines arrive only when their owner shows them (the
 * server filters on that), so "nothing came back" is the hidden case and
 * renders nothing, never a placeholder that would hint at a hidden result.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Sparkles } from "lucide-react";
import { withArticle, type GeneKeysView } from "@shared/geneKeys";
import { useModuleOn } from "@/modules/ModuleProvider";
import { readHandleGeneKeys, readPeopleGeneKeys } from "@/lib/geneKeysApi";
import GeneKeysSeal from "./GeneKeysSeal";
import { GeneKeysLines, GeneKeysOwnerControls } from "./GeneKeysLines";
import { useMyGeneKeys } from "./useMyGeneKeys";
import { BTN_GOLD, EYEBROW, HINT, NIGHT_CARD } from "./ui";

/** The seal on the member's own portrait (ProfileHero). */
export function MyGeneKeysSeal({ className }: { className?: string }) {
  const { mine } = useMyGeneKeys();
  if (!mine) return null;
  return <GeneKeysSeal view={mine} whose={null} mine={mine} className={className} />;
}

/** The card on the member's own profile: their lines, or the invitation to find them. */
export function ProfileGeneKeysCard() {
  const { on, mine } = useMyGeneKeys();
  if (!on || mine === undefined) return null;

  if (!mine) {
    return (
      <section id="gene-keys" aria-labelledby="gene-keys-card-h" className={NIGHT_CARD}>
        <h2 id="gene-keys-card-h" className="flex items-center gap-2 font-display text-xl text-card-foreground">
          <Sparkles className="h-5 w-5 text-notice" aria-hidden="true" />
          Get your Gene Keys
        </h2>
        <p className="mt-1 text-sm text-foreground">
          See the two lines you carry and how you work best. Your lines help us find roles and teams that fit you.
        </p>
        <p className={`${HINT} mt-2`}>Your birth details never leave your device. Only your lines are kept.</p>
        <Link href="/profile/gene-keys" className={`${BTN_GOLD} mt-4`}>
          Find my lines
        </Link>
      </section>
    );
  }

  return (
    <section id="gene-keys" aria-labelledby="gene-keys-card-h" className={NIGHT_CARD}>
      <p className={EYEBROW}>Gene Keys {mine.profile}</p>
      <h2 id="gene-keys-card-h" className="mb-4 font-display text-3xl text-card-foreground">
        {mine.names}
      </h2>
      <GeneKeysLines view={mine} whose={null} />
      <div className="mt-4">
        <GeneKeysOwnerControls mine={mine} />
      </div>
    </section>
  );
}

const byHandle = new Map<string, Promise<GeneKeysView | null>>();

/** Another member's shown lines, read once per handle per page load. */
function useHandleGeneKeys(handle: string | null | undefined): GeneKeysView | null {
  const on = useModuleOn("gene-keys");
  const [view, setView] = useState<GeneKeysView | null>(null);
  useEffect(() => {
    if (!on || !handle) return;
    let live = true;
    if (!byHandle.has(handle)) byHandle.set(handle, readHandleGeneKeys(handle).catch(() => null));
    byHandle.get(handle)!.then((v) => live && setView(v));
    return () => {
      live = false;
    };
  }, [on, handle]);
  return on ? view : null;
}

/** The seal on someone else's portrait (PublicProfile). */
export function PersonGeneKeysSeal({ handle, firstName, className }: { handle: string | null | undefined; firstName: string; className?: string }) {
  const view = useHandleGeneKeys(handle);
  return view ? <GeneKeysSeal view={view} whose={firstName} className={className} /> : null;
}

/** Their lines card, under their portrait. */
export function PersonGeneKeysCard({ handle, firstName }: { handle: string | null | undefined; firstName: string }) {
  const view = useHandleGeneKeys(handle);
  if (!view) return null;
  return (
    <section aria-labelledby="person-gene-keys-h" className={NIGHT_CARD}>
      <p className={EYEBROW}>Gene Keys {view.profile}</p>
      <h2 id="person-gene-keys-h" className="mb-4 font-display text-3xl text-card-foreground">
        {view.names}
      </h2>
      <GeneKeysLines view={view} whose={firstName} />
    </section>
  );
}

/**
 * The lines on a role application (Rye, 2026-10-22: "we can keep lines in the
 * role applications"). Read by the candidate's id, shown only when they show
 * their lines, and offered as information: the seal and one plain line, never
 * a score or a fit.
 */
export function ApplicantGeneKeys({ userId, firstName }: { userId: string; firstName: string }) {
  const on = useModuleOn("gene-keys");
  const [view, setView] = useState<GeneKeysView | null>(null);
  useEffect(() => {
    if (!on || !userId) return;
    let live = true;
    readPeopleGeneKeys([userId])
      .then((p) => live && setView(p[userId] ?? null))
      .catch(() => live && setView(null));
    return () => {
      live = false;
    };
  }, [on, userId]);
  if (!on || !view) return null;
  return (
    <div className="sheet-night mb-4 flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground">
      <span className="relative block h-12 w-12 shrink-0">
        <GeneKeysSeal view={view} whose={firstName} className="absolute inset-0" />
      </span>
      <p className="text-sm text-foreground">
        <span className="font-semibold">{firstName}</span> carries {view.names} ({view.profile}) and works best as {withArticle(view.type)}.
      </p>
    </div>
  );
}

