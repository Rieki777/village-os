/**
 * THE KEYBOARD STAYS WITH A HAND-BUILT MODAL.
 *
 * This client draws several of its modal surfaces by hand rather than with the
 * shadcn primitive (BreakGlass explains why), and `aria-modal="true"` on one of
 * them is a promise to a screen reader that the page behind is out of reach.
 * Nothing kept that promise for the keyboard. Measured on the weekly brief
 * before this hook: opening it left focus on the button behind the overlay,
 * Tab walked on through the page the overlay covers, Escape did nothing, and
 * closing it dropped focus on <body>, so a keyboard user restarted the page.
 *
 * Four behaviours, the ones the WAI-ARIA dialog pattern names:
 *
 *  1. Opening moves focus into the panel: `initial` if given, else the first
 *     focusable inside, else the panel itself. If focus is already inside
 *     (the component focused something itself), it is left where it is.
 *  2. Tab and Shift+Tab wrap inside the panel and never reach the page.
 *  3. Escape calls `onEscape`, when one is given. A component that already
 *     handles Escape itself passes none.
 *  4. Closing hands focus back to whatever held it before opening, if that
 *     element is still in the document.
 *
 * The panel must be in the DOM in the same render that `open` turns true,
 * which is how every caller here renders: `{open && <div ref={panel}>}`.
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "summary",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** The elements Tab can reach inside `root`, in document order. */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[hidden],[inert],[aria-hidden='true']") && el.tabIndex >= 0,
  );
}

export interface ModalFocusOptions {
  /** Called on Escape. Omit when the component handles Escape itself. */
  onEscape?: () => void;
  /** The element to focus on opening, instead of the first focusable. */
  initial?: RefObject<HTMLElement | null>;
}

export function useModalFocus(
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  options: ModalFocusOptions = {},
): void {
  // Read through refs so a caller passing a fresh arrow each render does not
  // re-run the effect, which would steal focus back on every keystroke.
  const onEscape = useRef(options.onEscape);
  onEscape.current = options.onEscape;
  const initial = useRef(options.initial);
  initial.current = options.initial;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current;
    if (root && !root.contains(document.activeElement)) {
      const target = initial.current?.current ?? focusablesIn(root)[0] ?? root;
      if (target === root && !root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
      target.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      const r = panel.current;
      if (!r) return;
      if (e.key === "Escape") {
        if (onEscape.current) {
          e.stopPropagation();
          onEscape.current();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusablesIn(r);
      if (items.length === 0) {
        e.preventDefault();
        r.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !r.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !r.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
    };
    // `panel` is a ref object and stable; only opening and closing matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
