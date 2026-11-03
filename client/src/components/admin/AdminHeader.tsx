/**
 * The admin header: who the village is, a night look, and how many items
 * this device has handled today.
 *
 * The count never leaves the browser. Night look starts off and is remembered
 * here too. The line under the title points at the library, which is where
 * the filters are changed.
 */
import { useEffect, useState } from "react";
import { Lock, LogOut } from "lucide-react";
import { HANDLED_EVENT, readHandledCount } from "./handledToday";
import "./adminNight.css";

const DAY = "bg-teal-deep text-white shadow-md";
const NIGHT = "border-b border-border bg-card text-card-foreground shadow-sm";
const CONTROL = "inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium";

export default function AdminHeader({
  villageName,
  siteUrl,
  night,
  onNight,
  onSignOut,
}: {
  villageName: string;
  siteUrl: string;
  night: boolean;
  onNight: (next: boolean) => void;
  onSignOut: () => void;
}) {
  const [handled, setHandled] = useState(() => readHandledCount(new Date()));
  useEffect(() => {
    const sync = () => setHandled(readHandledCount(new Date()));
    window.addEventListener(HANDLED_EVENT, sync);
    window.addEventListener("focus", sync);
    const id = window.setInterval(sync, 60_000);
    return () => {
      window.removeEventListener(HANDLED_EVENT, sync);
      window.removeEventListener("focus", sync);
      window.clearInterval(id);
    };
  }, []);

  const host = siteUrl.replace(/^https?:\/\//, "");
  const quiet = night ? "text-muted-foreground" : "text-white";

  return (
    <header className={`px-4 py-4 sm:px-6 ${night ? NIGHT : DAY}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${night ? "border-border bg-muted" : "border-white"}`}>
            <Lock className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">{villageName ? `${villageName} Admin` : "Admin"}</h1>
            {host && <p className={`text-sm ${quiet}`}>{host}</p>}
            <p className={`text-sm ${quiet}`}>
              You choose what this village shows people.{" "}
              <a href="/modules" className={`underline ${night ? "text-card-foreground" : "text-white"} inline-flex min-h-11 items-center`}>
                Change the filters
              </a>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm ${quiet}`}>Handled today: {handled}, on this device</p>
          <button
            type="button"
            aria-pressed={night}
            onClick={() => onNight(!night)}
            className={`${CONTROL} border ${night ? "border-border bg-muted text-card-foreground" : "border-white text-white"}`}
          >
            {night ? "Night look, on" : "Night look, off"}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className={`${CONTROL} ${night ? "text-card-foreground" : "text-white"}`}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}
