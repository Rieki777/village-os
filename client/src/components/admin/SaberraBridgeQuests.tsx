/**
 * The pieces of the Sera bridge board: a quest card with its meter, the
 * level ring, and the tools as unlocked and locked badges. Display only; the
 * board (`SaberraBridgeBoard.tsx`) reads the server and passes numbers in.
 *
 * Light-only, like every panel in this directory.
 */
import type { ReactNode } from "react";
import { Check, Lock, Sparkles } from "lucide-react";
import type { SeraTool } from "@shared/seraBridgeBoard";

export type QuestState = "done" | "active" | "building" | "waiting";

const STATE_WORDS: Record<QuestState, string> = {
  done: "Complete",
  active: "In progress",
  building: "Building",
  waiting: "Not started",
};

const STATE_CLS: Record<QuestState, string> = {
  done: "bg-emerald-50 text-emerald-800 border-emerald-200",
  active: "bg-amber-50 text-amber-800 border-amber-200",
  building: "bg-gray-50 text-gray-700 border-gray-200",
  waiting: "bg-gray-50 text-gray-600 border-gray-200",
};

/** A bar from real steps: `done` of `of`. Hidden when `of` is 0. */
export function Meter({ done, of, label }: { done: number; of: number; label: string }) {
  if (of <= 0) return null;
  const pct = Math.round((Math.min(done, of) / of) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={of}
      aria-valuenow={Math.min(done, of)}
      className="h-2 w-full rounded-full bg-gray-100 overflow-hidden"
    >
      <div className="h-full rounded-full bg-teal-deep motion-safe:transition-all motion-safe:duration-700" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function QuestCard({
  title,
  state,
  steps,
  children,
}: {
  title: string;
  state: QuestState;
  steps?: { done: number; of: number };
  children: ReactNode;
}) {
  return (
    <li
      className={`relative rounded-xl border p-4 space-y-2 bg-white ${state === "done" ? "border-emerald-200" : "border-gray-100"}`}
      aria-label={`${title}: ${STATE_WORDS[state]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-gray-900 text-sm">{title}</h4>
        <span className={`shrink-0 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${STATE_CLS[state]}`}>
          {state === "done" && <Sparkles aria-hidden className="w-3 h-3 motion-safe:animate-pulse" />}
          {STATE_WORDS[state]}
        </span>
      </div>
      <div className="text-xs text-gray-600 space-y-1">{children}</div>
      {steps && <Meter done={steps.done} of={steps.of} label={`${title} steps done`} />}
    </li>
  );
}

/** The level ring: completed checks of all checks, drawn as a circle. */
export function LevelRing({ done, of }: { done: number; of: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = of > 0 ? Math.min(done, of) / of : 0;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${done} of ${of} bridge checks done`}>
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-gray-100" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        transform="rotate(-90 32 32)"
        className="stroke-teal-deep motion-safe:transition-all motion-safe:duration-700"
      />
      <text x="32" y="37" textAnchor="middle" className="fill-gray-900 text-sm font-semibold">
        {done}/{of}
      </text>
    </svg>
  );
}

export function ToolBadges({ tools }: { tools: readonly SeraTool[] }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Sera tools">
      {tools.map((t) => (
        <li
          key={t.name}
          title={t.what}
          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
            t.unlocked ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-gray-50 text-gray-600 border-gray-200"
          }`}
        >
          {t.unlocked ? <Check aria-hidden className="w-3 h-3" /> : <Lock aria-hidden className="w-3 h-3" />}
          <span className="font-mono">{t.name}</span>
          <span className="sr-only">{t.unlocked ? "unlocked" : "locked"}: {t.what}</span>
        </li>
      ))}
    </ul>
  );
}
