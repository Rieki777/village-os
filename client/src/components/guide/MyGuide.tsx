/**
 * The member's guide choice, on any surface: reads `GET /api/guide` once and
 * draws the existing GuidePicker ("Talking to Maia" / "Switch to Sera"), so a
 * member can choose Sera wherever a guide talks to them (Rye, 2026-11-09:
 * "Ensuring she's on at every point where we have a conversational agent").
 * Before this it was mounted on the role-proposal panel only.
 */
import { useEffect, useState } from "react";
import type { GuideState } from "@shared/guideChoice";
import { fetchGuide } from "@/lib/guideApi";
import GuidePicker from "./GuidePicker";

/** The member's guide state, fetched once per mount. Null until it arrives, or when it cannot be read. */
export function useGuideState(): [GuideState | null, (next: GuideState) => void] {
  const [state, setState] = useState<GuideState | null>(null);
  useEffect(() => {
    let live = true;
    void fetchGuide().then((s) => {
      // Only a real guide state: anything else (an old server, a proxy page)
      // must draw nothing, never take the page it sits on down with it.
      if (live && s && Array.isArray((s as GuideState).options) && typeof (s as GuideState).answering !== "undefined") setState(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return [state, setState];
}

/** Who answers here, with the one-tap switch when both guides can. Draws nothing until it knows. */
export default function MyGuide({ state, onChange }: { state: GuideState | null; onChange: (next: GuideState) => void }) {
  if (!state) return null;
  return <GuidePicker state={state} onChange={onChange} />;
}
