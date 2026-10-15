/**
 * The honest Admin nav (L1): which admin tabs exist follows which modules are
 * on, and this file is the single owner of the tab-to-module mapping.
 *
 * Pure on purpose: `navGroups()` in Admin.tsx stays a literal list of
 * everything the panel CAN show, and `filterNavByModules` decides what this
 * village's Admin DOES show, so the two concerns never tangle and the filter
 * is testable without rendering anything.
 */
import type { ModuleLifecycle } from "@shared/modules";

/**
 * Admin tab key -> module id. A tab named here renders only while its module
 * is not off, and carries the module's lifecycle as a badge. Every tab NOT
 * named here is a platform tab and always renders.
 *
 * `resources-admin` and `intents-admin` are mapped ahead of their modules
 * (L3's `resources`, L7's `introductions`): an id the registry does not know
 * reads as off, so those tabs stay hidden until their lanes land, and neither
 * lane has to edit this map to get the hiding right.
 *
 * Measured, not assumed: `org-chart` and `seasons-patterns` stay platform
 * tabs because `/api/org` and `/api/admin/seasons/patterns` mount behind no
 * requireModule and both surfaces work with `map` off.
 */
export const TAB_MODULE: Record<string, string> = {
  "circles-map": "map",
  "events-admin": "events",
  "tools-admin": "tools",
  "crowdpool-admin": "crowdpool",
  "stays-admin": "stays",
  "exchange-admin": "exchange",
  "badges-admin": "badges",
  "library-admin": "library",
  "health-admin": "health",
  "calls-admin": "automation",
  products: "commerce",
  "forum-moderation": "forum",
  // `/api/admin/messages` mounts behind requireModule("messaging"), so the DM
  // report queue is only a queue while the module is on. `cycles` is NOT here:
  // gratitude is core, always public, and its close route is behind no gate.
  "message-reports": "messaging",
  "resources-admin": "resources",
  "intents-admin": "introductions",
  // `app.use("/api/admin/governance", requireModule("governance"))` gates every
  // weight route, so the allocation table is only a table while the engine is
  // on. Off, the tab hides instead of offering a form that 404s.
  "governance-weights": "governance",
  // Village Comms: the five screens that drive the automations follow the
  // module. `comms-sent` and `comms-settings` are deliberately NOT here: a
  // village sets up its sending before it turns anything on, and the post
  // office records every email (a password link included) whatever the
  // module says, so both are platform tabs (server/routes/comms.ts).
  "comms-overview": "comms",
  "comms-journeys": "comms",
  "comms-words": "comms",
  "comms-people": "comms",
  "comms-letters": "comms",
};

/** The badge an admin tab wears: where its module stands right now. */
export type TabBadge = "preview" | "members" | "everyone";

export function tabBadge(lifecycle: ModuleLifecycle | undefined): TabBadge | undefined {
  if (lifecycle === "preview") return "preview";
  if (lifecycle === "members") return "members";
  if (lifecycle === "public") return "everyone";
  return undefined;
}

interface FilterableItem {
  key: string;
  badge?: TabBadge;
}

interface FilterableGroup<I extends FilterableItem> {
  title: string;
  items: I[];
}

/**
 * Drop every tab whose module is off, badge the rest with where their module
 * stands, and drop a group that ends up empty (a bare title is not a menu).
 *
 * `lifecycles` null or undefined means the admin modules payload has not
 * arrived yet: filter NOTHING, so a slow link shows the full rail instead of
 * flashing an empty one. An id missing from the record reads as off, which is
 * exactly the delta-off rule the server lives by.
 */
export function filterNavByModules<I extends FilterableItem, G extends FilterableGroup<I>>(
  groups: G[],
  lifecycles: Record<string, ModuleLifecycle> | null | undefined,
): G[] {
  if (!lifecycles) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((item) => {
          const moduleId = TAB_MODULE[item.key];
          if (!moduleId) return true;
          return (lifecycles[moduleId] ?? "off") !== "off";
        })
        .map((item) => {
          const moduleId = TAB_MODULE[item.key];
          const badge = moduleId ? tabBadge(lifecycles[moduleId]) : undefined;
          return badge ? { ...item, badge } : item;
        }),
    }))
    .filter((g) => g.items.length > 0);
}
