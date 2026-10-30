/**
 * YOUR SEASON, SUMMED UP, ON YOUR PROFILE (idea 4, Rye 2026-10-30).
 *
 * Reachable any time after a season turns, at /profile#season-summary, which
 * is where the after-turn prompt (SeasonSummaryOffer) sends a member. Opens on
 * the most recently closed season; a member with more than one can pick.
 *
 * SHARING. "Save picture" downloads a PNG of the card; "Share" hands the same
 * PNG to the device's share sheet where the browser offers one; "Copy link"
 * copies the member's public profile address. The picture carries only what
 * the member ticked, and cash starts unticked (`SHARE_DEFAULTS`). There is no
 * public link onto these numbers: the server answers only the asker.
 *
 * Renders nothing until a season has closed.
 */
import { useEffect, useRef, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { useAuth } from "@/contexts/AuthContext";
import { SHARE_DEFAULTS, type SeasonSummary, type ShareChoices } from "@shared/seasonSummary";
import { cardPng, drawSeasonCard, paletteFrom, seasonCardModel } from "@/lib/seasonCard";
import SeasonSummaryCard from "./SeasonSummaryCard";
import { markSeasonSeen } from "./seen";
import { useTokenName } from "@/hooks/useTokenNames";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export const SEASON_SUMMARY_ANCHOR = "season-summary";

const choiceWords = (thanks: string): Record<keyof ShareChoices, string> => ({
  earnings: "What I earned",
  gratitude: thanks,
  cash: "Cash",
});

export default function SeasonSummarySection() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<SeasonSummary | null>(null);
  const [season, setSeason] = useState<string>("");
  const [choices, setChoices] = useState<ShareChoices>(SHARE_DEFAULTS);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const thanks = useTokenName();
  const CHOICE_WORDS = choiceWords(thanks);

  useEffect(() => {
    let live = true;
    const q = season ? `?season=${encodeURIComponent(season)}` : "";
    fetch(`/api/me/season-summary${q}`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live) setSummary(d?.summary ?? null);
      })
      .catch(() => {
        if (live) setSummary(null);
      });
    return () => {
      live = false;
    };
  }, [season]);

  // Arriving from the prompt: bring the card into view and count it as seen.
  useEffect(() => {
    if (!summary || !user) return;
    markSeasonSeen(String(user.id), summary.season.id);
    if (window.location.hash === `#${SEASON_SUMMARY_ANCHOR}`) {
      document.getElementById(SEASON_SUMMARY_ANCHOR)?.scrollIntoView({ block: "start" });
    }
  }, [summary, user]);

  if (!summary) return null;

  const picture = async (): Promise<Blob | null> => {
    const canvas = drawSeasonCard(document.createElement("canvas"), seasonCardModel(summary, choices, thanks), paletteFrom(cardRef.current));
    return cardPng(canvas);
  };
  // The constructor, because the client's typecheck refuses the `u` flag on a literal.
  const fileName = `${summary.season.name.replace(new RegExp("[^\\p{L}\\p{N}]+", "gu"), "-").toLowerCase() || "season"}-summary.png`;

  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      const blob = await picture();
      if (!blob) return setNotice("This browser could not make the picture.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Saved. Post it wherever you like.");
    } finally {
      setBusy(false);
    }
  };

  const link = summary.member.handle ? `${window.location.origin}/profile/${encodeURIComponent(summary.member.handle)}` : "";
  const canShareFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  const share = async () => {
    setBusy(true);
    setNotice("");
    try {
      const blob = await picture();
      if (!blob) return setNotice("This browser could not make the picture.");
      const file = new File([blob], fileName, { type: "image/png" });
      if (!navigator.canShare?.({ files: [file] })) return setNotice("This device cannot share a picture. Save it instead.");
      await navigator.share({ files: [file], title: `${summary.season.name}, summed up`, ...(link ? { url: link } : {}) });
    } catch {
      /* the member closed the share sheet */
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Link copied.");
    } catch {
      setNotice(link);
    }
  };

  return (
    <section id={SEASON_SUMMARY_ANCHOR} aria-label="Your season, summed up" className="scroll-mt-24 space-y-4">
      {summary.seasons.length > 1 && (
        <label className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Season
          <select
            value={season || summary.season.id}
            onChange={(e) => setSeason(e.target.value)}
            className="min-h-9 rounded-lg border border-border bg-background px-3 text-foreground"
          >
            {summary.seasons.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}{x.closed ? "" : " (running)"}
              </option>
            ))}
          </select>
        </label>
      )}

      <div ref={cardRef}>
        <SeasonSummaryCard summary={summary} choices={choices} />
      </div>

      <div className="rounded-2xl bg-card p-5 shadow-sm space-y-3">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-card-foreground">In the picture</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(Object.keys(CHOICE_WORDS) as Array<keyof ShareChoices>).map((k) => (
              <label key={k} className="flex min-h-9 items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={choices[k]}
                  onChange={(e) => setChoices({ ...choices, [k]: e.target.checked })}
                  className="h-4 w-4"
                />
                {CHOICE_WORDS[k]}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Cash stays out of the picture unless you tick it. Your work and badges are always in it.
          </p>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="min-h-11 rounded-full bg-notice px-5 text-sm font-semibold text-background disabled:opacity-40"
          >
            Save picture
          </button>
          {canShareFiles && (
            <button
              type="button"
              disabled={busy}
              onClick={share}
              className="min-h-11 rounded-full border border-border px-5 text-sm font-medium text-foreground disabled:opacity-40"
            >
              Share
            </button>
          )}
          {link && (
            <button
              type="button"
              onClick={copy}
              className="min-h-11 rounded-full border border-border px-5 text-sm font-medium text-foreground"
            >
              Copy link to my profile
            </button>
          )}
        </div>
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      </div>
    </section>
  );
}
