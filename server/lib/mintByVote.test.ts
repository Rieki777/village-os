/**
 * MINTING BY VOTE (vote-path gap 8). Rye, 2026-11-06: "EVERYTHING can change
 * with the highest village vote."
 *
 * Two minting effects had no village path at all:
 *
 *  1. CREATING a minting rule. The change set could edit amount, ceiling and
 *     enabled on a rule that already existed, and nothing created one. No admin
 *     route creates one either: the seed is the only writer.
 *  2. DECIDING a manual mint request that waits for a second steward. Only an
 *     admin could sign or decline it, so a village with one admin, or with
 *     every admin gone, held a request nobody could ever decide.
 *
 * The rules pinned here:
 *
 *  - a new rule is validated by one function, at raise and again at landing,
 *    and it refuses every token the platform refuses to mint: Gratitude, a
 *    Hypha token, an example token, a token with no faucet;
 *  - a carried vote creates the rule disabled for this moon and live from the
 *    next, and a second landing writes nothing;
 *  - a carried vote on a mint request posts exactly once, through the same
 *    function the admin route calls, with the same idempotency key;
 *  - the person paid can never be the person who asked, the cap still binds,
 *    and a refusal writes nothing to the ledger.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  EXECUTABLE_ITEM_KINDS,
  priceChangeSet,
  pricingOf,
  validateChangeSet,
  type ChangeItem,
} from "./mechanics";
import { applyChangeSet, applyMechanicsProposal, changeSetSnapsToBoundary, WRITE_ORDER, type ChangesetDeps } from "./changeset";
import {
  isMintRuleCreateKey,
  isMintRuleKey,
  mintRuleCreateKey,
  mintRuleDraftProblem,
  mintRuleIdFor,
} from "../../shared/mintRuleKeys";
import { MINT_REQUEST, thresholdsForSubject } from "../../shared/ballotSubjects";
import { CRITICALITIES, type Criticality } from "../../shared/governanceEngine";

const rank = (c: Criticality): number => CRITICALITIES.indexOf(c);
import { loadVariables, setVariable } from "./variables";
import { balanceOf, loadTokenRegistry, memberAccount, registerToken } from "./ledger";
import { CREDITS, villageId } from "./economy";
import { currentCycleNumber } from "./gratitude-cycles";
import { newMintRuleProblem } from "./mintRuleCreate";
import { approveMintRequest, mintRequestCloser, putMintRequestToVillage, type MintRequestDeps } from "./mintRequests";
import type { BallotRow } from "./ballots";

const noPool = new Proxy({}, { get: () => { throw new Error("pool must not be touched when cooldown is off"); } }) as any;
const effective = () => "";

const create = (over: Partial<Record<"trigger" | "tokenSlug" | "amount" | "ceiling", string>> = {}): ChangeItem =>
  ({
    kind: "mint_rule_create",
    trigger: "proposal.accepted",
    tokenSlug: CREDITS,
    amount: "15",
    ceiling: "150",
    ...over,
  }) as ChangeItem;

// ── Unit: the pure half of the new rule's validation ────────────────────────

describe("a new minting rule's shape, checked without the registry", () => {
  it("accepts a work trigger with an amount and a ceiling", () => {
    expect(mintRuleDraftProblem({ trigger: "quest.completed", tokenSlug: "credits", amount: "10", ceiling: "100" })).toBeNull();
    expect(mintRuleDraftProblem({ trigger: "role.cycle", tokenSlug: "credits", amount: "from-source", ceiling: "100" })).toBeNull();
  });

  it("refuses a trigger the engine never reads a rule for", () => {
    const p = mintRuleDraftProblem({ trigger: "gratitude.given", tokenSlug: "credits", amount: "10", ceiling: "100" });
    expect(p).toContain("pays for");
  });

  it("refuses an amount of zero, a negative ceiling, and a slug that is not a slug", () => {
    expect(mintRuleDraftProblem({ trigger: "quest.completed", tokenSlug: "credits", amount: "0", ceiling: "100" })).toContain("greater than zero");
    expect(mintRuleDraftProblem({ trigger: "quest.completed", tokenSlug: "credits", amount: "5", ceiling: "-1" })).toContain("zero or more");
    expect(mintRuleDraftProblem({ trigger: "quest.completed", tokenSlug: "Credits; DROP", amount: "5", ceiling: "1" })).toContain("token");
  });

  it("files a new rule under a key no edit key and no dial can be mistaken for", () => {
    const key = mintRuleCreateKey("quest.completed", "credits");
    expect(isMintRuleCreateKey(key)).toBe(true);
    expect(isMintRuleKey(key)).toBe(false);
    expect(mintRuleIdFor("quest.completed", "credits")).toBe("rule-quest.completed-credits");
  });
});

describe("a new minting rule inside a change set", () => {
  it("is a kind this build can carry out, written after the edits to rules that exist", () => {
    expect(EXECUTABLE_ITEM_KINDS.has("mint_rule_create")).toBe(true);
    expect(WRITE_ORDER.indexOf("mint_rule_create")).toBeGreaterThan(WRITE_ORDER.indexOf("mint_rule"));
    expect(changeSetSnapsToBoundary([{ kind: "mint_rule_create", key: mintRuleCreateKey("quest.completed", "credits") }])).toBe(true);
  });

  it("is priced at the structural tier at least, under the minting subject's own floor", () => {
    const priced = pricingOf(create());
    expect(priced.subject).toBe("mint_rule");
    expect(rank(priced.criticality)).toBeGreaterThanOrEqual(rank("structural"));
    const set = priceChangeSet([create()], "custom", { unityPct: 0, quorumPct: 0 });
    expect(set.dials.quorumPct).toBeGreaterThanOrEqual(50);
  });

  it("is refused where the caller cannot check it against the registry", async () => {
    const { problems } = await validateChangeSet(noPool, [create()], effective, 0);
    expect(problems.map((p) => p.problem).join(" ")).toContain("new minting rule");
  });

  it("carries the registry's refusal through, word for word", async () => {
    const { problems, normalized } = await validateChangeSet(noPool, [create({ tokenSlug: "gratitude" })], effective, 0, undefined, {
      newMintRuleProblem: async () => "Gratitude is only ever sent",
    });
    expect(normalized).toEqual([]);
    expect(problems[0].problem).toBe("Gratitude is only ever sent");
  });

  it("normalises into a stored change that keeps its kind and every field", async () => {
    const { problems, normalized } = await validateChangeSet(noPool, [create({ amount: "15.0000" })], effective, 0, undefined, {
      newMintRuleProblem: async () => null,
    });
    expect(problems).toEqual([]);
    expect(normalized).toEqual([
      {
        key: mintRuleCreateKey("proposal.accepted", CREDITS),
        from: "",
        to: "15",
        kind: "mint_rule_create",
        trigger: "proposal.accepted",
        tokenSlug: CREDITS,
        amount: "15",
        ceiling: "150",
      },
    ]);
  });

  it("refuses to travel with a dial, and refuses the same new rule twice", async () => {
    const opts = { newMintRuleProblem: async () => null };
    const mixed = await validateChangeSet(noPool, [create(), { kind: "dial", key: "governance.vote_days", to: "9" } as ChangeItem], effective, 0, undefined, opts);
    expect(mixed.problems[0].problem).toContain("next moon");
    const twice = await validateChangeSet(noPool, [create(), create()], effective, 0, undefined, opts);
    expect(twice.problems.map((p) => p.problem).join(" ")).toContain("twice");
  });
});

// ── DB-backed: the registry, the landing, and the mint request ─────────────

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;
let ledgerKeys: string[] = [];

const deps = (): ChangesetDeps => ({
  pool,
  recordMechanicsChange: async (key) => {
    ledgerKeys.push(key);
  },
  reloadCaches: async () => {
    await loadVariables(pool);
  },
  sharedPasswordPosture: () => false,
});

const people: Record<string, { id: string; email: string; name: string }> = {
  "u-asker": { id: "u-asker", email: "asker@village.test", name: "Asker One" },
  "u-paid": { id: "u-paid", email: "paid@village.test", name: "Paid Two" },
};
const requestDeps = (): MintRequestDeps => ({
  pool,
  members: {
    byId: async (id: string) => (people[id] ? { ...people[id] } : null),
    update: async () => null,
  },
  notify: async () => undefined,
});

const setup = () => ({
  method: "custom" as const,
  dials: { unityPct: 50, quorumPct: 0 },
  snapshot: { mode: "equal" as const, token: null },
  tokenProblem: null,
  electorate: [{ userId: "u-asker", weight: 1 }, { userId: "u-paid", weight: 1 }],
  durationDays: 3,
});

async function pendingRequest(id: string, over: { to?: string; by?: string; amount?: number; token?: string } = {}): Promise<void> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO admin_mint_requests (id, token_slug, to_user_id, amount, reason, requested_by, status) VALUES (?,?,?,?,?,?,'pending')",
    [id, over.token ?? CREDITS, over.to ?? "u-paid", over.amount ?? 40, "for the barn raising", over.by ?? "u-asker"],
  );
}

async function requestRow(id: string): Promise<any> {
  const [rows] = await pool.query<any[]>("SELECT * FROM admin_mint_requests WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows[0];
}

async function ledgerRowsFor(key: string): Promise<number> {
  const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM token_ledger WHERE idempotency_key = ?", [key]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return Number(rows[0].n);
}

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
  await loadVariables(pool);
  await registerToken(pool, { slug: "hypha-share", name: "Hypha Share", kind: "credit", governance: "hypha", transferable: false });
  await registerToken(pool, { slug: "show-credit", name: "Show Credit", kind: "credit", governance: "platform", transferable: false });
  await pool.query("UPDATE tokens SET is_example = 1 WHERE slug = 'show-credit'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  await loadTokenRegistry(pool);
  await setVariable(pool, "ledger.admin_mint_cycle_cap", "1000");
}, 300000);

afterAll(async () => {
  if (pool) await pool.end();
  if (db) await db.drop();
});

beforeEach(async () => {
  if (!configured) return;
  ledgerKeys = [];
  await pool.query("DELETE FROM governance_element_ledger"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  await pool.query("DELETE FROM mint_rules WHERE `trigger` = 'proposal.accepted' AND token_slug = ?", [CREDITS]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
});

describe.skipIf(!configured)("the registry's half of a new rule", () => {
  it("refuses every token the platform refuses to mint", async () => {
    const base = { trigger: "proposal.accepted", amount: "5", ceiling: "50" };
    expect(await newMintRuleProblem(pool, { ...base, tokenSlug: "gratitude" })).toContain("Gratitude");
    expect(await newMintRuleProblem(pool, { ...base, tokenSlug: "hypha-share" })).toContain("Hypha");
    expect(await newMintRuleProblem(pool, { ...base, tokenSlug: "show-credit" })).toContain("example");
    expect(await newMintRuleProblem(pool, { ...base, tokenSlug: "no-such-token" })).toContain("no token");
  });

  it("refuses an amount the token cannot hold, which the admin edit route also refuses", async () => {
    const p = await newMintRuleProblem(pool, { trigger: "proposal.accepted", tokenSlug: CREDITS, amount: "0.001", ceiling: "50" });
    expect(p).toContain("smallest");
  });

  it("refuses a rule the village already has, so a create can never overwrite one", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO mint_rules (id, village_id, `trigger`, token_slug, amount, ceiling, recipient, enabled) VALUES (?,?,?,?,?,?,?,1)",
      ["rule-existing-x", villageId(), "proposal.accepted", CREDITS, 25, 250, "claimant"],
    );
    expect(await newMintRuleProblem(pool, { trigger: "proposal.accepted", tokenSlug: CREDITS, amount: "5", ceiling: "50" })).toContain("already");
  });

  it("accepts a payable token on a trigger that has no rule for it", async () => {
    expect(await newMintRuleProblem(pool, { trigger: "proposal.accepted", tokenSlug: CREDITS, amount: "5", ceiling: "50" })).toBeNull();
  });
});

describe.skipIf(!configured)("a carried vote creates a minting rule", () => {
  const stored = async () => {
    const { problems, normalized } = await validateChangeSet(pool, [create()], effective, 0, undefined, {
      newMintRuleProblem: (d) => newMintRuleProblem(pool, d),
    });
    expect(problems).toEqual([]);
    return normalized;
  };

  it("lands the rule live from the next moon, and a second landing writes nothing", async () => {
    const changeSet = await stored();
    const proposal = { id: "gmp-create", title: "Pay credits for accepted proposals", changeSet, proposerUserId: "u-asker", hyphaRef: null, status: "onsite_vote", ballotId: "bal-create" };
    const first = await applyMechanicsProposal(deps(), proposal, null, { onApplied: async () => undefined });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const key = mintRuleCreateKey("proposal.accepted", CREDITS);
    expect(first.queued).toEqual([key]);

    const [rows] = await pool.query<any[]>("SELECT * FROM mint_rules WHERE `trigger` = 'proposal.accepted' AND token_slug = ?", [CREDITS]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows).toHaveLength(1);
    expect(String(rows[0].id)).toBe(mintRuleIdFor("proposal.accepted", CREDITS));
    expect(Number(rows[0].amount)).toBe(15);
    expect(Number(rows[0].ceiling)).toBe(150);
    expect(String(rows[0].recipient)).toBe("claimant");
    expect(Number(rows[0].effective_from_cycle)).toBe(currentCycleNumber(new Date()) + 1);

    const again = await applyChangeSet(deps(), { ballotId: "bal-create", proposalRef: "gm:gmp-create", actor: null, changes: changeSet });
    expect(again.ok, JSON.stringify(again)).toBe(true);
    const [after] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM mint_rules WHERE `trigger` = 'proposal.accepted' AND token_slug = ?", [CREDITS]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(after[0].n)).toBe(1);
    expect(ledgerKeys.filter((k) => k === key), "one amendment ledger row for one new rule").toHaveLength(1);
  });

  it("CONTROL: a stored vote to mint Gratitude is refused at landing and writes nothing", async () => {
    const changes = [{ kind: "mint_rule_create", key: mintRuleCreateKey("proposal.accepted", "gratitude"), from: "", to: "5", trigger: "proposal.accepted", tokenSlug: "gratitude", amount: "5", ceiling: "50" }];
    const result = await applyChangeSet(deps(), { ballotId: "bal-heart", proposalRef: "gm:heart", actor: null, changes: changes as any });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.failed)).toContain("Gratitude");
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM mint_rules WHERE token_slug = 'gratitude' AND `trigger` = 'proposal.accepted'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(rows[0].n)).toBe(0);
    expect(ledgerKeys).toEqual([]);
  });
});

describe.skipIf(!configured)("a carried vote decides a mint request", () => {
  it("approves it, moves the recipient's balance exactly once, and a second landing is idempotent", async () => {
    await pendingRequest("amr-vote-1");
    const opened = await putMintRequestToVillage(requestDeps(), { requestId: "amr-vote-1", openedBy: "u-paid", setup: setup() });
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    const ballot = (opened as { ballot: BallotRow }).ballot;
    expect(ballot.subjectType).toBe(MINT_REQUEST);

    const before = await balanceOf(pool, memberAccount("u-paid"), CREDITS);
    const closer = mintRequestCloser(requestDeps());
    const first = await closer.execute!(ballot, "u-paid");
    expect(first.held, JSON.stringify(first)).toBeNull();
    expect(first.applied).toEqual(["mint_request:amr-vote-1"]);
    const mid = await balanceOf(pool, memberAccount("u-paid"), CREDITS);
    expect(mid - before).toBeGreaterThan(0);

    const second = await closer.execute!(ballot, "u-paid");
    expect(second.held, JSON.stringify(second)).toBeNull();
    expect(await balanceOf(pool, memberAccount("u-paid"), CREDITS)).toBe(mid);
    expect(await ledgerRowsFor("admin_mint:req:amr-vote-1")).toBe(1);
    const row = await requestRow("amr-vote-1");
    expect(String(row.status)).toBe("approved");
    expect(String(row.decided_by)).toBe(`village:${ballot.id}`);
  });

  it("a vote that does not carry declines it, and the decision is recorded", async () => {
    await pendingRequest("amr-vote-no");
    const opened = await putMintRequestToVillage(requestDeps(), { requestId: "amr-vote-no", openedBy: "u-paid", setup: setup() });
    const ballot = (opened as { ballot: BallotRow }).ballot;
    await mintRequestCloser(requestDeps()).settle(ballot, "failed", "The village said no.", "u-paid");
    const row = await requestRow("amr-vote-no");
    expect(String(row.status)).toBe("declined");
    expect(String(row.decided_by)).toBe(`village:${ballot.id}`);
    expect(await ledgerRowsFor("admin_mint:req:amr-vote-no")).toBe(0);
  });

  it("too few voting leaves it waiting, neither approved nor declined", async () => {
    await pendingRequest("amr-vote-quiet");
    const opened = await putMintRequestToVillage(requestDeps(), { requestId: "amr-vote-quiet", openedBy: "u-paid", setup: setup() });
    const ballot = (opened as { ballot: BallotRow }).ballot;
    await mintRequestCloser(requestDeps()).settle(ballot, "no_quorum", "", "u-paid");
    expect(String((await requestRow("amr-vote-quiet")).status)).toBe("pending");
  });

  it("CONTROL: a request that pays the person who asked is refused at the door and at the landing, and writes nothing", async () => {
    await pendingRequest("amr-self", { to: "u-asker", by: "u-asker" });
    const refused = await putMintRequestToVillage(requestDeps(), { requestId: "amr-self", openedBy: "u-paid", setup: setup() });
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).toContain("self_grant_refused");

    const ballot = { id: "bal-self", subjectType: MINT_REQUEST, subjectRef: "amr-self", openedBy: "u-paid", title: "t" } as BallotRow;
    const landed = await mintRequestCloser(requestDeps()).execute!(ballot, "u-paid");
    expect(landed.applied).toEqual([]);
    expect(landed.held).toContain("pays the steward who asked");
    expect(await ledgerRowsFor("admin_mint:req:amr-self")).toBe(0);
    expect(String((await requestRow("amr-self")).status)).toBe("pending");
  });

  it("CONTROL: the per-cycle cap still binds a carried vote, and the claim is put back", async () => {
    await pendingRequest("amr-over", { amount: 5000 });
    const ballot = { id: "bal-over", subjectType: MINT_REQUEST, subjectRef: "amr-over", openedBy: "u-paid", title: "t" } as BallotRow;
    const landed = await mintRequestCloser(requestDeps()).execute!(ballot, "u-paid");
    expect(landed.applied).toEqual([]);
    expect(landed.held).toContain("cap");
    expect(await ledgerRowsFor("admin_mint:req:amr-over")).toBe(0);
    const row = await requestRow("amr-over");
    expect(String(row.status)).toBe("pending");
    expect(row.decided_by).toBeNull();
  });

  it("the admin door asks the same function, and is held while the village votes", async () => {
    await pendingRequest("amr-frozen");
    const opened = await putMintRequestToVillage(requestDeps(), { requestId: "amr-frozen", openedBy: "u-paid", setup: setup() });
    expect(opened.ok).toBe(true);
    const signed = await approveMintRequest(requestDeps(), { requestId: "amr-frozen", signer: "u-steward", decidedBy: "u-steward" });
    expect(signed.ok).toBe(false);
    expect(JSON.stringify(signed)).toContain("village is voting");
    expect(await ledgerRowsFor("admin_mint:req:amr-frozen")).toBe(0);
  });

  it("the threshold a mint request asks is the structural tier at least", () => {
    const t = thresholdsForSubject(MINT_REQUEST);
    expect(t).not.toBeNull();
    expect(rank(t!.criticality ?? "routine")).toBeGreaterThanOrEqual(rank("structural"));
  });
});
