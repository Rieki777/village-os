import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMemberDrivers,
  erasureIncomplete,
  erasureSentence,
  exportMemberEverywhere,
  forgetMemberEverywhere,
  registerMemberDriver,
  registeredMemberDrivers,
} from "./lib/memberDrivers";
import { integrationHealth } from "./lib/integrations";
import { looksLikeSubjectRef } from "./lib/subjectRefs";

/**
 * The failure mode IS the design here, so most of this file is about refusal.
 * A member must never be told "deleted" about a store that did not answer, and
 * an export that could not read a store must say so in the document.
 *
 * THE POOL HERE IS A STAND-IN, ON PURPOSE. These cases are about what the
 * village SAYS when a store answers or does not, and none of them is about the
 * subject-reference table. The stand-in keeps them a fast unit test with no
 * database. The reference behaviour itself, including the part that decides
 * whether a mapping survives a failed erasure, is covered against a real
 * database in `server/lib/memberDriverReferences.test.ts`.
 */
function standInPool() {
  const refs = new Map<string, string>();
  const pending: string[] = [];
  const pool = {
    async query(sql: string, params: any[] = []) {
      if (sql.startsWith("SELECT `ref`")) {
        const ref = refs.get(String(params[0]));
        return [ref ? [{ ref }] : []];
      }
      if (sql.startsWith("INSERT IGNORE INTO `subject_refs`")) {
        const [ref, userId] = params;
        if (!refs.has(String(userId))) refs.set(String(userId), String(ref));
        return [{}];
      }
      if (sql.startsWith("UPDATE `subject_refs`")) {
        // markErasurePending. Accepted and not modelled further: what it
        // WRITES is asserted against a real database in
        // server/lib/memberDriverReferences.test.ts, and these cases are about
        // what the village says rather than about the mapping table.
        pending.push(String(params[1]));
        return [{}];
      }
      if (sql.startsWith("DELETE FROM `subject_refs`")) {
        refs.delete(String(params[0]));
        return [{}];
      }
      // Loud rather than quiet, and NARROWER THAN IT LOOKS. This throws on any
      // query THESE TWO FUNCTIONS make that it does not model, so a new one in
      // forgetMemberEverywhere or exportMemberEverywhere breaks here and makes
      // somebody look. It guards nothing in the local sweep: this file never
      // calls anonymizeMember, so the roughly thirty queries in
      // server/lib/erasure.ts are covered by loop.e2e against a real database
      // and by nothing here. Those are different properties. A real database
      // says whether a query is CORRECT; this says whether anybody NOTICED a
      // new one went in, and only the first half of the erasure path has both.
      throw new Error(`the stand-in pool was asked something it does not model: ${sql}`);
    },
  } as any;
  return { pool, refs, pending };
}

let db = standInPool();

beforeEach(() => {
  clearMemberDrivers();
  db = standInPool();
});

describe("with nothing registered", () => {
  it("asks nobody and says so plainly", async () => {
    const out = await forgetMemberEverywhere(db.pool, "u1");
    expect(out).toEqual({ asked: [], confirmed: [], unconfirmed: [] });
    expect(erasureIncomplete(out)).toBe(false);
    expect(erasureSentence(out)).toContain("Nothing outside it held a copy");
  });

  it("exports an empty set of outside stores", async () => {
    expect(await exportMemberEverywhere(db.pool, "u1")).toEqual({ stores: {}, unavailable: [] });
  });
});

describe("a driver that confirms", () => {
  it("is handed an opaque reference and never the member id", async () => {
    let askedFor = "";
    registerMemberDriver("confirming", {
      forgetMember: async (id) => {
        askedFor = id;
        return { confirmed: true };
      },
      exportMember: async () => ({ rows: 2 }),
    });
    const out = await forgetMemberEverywhere(db.pool, "u42");

    // This assertion used to read `toBe("u42")`, which was the contract before
    // the reference scheme existed and was the thing the module library
    // contract had promised vendors would never happen.
    expect(askedFor).not.toBe("u42");
    expect(looksLikeSubjectRef(askedFor)).toBe(true);

    expect(out.confirmed).toEqual(["confirming"]);
    expect(out.unconfirmed).toEqual([]);
    expect(erasureIncomplete(out)).toBe(false);
    expect(erasureSentence(out)).toContain("confirmed the same");
  });
});

describe("a driver that refuses", () => {
  it("produces a visible failure and never a silent success", async () => {
    registerMemberDriver("refusing", {
      forgetMember: async () => ({ confirmed: false, detail: "deletion is queued for review" }),
      exportMember: async () => ({}),
    });
    const out = await forgetMemberEverywhere(db.pool, "u1");
    expect(out.confirmed).toEqual([]);
    expect(out.unconfirmed).toHaveLength(1);
    expect(out.unconfirmed[0].module).toBe("refusing");
    expect(out.unconfirmed[0].detail).toContain("queued for review");
    expect(erasureIncomplete(out)).toBe(true);
  });

  it("says the village is not finished, and never uses the word deleted about it", async () => {
    registerMemberDriver("refusing", {
      forgetMember: async () => ({ confirmed: false, detail: "no" }),
      exportMember: async () => ({}),
    });
    const sentence = erasureSentence(await forgetMemberEverywhere(db.pool, "u1"));
    expect(sentence).toContain("not confirmed yet");
    expect(sentence).toContain("not finished on your behalf");
  });

  it("lands in the health record as a failure, with a correlation id", async () => {
    registerMemberDriver("recorded", {
      forgetMember: async () => ({ confirmed: false, detail: "not today" }),
      exportMember: async () => ({}),
    });
    await forgetMemberEverywhere(db.pool, "u1");
    const rec = integrationHealth("recorded", "forgetMember")!;
    expect(rec.lastFailureAt).toBeTruthy();
    expect(rec.lastSuccessAt).toBeNull();
    expect(rec.lastCorrelationId).toBeTruthy();
  });
});

describe("a driver that throws", () => {
  it("reads exactly the same as one that refused", async () => {
    registerMemberDriver("throwing", {
      forgetMember: async () => {
        throw new Error("connection reset");
      },
      exportMember: async () => {
        throw new Error("connection reset");
      },
    });
    const out = await forgetMemberEverywhere(db.pool, "u1");
    expect(out.unconfirmed[0].detail).toContain("connection reset");
    expect(erasureIncomplete(out)).toBe(true);
  });
});

describe("one driver refusing does not stop the others", () => {
  it("asks every registered store and reports each answer", async () => {
    registerMemberDriver("a-good", { forgetMember: async () => ({ confirmed: true }), exportMember: async () => 1 });
    registerMemberDriver("b-bad", {
      forgetMember: async () => {
        throw new Error("down");
      },
      exportMember: async () => {
        throw new Error("down");
      },
    });
    registerMemberDriver("c-good", { forgetMember: async () => ({ confirmed: true }), exportMember: async () => 3 });
    const out = await forgetMemberEverywhere(db.pool, "u1");
    expect(out.asked).toEqual(["a-good", "b-bad", "c-good"]);
    expect(out.confirmed).toEqual(["a-good", "c-good"]);
    expect(out.unconfirmed.map((u) => u.module)).toEqual(["b-bad"]);
  });

  it("hands every one of them the same reference", async () => {
    const seen: string[] = [];
    const remember = { forgetMember: async (id: string) => { seen.push(id); return { confirmed: true }; }, exportMember: async () => 1 };
    registerMemberDriver("one", remember);
    registerMemberDriver("two", remember);
    await forgetMemberEverywhere(db.pool, "u1");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(looksLikeSubjectRef(seen[0])).toBe(true);
  });
});

describe("the export", () => {
  it("names a store it could not read, so a partial file announces itself", async () => {
    registerMemberDriver("readable", { forgetMember: async () => ({ confirmed: true }), exportMember: async () => ({ notes: 4 }) });
    registerMemberDriver("unreadable", {
      forgetMember: async () => ({ confirmed: true }),
      exportMember: async () => {
        throw new Error("403 from the vendor");
      },
    });
    const out = await exportMemberEverywhere(db.pool, "u1");
    expect(out.stores).toEqual({ readable: { notes: 4 } });
    expect(out.unavailable).toHaveLength(1);
    expect(out.unavailable[0].module).toBe("unreadable");
    expect(out.unavailable[0].detail).toContain("403");
  });
});

describe("the registry itself", () => {
  it("refuses a second driver for the same module", () => {
    const driver = { forgetMember: async () => ({ confirmed: true }), exportMember: async () => null };
    registerMemberDriver("only-one", driver);
    expect(() => registerMemberDriver("only-one", driver)).toThrow(/already registered/);
    expect(registeredMemberDrivers()).toEqual(["only-one"]);
  });
});
