/**
 * The client half of the brochure switch. The rule and the page list are in
 * shared/brochure.ts; the server reads the stored switch once at boot and
 * serves it as `brochurePages` on /api/game/config.
 *
 * Everything here fails toward HIDDEN. While the config is still loading the
 * answer is null, a link reads that as "not yet" and stays out, and a page
 * renders nothing rather than flashing the first village's story at a village
 * that has switched it off.
 */
import { lazy, type ComponentType } from "react";
import NotFound from "@/pages/NotFound";
import { useGameConfig } from "./gameApi";
import { isBrochurePath } from "@shared/brochure";

export { isBrochurePath };

/** True or false once the config has loaded, null before. */
export function useBrochurePages(): boolean | null {
  const config = useGameConfig();
  return config ? config.brochurePages === true : null;
}

/**
 * A lazily loaded brochure page that only exists while the switch is on.
 * Off, the route answers with the ordinary not-found page, exactly as an
 * address that never existed would, and the page's own chunk is never fetched.
 */
export function brochurePage(loader: () => Promise<{ default: ComponentType<any> }>): ComponentType<any> {
  const Page = lazy(loader);
  return function BrochureRoute(props: any) {
    const on = useBrochurePages();
    if (on === null) return null;
    return on ? <Page {...props} /> : <NotFound />;
  };
}
