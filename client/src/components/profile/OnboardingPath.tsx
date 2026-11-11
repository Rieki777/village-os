/**
 * The onboarding path on the profile, in the phases the village named.
 *
 * Opens when a holder is seated; the profile loads it lazily and it renders
 * nothing for anybody with no path to show. Items are ticked by whoever owns
 * them (the holder, the buddy, or the holder of the owning role); a check-in at
 * a check-in, where the village has set any, is filed by the holder and read by the holder, the buddy and
 * the onboarding role (server/lib/onboarding.ts decides, this only draws).
 *
 * Its own file because Profile.tsx sits under the file-lines ratchet.
 */
import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { gameFetch } from "@/lib/gameApi";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD,
  EYEBROW,
  FIELD as FIELD_LOOK,
  H2,
  HINT,
  LABEL,
  LINK,
  TILE,
} from "@/components/journey/look";
import { readLink, type CheckinAnswers, type PathItemState } from "@shared/onboardingPath";

export const ONBOARDING_WORDS = {
  heading: (role: string) => role,
  line: (day: number, due: string) =>
    `Day ${day}. The steps are due by ${due}.`,
  days: (a: number, b: number) => (a === b ? `Day ${a}` : `Days ${a} to ${b}`),
  holderOf: (role: string) => `A new holder in ${role}`,
  buddy: (name: string) => `Your buddy is ${name}.`,
  noBuddy: "No buddy is named yet. Ask the one who adopted you.",
  open: (n: number) => (n === 1 ? "1 step open" : `${n} steps open`),
  allDone: "Every step is done.",
  tick: "Mark done",
  doneWhen: "Done when:",
  due: (d: number) => `by day ${d}`,
  checkins: "Check-ins",
  checkinOpen: (d: number) => `File your day ${d} check-in`,
  filed: (d: number) => `Day ${d} filed`,
  clarity: "How clear is your role? (1 to 5)",
  overall: "How is it going overall? (1 to 5)",
  connection: "Who have you worked with? Who do you still want to meet?",
  culture: "What has surprised you about how we work together?",
  basics: "Do you have the access and tools you need? What is missing?",
  load: "How stretched or steady do we feel against the commitment we agreed?",
  oneThing: "One thing that would help most next moon",
  file: "File check-in",
  failed: "The onboarding path did not load.",
  retry: "Retry",
} as const;

interface Served {
  id: string;
  roleName: string;
  title: string;
  openedOn: string;
  dueOn: string;
  day: number;
  buddyName: string;
  mine: boolean;
  items: Array<PathItemState & { mayTick: boolean }>;
  openCount: number;
  checkinsDue: number[];
  checkins: Array<{
    day: number;
    answers: CheckinAnswers | null;
    filedAt: string;
  }> | null;
  mayFile: boolean;
}

const FIELD = `${FIELD_LOOK} mt-1 min-h-11`;

/** A step's link, read again here so only an https address ever becomes an href. */
const linkOf = (it: PathItemState) => readLink(it.link);

function CheckinForm({
  pathId,
  day,
  onFiled,
}: {
  pathId: string;
  day: number;
  onFiled: (paths: Served[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(
      [
        "clarity",
        "overall",
        "connection",
        "culture",
        "basics",
        "load",
        "oneThing",
      ].map(k => [k, String(f.get(k) ?? "")])
    );
    const res = await gameFetch(
      `/api/onboarding/paths/${encodeURIComponent(pathId)}/checkins/${day}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && Array.isArray(out.paths)) onFiled(out.paths);
    else
      setError(
        typeof out.error === "string" ? out.error : ONBOARDING_WORDS.failed
      );
  }
  return (
    <form onSubmit={submit} className={`${TILE} mt-3 space-y-3`}>
      <p className={H2}>{ONBOARDING_WORDS.checkinOpen(day)}</p>
      {(["clarity", "overall"] as const).map(k => (
        <label key={k} className={`block ${LABEL}`}>
          {ONBOARDING_WORDS[k]}
          <select name={k} required defaultValue="" className={FIELD}>
            <option value="" disabled />
            {[1, 2, 3, 4, 5].map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ))}
      {(["connection", "culture", "basics", "load", "oneThing"] as const).map(
        k => (
          <label key={k} className={`block ${LABEL}`}>
            {ONBOARDING_WORDS[k]}
            <textarea name={k} rows={2} maxLength={1000} className={FIELD} />
          </label>
        )
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={BTN_PRIMARY}>
        {ONBOARDING_WORDS.file}
      </button>
    </form>
  );
}

/** The steps grouped by phase, in the order the path holds them. */
export function phasesOf<
  T extends { phase: string; phaseFrom: number; phaseTo: number },
>(
  items: readonly T[]
): Array<{ name: string; from: number; to: number; items: T[] }> {
  const out: Array<{ name: string; from: number; to: number; items: T[] }> = [];
  for (const it of items) {
    const at = out.find(g => g.name === it.phase);
    if (at) at.items.push(it);
    else
      out.push({
        name: it.phase,
        from: it.phaseFrom,
        to: it.phaseTo,
        items: [it],
      });
  }
  return out;
}

function PathCard({
  p,
  onPaths,
}: {
  p: Served;
  onPaths: (paths: Served[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  async function tick(key: string) {
    setError(null);
    const res = await gameFetch(
      `/api/onboarding/paths/${encodeURIComponent(p.id)}/items/${encodeURIComponent(key)}/done`,
      { method: "POST" }
    );
    const out = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(out.paths)) onPaths(out.paths);
    else
      setError(
        typeof out.error === "string" ? out.error : ONBOARDING_WORDS.failed
      );
  }
  return (
    <section aria-labelledby={`onb-${p.id}`} className={CARD}>
      <p className={EYEBROW}>{p.title}</p>
      <h2 id={`onb-${p.id}`} className={`${H2} mt-1`}>
        {p.mine
          ? ONBOARDING_WORDS.heading(p.roleName)
          : ONBOARDING_WORDS.holderOf(p.roleName)}
      </h2>
      <p className="mt-2 text-foreground">
        {ONBOARDING_WORDS.line(p.day, p.dueOn)}
      </p>
      <p className="mt-1 text-foreground">
        {p.buddyName
          ? ONBOARDING_WORDS.buddy(p.buddyName)
          : ONBOARDING_WORDS.noBuddy}
      </p>
      <p className={`${HINT} mt-1`}>
        {p.openCount > 0
          ? ONBOARDING_WORDS.open(p.openCount)
          : ONBOARDING_WORDS.allDone}
      </p>
      {phasesOf(p.items).map(ph => (
        <div key={ph.name} className="mt-4">
          <h3 className="font-display text-lg font-bold text-card-foreground">
            {ph.name}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({ONBOARDING_WORDS.days(ph.from, ph.to)})
            </span>
          </h3>
          <ul className="mt-2 space-y-2">
            {ph.items.map(it => (
              <li
                key={it.key}
                className={`${TILE} flex flex-wrap items-center justify-between gap-2 py-3`}
              >
                <span
                  className={`flex items-start gap-3 ${it.doneAt ? "text-muted-foreground" : "font-medium text-card-foreground"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-notice ${it.doneAt ? "bg-notice text-background" : ""}`}
                  >
                    {it.doneAt && <Check className="size-3.5" />}
                  </span>
                  <span>
                    {it.title}
                    <span className="block text-sm font-normal text-muted-foreground">
                      {ONBOARDING_WORDS.doneWhen} {it.doneWhen} (
                      {ONBOARDING_WORDS.due(it.dueDay)})
                    </span>
                  </span>
                </span>
                {linkOf(it) && (
                  // Opens in a new tab and never hands the new page this one:
                  // noopener drops window.opener, noreferrer drops the Referer.
                  <a href={linkOf(it)!.href} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>
                    {linkOf(it)!.label}
                  </a>
                )}
                {!it.doneAt && it.mayTick && (
                  <button
                    type="button"
                    onClick={() => void tick(it.key)}
                    className={BTN_SECONDARY}
                  >
                    {ONBOARDING_WORDS.tick}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {p.checkins && (p.checkins.length > 0 || p.checkinsDue.length > 0) && (
        <div className="mt-4">
          <h3 className="font-display text-lg font-bold text-card-foreground">
            {ONBOARDING_WORDS.checkins}
          </h3>
          <ul className="mt-1 text-sm text-foreground">
            {p.checkins.map(c => (
              <li key={c.day}>
                {ONBOARDING_WORDS.filed(c.day)}
                {c.answers
                  ? ` (${c.answers.clarity} and ${c.answers.overall} of 5)`
                  : ""}
              </li>
            ))}
          </ul>
          {p.mayFile &&
            p.checkinsDue.map(d => (
              <CheckinForm key={d} pathId={p.id} day={d} onFiled={onPaths} />
            ))}
        </div>
      )}
    </section>
  );
}

export default function OnboardingPath() {
  const [paths, setPaths] = useState<Served[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    void gameFetch("/api/onboarding/me")
      .then(async res => {
        const out = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(out.paths)) setPaths(out.paths);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => load(), [load]);

  if (failed) {
    return (
      <p role="status" className="text-foreground">
        {ONBOARDING_WORDS.failed}{" "}
        <button type="button" onClick={load} className={`${LINK} min-h-11`}>
          {ONBOARDING_WORDS.retry}
        </button>
      </p>
    );
  }
  if (!paths || paths.length === 0) return null;
  return (
    <div id="onboarding" className="scroll-mt-28 flex flex-col gap-6">
      {paths.map(p => (
        <PathCard key={p.id} p={p} onPaths={setPaths} />
      ))}
    </div>
  );
}
