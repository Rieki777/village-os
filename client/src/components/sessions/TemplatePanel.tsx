/**
 * THE ROOM'S MEETING TYPE: what a session opened from a template adds to the
 * room (shared/sessionTemplates.ts). It reads the template's flow and draws
 * only what that flow asks for, so a template edited after a meeting changes
 * this panel at the next one with no code change.
 *
 *   - The flow, each section with its minutes and its prompt.
 *   - A `talking_stick` section: who holds the stick, who is next, everyone in
 *     the order it goes round, and the host's "Pass the stick". Anyone in the
 *     room keeps a line of what was shared; a line can be brought to a later
 *     session as an agenda item.
 *   - A `priorities_review` section: the priorities the meeting this one feeds
 *     from chose, each marked done, partly or carried over.
 *   - A `carried_over` section: what that meeting carried over, ready to be a
 *     priority again.
 *   - A `priorities_set` section: this meeting's priorities, which the next
 *     meeting in the series reads back.
 *
 *   - A `season_priorities` section: the running season's priorities, so the
 *     meeting keeps them at the centre. Every priority and every win can name
 *     the one it serves (0292), and "The season so far" opens the season view.
 *   - A `wins` section: the wins the room shares, each naming the season
 *     priority it serves.
 *
 * The section's own title heads each part, so "Last Monday's priorities" is
 * the template's words, never this file's.
 *
 * It asks its own door every few seconds while the tab is visible, apart from
 * the room's poll, and draws nothing for a session opened without a template.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Feather } from "lucide-react";
import {
  PRIORITY_OUTCOMES,
  PRIORITY_OUTCOME_LABEL,
  SEASON_COPY,
  SECTION_KIND_DEFS,
  SHARE_KIND_LABEL,
  STICK_SHARE_KINDS,
  TEMPLATES_ROOM_POLL_MS,
  TEMPLATE_COPY,
  TEMPLATE_LIMITS,
  sectionOf,
  templateRoomApi,
  type SeriesReadBack,
  type ShareKind,
  type TemplateRoomView,
} from "@shared/sessionTemplates";
import type { SessionItem } from "@shared/sessions";
import { gameFetch } from "@/lib/gameApi";
import { BTN_FORWARD, BTN_QUIET, BTN_SECONDARY, CHIP, EYEBROW, HINT, INPUT, LABEL_CAPS, PANEL, SOFT } from "./roomUi";

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
};

async function sentence(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body?.error === "string" && /\s/.test(body.error) ? body.error : TEMPLATE_COPY.saveFailed;
  } catch {
    return TEMPLATE_COPY.saveFailed;
  }
}

/** "Serves": one of the season's priorities, or none. Draws nothing when the season names none. */
function ServesPicker({
  goals,
  value,
  onChange,
  disabled,
  compact = false,
}: {
  goals: readonly string[];
  value: string | null;
  onChange(goal: string | null): void;
  disabled?: boolean;
  compact?: boolean;
}) {
  if (!goals.length) return null;
  return (
    <label className={`flex items-center gap-2 text-sm text-foreground ${compact ? "" : "min-w-0"}`}>
      <span className="shrink-0 text-muted-foreground">{SEASON_COPY.serves}</span>
      <select
        className={`${INPUT} w-auto max-w-[16rem] truncate`}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{SEASON_COPY.servesNone}</option>
        {goals.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The season priority a row serves, as a chip. */
const ServesChip = ({ goal }: { goal: string | null }) =>
  goal ? (
    <span className={CHIP}>
      {SEASON_COPY.serves}: {goal}
    </span>
  ) : null;

export default function TemplatePanel({ sessionId, agenda }: { sessionId: number; agenda: readonly SessionItem[] }) {
  const [view, setView] = useState<TemplateRoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareText, setShareText] = useState("");
  const [shareKind, setShareKind] = useState<ShareKind>("grateful");
  const [priorityText, setPriorityText] = useState("");
  const [priorityServes, setPriorityServes] = useState<string | null>(null);
  const [winText, setWinText] = useState("");
  const [winServes, setWinServes] = useState<string | null>(null);
  const alive = useRef(true);

  const read = useCallback(async () => {
    try {
      const res = await gameFetch(templateRoomApi(sessionId));
      if (!res.ok || !alive.current) return;
      setView((await res.json()) as TemplateRoomView);
    } catch {
      // Offline for a moment: the panel keeps what it showed.
    }
  }, [sessionId]);

  useEffect(() => {
    alive.current = true;
    void read();
    const tick = () => {
      if (document.visibilityState === "visible") void read();
    };
    const timer = window.setInterval(tick, TEMPLATES_ROOM_POLL_MS);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [read]);

  /** One write: the answer is the panel as it now stands. */
  const write = async (path: string, method: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await gameFetch(`${templateRoomApi(sessionId)}${path}`, { method, body: JSON.stringify(body) });
      if (!res.ok) {
        setError(await sentence(res));
        return false;
      }
      setView((await res.json()) as TemplateRoomView);
      return true;
    } catch {
      setError(TEMPLATE_COPY.saveFailed);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!view?.template) return null;
  const { template, hosts, joined, open } = view;
  const flow = template.flow;
  const stickSection = sectionOf(flow, "talking_stick");
  const reviewSection = sectionOf(flow, "priorities_review");
  const carriedSection = sectionOf(flow, "carried_over");
  const setSection = sectionOf(flow, "priorities_set");
  const seasonSection = sectionOf(flow, "season_priorities");
  const winsSection = sectionOf(flow, "wins");
  const goals = view.season?.goals ?? [];
  const wins = view.shares.filter((s) => s.kind === "win");
  const stickShares = view.shares.filter((s) => s.kind !== "win");
  const canHost = hosts && open;
  const nameOf = (no: number | null) => (no == null ? "" : (view.stick?.people.find((p) => p.no === no)?.name ?? ""));

  const takeAgenda = async () => {
    const have = new Set(view.priorities.map((p) => p.text.trim().toLowerCase()));
    const top = [...agenda]
      .filter((i) => i.status !== "parked")
      .sort((a, b) => a.position - b.position)
      .filter((i) => !have.has(i.title.trim().toLowerCase()))
      .slice(0, Math.max(0, Math.min(3, TEMPLATE_LIMITS.priorities - view.priorities.length)));
    for (const i of top) if (!(await write("/priorities", "POST", { text: i.title }))) return;
  };

  const readBackLine = (r: SeriesReadBack) => TEMPLATE_COPY.readBackFrom(r.sessionTitle, day(r.openedAt));

  return (
    <section aria-labelledby="template-panel-heading" className={`${PANEL} space-y-5`}>
      <div>
        <p className={EYEBROW}>{template.category}</p>
        <h2 id="template-panel-heading" className="mt-1 font-display text-2xl text-foreground">
          {TEMPLATE_COPY.panelHeading(template.name)}
        </h2>
        <ol className="mt-3 flex flex-wrap gap-1.5" aria-label={TEMPLATE_COPY.flowHeading}>
          {flow.map((s, i) => (
            <li key={s.key} className={CHIP} title={s.prompt || SECTION_KIND_DEFS[s.kind].hint}>
              {i + 1}. {s.title} · {s.minutes} min
            </li>
          ))}
        </ol>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      {seasonSection && (
        <div className="space-y-2 rounded-xl border border-notice/50 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className={LABEL_CAPS}>{seasonSection.title}</h3>
            <Link href="/sessions/season" className={BTN_QUIET}>
              {SEASON_COPY.link}
            </Link>
          </div>
          {seasonSection.prompt && <p className={HINT}>{seasonSection.prompt}</p>}
          {goals.length ? (
            <ol className="space-y-1">
              {goals.map((g, i) => (
                <li key={g} className="flex gap-2 text-foreground">
                  <span className="tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span>{g}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={HINT}>{SEASON_COPY.noGoals}</p>
          )}
        </div>
      )}

      {winsSection && (
        <div className="space-y-2">
          <h3 className={LABEL_CAPS}>{winsSection.title}</h3>
          {winsSection.prompt && <p className={HINT}>{winsSection.prompt}</p>}
          {wins.length ? (
            <ul className="space-y-1.5">
              {wins.map((w) => (
                <li key={w.id} className={`${SOFT} flex flex-wrap items-center justify-between gap-2`}>
                  <span className="min-w-0 flex-1 text-foreground">{w.text}</span>
                  {joined && open && goals.length ? (
                    <ServesPicker goals={goals} value={w.servesGoal} disabled={busy} onChange={(g) => void write(`/shares/${w.id}`, "PATCH", { servesGoal: g })} />
                  ) : (
                    <ServesChip goal={w.servesGoal} />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={HINT}>{TEMPLATE_COPY.winsEmpty}</p>
          )}
          {joined && open && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await write("/shares", "POST", { kind: "win", text: winText, servesGoal: winServes })) {
                  setWinText("");
                  setWinServes(null);
                }
              }}
            >
              <input
                className={`${INPUT} min-w-0 flex-1`}
                aria-label={TEMPLATE_COPY.winsLabel}
                placeholder={TEMPLATE_COPY.winPlaceholder}
                value={winText}
                maxLength={TEMPLATE_LIMITS.shareText}
                onChange={(e) => setWinText(e.target.value)}
              />
              <ServesPicker goals={goals} value={winServes} onChange={setWinServes} disabled={busy} />
              <button type="submit" className={BTN_SECONDARY} disabled={busy || !winText.trim()}>
                {TEMPLATE_COPY.winsLabel}
              </button>
            </form>
          )}
        </div>
      )}

      {stickSection && (
        <div className="space-y-4">
          <div>
            <h3 className={LABEL_CAPS}>{stickSection.title}</h3>
            {stickSection.prompt && <p className={`mt-1 ${HINT}`}>{stickSection.prompt}</p>}
          </div>
          {view.stick ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-notice/60 bg-muted px-4 py-4" aria-live="polite">
                <span className="grid size-16 shrink-0 place-items-center rounded-full text-notice ring-2 ring-notice" aria-hidden>
                  <Feather className="size-8" strokeWidth={1.4} />
                </span>
                <div className="min-w-0">
                  <p className="font-display text-2xl text-foreground">{TEMPLATE_COPY.stickHolder(nameOf(view.stick.holder))}</p>
                  <p className="text-sm text-muted-foreground">
                    {view.stick.next != null && TEMPLATE_COPY.stickNext(nameOf(view.stick.next))} · {TEMPLATE_COPY.stickRound(view.stick.rounds + 1)}
                  </p>
                </div>
              </div>
              <ol className="flex flex-wrap gap-2">
                {view.stick.people.map((p) => (
                  <li
                    key={p.no}
                    className={
                      p.no === view.stick?.holder
                        ? "rounded-full border border-notice bg-notice px-3 py-1 text-sm font-semibold text-background"
                        : p.no === view.stick?.next
                          ? "rounded-full border border-notice/70 px-3 py-1 text-sm font-medium text-foreground"
                          : "rounded-full border border-border px-3 py-1 text-sm text-muted-foreground"
                    }
                  >
                    {p.name}
                  </li>
                ))}
              </ol>
              {canHost && (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={BTN_FORWARD} disabled={busy} onClick={() => void write("/stick", "POST", { move: "pass" })}>
                    {TEMPLATE_COPY.stickPass}
                  </button>
                  <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void write("/stick", "POST", { move: "back" })}>
                    {TEMPLATE_COPY.stickBack}
                  </button>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    {TEMPLATE_COPY.stickGive}
                    <select
                      className={`${INPUT} w-auto`}
                      value=""
                      disabled={busy}
                      onChange={(e) => e.target.value && void write("/stick", "POST", { move: "give", to: Number(e.target.value) })}
                    >
                      <option value="">{TEMPLATE_COPY.stickChoose}</option>
                      {view.here.map((p) => (
                        <option key={p.no} value={p.no}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void write("/stick", "POST", { move: "stop" })}>
                    {TEMPLATE_COPY.stickStop}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className={`${SOFT} flex flex-wrap items-center justify-between gap-3`}>
              <p className="text-sm text-muted-foreground">{TEMPLATE_COPY.stickIdle}</p>
              {canHost && view.here.length > 0 && (
                <button type="button" className={BTN_FORWARD} disabled={busy} onClick={() => void write("/stick", "POST", { move: "start", order: view.here.map((p) => p.no) })}>
                  {TEMPLATE_COPY.stickStart}
                </button>
              )}
            </div>
          )}

          {joined && open && (
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await write("/shares", "POST", { kind: shareKind, text: shareText })) setShareText("");
              }}
            >
              <p className={LABEL_CAPS}>{TEMPLATE_COPY.captureLabel}</p>
              <div className="flex flex-wrap gap-2">
                <select className={`${INPUT} w-auto`} aria-label={TEMPLATE_COPY.captureKind} value={shareKind} onChange={(e) => setShareKind(e.target.value as ShareKind)}>
                  {STICK_SHARE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SHARE_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                <input
                  className={`${INPUT} min-w-0 flex-1`}
                  placeholder={TEMPLATE_COPY.capturePlaceholder}
                  value={shareText}
                  maxLength={TEMPLATE_LIMITS.shareText}
                  onChange={(e) => setShareText(e.target.value)}
                />
                <button type="submit" className={BTN_SECONDARY} disabled={busy || !shareText.trim()}>
                  {TEMPLATE_COPY.capture}
                </button>
              </div>
            </form>
          )}

          {stickShares.length > 0 && (
            <div className="space-y-2">
              <p className={LABEL_CAPS}>{TEMPLATE_COPY.sharesHeading}</p>
              <ul className="space-y-1.5">
                {stickShares.map((s) => (
                  <li key={s.id} className={`${SOFT} flex flex-wrap items-start justify-between gap-2 text-sm`}>
                    <span className="min-w-0 flex-1">
                      <span className={CHIP}>{SHARE_KIND_LABEL[s.kind]}</span> <span className="text-foreground">{s.text}</span>
                      {s.speaker && <span className="block text-xs text-muted-foreground">{s.speaker}</span>}
                    </span>
                    {s.broughtAs != null ? (
                      <span className="text-xs text-muted-foreground">{TEMPLATE_COPY.broughtAs}</span>
                    ) : (
                      joined && (
                        <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void write(`/shares/${s.id}/bring`, "POST", {})}>
                          {TEMPLATE_COPY.bring}
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{TEMPLATE_COPY.thrivingLine}</p>
        </div>
      )}

      {reviewSection && (
        <div className="space-y-2">
          <h3 className={LABEL_CAPS}>{reviewSection.title}</h3>
          {view.review ? (
            <>
              <p className={HINT}>
                {readBackLine(view.review)} · {TEMPLATE_COPY.outcomeAsk}
              </p>
              {view.review.rows.length ? (
                <ul className="space-y-1.5">
                  {view.review.rows.map((p) => (
                    <li key={p.id} className={`${SOFT} flex flex-wrap items-center justify-between gap-2`}>
                      <span className="text-foreground">
                        {p.text} <ServesChip goal={p.servesGoal} />
                      </span>
                      <span className="flex flex-wrap gap-1" role="group" aria-label={TEMPLATE_COPY.outcomeAsk}>
                        {PRIORITY_OUTCOMES.map((o) => (
                          <button
                            key={o}
                            type="button"
                            aria-pressed={p.outcome === o}
                            disabled={busy || !canHost}
                            className={
                              p.outcome === o
                                ? "min-h-9 rounded-full border border-notice bg-notice px-3 text-sm font-semibold text-background"
                                : "min-h-9 rounded-full border border-border px-3 text-sm text-foreground hover:border-notice disabled:opacity-60"
                            }
                            onClick={() => void write(`/priorities/${p.id}`, "PATCH", { outcome: p.outcome === o ? null : o })}
                          >
                            {PRIORITY_OUTCOME_LABEL[o]}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={HINT}>{TEMPLATE_COPY.reviewEmpty}</p>
              )}
            </>
          ) : (
            <p className={HINT}>{TEMPLATE_COPY.reviewEmpty}</p>
          )}
        </div>
      )}

      {carriedSection && (
        <div className="space-y-2">
          <h3 className={LABEL_CAPS}>{carriedSection.title}</h3>
          {view.carried && <p className={HINT}>{readBackLine(view.carried)}</p>}
          {view.carried?.rows.length ? (
            <ul className="space-y-1.5">
              {view.carried.rows.map((p) => (
                <li key={p.id} className={`${SOFT} flex flex-wrap items-center justify-between gap-2`}>
                  <span className="text-foreground">
                    {p.text} {p.outcome && <span className={CHIP}>{PRIORITY_OUTCOME_LABEL[p.outcome]}</span>} <ServesChip goal={p.servesGoal} />
                  </span>
                  {canHost && (
                    <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void write("/priorities", "POST", { fromCarried: p.id })}>
                      {TEMPLATE_COPY.takeUp}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={HINT}>{TEMPLATE_COPY.carriedEmpty}</p>
          )}
        </div>
      )}

      {setSection && (
        <div className="space-y-2">
          <h3 className={LABEL_CAPS}>{setSection.title}</h3>
          {setSection.prompt && <p className={HINT}>{setSection.prompt}</p>}
          {view.priorities.length ? (
            <ol className="space-y-1.5">
              {view.priorities.map((p, i) => (
                <li key={p.id} className={`${SOFT} flex flex-wrap items-center justify-between gap-2`}>
                  <span className="min-w-0 flex-1 text-foreground">
                    <span className="tabular-nums text-muted-foreground">{i + 1}.</span> {p.text}
                  </span>
                  {canHost && goals.length ? (
                    <ServesPicker goals={goals} value={p.servesGoal} disabled={busy} onChange={(g) => void write(`/priorities/${p.id}`, "PATCH", { servesGoal: g })} />
                  ) : (
                    <ServesChip goal={p.servesGoal} />
                  )}
                  {canHost && (
                    <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void write(`/priorities/${p.id}`, "PATCH", { remove: true })}>
                      {TEMPLATE_COPY.removePriority}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className={HINT}>{TEMPLATE_COPY.prioritiesEmpty}</p>
          )}
          {canHost && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await write("/priorities", "POST", { text: priorityText, servesGoal: priorityServes })) {
                  setPriorityText("");
                  setPriorityServes(null);
                }
              }}
            >
              <input
                className={`${INPUT} min-w-0 flex-1`}
                placeholder={TEMPLATE_COPY.priorityPlaceholder}
                value={priorityText}
                maxLength={TEMPLATE_LIMITS.priorityText}
                onChange={(e) => setPriorityText(e.target.value)}
              />
              <ServesPicker goals={goals} value={priorityServes} onChange={setPriorityServes} disabled={busy} />
              <button type="submit" className={BTN_SECONDARY} disabled={busy || !priorityText.trim()}>
                {TEMPLATE_COPY.addPriority}
              </button>
              {agenda.length > 0 && (
                <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void takeAgenda()}>
                  {TEMPLATE_COPY.fromAgenda}
                </button>
              )}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
