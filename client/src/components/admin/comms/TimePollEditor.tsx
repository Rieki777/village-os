/**
 * THE HOST'S TIME VOTE EDITOR, inside the Calendar panel's gathering list
 * (the comms build spec 5.10).
 *
 * With no vote yet, it offers one: a one-off gathering gets two to eight
 * dates to choose from, a weekly series gets two to eight weekly slots. With
 * a vote, it shows the tally with names, and the host's controls: add or
 * remove a time, pin one (the pin beats the vote), the close time, the settle
 * time, the freeze, whether members see names, lock now, reopen, invite, and
 * end the vote.
 *
 * Every refusal is the server's own sentence: the rules live in
 * shared/comms/timePoll.ts and the server is the one that applies them.
 *
 * Admin is light-only by ruling: fixed grays on a fixed white surface.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { PollView } from "@shared/comms/timePoll";
import { authHeaders, refusal } from "../adminApi";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface OptionDraft {
  startsAt: string;
  weekday: string;
  time: string;
  duration: string;
}

const EMPTY_OPTION: OptionDraft = { startsAt: "", weekday: "2", time: "18:00", duration: "60" };

/** `HH:MM` as minutes after midnight, or null. */
function minuteOf(time: string): number | null {
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** A draft as the server reads it. A one-off start goes from the picker's local time to an instant. */
function optionBody(weekly: boolean, d: OptionDraft) {
  return weekly
    ? { weekday: Number(d.weekday), startMinute: minuteOf(d.time), durationMinutes: Number(d.duration) || 60 }
    : { startsAt: d.startsAt ? new Date(d.startsAt).toISOString() : "", durationMinutes: Number(d.duration) || 60 };
}

/** `datetime-local` wants local `YYYY-MM-DDTHH:mm`. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TimePollEditor({
  eventId,
  weekly,
  password,
  onChanged,
}: {
  eventId: string;
  /** The gathering repeats every week, so its vote is a weekly one. */
  weekly: boolean;
  password: string;
  onChanged?: () => void;
}) {
  const [poll, setPoll] = useState<PollView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<OptionDraft[]>([{ ...EMPTY_OPTION }, { ...EMPTY_OPTION, weekday: "3" }]);
  const [extra, setExtra] = useState<OptionDraft>({ ...EMPTY_OPTION });
  const [closesAt, setClosesAt] = useState("");
  const [settle, setSettle] = useState("0");
  const [freeze, setFreeze] = useState("48");
  const [showNames, setShowNames] = useState(true);
  const [inviteAnswered, setInviteAnswered] = useState(true);
  const [inviteMembers, setInviteMembers] = useState(false);

  const base = `/api/events/${encodeURIComponent(eventId)}/time-poll`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { headers: authHeaders(password) });
      const body = await res.json().catch(() => ({}));
      const view: PollView | null = res.ok ? body.poll ?? null : null;
      setPoll(view);
      if (view) {
        setClosesAt(view.closesAtSet ? toLocalInput(view.closesAt) : "");
        setSettle(String(view.settleMinutes));
        setFreeze(String(view.freezeHours));
        setShowNames(view.showNames);
      }
    } catch {
      setPoll(null);
    }
    setLoaded(true);
  }, [base, password]);

  useEffect(() => {
    void load();
  }, [load]);

  /** One host action: send it, show the server's answer, and read the vote back. */
  const act = async (method: string, path: string, body: unknown, done: string) => {
    setBusy(true);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(refusal(d, "That did not work"));
      else {
        toast.success(done);
        await load();
        onChanged?.();
      }
      setBusy(false);
      return res.ok ? d : null;
    } catch {
      toast.error("That did not work");
      setBusy(false);
      return null;
    }
  };

  const create = async () => {
    const made = await act(
      "POST",
      "",
      {
        mode: weekly ? "weekly" : "once",
        options: drafts.map((d) => optionBody(weekly, d)),
        closesAt: !weekly && closesAt ? new Date(closesAt).toISOString() : null,
        settleMinutes: Number(settle),
        freezeHours: Number(freeze),
        showNames,
      },
      "Vote started",
    );
    if (made && (inviteAnswered || inviteMembers)) await sendInvites();
  };

  const sendInvites = () =>
    act("POST", "/invite", { answered: inviteAnswered, members: inviteMembers ? "all" : [] }, "Invitations sent");

  const saveSettings = () =>
    act(
      "PUT",
      "",
      {
        ...(poll?.mode === "once" ? { closesAt: closesAt ? new Date(closesAt).toISOString() : null } : {}),
        settleMinutes: Number(settle),
        freezeHours: Number(freeze),
        showNames,
      },
      "Saved",
    );

  const input = "text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-900";
  const button = "px-2.5 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50";
  const primary = "px-3 py-1.5 text-xs bg-teal-deep text-white rounded-lg disabled:opacity-50";

  const optionRow = (d: OptionDraft, set: (d: OptionDraft) => void, key: string) => (
    <div key={key} className="flex items-end gap-2 flex-wrap">
      {weekly ? (
        <>
          <label className="text-[11px] font-medium text-gray-500">
            Day
            <select value={d.weekday} onChange={(e) => set({ ...d, weekday: e.target.value })} className={`${input} block mt-0.5`}>
              {WEEKDAYS.map((w, i) => (
                <option key={w} value={i}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-medium text-gray-500">
            Starts (village time)
            <input type="time" value={d.time} onChange={(e) => set({ ...d, time: e.target.value })} className={`${input} block mt-0.5`} />
          </label>
        </>
      ) : (
        <label className="text-[11px] font-medium text-gray-500">
          Starts
          <input type="datetime-local" value={d.startsAt} onChange={(e) => set({ ...d, startsAt: e.target.value })} className={`${input} block mt-0.5`} />
        </label>
      )}
      <label className="text-[11px] font-medium text-gray-500">
        Minutes
        <input type="number" min={15} max={1440} value={d.duration} onChange={(e) => set({ ...d, duration: e.target.value })} className={`${input} block mt-0.5 w-20`} />
      </label>
    </div>
  );

  const dials = (
    <div className="flex items-end gap-3 flex-wrap mt-3">
      {(!poll ? !weekly : poll.mode === "once") && (
        <label className="text-[11px] font-medium text-gray-500">
          Voting closes (blank: {freeze} hours before the earliest time)
          <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className={`${input} block mt-0.5`} />
        </label>
      )}
      <label className="text-[11px] font-medium text-gray-500">
        Settle (minutes a time must lead)
        <input type="number" min={0} max={1440} value={settle} onChange={(e) => setSettle(e.target.value)} className={`${input} block mt-0.5 w-24`} />
      </label>
      <label className="text-[11px] font-medium text-gray-500">
        Freeze (hours)
        <input type="number" min={0} max={336} value={freeze} onChange={(e) => setFreeze(e.target.value)} className={`${input} block mt-0.5 w-20`} />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-gray-700 pb-1.5">
        <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
        Members see who picked each time
      </label>
    </div>
  );

  if (!loaded) return <p className="text-xs text-gray-400 mt-3">Loading...</p>;

  if (!poll) {
    return (
      <div className="mt-3 border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-500 mb-2">
          {weekly
            ? "Let people vote on the series' weekday and time. The series follows the leading time, and an evening inside the freeze never moves."
            : "Let people vote on this gathering's time. The gathering follows the leading time until the vote closes."}{" "}
          The first time listed leads until somebody votes.
        </p>
        <div className="space-y-2">
          {drafts.map((d, i) =>
            optionRow(d, (next) => setDrafts((all) => all.map((x, j) => (j === i ? next : x))), `draft-${i}`),
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          {drafts.length < 8 && (
            <button type="button" className={button} onClick={() => setDrafts((all) => [...all, { ...EMPTY_OPTION }])}>
              Add a time
            </button>
          )}
          {drafts.length > 2 && (
            <button type="button" className={button} onClick={() => setDrafts((all) => all.slice(0, -1))}>
              Remove the last time
            </button>
          )}
        </div>
        {dials}
        <div className="flex items-center gap-3 flex-wrap mt-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-700">
            <input type="checkbox" checked={inviteAnswered} onChange={(e) => setInviteAnswered(e.target.checked)} />
            Email everyone who said yes or maybe
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-700">
            <input type="checkbox" checked={inviteMembers} onChange={(e) => setInviteMembers(e.target.checked)} />
            Notify every member
          </label>
          <button type="button" className={primary} disabled={busy} onClick={() => void create()}>
            Start the vote
          </button>
        </div>
      </div>
    );
  }

  const open = poll.state === "open";
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-xs text-gray-700 mb-2">
        <span className="font-medium text-gray-900">{open ? "Vote open" : "Vote locked"}</span>
        {` · ${poll.voters} voted`}
        {poll.appliedLabel ? ` · On the calendar: ${poll.appliedLabel}` : ""}
        {open && poll.closesAt ? ` · Closes ${new Date(poll.closesAt).toLocaleString()}` : ""}
      </p>
      <ul className="space-y-1.5 mb-3">
        {poll.options.map((o) => (
          <li key={o.id} className="flex items-start justify-between gap-2 text-xs">
            <span className="min-w-0">
              <span className={o.applied ? "font-semibold text-gray-900" : "text-gray-900"}>{o.label}</span>
              <span className="text-gray-500">
                {` · ${o.count}`}
                {o.leading ? " · leading" : ""}
                {o.pinned ? " · pinned" : ""}
              </span>
              {o.names && o.names.length > 0 && <span className="block text-gray-500">{o.names.join(", ")}</span>}
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              <button type="button" className={button} disabled={busy} onClick={() => void act("POST", "/pin", { optionId: o.pinned ? null : o.id }, o.pinned ? "Pin cleared" : "Pinned")}>
                {o.pinned ? "Unpin" : "Pin"}
              </button>
              <button type="button" className={button} disabled={busy || poll.options.length <= 2} onClick={() => void act("DELETE", `/options/${encodeURIComponent(o.id)}`, undefined, "Time removed")}>
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
      {poll.options.length < 8 && (
        <div className="flex items-end gap-2 flex-wrap">
          {optionRow(extra, setExtra, "extra")}
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={async () => {
              if (await act("POST", "/options", { options: [optionBody(poll.mode === "weekly", extra)] }, "Time added")) setExtra({ ...EMPTY_OPTION });
            }}
          >
            Add this time
          </button>
        </div>
      )}
      {dials}
      <div className="flex items-center gap-2 flex-wrap mt-3">
        <button type="button" className={button} disabled={busy} onClick={() => void saveSettings()}>
          Save settings
        </button>
        {open ? (
          <button type="button" className={primary} disabled={busy} onClick={() => void act("POST", "/lock", {}, "Time set")}>
            Lock now
          </button>
        ) : (
          <button type="button" className={button} disabled={busy} onClick={() => void act("POST", "/reopen", { closesAt: closesAt ? new Date(closesAt).toISOString() : null }, "Vote reopened")}>
            Reopen
          </button>
        )}
        {open && (
          <>
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={inviteAnswered} onChange={(e) => setInviteAnswered(e.target.checked)} />
              People who said yes or maybe
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              <input type="checkbox" checked={inviteMembers} onChange={(e) => setInviteMembers(e.target.checked)} />
              Every member
            </label>
            <button type="button" className={button} disabled={busy || (!inviteAnswered && !inviteMembers)} onClick={() => void sendInvites()}>
              Invite to vote
            </button>
          </>
        )}
        <button
          type="button"
          className="px-2.5 py-1 text-xs border border-red-200 text-red-700 rounded-lg bg-white disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const words =
              poll.mode === "weekly"
                ? "End the vote? Planned evenings keep the voted time. Later evenings follow the series' own day and time, and the votes are deleted."
                : "End the vote? The gathering keeps the time it has now, and the votes are deleted.";
            if (window.confirm(words)) void act("DELETE", "", undefined, "Vote ended");
          }}
        >
          End the vote
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        Each person is invited once per vote. Members follow their own email settings.
      </p>
    </div>
  );
}
