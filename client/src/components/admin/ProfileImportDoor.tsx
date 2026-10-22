/**
 * The door to "Start from your ReGen Civics profile", at the top of Make This
 * Site Yours.
 *
 * A land project in ReGen Civics' Season 2 leaves the sessions with a file
 * that holds its needs, its circles and seats, and once its stewards have
 * answered them, its name, purpose and the rest (Rye, 2026-10-20: the Season
 * ends in launching each project's Village OS from what the episodes uncover,
 * and its founders edit it from there). This card is where a founder brings
 * that file in.
 *
 * Closed, it is two lines and a button. The screen behind it is a lazy chunk
 * (CLAUDE.md, "Routes are lazy"): the Setup Wizard is the first thing every
 * founder opens, and most will never press this.
 *
 * `onIdentity` fills the wizard's own Identity boxes, unsaved, so the founder
 * presses "Save identity" there. It comes from the wizard, which holds those
 * boxes' state; this card never saves the brand record itself, because the
 * wizard would then save its older copy straight over it.
 */
import { lazy, Suspense, useState } from "react";
import type { IdentityPrefill } from "@shared/regenImport";
import { keepFile, keptFileText } from "@/lib/profilePrefill";

const ProfileImport = lazy(() => import("./ProfileImport"));

export default function ProfileImportDoor({
  password,
  onOpenTab,
  onIdentity,
}: {
  password: string;
  onOpenTab: (tab: string) => void;
  onIdentity?: (p: IdentityPrefill) => void;
}) {
  // Open again when a file was read earlier on this page, so a founder back from another editor finds it.
  const [open, setOpen] = useState(() => keptFileText() !== "");
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 px-5 py-3 border-b border-gray-100">
        <div>
          <h3 className="font-semibold text-gray-900 leading-tight">Start from your ReGen Civics profile</h3>
          <p className="text-xs text-gray-600">
            Bring in the needs, circles and roles your project designed in the Season, and read every part before
            anything is set.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (open) keepFile("");
            setOpen(!open);
          }}
          aria-expanded={open}
          className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-800 min-h-[44px]"
        >
          {open ? "Close" : "Start from my profile"}
        </button>
      </div>
      {open ? (
        <div className="p-5 bg-white">
          <Suspense fallback={<p className="text-sm text-gray-600">Opening...</p>}>
            <ProfileImport password={password} onOpenTab={onOpenTab} onIdentity={onIdentity} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
