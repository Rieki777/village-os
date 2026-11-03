/**
 * "What is this?" for the open admin tab.
 *
 * The words come from one file. The button is a real control, at least 44px,
 * and the answer stays on the page.
 */
import { useState } from "react";
import { whatIsThis } from "./adminWords";
import { replayTour } from "./AdminFeel";

export default function AdminHelp({ tab }: { tab: string }) {
  const [open, setOpen] = useState(false);
  const words = whatIsThis(tab);
  return (
    <section className="mb-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-900"
      >
        What is this?
      </button>
      <button type="button" onClick={replayTour} className="ml-2 inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm text-gray-700 underline">Show the tour</button>
      {open && (
        <div className="mt-2 rounded-xl border border-gray-200 bg-white p-4" role="region" aria-label={`What is this? ${words.name}`}>
          <p className="text-sm font-medium text-gray-900">{words.name}</p>
          <p className="mt-1 text-base text-gray-800">{words.help}</p>
        </div>
      )}
    </section>
  );
}
