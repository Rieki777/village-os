/**
 * The member's own needs card, on their own profile. (R20, R17; lane N4)
 *
 * THE ORDER OF THIS CARD IS THE ARGUMENT. Who will ever see the answer is
 * printed BEFORE the first control, never behind a link and never under the
 * save button. Saying "Deprived" on Love is a confession about somebody's
 * life, and a person deciding whether to make it has to know the audience at
 * the moment they are asked, not after they have answered.
 *
 * WHAT LEAVES THIS COMPONENT. `needKey`, `depth`, and two optional strings the
 * member typed. No `visibility` field is ever sent: the server sets it, and
 * `PUT /api/needs/mine` refuses a body that carries one. A card that offered a
 * visibility control would be promising a setting no release has built.
 *
 * WHERE THE NUMBER IN THE PRIVACY SENTENCE COMES FROM. `floor`, off the same
 * payload, which is `aggregateFloor()` in server/lib/needs.ts reading the
 * `needs.aggregate_floor` dial this village voted. The same call decides
 * which counts the aggregate withholds, so the sentence and the suppression
 * are one number. This file never carries its own copy, so a village that
 * moves its floor moves what it is told in the same breath.
 *
 * THE HONEST HALF UNDER EACH NEED comes from `GET /api/needs/coverage`, lane
 * N1's read. A need with nothing tagged to it says so in a sentence. The
 * alternative is a member recording that they are Deprived on Play beside a
 * blank space, which teaches them that saying so changed nothing.
 *
 * COLOURS. This card sits on `/profile`, whose older neighbours pair a fixed
 * `bg-white` with fixed grays and therefore cannot follow a village's theme.
 * Everything here is a token (`bg-card`, `text-foreground`,
 * `text-muted-foreground`, `border-border`, `text-teal-deep`), so it reads
 * correctly in both themes and picks up a founder's seed colour.
 */
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { useAuth } from "@/contexts/AuthContext";
import { HUMAN_NEEDS, NEED_DEPTHS, NEED_DEPTH_LABELS, type NeedDepth } from "@shared/needs";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t
    ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
};

interface MineRow {
  needKey: string;
  depth: NeedDepth;
  feeling: string | null;
  note: string | null;
}

interface MinePayload {
  floor: number;
  feelingMax: number;
  noteMax: number;
  answered: boolean;
  mine: MineRow[];
}

interface CoverageRow {
  needKey: string;
  label: string;
  counts: Record<string, number>;
  total: number;
}

interface CoveragePayload {
  coverage: CoverageRow[];
}

/**
 * What one tagged thing is CALLED in a sentence, singular and plural.
 *
 * Keyed by the subject union the server sends. A kind added on the server
 * without a word here would render a bare number where a noun belonged, with
 * no error anywhere, which is the mirror-annotation trap in CLAUDE.md.
 */
const SUBJECT_WORDS: Record<string, [string, string]> = {
  quest: ["quest", "quests"],
  role: ["seat", "seats"],
  sink: ["place to spend", "places to spend"],
  stay: ["stay", "stays"],
  event: ["gathering", "gatherings"],
  place: ["place", "places"],
};

/** "1 seat and 3 quests", from the counts the coverage read returns. */
function coverageWords(counts: Record<string, number>): string {
  const parts: string[] = [];
  for (const kind of Object.keys(SUBJECT_WORDS)) {
    const n = Number(counts?.[kind] ?? 0);
    if (!n) continue;
    const words = SUBJECT_WORDS[kind];
    parts.push(`${n} ${n === 1 ? words[0] : words[1]}`);
  }
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

type Draft = { depth: NeedDepth | ""; feeling: string; note: string };

const emptyDraft = (): Draft => ({ depth: "", feeling: "", note: "" });

export default function NeedCard() {
  const { user } = useAuth();
  const [mine, setMine] = useState<MinePayload | null>(null);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    fetch("/api/needs/mine", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MinePayload | null) => {
        if (!d) return;
        setMine(d);
        const next: Record<string, Draft> = {};
        for (const row of d.mine ?? []) {
          next[row.needKey] = {
            depth: row.depth,
            feeling: row.feeling ?? "",
            note: row.note ?? "",
          };
        }
        setDrafts(next);
      })
      .catch(() => {
        /* the card simply does not appear */
      });
    fetch("/api/needs/coverage", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CoveragePayload | null) => setCoverage(d?.coverage ?? []))
      .catch(() => setCoverage([]));
  };

  useEffect(() => {
    if (user) load();
  }, [user?.id]);

  if (!user || !mine) return null;

  /**
   * The needs this card shows, in one list and without duplicates.
   *
   * The village's own scope first, because those are the needs it said it
   * would meet. Then anything this member already answered on, so an answer
   * survives the village retiring the need. Then whatever they have chosen to
   * add for themselves this session.
   */
  const shown: string[] = [];
  for (const key of [
    ...coverage.map((c) => c.needKey),
    ...(mine.mine ?? []).map((m) => m.needKey),
    ...extra,
  ]) {
    if (!shown.includes(key)) shown.push(key);
  }

  const labelFor = (key: string): string =>
    coverage.find((c) => c.needKey === key)?.label ??
    HUMAN_NEEDS.find((n) => n.id === key)?.label ??
    key;

  const draftFor = (key: string): Draft => drafts[key] ?? emptyDraft();

  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [key]: { ...(d[key] ?? emptyDraft()), ...patch } }));

  const save = async (key: string) => {
    const draft = draftFor(key);
    if (!draft.depth) return;
    setBusy(key);
    setResult(null);
    try {
      // Only the fields the member typed. No `visibility`: the server sets it.
      const r = await fetch("/api/needs/mine", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({
          needKey: key,
          depth: draft.depth,
          feeling: draft.feeling || null,
          note: draft.note || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setResult({ ok: false, text: d?.error ?? "That answer did not save." });
      } else {
        setResult({ ok: true, text: `Saved. ${labelFor(key)} is yours alone.` });
        load();
      }
    } catch {
      setResult({ ok: false, text: "That did not reach the village. Try again in a moment." });
    }
    setBusy("");
  };

  const forget = async (key: string) => {
    setBusy(key);
    setResult(null);
    try {
      const r = await fetch("/api/needs/mine", {
        method: "DELETE",
        headers: headers(),
        body: JSON.stringify({ needKey: key }),
      });
      const d = await r.json();
      setResult(
        r.ok
          ? { ok: true, text: `Your answer on ${labelFor(key)} is gone.` }
          : { ok: false, text: d?.error ?? "That answer is still there." },
      );
      if (r.ok) {
        setDrafts((all) => {
          const next = { ...all };
          delete next[key];
          return next;
        });
        load();
      }
    } catch {
      setResult({ ok: false, text: "That did not reach the village. Try again in a moment." });
    }
    setBusy("");
  };

  const unlisted = HUMAN_NEEDS.filter((n) => !shown.includes(n.id));

  return (
    <div className="bg-card text-card-foreground rounded-2xl shadow-lg p-8 border border-border">
      <h3 className="text-xl font-display font-bold text-teal-deep flex items-center gap-2 mb-2">
        <Heart className="w-6 h-6" />
        I feel ____ because I need ____.
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        Pick the need, say the feeling, and say where you are with it. Deprived, Unmet, Alive,
        Satisfied, Thriving.
      </p>

      {/* The audience, before a single control. */}
      <p className="text-sm text-foreground bg-muted rounded-lg px-4 py-3 mb-6">
        Only you can read this. The village sees how many members are doing well or badly on each
        need, never who. A count appears only once at least {mine.floor} members have answered.
      </p>

      {shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Your village has not said what it is for yet. Add a need below and it is still yours.
        </p>
      )}

      <div className="space-y-6">
        {shown.map((key) => {
          const draft = draftFor(key);
          const row = coverage.find((c) => c.needKey === key);
          const met = row && row.total > 0 ? coverageWords(row.counts) : "";
          return (
            <div key={key} className="border-t border-border pt-5 first:border-t-0 first:pt-0">
              <fieldset>
                <legend className="text-base font-display font-semibold text-foreground mb-2">
                  {labelFor(key)}
                </legend>
                <div role="radiogroup" aria-label={`Where you are with ${labelFor(key)}`} className="flex flex-wrap gap-2 mb-3">
                  {NEED_DEPTHS.map((rung) => (
                    <label
                      key={rung}
                      className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${
                        draft.depth === rung
                          ? "border-teal-deep bg-teal-deep text-white"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`depth-${key}`}
                        value={rung}
                        checked={draft.depth === rung}
                        onChange={() => setDraft(key, { depth: rung })}
                      />
                      {NEED_DEPTH_LABELS[rung]}
                    </label>
                  ))}
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">I feel</span>
                    <input
                      type="text"
                      maxLength={mine.feelingMax}
                      value={draft.feeling}
                      onChange={(e) => setDraft(key, { feeling: e.target.value })}
                      className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                      placeholder="lonely, restless, held"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">
                      Anything else you want to say (optional)
                    </span>
                    <input
                      type="text"
                      maxLength={mine.noteMax}
                      value={draft.note}
                      onChange={(e) => setDraft(key, { note: e.target.value })}
                      className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
                      placeholder="In your own words"
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3 pt-3">
                  <p className="text-xs text-muted-foreground">
                    {met
                      ? `Met here by ${met}.`
                      : "Nothing in this village meets this yet. Your village knows."}
                  </p>
                  <div className="flex items-center gap-2">
                    {drafts[key] && (
                      <button
                        type="button"
                        onClick={() => forget(key)}
                        disabled={busy === key}
                        className="text-xs text-muted-foreground underline disabled:opacity-50"
                      >
                        Take it back
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => save(key)}
                      disabled={busy === key || !draft.depth}
                      className="bg-teal-deep text-white text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50"
                    >
                      {busy === key ? "Saving" : "Save"}
                    </button>
                  </div>
                </div>
              </fieldset>
            </div>
          );
        })}
      </div>

      {unlisted.length > 0 && (
        <label className="block mt-6">
          <span className="text-xs font-medium text-muted-foreground">
            Add a need of your own. Your village does not have to have taken it on.
          </span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setExtra((x) => [...x, e.target.value]);
            }}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
          >
            <option value="">Choose a need</option>
            {unlisted.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`mt-4 text-sm rounded-lg px-3 py-2 ${
            result.ok ? "text-teal-deep bg-teal-deep/10" : "text-destructive bg-destructive/10"
          }`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
