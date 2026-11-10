/**
 * The client half of the brochure switches. The rule and the page list are in
 * shared/brochure.ts; the server reads the stored switches once at boot and
 * serves them as `brochurePages` (all the story pages) and `brochureHidden`
 * (the ones switched off one by one) on /api/game/config.
 *
 * Everything here fails toward HIDDEN. While the config is still loading the
 * answer is null, a link reads that as "not yet" and stays out, and a page
 * renders nothing rather than flashing the first village's story at a village
 * that has switched it off.
 */
import { lazy, useCallback, type ComponentType } from "react";
import { useLocation } from "wouter";
import NotFound from "@/pages/NotFound";
import { useGameConfig, type PublicGameConfig } from "./gameApi";
import { brochurePathServed, isBrochurePath, isMemberDoor, servedTo } from "@shared/brochure";
import { useOptionalAuth } from "@/contexts/AuthContext";

export { isBrochurePath };

/** True or false once the config has loaded, null before. */
export function useBrochurePages(): boolean | null {
  const config = useGameConfig();
  return config ? config.brochurePages === true : null;
}

type Switches = Pick<PublicGameConfig, "brochurePages" | "brochureHidden">;

/**
 * Whether a link to `href` may be drawn: always for an address outside the
 * story pages, and for a story page only while this village serves it. A
 * config that has not answered yet serves no story page.
 */
export function storyPageShown(config: Switches | null | undefined, href: string): boolean {
  if (!config) return !isBrochurePath(href);
  return brochurePathServed({ enabled: config.brochurePages === true, hidden: config.brochureHidden ?? [] }, href);
}

/**
 * `storyPageShown` bound to the live config, for a component that draws links
 * to several pages. A link to a page this village does not serve is left out,
 * the same way a link to a module that is off is left out.
 */
/**
 * A story page as THIS viewer can open it: a member's door (the Love Letter)
 * is always open to somebody signed in (shared/brochure.ts, MEMBER_DOORS).
 * The question a member's own surface asks before it links the letter.
 */
export function memberDoorShown(config: Switches | null | undefined, href: string, signedIn: boolean): boolean {
  if (!config) return signedIn || !isBrochurePath(href);
  return servedTo({ enabled: config.brochurePages === true, hidden: config.brochureHidden ?? [] }, href, signedIn);
}

export function useStoryPageShown(): (href: string) => boolean {
  const config = useGameConfig();
  return useCallback((href: string) => storyPageShown(config, href), [config]);
}

/**
 * True when `href` is a story page this village switched off on its own.
 *
 * The question a link ON a story page asks. A story page only renders while
 * the master switch is on, so the one thing left to know is whether the page
 * it points at was switched off by itself. A config that has not answered, or
 * a server that never sent the list, switches nothing off.
 */
export function storyPageOffAlone(config: Switches | null | undefined, href: string): boolean {
  return !brochurePathServed({ enabled: true, hidden: config?.brochureHidden ?? [] }, href);
}

/** `storyPageOffAlone` bound to the live config, for a story page's own links. */
export function useStoryPageOffAlone(): (href: string) => boolean {
  const config = useGameConfig();
  return useCallback((href: string) => storyPageOffAlone(config, href), [config]);
}

/**
 * A lazily loaded brochure page that only exists while this village serves
 * it: the master switch on, and the page's own switch not off. Off, the route
 * answers with the ordinary not-found page, exactly as an address that never
 * existed would, and the page's own chunk is never fetched.
 */
export function brochurePage(loader: () => Promise<{ default: ComponentType<any> }>): ComponentType<any> {
  const Page = lazy(loader);
  return function BrochureRoute(props: any) {
    const config = useGameConfig();
    const [location] = useLocation();
    const auth = useOptionalAuth();
    if (!config) return null;
    const door = isMemberDoor(location);
    // A member's door waits for the session, so a signed-in member is never shown not-found first.
    if (door && auth?.loading) return null;
    // The master switch decides wherever this is mounted; the page's own
    // switch is read off the address it answers. A member's door (the Love
    // Letter) is open to anybody signed in, whatever the switches say.
    const served = (config.brochurePages === true && storyPageShown(config, location)) || (door && !!auth?.user);
    return served ? <Page {...props} /> : <NotFound />;
  };
}
