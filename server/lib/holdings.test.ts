/**
 * WHAT A MEMBER HAS AGAINST WHAT A MEMBER CAN SPEND.
 *
 * Rye's case, and the sentence is his: a member with seventy library credits
 * and fifty locked in a camera has twenty to spend and seventy to their name,
 * and the words they meet are "locked up with the Camera, return the camera to
 * unlock these tokens".
 *
 * Two halves here and they need different things. The FOLD is pure, so every
 * edge that is easy to get wrong on a live database is driven with no database
 * at all: a real zero against an empty state, a fully locked balance against a
 * spent one, a lock on a token whose balance row is gone. The READS are DB
 * backed, because the whole claim is that the four numbers come off the same
 * rows the reconciliation functions compare, and a fixture that invented the
 * rows would prove only that the fixture agrees with itself.
 *
 * The library case is driven through `reserveItem` and `settleLoan`, which are
 * the doors a member actually presses, so the escrow that appears is the
 * escrow the module took and the release at the end is the module's own.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { balanceOf, checkLedgerInvariants, loadTokenRegistry, memberAccount, postTransfer } from "./ledger";
import { toLedgerUnits } from "./economy";
import {
  LIBRARY_CREDIT,
  LIBRARY_ESCROW,
  LIBRARY_MINT,
  ensureLibraryToken,
  libraryHoldingsFor,
  reserveItem,
  settleLoan,
} from "./library";
import {
  foldHoldings,
  holdingFor,
  holdingsFor,
  lockedSentence,
  lockedShortfall,
  type TokenLock,
} from "./holdings";
import { loadVariables, setVariable } from "./variables";

const configured = testDbConfigured();
const DB_HEAVY = 420_000;

const lock = (over: Partial<TokenLock> = {}): TokenLock => ({
  source: "library-loan",
  ref: "loan-1",
  tokenSlug: LIBRARY_CREDIT,
  heldUnits: 5000,
  held: 50,
  itemName: "Camera",
  sentence: lockedSentence("Camera"),
  ...over,
});

// ── The half that needs no database ────────────────────────────────────────

describe("the founder's sentence", () => {
  it("says his words with the item named, and carries no trailing period", () => {
    expect(lockedSentence("Camera")).toBe(
      "locked up with the Camera, return the Camera to unlock these tokens",
    );
    expect(lockedSentence("Camera").endsWith(".")).toBe(false);
  });

  it("names the item as the shelf names it, model number and all", () => {
    // The departure from his capitalisation, kept deliberately. Lowercasing the
    // second occurrence reproduces his example exactly and prints "18v" for the
    // seeded catalogue's own drill, which is a mangled model number in a
    // sentence a member is being asked to act on.
    expect(lockedSentence("Cordless drill, 18V, two batteries")).toContain("18V, two batteries to unlock");
  });

  it("still says something when nothing named the item", () => {
    expect(lockedSentence("")).toBe("locked up with the item, return the item to unlock these tokens");
  });
});

describe("the fourth reading", () => {
  it("splits seventy into twenty to spend and seventy to their name", () => {
    const out = foldHoldings({ [LIBRARY_CREDIT]: 2000 }, [lock()]);
    const it_ = out[LIBRARY_CREDIT]!;
    expect(it_.spendableUnits).toBe(2000);
    expect(it_.lockedUnits).toBe(5000);
    expect(it_.totalUnits).toBe(7000);
    expect(it_.locks).toHaveLength(1);
    expect(it_.locks[0]!.sentence).toContain("return the Camera");
  });

  it("tells a real zero from a fully locked balance, which are different facts", () => {
    const zero = foldHoldings({ [LIBRARY_CREDIT]: 0 }, [])[LIBRARY_CREDIT]!;
    expect(zero.totalUnits).toBe(0);
    expect(zero.locks).toEqual([]);

    const allLocked = foldHoldings({ [LIBRARY_CREDIT]: 0 }, [lock()])[LIBRARY_CREDIT]!;
    expect(allLocked.spendableUnits).toBe(0);
    expect(allLocked.totalUnits).toBe(5000);
    // Both print zero spendable. Only one of them is a member with nothing.
    expect(allLocked.locks).toHaveLength(1);
  });

  it("keeps a lock whose balance row is gone, because that IS the fully locked case", () => {
    const out = foldHoldings({}, [lock()]);
    expect(Object.keys(out)).toEqual([LIBRARY_CREDIT]);
    expect(out[LIBRARY_CREDIT]!.totalUnits).toBe(5000);
  });

  it("sorts each lock under its own token and never pools them", () => {
    const out = foldHoldings({ credits: 100, [LIBRARY_CREDIT]: 0 }, [
      lock(),
      lock({ ref: "rdm-1", source: "redemption", tokenSlug: "credits", heldUnits: 700, held: 7 }),
    ]);
    expect(out[LIBRARY_CREDIT]!.lockedUnits).toBe(5000);
    expect(out.credits!.lockedUnits).toBe(700);
    expect(out.credits!.totalUnits).toBe(800);
  });
});

describe("why a spend is short", () => {
  const holding = () => foldHoldings({ [LIBRARY_CREDIT]: 2000 }, [lock()])[LIBRARY_CREDIT]!;

  it("says nothing at all when the member can afford it", () => {
    expect(lockedShortfall(holding(), 2000)).toBeNull();
  });

  it("hands back his sentence when the lock is what is in the way", () => {
    const said = lockedShortfall(holding(), 4000)!;
    // The amount, then his sentence. The token's DISPLAY name comes from the
    // registry and this half of the file deliberately loads none, so the
    // sentence is asserted and the name is not: `libraryHoldingsFor` below
    // reads it against a real registry and proves the whole string.
    expect(said.startsWith("50 ")).toBe(true);
    expect(said.endsWith("locked up with the Camera, return the Camera to unlock these tokens")).toBe(true);
  });

  it("stays quiet when the locks would not have covered it either", () => {
    // A member who is genuinely short is never sent to fetch an item that
    // would not have been enough. They get the ordinary sentence.
    expect(lockedShortfall(holding(), 9000)).toBeNull();
  });

  it("stays quiet when there is no lock, however short they are", () => {
    const bare = foldHoldings({ [LIBRARY_CREDIT]: 2000 }, [])[LIBRARY_CREDIT]!;
    expect(lockedShortfall(bare, 9000)).toBeNull();
  });

  it("names every item when more than one is out", () => {
    const two = foldHoldings({ [LIBRARY_CREDIT]: 0 }, [
      lock(),
      lock({ ref: "loan-2", itemName: "Broadfork", heldUnits: 2500, held: 25, sentence: lockedSentence("Broadfork") }),
    ])[LIBRARY_CREDIT]!;
    const said = lockedShortfall(two, 7000)!;
    expect(said).toContain("return the Camera to unlock these tokens");
    expect(said).toContain("return the Broadfork to unlock these tokens");
  });
});

// ── The half that reads the rows ───────────────────────────────────────────

describe.skipIf(!configured)("what the library actually holds", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const units = (human: number) => toLedgerUnits(LIBRARY_CREDIT, human);

  const member = async (id: string, human: number) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,'h')",
      [id, id, `${id}@examples.invalid`],
    );
    if (human > 0) {
      const r = await postTransfer(pool, {
        from: LIBRARY_MINT,
        to: memberAccount(id),
        tokenType: LIBRARY_CREDIT,
        amount: units(human),
        source: "library_intake",
        idempotencyKey: `seed:${id}:${human}`,
        description: "seed",
      });
      expect(r.ok, r.error).toBe(true);
    }
    return id;
  };

  /** An item on the shelf worth `creditValue`, which at 100% escrows the same. */
  const item = async (id: string, name: string, creditValue: number) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO library_items (id, name, status, credit_value) VALUES (?,?,'available',?)",
      [id, name, creditValue],
    );
    return id;
  };

  const conserves = async () => {
    expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    await loadTokenRegistry(pool);
    // Registered at BOOT by the library module and not by a migration.
    await ensureLibraryToken(pool);
    await loadTokenRegistry(pool);
    await loadVariables(pool);
  }, DB_HEAVY);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `library_item_events`"); // module-review-ok: scratch-schema teardown between cases
    await pool.query("DELETE FROM `library_loans`"); // module-review-ok: scratch-schema teardown between cases
    await pool.query("DELETE FROM `library_items`"); // module-review-ok: scratch-schema teardown between cases
    await pool.query("DELETE FROM `token_ledger`"); // module-review-ok: scratch-schema teardown, not a ledger write: value only ever moves here through postTransfer
    await pool.query("DELETE FROM `token_balances`"); // module-review-ok: scratch-schema teardown, not a ledger write: value only ever moves here through postTransfer
    await pool.query("DELETE FROM `users`"); // module-review-ok: scratch-schema teardown between cases
    await pool.query("DELETE FROM `game_variables`"); // module-review-ok: scratch-schema teardown between cases
    await loadVariables(pool);
    // The deposit is the item's whole credit value, which is what makes the
    // founder's arithmetic land exactly: 70 held, 50 locked in a 50 camera.
    await setVariable(pool, "library.escrow_pct", "100");
    // ZERO WEAR, so the release case is about the release and not about the
    // fee. The default is 5%, a normal return pays it into the library pool,
    // and that is a different mechanism with its own tests. Pinning it here
    // means "exactly what was held" can be asserted as an equality.
    await setVariable(pool, "library.usage_fee_pct", "0");
  });

  it("shows the held amount, the spendable amount, and his sentence naming the item", async () => {
    await member("wren", 70);
    await item("cam", "Camera", 50);

    const got = await reserveItem(pool, { itemId: "cam", userId: "wren" });
    expect(got.ok, got.ok ? undefined : (got as any).error).toBe(true);

    const mine = await libraryHoldingsFor(pool, "wren");
    expect(mine.spendable).toBe(20);
    expect(mine.locked).toBe(50);
    expect(mine.total).toBe(70);
    // The wire shape carries minor units beside the scale, which is what the
    // page divides by. `balance` is the old field and still means spendable.
    expect(mine.spendableUnits).toBe(units(20));
    expect(mine.balance).toBe(units(20));
    expect(mine.balanceDecimals).toBe(2);
    expect(mine.locks).toHaveLength(1);
    expect(mine.locks[0]!.sentence).toBe(
      "locked up with the Camera, return the Camera to unlock these tokens",
    );
    expect(mine.locks[0]!.held).toBe(50);

    // And the four numbers agree with the accounts they are read against.
    expect(await balanceOf(pool, memberAccount("wren"), LIBRARY_CREDIT)).toBe(units(20));
    expect(await balanceOf(pool, LIBRARY_ESCROW, LIBRARY_CREDIT)).toBe(units(50));
    await conserves();
  });

  it("refuses the next borrow with his sentence and not with a bare shortfall", async () => {
    await member("wren", 70);
    await item("cam", "Camera", 50);
    await item("fork", "Broadfork", 30);
    expect((await reserveItem(pool, { itemId: "cam", userId: "wren" })).ok).toBe(true);

    const refused = await reserveItem(pool, { itemId: "fork", userId: "wren" });
    expect(refused.ok).toBe(false);
    const said = (refused as any).error as string;
    expect(said).toContain("locked up with the Camera, return the Camera to unlock these tokens");
    expect(said).toContain("20 of yours are free");
    // The old sentence sent them to go and earn credits they already have.
    expect(said).not.toContain("Earn them by contributing items or work");
    // The shelf is unharmed by a refusal.
    const [rows] = await pool.query<any[]>("SELECT status FROM library_items WHERE id = 'fork'");
    expect(rows[0].status).toBe("available");
    await conserves();
  });

  it("still says the ordinary thing to a member who is simply short", async () => {
    await member("ash", 10);
    await item("cam", "Camera", 50);
    const refused = await reserveItem(pool, { itemId: "cam", userId: "ash" });
    expect(refused.ok).toBe(false);
    const said = (refused as any).error as string;
    expect(said).toContain("Earn them by contributing items or work");
    expect(said).not.toContain("unlock these tokens");
  });

  it("releases exactly what was held when the item comes back", async () => {
    await member("wren", 70);
    await item("cam", "Camera", 50);
    const got = await reserveItem(pool, { itemId: "cam", userId: "wren" });
    const loanId = (got as any).loanId as string;

    const settled = await settleLoan(pool, { loanId, outcome: "closed" });
    expect(settled.ok, settled.ok ? undefined : (settled as any).error).toBe(true);

    const mine = await libraryHoldingsFor(pool, "wren");
    expect(mine.spendable).toBe(70);
    expect(mine.locked).toBe(0);
    expect(mine.total).toBe(70);
    expect(mine.locks).toEqual([]);
    // EXACTLY what was held, read off both accounts and not off the return.
    expect(await balanceOf(pool, memberAccount("wren"), LIBRARY_CREDIT)).toBe(units(70));
    expect(await balanceOf(pool, LIBRARY_ESCROW, LIBRARY_CREDIT)).toBe(0);
    await conserves();
  });

  it("tells a member who has never held one from a member who spent theirs", async () => {
    await member("newcomer", 0);
    const empty = await holdingsFor(pool, "newcomer");
    // ABSENT, which is the empty state: no row was ever written for them.
    expect(empty[LIBRARY_CREDIT]).toBeUndefined();
    // And asking about the slug directly always answers, so a refusal can
    // still state a number.
    const asked = await holdingFor(pool, "newcomer", LIBRARY_CREDIT);
    expect(asked.total).toBe(0);
    expect(asked.locks).toEqual([]);

    await member("spender", 5);
    await postTransfer(pool, {
      from: memberAccount("spender"),
      to: LIBRARY_MINT,
      tokenType: LIBRARY_CREDIT,
      amount: units(5),
      source: "library_writeoff",
      idempotencyKey: "spent-it-all",
    });
    const spent = await holdingsFor(pool, "spender");
    // PRESENT and zero, which is a real zero and a different fact.
    expect(spent[LIBRARY_CREDIT]?.totalUnits).toBe(0);
  });
});
