/**
 * Undo sits at the bottom, near the thumb, until the wait ends.
 */
import { useEffect, useState } from "react";
import { cancelUndo, pendingUndoLabel, subscribeUndo } from "./adminUndo";

export default function UndoBar() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => subscribeUndo(() => setLabel(pendingUndoLabel())), []);
  if (!label) return null;
  return (
    <div className="fixed inset-x-0 bottom-16 z-50 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:bottom-4">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm">
        <p className="text-sm">{label} You have 10 seconds.</p>
        <button type="button" onClick={cancelUndo} className="inline-flex min-h-[44px] items-center rounded-lg bg-teal-deep px-4 text-sm font-medium text-white">
          Undo
        </button>
      </div>
    </div>
  );
}
