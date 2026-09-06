/**
 * THE PAGE'S STATE VOCABULARY AGAINST THE ONE THE SERVER ACTUALLY SENDS.
 *
 * This exists because the drift it checks for shipped and was live. 0089 widened
 * `mechanics_proposals.status` from eight values to ten, adding `onsite_vote`
 * and `passed_onsite` for the village's own ballot. `GameMechanics.tsx` kept
 * eight and read `STATUS_COPY[p.status].cls` straight, so the first proposal
 * ever to reach the village's own vote returned `undefined` from that lookup
 * and threw inside the list. The whole page went to the error boundary, for
 * every member, signed in or not, and the crash was two hops from the ordinary
 * path: propose, gather support, open the ballot.
 *
 * NOTHING CAUGHT IT. `pnpm check` cannot: `Record<Union, T>` types the lookup
 * as total, so `STATUS_COPY[p.status]` is `T` and never `T | undefined`, and
 * the union was the thing that was wrong. The status arrives over HTTP as a
 * string, so the compiler is asserting a claim about the server rather than
 * checking one.
 *
 * So the check has to read the AUTHORITY and not the page's own belief:
 *   - proposal statuses come out of `drizzle/*.sql`, from the last migration
 *     to declare the column, because the database is what the route selects.
 *   - ballot statuses come out of `BallotRow` in `server/lib/ballots.ts`,
 *     because `ballots.status` is a varchar with a comment and that type is
 *     the only enumeration of it. Read as text, the way
 *     `shared/notificationKinds.test.ts` reads its producers out of source.
 *
 * A migration that adds an eleventh status fails this file, which is the point.
 *
 * THE SAME SHAPE BIT A SECOND TIME AND IN THE OTHER DIRECTION, so this file
 * now covers that too. `POST /api/admin/mechanics/proposals/:id/apply` accepts
 * FOUR statuses and its own comment says why the fourth is there: a proposal
 * the village carried at its own ballot is applied by the same human hand as a
 * Hypha-verified one. The page's apply button listed three, so a carried
 * proposal held by the auto-apply brake could be applied from no surface a
 * human uses. A hand-kept list agreeing with a route by memory is the same
 * defect as a hand-kept union agreeing with a column by memory, and the fix is
 * the same: read the authority.
 *
 * AND THE ROUTE WITH NO DOOR. `POST /api/governance/mechanics/:id/open-ballot`
 * shipped complete, tested, and called by nothing in `client/` at all, which
 * meant the shipped default posture (`governance.default_method` at `custom`)
 * had no way for a village to open its own vote. `check-route-reachability`
 * could not see it: that gate reads PAGE routes out of App.tsx and never looks
 * at API routes. So the door is asserted here, against the route's own path
 * read out of the server, next to the states it produces.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { STATUS_COPY, APPLYABLE, dialMatches } from "./GameMechanics";
import { ballotReturn } from "./gameMechanicsBallotCopy";

/*
 * The reading a village that never renamed anything would see. `ballotReturn`
 * became a function of the village's word for whoever runs it, so this file
 * binds the platform default once rather than restating it per assertion.
 */
const BALLOT_RETURN = ballotReturn("a Catalyst");

const ROOT = path.resolve(__dirname, "../../..");

/** The values the column can hold, off the LAST migration that declares it. */
function proposalStatusesFromMigrations(): string[] {
  const files = fs
    .readdirSync(path.join(ROOT, "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let last: string[] | null = null;
  let from = "";
  for (const f of files) {
    const sql = fs.readFileSync(path.join(ROOT, "drizzle", f), "utf8");
    // Both shapes that declare it: the CREATE TABLE body and every ALTER.
    const re = /mechanics_proposals[\s\S]{0,400}?`status`\s+enum\(([^)]*)\)|`status`\s+enum\(([^)]*)\)[\s\S]{0,80}?DEFAULT\s+'open'/gi;
    for (const m of sql.matchAll(re)) {
      const body = m[1] ?? m[2];
      if (!body || !/'draft'/.test(body)) continue;
      last = [...body.matchAll(/'([^']+)'/g)].map((v) => v[1]);
      from = f;
    }
  }
  if (!last) throw new Error("no mechanics_proposals status enum found in drizzle/");
  // eslint-disable-next-line no-console
  console.log(`[states] ${last.length} proposal status(es), last declared in ${from}`);
  return last;
}

/** The statuses the ONE apply route accepts, off the route's own refusal. */
function applyableFromRoute(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "server/index.ts"), "utf8");
  const at = src.indexOf('app.post("/api/admin/mechanics/proposals/:id/apply"');
  if (at < 0) throw new Error("the admin apply route was not found in server/index.ts");
  const guard = src.slice(at, at + 1200);
  const statuses = [...guard.matchAll(/p\.status !== "([a-z_]+)"/g)].map((m) => m[1]);
  if (statuses.length === 0) throw new Error("the apply route's status guard was not found");
  return statuses;
}

/** Every client file, so a route's doors can be counted the way a member finds them. */
function clientSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(path.join(ROOT, "client/src"));
  return out;
}

/** The values `ballots.status` can hold, off the row type that enumerates it. */
function ballotStatusesFromSource(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "server/lib/ballots.ts"), "utf8");
  const m = src.match(/status:\s*((?:"[a-z_]+"\s*\|\s*)+"[a-z_]+")\s*;/);
  if (!m) throw new Error("BallotRow's status union not found in server/lib/ballots.ts");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((v) => v[1]);
}

describe("the mechanics page speaks every state the server can send", () => {
  it("has a chip for every proposal status the database column allows", () => {
    const statuses = proposalStatusesFromMigrations();
    // The shape that failed: ten in the column, and the page must hold ten.
    expect(statuses).toContain("onsite_vote");
    expect(statuses).toContain("passed_onsite");
    const missing = statuses.filter((s) => !(s in STATUS_COPY));
    expect(missing, `no STATUS_COPY entry for: ${missing.join(", ")}`).toEqual([]);
  });

  it("offers the apply button for every status the apply route accepts", () => {
    const fromRoute = applyableFromRoute();
    // The shape that shipped: the route took passed_onsite and the page did
    // not, so a proposal the village carried had no door to the ledger.
    expect(fromRoute).toContain("passed_onsite");
    const missing = fromRoute.filter((s) => !APPLYABLE.has(s as never));
    expect(missing, `the apply route accepts these and the page has no button: ${missing.join(", ")}`).toEqual([]);
    // And the other way: a button offering a status the route refuses walks
    // an admin into a 409 with no way to know why.
    const extra = [...APPLYABLE].filter((s) => !fromRoute.includes(s));
    expect(extra, `the page offers apply for statuses the route refuses: ${extra.join(", ")}`).toEqual([]);
  });

  it("gives the village's own vote a door in the client, and not only in the tests", () => {
    const server = fs.readFileSync(path.join(ROOT, "server/index.ts"), "utf8");
    expect(server).toContain('app.post("/api/governance/mechanics/:id/open-ballot"');
    // Counted the way check-route-reachability counts a page door, on the
    // path the route is actually mounted at. It was zero when this shipped.
    const doors = clientSources().filter((s) => s.includes("/api/governance/mechanics/")).length;
    expect(doors, "no file in client/src calls the open-ballot route").toBeGreaterThan(0);
  });

  /**
   * AND THE FIELD WITH NO SENDER, which is the same defect one layer in.
   *
   * PR #93 shipped `answersObjectionId` on the open-ballot route: a proposer
   * naming the objection their amended proposal answers, so the objection's own
   * page can say "the proposal changed after this". The route reads it, refuses
   * a name it cannot honour with a sentence, and writes the edge. Nothing in
   * the client ever sent it, so the only way to reach the feature was curl.
   *
   * A route with no caller and a field with no sender fail the same way and are
   * invisible to the same gates, so they are asserted the same way, side by
   * side, off the server's own text.
   */
  it("gives the objection field a sender, and not only a reader", () => {
    const server = fs.readFileSync(path.join(ROOT, "server/index.ts"), "utf8");
    expect(server, "the route must still read the field").toContain("req.body?.answersObjectionId");
    const senders = clientSources().filter((s) => s.includes("answersObjectionId")).length;
    expect(senders, "no file in client/src sends answersObjectionId").toBeGreaterThan(0);
  });

  /**
   * A PICKER MAY ONLY OFFER WHAT THE SERVER WILL ACCEPT. Naming an objection
   * the route refuses walks a proposer into a refusal they could not have seen
   * coming, and the route's own comment says naming one is optional precisely
   * so a proposer who names nothing still opens. So the choices come from a
   * server route, never from a filter the page keeps in its head.
   */
  it("reads the answerable objections from the server", () => {
    const server = fs.readFileSync(path.join(ROOT, "server/index.ts"), "utf8");
    expect(server).toContain('app.get("/api/governance/objections/answerable"');
    const readers = clientSources().filter((s) => s.includes("/api/governance/objections/answerable")).length;
    expect(readers, "nothing in client/src asks which objections may be named").toBeGreaterThan(0);
  });

  it("has a reading for every way a ballot can end", () => {
    const statuses = ballotStatusesFromSource();
    expect(statuses).toContain("no_quorum");
    expect(statuses).toContain("withdrawn");
    const missing = statuses.filter((s) => !(s in BALLOT_RETURN));
    expect(missing, `no BALLOT_RETURN entry for: ${missing.join(", ")}`).toEqual([]);
  });

  it("never calls a missed quorum or a called-off vote a loss", () => {
    // The whole reason the close route was fixed. Words that would put a
    // verdict on a ballot that reached none, checked on the copy itself.
    const verdict = /\b(reject|rejected|fail|failed|lost|lose|defeat|denied|turned down|did not pass|voted down)\b/i;
    for (const key of ["no_quorum", "withdrawn"] as const) {
      const entry = BALLOT_RETURN[key];
      for (const [field, text] of Object.entries(entry)) {
        if (typeof text !== "string" || field === "cls") continue;
        expect(verdict.test(text), `BALLOT_RETURN.${key}.${field} reads as a verdict: ${text}`).toBe(false);
      }
    }
  });

  it("borrows the bell's words instead of minting a second set", () => {
    // Two surfaces describing one event two ways is the defect this lane
    // exists to avoid, so the page's phrases are checked against the
    // notification kinds a member meets first.
    const kinds = fs.readFileSync(path.join(ROOT, "shared/notificationKinds.ts"), "utf8");
    const noQuorumBlurb = kinds.match(/ballot_no_quorum:\s*\{[^}]*blurb:\s*"([^"]+)"/)?.[1] ?? "";
    const withdrawnBlurb = kinds.match(/ballot_withdrawn:\s*\{[^}]*blurb:\s*"([^"]+)"/)?.[1] ?? "";
    expect(noQuorumBlurb).toMatch(/too few/i);
    expect(withdrawnBlurb).toMatch(/called off/i);
    expect(BALLOT_RETURN.no_quorum.chip).toMatch(/too few/i);
    expect(BALLOT_RETURN.no_quorum.line).toMatch(/too few/i);
    expect(BALLOT_RETURN.withdrawn.chip).toMatch(/called off/i);
    expect(BALLOT_RETURN.withdrawn.line).toMatch(/called off/i);
  });

  it("puts the withdrawal rule where a member meets it, before the refusal", () => {
    // An opener may call off a ballot nobody has answered; once a vote stands
    // it takes proposal.decide or an admin (withdrawBallot, server/lib/ballots.ts).
    // The COPY says the village's word for that person, which is why this
    // reads the label passed in above rather than the platform's own "admin".
    const tip = BALLOT_RETURN.withdrawn.tip ?? "";
    expect(tip).toMatch(/proposal\.decide/);
    expect(tip).toMatch(/a Catalyst/);
    expect(tip.toLowerCase()).toContain("nobody has answered");
  });
});

describe("finding a dial you cannot name", () => {
  /*
   * R79's second half. The Dials list is every tunable rule in the Game, spread
   * over more than two dozen categories, every category shut, and no way to
   * search. A founder setting up a Game is opening drawers looking for a switch
   * whose key they have never seen. The exact count moves every round, so it is
   * deliberately not written down here.
   *
   * THE DESCRIPTION IS PART OF THE HAYSTACK, and that is the point of these
   * tests. Somebody hunting for the feedback switch types "bug report" or
   * "platform team" or "turn off sharing". The key is `platform.feedback_relay`
   * and the label says "Share bug reports and ideas with the platform team",
   * so a search over key and label alone answers some of those and silently
   * misses the rest. The word they are most likely to type, "relay", is the
   * one word a founder has no reason to know.
   */
  const relay = {
    key: "platform.feedback_relay",
    label: "Share bug reports and ideas with the platform team",
    description:
      "A copy of each bug report and idea reaches the platform team who maintain this software. Turn it off to keep feedback entirely local.",
    category: "Platform",
  };
  const quorum = {
    key: "governance.quorum_percent",
    label: "Quorum",
    description: "How much of the village has to answer a ballot for it to settle.",
    category: "Governance",
  };

  it("an empty search shows every dial", () => {
    expect(dialMatches(relay, "")).toBe(true);
    expect(dialMatches(quorum, "   ")).toBe(true);
  });

  it("matches the key", () => {
    expect(dialMatches(relay, "feedback_relay")).toBe(true);
  });

  it("matches the label", () => {
    expect(dialMatches(relay, "bug reports")).toBe(true);
  });

  it("matches words that live only in the description", () => {
    // "local" appears nowhere in the key, the label or the category.
    expect(`${relay.key} ${relay.label} ${relay.category}`.toLowerCase()).not.toContain("local");
    expect(dialMatches(relay, "local")).toBe(true);
    expect(dialMatches(quorum, "settle")).toBe(true);
  });

  it("matches the category, so a founder can open one part of the Game", () => {
    expect(dialMatches(quorum, "governance")).toBe(true);
  });

  it("ignores case and takes words in any order", () => {
    expect(dialMatches(relay, "PLATFORM Feedback")).toBe(true);
    expect(dialMatches(relay, "local bug")).toBe(true);
  });

  it("every word has to land, so a search narrows", () => {
    expect(dialMatches(quorum, "governance ballot")).toBe(true);
    expect(dialMatches(quorum, "governance feedback")).toBe(false);
    expect(dialMatches(relay, "quorum")).toBe(false);
  });
});
