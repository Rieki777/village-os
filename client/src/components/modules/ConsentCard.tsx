/**
 * THE CARD A FUNDS MODULE ASKS FOR BEFORE IT TURNS ON.
 *
 * It replaced a `window.confirm`, which a browser renders in its own chrome,
 * cannot be styled or read twice, and is dismissed by a reflex Enter. A module
 * marked `legalReview` moves money or something a member could mistake for
 * money, so the person turning it on reads the conditions on the page, ticks
 * that they have, and then presses the button. No timer, no countdown: the
 * tick is the whole ceremony.
 *
 * The words are the platform's, not the village's. The server refuses the
 * enable anyway while a shared password is the only admin credential; this
 * card is the reading, the route is the guard.
 */
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { joinNames } from "@shared/moduleSwitch";

export default function ConsentCard({
  names,
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  /** The funds modules this press would turn on. */
  names: string[];
  /** What the confirm button says: "Turn on", "Propose it", and so on. */
  action: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [read, setRead] = useState(false);
  return (
    <div role="group" aria-label="Before this turns on" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="flex items-center gap-2 font-semibold">
        <ShieldAlert className="w-5 h-5 text-amber-700" aria-hidden="true" />
        {joinNames(names)} {names.length === 1 ? "touches" : "touch"} money
      </p>
      <ul className="mt-2 list-disc pl-5 space-y-1 text-sm leading-relaxed">
        <li>Credits bought here stay credits. Nobody can withdraw them or turn them back into money.</li>
        <li>Every person who runs this village signs in with their own account.</li>
        <li>Backups have been made and a restore has been tried.</li>
        <li>Someone who knows the law where this village is has read how it works.</li>
      </ul>
      <label className="mt-3 flex items-start gap-2 text-sm font-medium min-h-[44px]">
        <input
          type="checkbox"
          checked={read}
          onChange={(e) => setRead(e.target.checked)}
          className="mt-0.5 w-5 h-5 accent-teal-deep"
        />
        I have read this, and all four are true here.
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!read || busy}
          onClick={onConfirm}
          className="min-h-[44px] px-5 rounded-lg bg-teal-deep text-white font-semibold text-sm disabled:opacity-40"
        >
          {action}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] px-4 rounded-lg border border-amber-300 bg-white text-sm font-medium"
        >
          Not yet
        </button>
      </div>
    </div>
  );
}
