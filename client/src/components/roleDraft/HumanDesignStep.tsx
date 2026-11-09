/**
 * "ADD YOUR HUMAN DESIGN OR GENE KEYS", the optional step of the role draft
 * board (role journey, lane L3). Loaded as its own chunk, only when opened,
 * because the sky calculation is large.
 *
 * SELF-KNOWLEDGE ONLY. A signed-in member who uses the Gene Keys module and
 * presses "Use my profile" has their type and lines read from it. Anyone else
 * can work theirs out here from a birth date and time, in this browser. The
 * only request this file makes is the village's mapping (a GET that carries
 * nothing of the person). The chart is never sent, never stored, never put on
 * an application, never shown to anyone deciding, never used in selection.
 *
 * The village's mapping turns a type or a line into suggested characters. The
 * platform ships none: with no mapping the step says so and suggests nothing.
 */
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";
import { useMyGeneKeys } from "@/components/geneKeys/useMyGeneKeys";
import { viewOf } from "@shared/geneKeys";
import { resultAt, zonedToUtc } from "@shared/geneKeysSky";
import { DISCOVER_WORDS, EMPTY_MAPPING, mappingIsEmpty, parseMapping, suggestCharacters, type DiscoverMapping } from "@shared/roleDiscover";

const FIELD = "min-h-11 rounded-lg border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring";

interface Reading {
  type: string;
  lines: [number, number];
}

export default function HumanDesignStep({
  cast,
  chars,
  onToggle,
}: {
  cast: ReadonlyArray<{ key: string; name: string }>;
  chars: readonly string[];
  onToggle: (key: string) => void;
}) {
  const { t } = useLingui();
  const [mapping, setMapping] = useState<DiscoverMapping | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("12:00");
  const [problem, setProblem] = useState<string | null>(null);
  const { on, mine } = useMyGeneKeys();

  useEffect(() => {
    let live = true;
    gameFetch("/api/governance/role-discover/mapping")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setMapping(parseMapping(d?.mapping)))
      .catch(() => live && setMapping(EMPTY_MAPPING));
    return () => {
      live = false;
    };
  }, []);

  const compute = () => {
    setProblem(null);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const tm = /^(\d{2}):(\d{2})$/.exec(time);
    if (!m || !tm) return setProblem(t`Enter a birth date and a time.`);
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const utc = zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(tm[1]), Number(tm[2]), zone);
      const v = viewOf(resultAt(utc).chart);
      setReading({ type: v.type, lines: v.lines });
    } catch {
      setProblem(t`That date could not be read.`);
    }
  };

  const castKeys = cast.map((c) => c.key);
  const none = mapping !== null && mappingIsEmpty(mapping);
  const suggested = reading && mapping ? suggestCharacters(mapping, { type: reading.type, lines: reading.lines }, castKeys) : [];
  const nameOf = (k: string) => cast.find((c) => c.key === k)?.name ?? k;

  return (
    <div className="mt-3 space-y-3 text-sm">
      <p className="font-semibold">{DISCOVER_WORDS.private}</p>
      {on && mine && (
        <button
          type="button"
          onClick={() => setReading({ type: mine.type, lines: mine.lines })}
          className="min-h-11 rounded-full border border-border px-4 font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t`Use my profile`}
        </button>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {t`Birth date`}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          {t`Birth time`}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={FIELD} />
        </label>
        <button type="button" onClick={compute} className="min-h-11 rounded-full border border-border px-4 font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          {t`Work it out here`}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t`Worked out in this browser, in this device's time zone. Nothing you type here is sent.`}</p>
      {problem && <p role="alert">{problem}</p>}
      {reading && (
        <p>{t`Your type is ${reading.type}, with lines ${reading.lines[0]} and ${reading.lines[1]}.`}</p>
      )}
      {none && <p className="text-muted-foreground">{DISCOVER_WORDS.noMapping}</p>}
      {reading && suggested.length > 0 && (
        <div>
          <p className="font-semibold">{t`Characters this village points you toward`}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggested.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={chars.includes(k)}
                onClick={() => onToggle(k)}
                className={`min-h-11 rounded-full border px-4 font-semibold focus-visible:outline-2 focus-visible:outline-ring ${chars.includes(k) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
              >
                {nameOf(k)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
