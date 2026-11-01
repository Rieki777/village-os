/**
 * A role proposal payload for the proposal steps' client tests (role
 * proposals PR C), built the way the server builds it: each role's word
 * fields come from `wordFields` (shared/roleProposals.ts) over the role as
 * posted and the words the draft holds, so "changed" is the server's own
 * answer. `answerPut` plays the PUT: a group sent replaces the one stored.
 *
 * Every name is made up, and the role ids match the card fixture's (r1, r2,
 * r3), so a preview drawn from `fixturePayload` lines up with the proposal.
 */
import { wordFields, type RoleWords, type WordFieldsContext } from "@shared/roleProposals";
import type { ConsentState } from "@shared/roleProposalConsent";
import type { SeatSettings } from "@shared/seatSettings";
import type { ConsentOut, ProposalOut, ProposalUpdate, ShareOut } from "@/components/roleProposal/proposalApi";

export const WORDS_CTX: WordFieldsContext = {
  fields: ["name", "aim", "domain", "accountabilities", "whyItMatters", "bringMe", "notMine", "runbook", "existsWhile", "authorities", "responsibilities", "signsStretched", "flowsBack", "stepBack", "timeCommitment"],
  lists: new Set(["accountabilities", "bringMe", "notMine", "authorities", "responsibilities"]),
};

/** The roles as posted. */
export const POSTED: Record<string, Record<string, unknown>> = {
  r1: {
    name: "Kitchen keeper",
    aim: "Feed the village well.",
    domain: "The kitchen and its stores.",
    accountabilities: ["Meals on time", "A clean kitchen", "Stores counted"],
    bringMe: ["Food allergies"],
    runbook: "https://example.org/kitchen",
    timeCommitment: "30 hours a week",
  },
  r2: { name: "Orchard keeper", aim: "Keep the orchard bearing.", domain: "The orchard.", accountabilities: [], timeCommitment: "3 days a week" },
  r3: { name: "Gate keeper", aim: "Welcome every visitor.", domain: "The gate.", accountabilities: [] },
  r4: { name: "Water keeper", aim: "Keep the water clean.", accountabilities: [] },
  r5: { name: "Tool keeper", aim: "Keep the tools sharp.", accountabilities: [] },
  r6: { name: "Seed keeper", aim: "Keep our seeds.", accountabilities: [] },
};

export const CIRCLES: Record<string, { id: string; name: string }> = {
  r1: { id: "c-food", name: "Food circle" },
  r2: { id: "c-land", name: "Land circle" },
  r3: { id: "c-food", name: "Food circle" },
};

export interface DraftBody {
  roles: Array<{ roleId: string; words?: RoleWords; reviewOn?: string | null }>;
  newRoles?: Array<{ id: string; circleId: string; seats?: number; words: RoleWords; reviewOn?: string | null }>;
  settings?: SeatSettings;
  season?: { aim: string | null; seasonalGoals: Array<{ title: string; doneWhen: string | null }>; servesGoals: Array<{ goal: string; howItHelps: string | null }> };
}

export const OFF_SHARE: ShareOut = { on: false, audience: "members", link: null, token: null, anyoneReaches: true, anyoneNote: null };

export function consentOf(state: ConsentState, extra: Partial<ConsentOut> = {}): ConsentOut {
  const words: Record<ConsentState, string> = {
    open: "The circle is asked to consent or object by 6 November 2026.",
    objected: "A member of the circle objected, so the proposal goes to the circle's next meeting. It can still be adopted by a holder of the power that seats people.",
    consented: "Consented by the circle",
    lapsed: "The circle's 2 business days passed with no consent. It can still be adopted by a holder of the power that seats people.",
    "no-other-holders": "Nobody else holds a role in this circle, so the circle cannot consent. It is adopted by a holder of the power that seats people.",
  };
  return {
    state,
    words: words[state],
    closesAt: "2026-11-06T06:00:00.000Z",
    closesOn: "2026-11-06",
    asked: 2,
    consented: 0,
    objected: 0,
    objections: [],
    record: state === "consented" ? "Record the adoption" : null,
    you: { asked: false, answer: null, mayAnswer: false },
    ...extra,
  };
}

export function proposalWith(
  body: DraftBody,
  extra: Partial<ProposalOut> = {},
): ProposalOut {
  return {
    id: "rp-00000000000000a1",
    status: "draft",
    href: "/role-proposals/rp-00000000000000a1",
    target: { seasonId: "s3", name: "Season of Roots", startsOn: "2027-01-01", endsOn: "2027-03-31", ended: false },
    targetWords: null,
    orgGoals: ["Feed everyone", "Grow the orchard"],
    roles: body.roles.map((r) => {
      const fields = wordFields(POSTED[r.roleId] ?? null, r.words ?? {}, WORDS_CTX);
      return {
        roleId: r.roleId,
        name: String(POSTED[r.roleId]?.name ?? r.roleId),
        circle: CIRCLES[r.roleId] ?? null,
        live: true,
        fields,
        changedCount: fields.filter((f) => f.changed).length,
        reviewOn: r.reviewOn ?? null,
      };
    }),
    newRoles: (body.newRoles ?? []).map((r) => ({
      id: r.id,
      name: typeof r.words.name === "string" ? r.words.name : "",
      circle: { id: r.circleId, name: r.circleId === "c-land" ? "Land circle" : "Food circle" },
      seats: r.seats ?? 1,
      fields: wordFields(null, r.words, WORDS_CTX),
      reviewOn: r.reviewOn ?? null,
    })),
    limits: { maxRoles: 5 },
    frameworkTerms: true,
    settings: body.settings ?? { v: 1 },
    season: body.season ?? { aim: null, seasonalGoals: [], servesGoals: [] },
    share: OFF_SHARE,
    mayEdit: true,
    readyToSubmit: false,
    submitBlocked: "Write your aim for the season, then submit.",
    changesRoles: false,
    application: null,
    consent: null,
    decided: null,
    createdAt: "2026-10-22T18:00:00.000Z",
    updatedAt: "2026-10-22T18:00:00.000Z",
    submittedAt: null,
    ...extra,
  };
}

/** Play the PUT: each group sent replaces the stored one, the way the route does. */
export function answerPut(current: DraftBody, update: ProposalUpdate): DraftBody {
  let n = 0;
  return {
    roles: update.roles ? update.roles.map((r) => ({ roleId: r.roleId, words: r.words as RoleWords, reviewOn: r.reviewOn })) : current.roles,
    newRoles: update.newRoles
      ? update.newRoles.map((r) => ({ id: r.id ?? `role-00000000000${++n}`, circleId: r.circleId, seats: r.seats, words: r.words as RoleWords, reviewOn: r.reviewOn }))
      : current.newRoles,
    settings: update.settings ?? current.settings,
    season: update.season ?? current.season,
  };
}

// ── A fake of the routes the steps call ─────────────────────────────────────

export const ORG = {
  roles: [
    { id: "r1", name: "Kitchen keeper", circleId: "c-food", seats: 1, holderCount: 1, holders: [{ userId: "u-me" }] },
    { id: "r2", name: "Orchard keeper", circleId: "c-land", seats: 2, holderCount: 1, holders: [{ userId: "u-other" }] },
    { id: "r3", name: "Gate keeper", circleId: "c-food", seats: 1, holderCount: 1, holders: [{ userId: "u-other" }] },
    { id: "r4", name: "Water keeper", circleId: "c-land", seats: 1, holderCount: 0, holders: [] },
    { id: "r5", name: "Tool keeper", circleId: "c-land", seats: 1, holderCount: 0, holders: [] },
    { id: "r6", name: "Seed keeper", circleId: "c-land", seats: 1, holderCount: 0, holders: [] },
  ],
  circles: [
    { id: "c-food", name: "Food circle", purpose: "Everyone eats well." },
    { id: "c-land", name: "Land circle", purpose: "The land thrives." },
  ],
};

/** Other members' applications, read for counts: one for the orchard, and the reader's own for the gate. */
export const APPLICATIONS = [
  { status: "awaiting-holder", candidate: { id: "u-other-2" }, seats: [{ id: "r2" }] },
  { status: "awaiting-holder", candidate: { id: "u-me" }, seats: [{ id: "r3" }] },
  { status: "adopted", candidate: { id: "u-other-3" }, seats: [{ id: "r2" }] },
];

export const PROPOSAL_ID = "rp-00000000000000a1";
const BASE = `/api/governance/role-proposals/${PROPOSAL_ID}`;

export interface Asked {
  method: string;
  url: string;
  body: any;
}

/**
 * The routes the steps call, answering as the server would. `extra` is laid
 * over every proposal it answers with; `card` is the preview's payload.
 */
export function fakeServer(start: DraftBody, opts: { extra?: Partial<ProposalOut>; card?: unknown; comments?: unknown[]; whoApproves?: string } = {}) {
  let stored = start;
  let share: ShareOut = opts.extra?.share ?? OFF_SHARE;
  const asked: Asked[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const now = () => proposalWith(stored, { ...opts.extra, share });
  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    asked.push({ method, url, body });
    if (url === "/api/governance/role-applications") return json({ applications: APPLICATIONS });
    if (url === BASE && method === "PUT") {
      stored = answerPut(stored, body);
      return json({ proposal: now() });
    }
    if (url === BASE) return json({ proposal: now() });
    if (url === `${BASE}/card`) return json(opts.card ?? {});
    if (url === `${BASE}/comments`) return json({ comments: opts.comments ?? [] });
    if (url === `${BASE}/words`) {
      return json({ title: "Terms", body: "I hold Kitchen keeper on these terms.", money: false, intent: "x", ...(opts.whoApproves ? { whoApproves: opts.whoApproves } : {}) });
    }
    if (url === `${BASE}/share/regenerate`) {
      share = { ...share, on: true, audience: body?.audience ?? share.audience, token: "N".repeat(32), link: `/role-proposals/shared/${"N".repeat(32)}` };
      return json({ share });
    }
    if (url === `${BASE}/share` && method === "POST") {
      share = { ...share, on: true, audience: body?.audience ?? share.audience, token: share.token ?? "T".repeat(32), link: `/role-proposals/shared/${share.token ?? "T".repeat(32)}` };
      return json({ share });
    }
    if (url === `${BASE}/share` && method === "DELETE") {
      share = { ...share, on: false, token: null, link: null };
      return json({ share });
    }
    if (url === `${BASE}/submit`) {
      return json(
        {
          status: "awaiting-holder",
          proposal: proposalWith(stored, {
            ...opts.extra,
            status: "submitted",
            mayEdit: false,
            consent: consentOf("open"),
            application: { id: "sa-00000000000000b1", href: "/role-applications/sa-00000000000000b1" },
            submittedAt: "2026-11-04T15:00:00.000Z",
          }),
          seasonPlanSaved: true,
        },
        201,
      );
    }
    return json({});
  };
  return { fetch, asked, puts: () => asked.filter((a) => a.method === "PUT").map((a) => a.body as ProposalUpdate), stored: () => stored };
}
