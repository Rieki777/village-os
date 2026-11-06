/**
 * The gentler layer: a short tour, optional quests, a calm all-clear,
 * a weekly line, and the switches for all of them.
 */
import { useEffect, useState } from "react";
import { TOUR_STEPS, bumpWeek, feelOn, setFeel, showEverything, simpleNav, weekCount, type FeelKey } from "./adminFeelState";
import { readHandledCount } from "./handledToday";

export function TourCard({ wait = false }: { wait?: boolean }) {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(() => feelOn("tour") && storedTextSeen() === false);
  const [ready, setReady] = useState(!wait);
  useEffect(() => {
    const on = () => { setStep(0); setOpen(true); setReady(true); };
    window.addEventListener("admin:tour", on);
    return () => window.removeEventListener("admin:tour", on);
  }, []);
  useEffect(() => {
    if (!wait) { setReady(true); return; }
    setReady(false);
    const shown = () => setReady(true);
    window.addEventListener("admin:today-ready", shown);
    const t = window.setTimeout(shown, 8000);
    return () => {
      window.removeEventListener("admin:today-ready", shown);
      window.clearTimeout(t);
    };
  }, [wait]);
  if (!open || !feelOn("tour") || !ready) return null;
  const last = step >= TOUR_STEPS.length - 1;
  return (
    <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4 text-gray-900" aria-label="Tour">
      <p className="text-sm text-gray-600">Step {step + 1} of {TOUR_STEPS.length}</p>
      <p className="mt-1 text-base">{TOUR_STEPS[step]}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!last && <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg bg-teal-deep px-3 text-sm text-white" onClick={() => setStep((n) => n + 1)}>Next</button>}
        <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-3 text-sm" onClick={() => { markTourSeen(); setOpen(false); }}>{last ? "Done" : "Skip"}</button>
      </div>
    </section>
  );
}

function storedTextSeen(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem("admin.tourSeen") === "1";
}
function markTourSeen() {
  try { window.localStorage.setItem("admin.tourSeen", "1"); } catch { /* the tour can show again */ }
}

export function GentleQuests() {
  const handled = readHandledCount(new Date());
  if (!feelOn("quests")) return null;
  const items = [
    { id: "answer", label: "Answer your first request", done: handled > 0 },
    { id: "connections", label: "Look at your connections", done: false },
  ];
  return (
    <section className="mt-4" aria-label="Gentle quests">
      <h3 className="text-base font-semibold text-gray-900">If you want a small start</h3>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.id} className="text-sm text-gray-800">{item.done ? "Done. " : ""}{item.label}</li>
        ))}
      </ul>
    </section>
  );
}

export function AllClear({ show }: { show: boolean }) {
  if (!show || !feelOn("clear")) return null;
  return <p className="mt-2 text-base text-gray-900">All clear for today.</p>;
}

export function WeekRecap() {
  const [count, setCount] = useState(() => weekCount());
  useEffect(() => {
    const on = () => setCount(bumpWeek());
    window.addEventListener("admin:handled", on);
    return () => window.removeEventListener("admin:handled", on);
  }, []);
  if (!feelOn("recap")) return null;
  return <p className="mt-2 text-sm text-gray-700">This week on this device: {count} handled.</p>;
}

export function FeelSettings({ role, onChanged }: { role: string | undefined; onChanged: () => void }) {
  const [tick, setTick] = useState(0);
  const flip = (key: FeelKey, on: boolean) => { setFeel(key, on); setTick((n) => n + 1); };
  const limited = simpleNav(role);
  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4" aria-label="On this device">
      <h3 className="text-base font-semibold text-gray-900">On this device</h3>
      <ul className="mt-2 space-y-1">
        {(["tour", "quests", "clear", "recap"] as FeelKey[]).map((key) => (
          <li key={key}>
            <label className="flex min-h-11 w-full cursor-pointer items-center gap-3 py-2 text-sm text-gray-900">
              <input type="checkbox" className="h-6 w-6 shrink-0" checked={feelOn(key)} onChange={(e) => flip(key, e.target.checked)} />
              {key === "tour" ? "Tour" : key === "quests" ? "Gentle quests" : key === "clear" ? "All clear line" : "Weekly recap"}
            </label>
          </li>
        ))}
      </ul>
      {role !== "admin" && role !== "founder" && (
        <button type="button" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-teal-deep underline" onClick={() => { showEverything(); onChanged(); }}>
          {limited ? "Show everything" : "Showing everything"}
        </button>
      )}
      <span className="sr-only">{tick}</span>
    </section>
  );
}

export function replayTour(): void {
  try { window.localStorage.removeItem("admin.tourSeen"); } catch { /* replay still fires the event */ }
  window.dispatchEvent(new CustomEvent("admin:tour"));
}
