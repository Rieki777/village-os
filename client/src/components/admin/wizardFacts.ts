/**
 * WHAT THE SETUP WIZARD NEEDS TO KNOW ABOUT THIS VILLAGE before it points a
 * founder anywhere (the founder-path pass of 2026-11-01).
 *
 *   Step 5 listed five editors whose pages a new village has switched off (the
 *   brochure pages: team, the journey FAQs, the home page's build progress,
 *   visits, the investor summary). A founder filled them in and nothing they
 *   wrote showed anywhere. Each still opens, because a founder may be getting
 *   ready to switch the pages on, and now says plainly that nobody sees it yet.
 *
 *   Step 6 opened `/map` while the map module was off, which lands on the
 *   module's gate. It now sends a founder to switch the map on first.
 *
 * Here and not in Admin.tsx, which is held by the monolith ratchet; re-exported
 * through setupProgress.ts so the wizard's existing import carries it.
 */
import { useGameConfig } from "@/lib/gameApi";
import { moduleIsOn, useModules } from "@/modules/ModuleProvider";

export interface ContentEditor {
  tab: string;
  label: string;
  hint: string;
  /** Edits content that only shows on a brochure page, which a village may switch off. */
  brochure?: boolean;
}

export const PAGE_OFF_HINT = "Its page is switched off in this village, so nobody sees this yet.";

export function contentEditorHint(c: ContentEditor, brochureOn: boolean | null): string {
  return c.brochure && brochureOn === false ? PAGE_OFF_HINT : c.hint;
}

export function useWizardFacts(): { brochureOn: boolean | null; mapOn: boolean } {
  const config = useGameConfig();
  const modules = useModules();
  return {
    brochureOn: config ? config.brochurePages === true : null,
    // Unknown while the module list loads: keep the map link, which is the common case.
    mapOn: !modules.loaded || moduleIsOn(modules, "map"),
  };
}
