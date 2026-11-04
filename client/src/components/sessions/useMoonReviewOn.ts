/**
 * Whether the moon-review module is on for this viewer, for the End of moon
 * section kinds in the template editor and the room's panel.
 *
 * The same answer as `moduleIsOn` in modules/ModuleProvider.tsx (still
 * loading: false; the catalog could not be read: true; otherwise listed and
 * not off), read through `useModules` because that is the one hook every page
 * holding these components already reads, and every test of those pages
 * already stands in for.
 */
import { MOON_REVIEW_MODULE_ID } from "@shared/sessionTemplates";
import { useModules } from "@/modules/ModuleProvider";

export function useMoonReviewOn(): boolean {
  const s = useModules();
  if (!s.loaded) return false;
  if (s.failed) return true;
  return s.modules.some((m) => m.id === MOON_REVIEW_MODULE_ID && m.lifecycle !== "off");
}
