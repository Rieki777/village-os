/**
 * ONE ADDRESS FOR "EXACTLY WHAT THEY NEED".
 *
 * Rye, 2026-09-21, on a module that owns a place-dependent default: "Yes - and
 * whenever this happens have a link to direct people to exactly what they
 * need." A readiness hint says what is missing; this says where it lives, and
 * it is a function rather than a string written at each call site because
 * three surfaces render the same link (the module card in Admin, the module's
 * page in the library, and the Go-live slot on the module's own tab) and a
 * fourth would otherwise invent a fourth spelling.
 *
 * WHY A QUERY PARAMETER AND NOT A `#hash`. Three reasons, all measured:
 *
 *   1. The admin tab already lives in the query string (`?tab=modules`), and
 *      the module whose settings to open already rides beside it
 *      (`&module=<id>`). A hash would be a second address space for the same
 *      journey.
 *   2. The control does not exist when the page loads. The Modules tab fetches
 *      the catalog, the card then fetches the dials, and only then is there an
 *      element to jump to. The browser's own hash jump has long since fired.
 *   3. A dial key contains dots. `#module-setting-calendar.hemisphere` is a
 *      valid id and an invalid CSS selector, so anything reaching for it with
 *      `querySelector` reads "hemisphere" as a class and finds nothing.
 *
 * So the address carries the key and the landing code focuses it once the
 * control is really there (client/src/components/admin/moduleDeepLink.ts).
 */
import type { SetupTarget } from "./modules";

/** Where a module's own settings live: the card, on the Admin Modules tab. */
export function moduleCardHref(moduleId: string): string {
  return `/admin?tab=modules&module=${encodeURIComponent(moduleId)}`;
}

/**
 * The address for one readiness target.
 *
 * `on` is whether the module is being served at all (anything but off). It
 * only changes a `tab` target: content is made on the module's own admin
 * screen, the nav rail hides that screen while the module is off, and its
 * routes answer 404 behind requireModule, so an off module's link goes to the
 * card instead of to a screen that would 404 on arrival.
 *
 * A missing target still answers the card rather than nothing. A link that
 * lands one step away is a worse answer than a link that lands on the control
 * and a much better one than a founder reading a hint with nowhere to go.
 */
export function setupHref(
  moduleId: string,
  target: SetupTarget | null | undefined,
  opts: { on: boolean },
): string {
  if (!target) return moduleCardHref(moduleId);
  if (target.kind === "setting") {
    return `${moduleCardHref(moduleId)}&setting=${encodeURIComponent(target.key)}`;
  }
  if (target.kind === "config") return `${moduleCardHref(moduleId)}&setting=config`;
  return opts.on ? `/admin?tab=${encodeURIComponent(target.tab)}` : moduleCardHref(moduleId);
}

/**
 * What the link says. It names the control, never the journey: "Settings" is
 * true of every link on the page and tells a founder holding one question
 * nothing about which of twenty-four cards answers it.
 */
export function setupLinkText(
  target: SetupTarget | null | undefined,
  opts: { on: boolean },
): string {
  if (!target) return "Open its settings";
  if (target.kind === "setting") return `Set ${target.label}`;
  if (target.kind === "config") return `Set up ${target.label}`;
  return opts.on ? `Open ${target.label}` : `Open its settings`;
}

/**
 * The sentence that keeps an off module's link honest, or null when there is
 * nothing extra to say. Only a `tab` target needs one: the thing it asks for
 * cannot be made until the module is on, so the link goes to the card and this
 * says why.
 */
export function setupAside(
  target: SetupTarget | null | undefined,
  opts: { on: boolean },
): string | null {
  if (!target || opts.on || target.kind !== "tab") return null;
  return "Turn it on in preview first: this is made on the module's own screen, which opens with it.";
}
