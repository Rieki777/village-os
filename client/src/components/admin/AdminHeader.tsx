/**
 * The admin header: who the village is, a night look, and how many items
 * this device has handled today.
 *
 * The count never leaves the browser. Night look starts off and is remembered
 * here too. The line under the title points at the library, which is where
 * the filters are changed.
 */
import { useEffect, useState, type ReactNode } from "react";
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
  extra,
}: {
  villageName: string;
  siteUrl: string;
  night: boolean;
  onNight: (next: boolean) => void;
  onSignOut: () => void;
  extra?: ReactNode;
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
    <header className={`px-4 py-2 sm:px-6 sm:py-4 ${night ? NIGHT : DAY}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg border sm:flex ${night ? "border-border bg-muted" : "border-white"}`}>
            <Lock className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight sm:text-lg">{villageName ? `${villageName} Admin` : "Admin"}</h1>
            {host && <p className={`hidden text-sm sm:block ${quiet}`}>{host}</p>}
            <p className={`hidden text-sm sm:block ${quiet}`}>
              You choose what this village shows people.{" "}
              <a href="/modules" className={`underline ${night ? "text-card-foreground" : "text-white"} inline-flex min-h-11 items-center`}>
                Change the filters
              </a>
            </p>
          </div>
        </div>
        <div className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto sm:w-auto">
          {extra}
          <p className={`whitespace-nowrap text-xs sm:text-sm ${quiet}`}>Handled today: {handled}, on this device</p>
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
