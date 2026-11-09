/**
 * The change-request dials' keys and defaults, in a file with no imports so
 * the dial registry (shared/gameVariables.ts) can read them without pulling in
 * the rest of shared/changeRequests.ts.
 */

/** How many change requests one member may be gathering at once (spec C7, a village dial). */
export const GATHERING_LIMIT_KEY = "governance.change_requests_gathering_per_member";
export const GATHERING_LIMIT_DEFAULT = 5;

/** How many days a change request stays in review before it may go to the vote (spec C3, a village dial). */
export const REVIEW_DAYS_KEY = "governance.change_request_review_days";
export const REVIEW_DAYS_DEFAULT = 3;
