/**
 * WHO HOLDS THE VOICE: the band under the open votes on /governance (Rye,
 * 2026-10-31: "a graphic on the governance page that shows the distribution of
 * voice holdings and other relevant governance metrics").
 *
 * A vote weighted by Voice gives a big contributor a big say, so the village
 * should be able to see how big. Each bar is one group of voters, the top
 * tenth, quarter and half by Voice, filled to the share of all Voice that
 * group holds. The upright mark on each bar sits where an even share would be: a
 * bar that reaches far past its mark is a group with more say than its size.
 *
 * It names nobody and shows no one's amount. The server sends only groups of
 * three or more with three or more outside them (shared/voiceSpread.ts), and
 * says when a village is too small for any. A stranger gets it only while the
 * village shows its people, and a refusal draws nothing here at all.
 *
 * The heading and the sentence under it are the village's own words (Admin,
 * Pages, How We Govern); every figure is the village's own.
 */
import { useEffect, useState } from "react";
import { useModule } from "@/modules/ModuleProvider";
import type { Evenness, VoiceSpreadView } from "@shared/voiceSpread";
import { fetchVoiceSpread } from "./governanceApi";

const EVENNESS_WORDS: Record<Evenness, string> = {
  even: "Voice is spread fairly evenly: each group's say is close to its size.",
  leaning: "Voice leans toward the most active: the top groups have more say than their size.",
  concentrated: "Most of the Voice sits with a few: the top groups have far more say than their size.",
};

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div data-spread-tile className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-600">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold text-teal-deep">{value}</div>
    </div>
  );
}

export default function VoiceSpreadBand({ heading, intro }: { heading: string; intro: string }) {
  const governance = useModule("governance");
  const [view, setView] = useState<VoiceSpreadView | null>(null);

  useEffect(() => {
    if (!governance) return;
    let alive = true;
    fetchVoiceSpread().then((answer) => {
      if (alive && answer.ok) setView(answer.data);
    });
    return () => {
      alive = false;
    };
  }, [governance]);

  if (!governance || !view) return null;
  const { spread, ballots } = view;

  return (
    <section className="border-b border-stone-200 bg-stone-50 py-12" aria-labelledby="voice-spread-heading">
      <div className="container mx-auto max-w-5xl px-4">
        <h2 id="voice-spread-heading" className="font-display text-2xl md:text-3xl font-bold text-teal-deep break-words">
          {heading}
        </h2>
        {intro.trim() !== "" && <p className="mt-2 max-w-3xl text-stone-700 leading-relaxed break-words">{intro}</p>}
        <p className="mt-3 text-sm font-medium text-stone-800">
          {view.weightedByVoice
            ? "Votes here are weighted by Voice."
            : "Right now every member's vote counts the same, so Voice moves no result yet."}
        </p>

        <div className="mt-6 grid gap-8 md:grid-cols-[3fr_2fr]">
          <div>
            {!spread.anyVoice ? (
              <p className="text-stone-700">Nobody holds any Voice yet.</p>
            ) : spread.bands.length === 0 ? (
              <p className="text-stone-700">
                {`With ${spread.voters} ${spread.voters === 1 ? "voter" : "voters"}, the village is too small to show how Voice is spread without pointing at someone. It shows once there are more of you.`}
              </p>
            ) : (
              <>
                <ul className="space-y-4">
                  {spread.bands.map((b) => (
                    <li key={b.topPct}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm text-stone-800">
                        <span>
                          The top <strong>{b.topPct}%</strong> of voters hold <strong>{b.sharePct}%</strong> of the Voice
                        </span>
                      </div>
                      <div className="relative mt-2.5 mb-1 h-4 rounded-full bg-stone-200" aria-hidden="true">
                        <div data-spread-fill className="h-full rounded-full bg-teal-deep" style={{ width: `${b.sharePct}%` }} />
                        <div data-spread-even className="absolute -top-1.5 h-7 w-1 -translate-x-1/2 rounded-full bg-amber-800 ring-2 ring-stone-50" style={{ left: `${b.topPct}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 flex items-center gap-2 text-xs text-stone-600">
                  <span className="inline-block h-4 w-1 rounded-full bg-amber-800" aria-hidden="true" />
                  The upright mark is where an even share would be.
                </p>
                {spread.evenness && <p className="mt-3 text-sm text-stone-800">{EVENNESS_WORDS[spread.evenness]}</p>}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 self-start">
            <Tile label={ballots.since ? "Votes this season" : "Votes so far"} value={String(ballots.run)} />
            <Tile label="Carried" value={ballots.closed ? `${ballots.passed} of ${ballots.closed}` : "None yet"} />
            <Tile label="Average turnout" value={ballots.turnoutPct === null ? "None closed yet" : `${ballots.turnoutPct}%`} />
            <Tile label="Quorum" value={`${view.quorumPct}%`} />
          </div>
        </div>
      </div>
    </section>
  );
}
