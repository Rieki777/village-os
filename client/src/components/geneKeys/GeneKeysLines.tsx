/**
 * THE LINES CARD: what the seal opens, and what the profile shows.
 *
 * The Activation Sequence (Life's Work, Evolution, Radiance, Purpose), each
 * sphere with its key, its line and the word genekeys.com gives that line in
 * that sphere; Love and Prosperity folded beneath it (opened 2026-10-30, after
 * their live test); then how this person works best (Human Design type,
 * strategy, authority); then the way to Richard Rudd's own work. Richard has agreed to
 * Amora using Gene Keys naming, and every card sends people to genekeys.com to
 * go deeper (Rye, 2026-10-22).
 *
 * The owner's copy adds their controls: show or hide, the guide's yes and
 * whether it talks plainly, share, find again, remove. Somebody else's copy
 * never shows a control.
 */
import { useState } from "react";
import { Link } from "wouter";
import { GENE_KEYS_SITE, MOON_SPHERES, withArticle, type GeneKeysView, type OwnGeneKeysView, type SphereView } from "@shared/geneKeys";
import { changeMyGeneKeys, removeMyGeneKeys, GeneKeysRefusal } from "@/lib/geneKeysApi";
import { useModuleOn } from "@/modules/ModuleProvider";
import { setMyGeneKeys } from "./useMyGeneKeys";
import { useGuideName } from "@/hooks/useGuideName";
import { guideNameAtSentenceStart } from "@shared/guideName";
import ShareLines from "./ShareLines";
import { BTN_LINK, BTN_PLAIN, EYEBROW, HINT, TILE } from "./ui";

function SphereTile({ s }: { s: SphereView }) {
  return (
    <div className={TILE}>
      <span className="text-sm font-medium text-foreground">{s.name}</span>
      {s.tagline ? <span className="text-xs text-muted-foreground">{s.tagline}</span> : null}
      <span className="font-display text-3xl text-notice">{s.keyLine}</span>
      <span className="text-xs text-foreground">
        Line {s.line} · {s.word}
      </span>
    </div>
  );
}

export function GeneKeysLines({ view, whose }: { view: GeneKeysView; whose: string | null }) {
  // A birth time picked between windows can misread the Moon-led sphere; say so to the owner only.
  const chosen = "source" in view && (view as OwnGeneKeysView).source === "chosen";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {view.spheres.map((s) => (
          <SphereTile key={s.sphere} s={s} />
        ))}
      </div>
      {view.love?.length ? (
        <details className="group rounded-xl border border-border bg-background p-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium text-foreground">Love and Prosperity</summary>
          <p className={`${EYEBROW} mt-3`}>Love</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {view.love.map((s) => (
              <SphereTile key={s.sphere} s={s} />
            ))}
          </div>
          {chosen && view.love.some((s) => MOON_SPHERES.has(s.sphere)) ? (
            <p className={`${HINT} mt-2`}>Attraction follows the Moon. With a chosen birth time it may read differently.</p>
          ) : null}
          <p className={`${EYEBROW} mt-4`}>Prosperity</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {view.prosperity.map((s) => (
              <SphereTile key={s.sphere} s={s} />
            ))}
          </div>
        </details>
      ) : null}
      <div className="flex flex-col gap-1 rounded-xl border border-border bg-background p-4">
        <p className={EYEBROW}>{whose ? `How ${whose} works best` : "How you work best"}</p>
        <p className="font-display text-2xl text-foreground">{whose ? view.type : `You're ${withArticle(view.type)}`}</p>
        <p className="text-sm leading-relaxed text-foreground">
          <span className="font-semibold text-notice">{view.strategy}.</span> {view.strategyLine}
        </p>
        <p className="text-sm leading-relaxed text-foreground">
          <span className="font-semibold text-notice">{view.authorityName} authority.</span> {view.authorityLine}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Type, strategy and authority come from Human Design.</p>
      </div>
      <a className={BTN_LINK} href={GENE_KEYS_SITE} target="_blank" rel="noopener noreferrer">
        Explore more in depth on genekeys.com
      </a>
    </div>
  );
}

/** The owner's own controls, under their card. */
export function GeneKeysOwnerControls({ mine }: { mine: OwnGeneKeysView }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The village's own guide, or "the village guide" while it has no name.
  const guide = useGuideName().name;

  const act = async (fn: () => Promise<OwnGeneKeysView | null>) => {
    setBusy(true);
    setProblem(null);
    try {
      setMyGeneKeys(await fn());
    } catch (e) {
      setProblem(e instanceof GeneKeysRefusal ? e.message : "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const shown = mine.visibility === "show";
  const cards = useModuleOn("session-card");
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <p className={HINT}>
        {shown ? "Shown on your profile, in your circle and on your role applications." : "Hidden. Only you see your lines."}{" "}
        {mine.maia
          ? mine.maiaPlain
            ? `${guideNameAtSentenceStart(guide)} uses your lines to choose its suggestions, and talks to you plainly.`
            : `${guideNameAtSentenceStart(guide)} uses your lines to shape its suggestions, and says when it does.`
          : `${guideNameAtSentenceStart(guide)} does not use your lines.`}
        {mine.inCards
          ? mine.maia && shown
            ? " Session cards can read your lines."
            : ` Session cards read your lines only while they are shown and ${guide} may use them.`
          : " Session cards welcome you by name and leave your lines out."}
        {cards ? "" : " Your village has not turned session cards on, so this choice waits for when it does."}
      </p>
      {mine.stale ? (
        <p className="text-sm text-notice">Your lines were found with an older calculator. Find them again to be sure they are right.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PLAIN} disabled={busy} onClick={() => act(() => changeMyGeneKeys({ visibility: shown ? "hide" : "show" }))}>
          {shown ? "Hide my lines" : "Show my lines"}
        </button>
        <button type="button" className={BTN_PLAIN} disabled={busy} onClick={() => act(() => changeMyGeneKeys({ maia: !mine.maia }))}>
          {mine.maia ? `Stop ${guide} using them` : `Let ${guide} use them`}
        </button>
        {mine.maia ? (
          <button type="button" className={BTN_PLAIN} disabled={busy} onClick={() => act(() => changeMyGeneKeys({ maiaPlain: !mine.maiaPlain }))}>
            {mine.maiaPlain ? `Let ${guide} speak to my type` : "Talk to me plainly"}
          </button>
        ) : null}
        {/* Shown whether or not the village has session cards on, so a member decides before a card ever reads them. */}
        <button type="button" className={BTN_PLAIN} disabled={busy} onClick={() => act(() => changeMyGeneKeys({ cards: !mine.inCards }))}>
          {mine.inCards ? "Leave me out of session cards" : "Read me on session cards"}
        </button>
        <ShareLines view={mine} />
        <Link href="/profile/gene-keys" className={BTN_PLAIN}>
          Find them again
        </Link>
        <button
          type="button"
          className={BTN_LINK}
          disabled={busy}
          onClick={() => act(async () => ((await removeMyGeneKeys()) ? null : mine))}
        >
          Remove my Gene Keys
        </button>
      </div>
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
