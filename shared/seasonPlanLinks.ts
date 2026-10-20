/**
 * Where a member plans their season, on its own so a module that only needs
 * the link (the term watch in server/lib/stewardship.ts, the season-end
 * reminders) does not import the season plan model, and through it the seat
 * settings model that shared/seatSettings.boundary.test.ts keeps away from
 * every module that moves value.
 */
export const SEASON_PLAN_MINE = "/season-plans/mine";
