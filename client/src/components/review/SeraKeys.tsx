/**
 * The keyboard for the outside service's differences on /review (spec R32,
 * US6.3; the approved "1280 px" board's "Keyboard keys").
 *
 * OFF BY DEFAULT, behind a toggle shown from 768 px and remembered in this
 * browser. While it is on and focus is in the list, never in a text box:
 *
 *   j or ArrowDown   the next row          x   tick the row
 *   k or ArrowUp     the row before        t   take the service's
 *   Escape           leave an edit         a   keep ours
 *                                          e   edit
 *
 * None of these is a key the browser or a screen reader needs while the list
 * has focus, and with no modifier held. Each acts by pressing the row's own
 * button (`data-act`), so a key does exactly what the visible button does.
 * The remembered choice is a convenience in this browser only: a browser that
 * keeps nothing simply starts with it off.
 */
import { useCallback, useState, type KeyboardEvent } from "react";
import { Trans } from "@lingui/react/macro";

const KEY = "village.seraReview.keys";

function readOn(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

/** The toggle's state, remembered in this browser, off until a person turns it on. */
export function useKeysToggle(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readOn);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // A browser that keeps nothing starts with the keys off next time, which is the default anyway.
    }
  }, []);
  return [on, set];
}

/** "Keyboard keys", shown from 768 px (`md`), where a keyboard is likely. */
export function KeysToggle({ on, set }: { on: boolean; set: (on: boolean) => void }) {
  return (
    <label className="hidden md:flex ml-auto items-center gap-2 min-h-[44px] text-sm text-muted-foreground cursor-pointer">
      <input type="checkbox" data-keys-toggle checked={on} onChange={(e) => set(e.target.checked)} className="w-[18px] h-[18px] accent-teal-deep" />
      <Trans context="sera answers">Keyboard keys</Trans>
    </label>
  );
}

/** The keys, listed on the page while they are on (US6.3). */
export function KeysLegend({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <p className="hidden md:block text-[13px] text-muted-foreground">
      <Trans context="sera answers">Keys: j or ↓ next, k or ↑ back, x tick, t take, a keep, e edit. Escape leaves an edit.</Trans>
    </p>
  );
}

const TEXT_INPUT = /^(text|search|email|url|tel|number|password)$/i;

/** True when a key belongs to whatever has focus: a text box, a select, or anything editable. */
function typing(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT.test(el.type || "text");
}

/**
 * The list's key handler. Rows are the elements marked `data-sera-row`, in the
 * order they are drawn; a key acts on the row focus is in. Answers whether it
 * used the key.
 */
export function handleListKey(e: KeyboardEvent<HTMLElement>, on: boolean, root: HTMLElement | null, onRow?: (key: string) => void): boolean {
  if (!on || !root || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return false;
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-sera-row]"));
  if (rows.length === 0) return false;
  const here = (e.target as HTMLElement).closest<HTMLElement>("[data-sera-row]");
  const at = here ? rows.indexOf(here) : -1;
  const move = (to: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, to))];
    row.focus();
    onRow?.(row.dataset.seraRow ?? "");
  };
  const press = (selector: string) => {
    if (!here) return false;
    const own = here.querySelector<HTMLElement>(selector);
    const pane = root.querySelector<HTMLElement>(`#sera-pane ${selector}`);
    const button = own ?? pane;
    if (!button || (button as HTMLButtonElement).disabled) return false;
    button.click();
    return true;
  };
  switch (e.key) {
    case "j":
    case "ArrowDown":
      move(at + 1);
      break;
    case "k":
    case "ArrowUp":
      move(at <= 0 ? 0 : at - 1);
      break;
    case "x":
      if (!press("[data-tick]")) return false;
      break;
    case "t":
      if (!press('[data-act="take"]')) return false;
      break;
    case "a":
      if (!press('[data-act="keep"]')) return false;
      break;
    case "e":
      if (!press('[data-act="edit"], [data-act="compare"]')) return false;
      break;
    default:
      return false;
  }
  e.preventDefault();
  return true;
}
