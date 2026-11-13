/**
 * THE PHONE'S KEYBOARD, measured (batch 158, live bugs M2 and M9).
 *
 * A phone's on-screen keyboard shrinks the VISUAL viewport and leaves the
 * layout viewport alone, so anything fixed or sticky to the bottom stays put
 * behind the keyboard, and the field being typed in can end up under a bar or
 * off the screen. `visualViewport` is the one thing that sees the keyboard:
 * the inset is how much of the layout viewport's bottom it covers.
 *
 * Two pieces, used together where a form has a bar at the bottom of a phone:
 *   - `useKeyboardInset()`: the covered height in px, 0 when no keyboard (and
 *     on every browser without `visualViewport`), to lift a bar above it;
 *   - `useFocusedFieldInView(ref)`: while the keyboard is up and a text field
 *     inside `ref` has focus, bring it to the middle of what the reader can
 *     see, again when the keyboard finishes opening. With no keyboard it
 *     does nothing, so a desk's click into a field never moves the page.
 */
import { useEffect, useState, type RefObject } from "react";

/** How much of the layout viewport's bottom the keyboard covers, in px. */
export function keyboardInset(win: Window | undefined = typeof window === "undefined" ? undefined : window): number {
  const vv = win?.visualViewport;
  if (!win || !vv) return 0;
  const covered = win.innerHeight - vv.height - vv.offsetTop;
  // A browser chrome bar that slides is a few px, never a keyboard.
  return covered > 80 ? Math.round(covered) : 0;
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(() => keyboardInset());
  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!vv) return;
    const read = () => setInset(keyboardInset());
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    read();
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);
  return inset;
}

const TYPED = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]';

/** True for a field that brings up a keyboard. */
export function isTypedField(el: Element | null): el is HTMLElement {
  return !!el && typeof (el as HTMLElement).matches === "function" && (el as HTMLElement).matches(TYPED);
}

/** Keep the focused text field inside `ref` in view while the keyboard is up. */
export function useFocusedFieldInView(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    // Read the ref at the moment of focus: the form may draw after this mounts (a page that loads first).
    const show = () => {
      const el = document.activeElement;
      const root = ref.current;
      // Only while a keyboard is up: a desk's click into a field never moves the page.
      if (!root || !isTypedField(el) || !root.contains(el) || keyboardInset() === 0) return;
      requestAnimationFrame(() => {
        if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", inline: "nearest" });
      });
    };
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    document.addEventListener("focusin", show);
    vv?.addEventListener("resize", show);
    return () => {
      document.removeEventListener("focusin", show);
      vv?.removeEventListener("resize", show);
    };
  }, [ref, enabled]);
}
