/**
 * ONE ADDRESS FOR "EXACTLY WHAT THEY NEED".
 *
 * Rye, 2026-09-21, on a module that owns a place-dependent default: "Yes - and
 * whenever this happens have a link to direct people to exactly what they
 * need." A readiness hint says what is missing; this says where it lives, and
 * it is a function rather than a string written at each call site because
 * several surfaces render the same link (the module's own page in the library,
 * the Go-live slot on the module's own tab, the settings screens) and another
 * would otherwise invent another spelling.
 *
 * ONE PAGE NOW (Rye, 2026-10-09). The admin Module Library tab is retired: a
 * module's settings, switch and setup all live on its library page,
 * `/modules/<id>`, and a dial is named in the fragment, `#setting-<key>`.
 * Every old `/admin?tab=modules&module=<id>&setting=<key>` address still works:
 * `legacyModulesTabTarget` below turns it into the new one and the admin page
 * redirects there.
 *
 * WHY A FRAGMENT NOW. The query string carried the admin tab, and the module's
 * page has no tab to carry. The dial does not exist when the page loads (the
 * catalog, then the steward's rows, then the dials each arrive), so the
 * browser's own jump fires too early either way and the landing code focuses
 * the dial once it is really there (client/src/components/admin/moduleDeepLink.ts).
 * A dial key contains dots, which is a valid id and an invalid CSS selector, so
 * that code finds the element by id and never by `querySelector`.
 */
import type { SetupTarget } from "./modules";

/** Where a module's own settings live: its page in the library. */
export function moduleCardHref(moduleId: string): string {
  return `/modules/${encodeURIComponent(moduleId)}`;
}

/** The fragment that opens the settings at one dial, or at the config editor. */
export const settingFragment = (key: string) => `#setting-${encodeURIComponent(key)}`;

/**
 * The address for one readiness target.
 *
 * `on` is whether the module is being served at all (anything but off). It
 * only changes a `tab` target: content is made on the module's own admin
 * screen, the nav rail hides that screen while the module is off, and its
 * routes answer 404 behind requireModule, so an off module's link goes to the
 * module's page instead of to a screen that would 404 on arrival.
 *
 * A missing target still answers the module's page rather than nothing. A link
 * that lands one step away is a worse answer than a link that lands on the
 * control and a much better one than a founder reading a hint with nowhere to go.
 */
export function setupHref(
  moduleId: string,
  target: SetupTarget | null | undefined,
  opts: { on: boolean },
): string {
  if (!target) return moduleCardHref(moduleId);
  if (target.kind === "setting") return `${moduleCardHref(moduleId)}${settingFragment(target.key)}`;
  if (target.kind === "config") return `${moduleCardHref(moduleId)}${settingFragment("config")}`;
  return opts.on ? `/admin?tab=${encodeURIComponent(target.tab)}` : moduleCardHref(moduleId);
}

/**
 * Where an old admin Module Library address goes now, or null when the address
 * is not one. `?tab=modules` alone is the library; with `module` it is that
 * module's page; with `setting` too, the dial.
 */
export function legacyModulesTabTarget(search: string): string | null {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (p.get("tab") !== "modules") return null;
  const moduleId = (p.get("module") ?? "").trim();
  if (!moduleId) return "/modules";
  const setting = (p.get("setting") ?? "").trim();
  return `${moduleCardHref(moduleId)}${setting ? settingFragment(setting) : ""}`;
}

/**
 * What the link says. It names the control, never the journey: "Settings" is
 * true of every link on the page and tells a founder holding one question
 * nothing about which of twenty-four modules answers it.
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
 * cannot be made until the module is on, so the link goes to the module's page
 * and this says why.
 */
export function setupAside(
  target: SetupTarget | null | undefined,
  opts: { on: boolean },
): string | null {
  if (!target || opts.on || target.kind !== "tab") return null;
  return "Turn it on in preview first: this is made on the module's own screen, which opens with it.";
}
