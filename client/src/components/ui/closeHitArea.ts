/**
 * The corner close button of every dialog and sheet, made a 44 px target.
 *
 * The visible button is the 16 px icon, and it was the whole target unless
 * the device reported a coarse pointer, so a touchscreen laptop, a stylus or
 * a phone in desktop mode got a 16 px close (found by the Gene Keys lane,
 * 2026-10-31). A transparent `::before` reaches CLOSE_HIT_REACH_PX past the
 * icon on every side, for every pointer, so the target is
 * CLOSE_ICON_PX + 2 x CLOSE_HIT_REACH_PX = 44 px and nothing visible changes.
 *
 * The button sits 16 px inside the panel's corner (`top-4 right-4`), so the
 * 14 px reach stays inside a panel that clips its overflow.
 *
 * Written out whole so Tailwind sees every class.
 */
export const CLOSE_ICON_PX = 16;
export const CLOSE_HIT_REACH_PX = 14;
export const CLOSE_HIT_AREA = "before:absolute before:-inset-[14px] before:content-['']";
