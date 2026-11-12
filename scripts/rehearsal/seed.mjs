/**
 * Seeds a made-up example village for the rehearsal, through the same routes a
 * founder uses, on a freshly migrated scratch schema.
 *
 * Every name here is invented and belongs to no real village or person. The
 * village is called "Example Village" and every address is on example.test,
 * which no mail server will ever accept.
 *
 * What it builds, and why each piece is there:
 *   - A founder, aligned with the membership letter, seated as the Welcome
 *     Steward: the steward who reads proposals and decides (persona 4).
 *   - The public pages on, with the platform's own words (no village's prose).
 *   - A season with four goals (one reached, so the commons shows moss) and the next one empty, and "this moon" open
 *     with a public link, so the open form has something to propose for.
 *   - Three circles and four roles. The Finance Steward carries written terms,
 *     so the counter-offer has something to change. Two seats each on the
 *     roles proposed for, because each persona walks once at 390 and once at
 *     1280 and both adoptions must land in an open seat.
 *   - A confidentiality agreement and the two "before your role starts" dials,
 *     so the new holder's first hour has its real steps (persona 5).
 *   - Two existing members, one per viewport, made through invitations, so the
 *     member's proposal walk (persona 3) starts from a fresh draft each time.
 */
import mysql from "mysql2/promise";

const civil = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export const PEOPLE = {
  founder: { email: "founder@example.test", name: "Wren Alder", password: "RehearsalFounder123!" },
  memberPhone: { email: "member.phone@example.test", name: "Juniper Hale", password: "RehearsalMember123!" },
  memberDesktop: { email: "member.desktop@example.test", name: "Rowan Pike", password: "RehearsalMember123!" },
};

const TERMS_WORDS = {
  term: "We renew together each moon. The first three are a trial for both of us.",
  clocks: "Full commitment. You manage your own workload, and we reply to each other within one working day.",
  rhythm: "We plan the week together on Monday and close it on Friday.",
  allowance: "A small allowance for tools each moon, agreed ahead of time.",
  bonus: "A share of the moon's value when its goals are met. We shape the exact mix with you.",
  goals: "Three to five goals each moon, each with a done when.",
  scoreboard: "The measures on the role card.",
  ending: "Either of us can end it with one moon's notice and a handover note.",
};

export async function seedVillage({ base, dbUrl, adminPassword, log = () => {} }) {
  let ipCounter = 0;
  const call = async (method, route, body, token) => {
    const res = await fetch(base + route, {
      method,
      headers: {
        "x-forwarded-for": `10.200.0.${(ipCounter++ % 250) + 1}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (res.status >= 400) throw new Error(`seed: ${method} ${route} answered ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  };
  const state = { roles: {} };

  // The founder.
  const boot = await call("POST", "/api/admin/bootstrap", { password: adminPassword, email: PEOPLE.founder.email, name: PEOPLE.founder.name });
  const claim = decodeURIComponent(String(boot?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const claimed = await call("POST", "/api/auth/set-password", { token: claim, password: PEOPLE.founder.password });
  const F = (state.founder = claimed.token);
  state.founderId = claimed.user.id;

  // The letter carries the village's name, so it is read fresh at each signing.
  const align = async (who, token) => {
    const letter = await call("GET", "/api/membership-letter");
    const signed = await call(
      "POST",
      "/api/forms/submit",
      {
        type: "membership-508",
        data: { name: who.name, email: who.email, phone: "", paths: ["resident"], why: "Founding.", monthlyContribution: "", acknowledgedGoodNeighbor: true, acknowledgedCommitments: true, signedAt: new Date().toISOString(), letterVersion: String(letter?.version ?? "") },
      },
      token,
    );
    await call("PUT", `/api/admin/submissions/${signed.id}/status`, { status: "accepted" }, F);
  };
  await align(PEOPLE.founder, F);
  await call("POST", "/api/admin/roles/steward-circle/holders", { userId: state.founderId, action: "add" }, F);

  // Identity, modules, the season and this moon.
  await call("PUT", "/api/admin/brand", { project: { name: "Example Village", tagline: "A small village that grows food and looks after its river" }, theme: { seed: "#1d3a30" } }, F);
  await call("PUT", "/api/admin/brochure-pages", { enabled: true }, F);
  for (const m of ["governance"]) await call("PUT", `/api/admin/modules/${m}/lifecycle`, { lifecycle: "public" }, F);
  const cfg = await call("GET", "/api/admin/seasons", undefined, F);
  const now = Date.now();
  await call(
    "PUT",
    "/api/admin/seasons",
    {
      ...cfg,
      seasons: [
        {
          id: "season-1",
          name: "Season of Roots",
          startsOn: civil(now - 60 * DAY),
          endsOn: civil(now + 60 * DAY),
          goals: ["A thriving community", "Clean water all year", "Shared meals every week", "Clear and trusted money"].map((text) => ({ text, done: text === "Shared meals every week" })),
        },
        { id: "season-2", name: "", startsOn: civil(now + 61 * DAY), endsOn: civil(now + 150 * DAY), goals: [] },
      ],
    },
    F,
  );
  await call("PUT", "/api/admin/open-proposals/settings", { term: "moon", publicLink: true }, F);

  // Circles and roles.
  for (const [id, name] of [["anchor", "Anchor Circle"], ["land", "Land and Water Circle"], ["hearth", "Hearth Circle"]]) await call("POST", "/api/admin/circles", { id, name }, F);
  const role = async (name, circleId, seats, aim, accountabilities, whyItMatters = null) => {
    const r = await call("POST", "/api/admin/org/roles", { name, circleId, seats }, F);
    await call("PUT", `/api/admin/org/roles/${r.id}`, { name, circleId, seats, aim, accountabilities, whyItMatters }, F);
    return r.id;
  };
  state.roles.welcome = await role("Welcome Steward", "anchor", 1, "Every person who joins is welcomed, held and clear.", ["A kind first fourteen days for every new holder"]);
  state.roles.finance = await role("Finance Steward", "anchor", 2, "Our money is clear and trusted, so every circle can plan.", ["A weekly view of our money", "Bills paid on time"], "Clear money lets every circle plan with confidence.");
  state.roles.land = await role("Land Steward", "land", 2, "The land and the river are read and tended each moon.", ["A walk of the land each moon", "Water readings kept"], "The land holds us. Someone listens to it every week.");
  state.roles.kitchen = await role("Kitchen Keeper", "hearth", 1, "We eat together, simply and well.", ["One shared meal a week"], "Shared meals are where a village becomes one.");

  const db = await mysql.createConnection(dbUrl);
  try {
    await db.query("UPDATE org_roles SET terms_offer = ?, time_commitment = ? WHERE id = ?", [
      JSON.stringify({ v: 1, clocks: { commitmentPct: 100 }, words: TERMS_WORDS }),
      "Full commitment",
      state.roles.finance,
    ]);
    // The roots the board's work grows from (the five archetypes as roots). The
    // starter quests are examples, which the roots route refuses, so the seed
    // writes them here the way a founder's tags would read: a few quests on
    // each root, and some left untagged, so the holder's filter has something
    // to keep and something to set aside.
    const [quests] = await db.query("SELECT id FROM quests ORDER BY sort_order, id");
    const cycle = [["building"], ["storytelling", "catalyzing"], ["facilitating"], ["researching", "building"], []];
    for (const [i, q] of quests.entries()) {
      await db.query("UPDATE quests SET archetypes = ?, archetypes_suggested = 0 WHERE id = ?", [JSON.stringify(cycle[i % cycle.length]), q.id]);
    }
    await db.query("UPDATE org_roles SET archetypes = ?, archetypes_suggested = 0 WHERE id = ?", [JSON.stringify(["researching", "catalyzing", "building"]), state.roles.finance]);
    await db.query("UPDATE org_roles SET archetypes = ?, archetypes_suggested = 0 WHERE id = ?", [JSON.stringify(["building", "researching"]), state.roles.land]);
  } finally {
    await db.end();
  }
  await call("POST", `/api/admin/org/roles/${state.roles.welcome}/holders`, { userId: state.founderId, action: "add" }, F);

  // Phase A: the founding team leads /roles with two paid roles, each card with its founding sections,
  // the village's default split under it and a ceiling on the Finance Steward. Made-up words and figures.
  for (const [k, v] of [
    ["org.founding_team", true],
    ["org.founding_team_roles", `${state.roles.finance}, ${state.roles.land}`],
    ["org.pay_shape", "cash 40, equity 55, village credits 5"],
    ["org.pay_shape_at_risk", "Part of the pay grows with what the village raises."],
    ["org.pay_shape_note", "Indicative only. Terms are still being defined and are subject to legal review."],
  ]) await call("PUT", `/api/admin/variables/${k}`, { value: v }, F);
  await call(
    "POST",
    `/api/org/role-edit/${state.roles.finance}`,
    {
      sections: {
        paid: true,
        idealBackground: ["Ideally a background in finance", "Experience we'd love to see: shared land models"],
        qualities: ["Holds the whole domain", "In it for the long run"],
        aiCompanion: "Heron",
        aiSupport: "An AI companion keeps the daily books moving, so the steward's time goes to the model.",
        payCeiling: { amount: 5000, currency: "USD", per: "month" },
        paySplitNote: "To be decided in the onboarding process.",
      },
    },
    F,
  );

  // The new holder's first steps.
  await call("PUT", "/api/admin/content/confidentiality", { title: "Confidentiality agreement", body: "What you read in our private records stays with you.\n\nYou keep it after you leave." }, F);
  for (const k of ["org.start_after_confidentiality", "org.start_after_membership"]) await call("PUT", `/api/admin/variables/${k}`, { value: true }, F);
  // Our review comes before the conversations (Phase A), with a way to stay close the not-invited letter names.
  await call("PUT", "/api/admin/variables/org.review_before_conversations", { value: true }, F);
  await call("PUT", "/api/admin/variables/org.stay_close_name", { value: "Friends of the Village" }, F);
  await call("PUT", "/api/admin/variables/org.stay_close_link", { value: "/resident" }, F);

  // Two existing members, one per viewport.
  for (const key of ["memberPhone", "memberDesktop"]) {
    const who = PEOPLE[key];
    const inv = await call("POST", "/api/invites", { email: who.email, name: who.name }, F);
    const invite = inv?.token ?? new URLSearchParams(String(inv?.path ?? "").split("?")[1] ?? "").get("invite");
    const reg = await call("POST", "/api/auth/register", { name: who.name, email: who.email, password: who.password, paths: ["resident"], invite });
    state[key] = reg.token;
    await align(who, reg.token);
  }
  log(`seeded: founder, ${Object.keys(state.roles).length} roles, 2 members`);
  return state;
}
