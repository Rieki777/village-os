/**
 * THE FIVE ARCHETYPES AS ROOTS, for any page (11 Nov 2026).
 *
 * - `RootTags`: which roots a role or quest grows from, drawn as small roots.
 * - `RootPicker`: an editor's one-to-three boxes, with the coverage check.
 * - `useRootsFilter` and `RootsFilterToggle`: "Show only what matches my
 *   roots", on by default once a person has picked. The roles list uses the
 *   same two the quests list does:
 *
 *     const roots = useRootsFilter(user?.id);
 *     const { shown, hidden } = roots.apply(roles, (r) => r.archetypes);
 *     <RootsFilterToggle filter={roots} total={roles.length} shown={shown.length} noun="roles" />
 *
 * The rules themselves are in shared/archetypeRoots.ts.
 */
export { default as RootTags, RootGlyph } from "./RootTags";
export type { RootTagsProps } from "./RootTags";
export { default as RootPicker } from "./RootPicker";
export type { RootPickerProps } from "./RootPicker";
export { default as RootsFilterToggle, ROOTS_PAGE } from "./RootsFilterToggle";
export { useMyRoots, useRootsFilter, ROOTS_FILTER_OFF_KEY, type RootsFilter } from "./useRootsFilter";
export { useRootCast, readRootCast, type Root } from "./rootCast";
export { filterByRoots, rootsMatch, rootsFilterOn } from "@shared/archetypeRoots";
