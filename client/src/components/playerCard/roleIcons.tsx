/**
 * The role tiles' gold line icons, drawn in the approved design's own hand
 * (https://claude.ai/artifact/XGP6VP5WFU1T6ti7RD482P): a 32 by 32 box, a 1.6
 * stroke in the current colour, round caps and joins. The door, the game
 * screen and the three circles are the design's own drawings, copied as they
 * are; the rest are drawn to match them.
 *
 * Which icon a role gets is decided by its name and domain, in
 * shared/roleIcons.ts, where the keyword map is written down. Keyed by
 * `RoleIcon`, so an icon added there without a drawing here fails to compile.
 */
import type { ReactNode } from "react";
import type { RoleIcon } from "@shared/roleIcons";

const PATHS: Record<RoleIcon, ReactNode> = {
  // The design's door, for onboarding and people.
  door: (
    <>
      <path d="M8 28V6h13l3 3v19" />
      <path d="M8 28h16" />
      <circle cx="18" cy="17" r="1.2" fill="currentColor" />
      <path d="M4 28h4M24 28h4" />
    </>
  ),
  // The design's game screen, for the front end, the game and the platform.
  screen: (
    <>
      <rect x="4" y="7" width="24" height="16" rx="2.5" />
      <path d="M12 27h8M16 23v4" />
      <path d="M11 15h4M13 13v4" />
      <circle cx="20" cy="14" r="1" fill="currentColor" />
      <circle cx="22" cy="16.5" r="1" fill="currentColor" />
    </>
  ),
  // The design's three circles in a ring, for governance, org design and facilitation.
  circles: (
    <>
      <circle cx="16" cy="16" r="11" />
      <circle cx="16" cy="9.5" r="2.6" />
      <circle cx="10.2" cy="19.5" r="2.6" />
      <circle cx="21.8" cy="19.5" r="2.6" />
    </>
  ),
  sprout: (
    <>
      <path d="M16 28V15" />
      <path d="M16 19c-5 0-8-3-8-8 5 0 8 3 8 8z" />
      <path d="M16 15c0-5 3-8 8-8 0 5-3 8-8 8z" />
      <path d="M8 28h16" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="13" cy="9" rx="7" ry="3" />
      <path d="M6 9v5c0 1.7 3.1 3 7 3" />
      <path d="M20 9v3" />
      <ellipse cx="19" cy="18" rx="7" ry="3" />
      <path d="M12 18v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    </>
  ),
  house: (
    <>
      <path d="M5 15 16 6l11 9" />
      <path d="M8 13v15h16V13" />
      <path d="M14 28v-7h4v7" />
    </>
  ),
  heart: <path d="M16 26s-10-6.2-10-13a5.5 5.5 0 0 1 10-3.2A5.5 5.5 0 0 1 26 13c0 6.8-10 13-10 13z" />,
  book: (
    <>
      <path d="M16 9c-3-2-7-2.5-11-2v17c4-.5 8 0 11 2 3-2 7-2.5 11-2V7c-4-.5-8 0-11 2z" />
      <path d="M16 9v17" />
    </>
  ),
  speech: (
    <>
      <path d="M6 7h20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14l-6 5v-5H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M10 13h12M10 17h8" />
    </>
  ),
  gear: (
    <>
      <circle cx="16" cy="16" r="4" />
      <circle cx="16" cy="16" r="9" />
      <path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8" />
    </>
  ),
  star: <path d="M16 4l3.5 7.6 8.3.9-6.2 5.6 1.8 8.2L16 22.1l-7.4 4.2 1.8-8.2-6.2-5.6 8.3-.9z" />,
};

export function RoleIconSvg({ icon }: { icon: RoleIcon }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-role-icon={icon}>
      {PATHS[icon] ?? PATHS.star}
    </svg>
  );
}
