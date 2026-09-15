/**
 * JOINING BY INVITATION, DRIVEN THROUGH THE BUILT SERVER.
 *
 * Rye's ruling, 2026-09-09: an account is made with an invitation link a member
 * sent, and anybody else can look around and ask to join. This is the one
 * suite that provisions the village the way the platform ships it, with
 * `membership.invite_only` on. `ProvisionOptions.inviteOnly` in
 * `server/db/testDb.ts` says why every other suite opens the door.
 *
 * Every refusal sits in the same case as somebody the same door lets in, so a
 * door that refused everybody fails here as loudly as one that refused nobody.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[invites.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 5400 + (process.pid % 200);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "invites-admin";
const PASSWORD = "Invitations123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
/** Arrived through the founder's first link. A guest, so no vouch of their own to give. */
let wrenToken = "";
let wrenId = "";
/** The token Wren arrived on, kept to prove it works once. */
let wrenLink = "";

interface Answer { status: number; json: any }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sign up by email, with or without a link. Asserts nothing: each case says what should happen. */
const signUp = (name: string, handle: string, invite?: string) =>
  call("POST", "/api/auth/register", {
    token: null,
    body: {
      name,
      email: `${handle}-${PORT}@example.test`,
      password: PASSWORD,
      paths: ["resident"],
      ...(invite === undefined ? {} : { invite }),
    },
  });

/** A link made by whoever holds `token`, read back into the id and token it carries. */
async function makeInvite(token = founderToken): Promise<{ id: string; token: string }> {
  const made = await call("POST", "/api/invites", { token });
  expect(made.status, JSON.stringify(made.json)).toBe(200);
  const invite = new URL(String(made.json?.path ?? ""), BASE).searchParams.get("invite") ?? "";
  expect(invite, "the link carries a token").toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { id: String(made.json.id), token: invite };
}

/** How many accounts hold an address, read from the table rather than from the refusal. */
async function accountsFor(handle: string): Promise<number> {
  const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM users WHERE email = ?", [`${handle}-${PORT}@example.test`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the invitation test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-invites-"));
  testDb = await provisionTestDb({ inviteOnly: true });
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler, for the reason selfMembership.routes.e2e.test.ts gives.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "invites-secret",
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s. Output:\n${logs.join("")}`);
    }
    try {
      const res = await fetch(`${BASE}/health`); // module-review-ok: the boot poll against the local test server
      if (res.ok) break;
    } catch { /* not up yet */ }
    await settle(400);
  }

  const boot = await call("POST", "/api/admin/bootstrap", {
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Invitations Founder" },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", {
    body: { token: claim, password: PASSWORD },
    token: null,
  });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("a village that joins by invitation", () => {
  it("says so to anybody who asks, before they have an account", async () => {
    const methods = await call("GET", "/api/auth/methods", { token: null });
    expect(methods.status).toBe(200);
    expect(methods.json?.inviteOnly).toBe(true);
  });

  it("refuses an account nobody invited, and says nothing about whose address it is", async () => {
    const stranger = await signUp("Mallory Vane", "mallory");
    expect(stranger.status, JSON.stringify(stranger.json)).toBe(403);
    expect(stranger.json?.code).toBe("invitation_required");
    expect(String(stranger.json?.error)).toContain("by invitation");
    expect(await accountsFor("mallory")).toBe(0);

    // The founder's own address, with no link, meets the same refusal. It never
    // hears "Email already exists", which would answer a stranger's question
    // about a member.
    const probe = await call("POST", "/api/auth/register", {
      token: null,
      body: { name: "Probe", email: `founder-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
    });
    expect(probe.status).toBe(403);
    expect(String(probe.json?.error)).not.toContain("exists");
  });

  it("opens for the one person holding a link, and records the inviter's vouch", async () => {
    const link = await makeInvite();
    wrenLink = link.token;
    const check = await call("GET", `/api/invites/check?token=${link.token}`, { token: null });
    expect(check.json).toMatchObject({ inviteOnly: true, valid: true, invitedBy: "Invitations", daysLeft: 14 });

    const wren = await signUp("Wren Ashby", "wren", link.token);
    expect(wren.status, JSON.stringify(wren.json)).toBe(200);
    wrenToken = String(wren.json?.token ?? "");
    wrenId = String(wren.json?.user?.id ?? "");
    expect(wrenToken, "the new account holds a session").toBeTruthy();

    const vouches = await call("GET", `/api/members/${wrenId}/vouches`);
    expect(vouches.status).toBe(200);
    expect(vouches.json?.vouches).toEqual([{ voucherUserId: founderId, kind: "arrival", note: null }]);
    // One vouch of the village's three: arrived, and not yet admitted.
    expect(vouches.json?.state?.count).toBe(1);
    expect(vouches.json?.isMember).toBe(false);
  });

  it("works once: the same link makes no second account", async () => {
    const again = await signUp("Ida Kestrel", "ida", wrenLink);
    expect(again.status).toBe(403);
    expect(String(again.json?.error)).toContain("already been used");
    expect(await accountsFor("ida")).toBe(0);

    const check = await call("GET", `/api/invites/check?token=${wrenLink}`, { token: null });
    expect(check.json?.valid).toBe(false);
    expect(String(check.json?.error)).toContain("already been used");
  });

  it("refuses a withdrawn link, an expired one and one never made, each saying why", async () => {
    const withdrawn = await makeInvite();
    expect((await call("POST", `/api/invites/${withdrawn.id}/revoke`)).status).toBe(200);
    const stale = await makeInvite();
    await pool.query("UPDATE member_invites SET expires_at = CURRENT_TIMESTAMP - INTERVAL 1 SECOND WHERE id = ?", [stale.id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table

    const tries: Array<[string, string, string]> = [
      ["withdrawn", withdrawn.token, "withdrawn"],
      ["expired", stale.token, "expired"],
      ["never-made", "A".repeat(43), "not made by this village"],
    ];
    for (const [label, token, says] of tries) {
      const tried = await signUp(`Someone ${label}`, `someone-${label}`, token);
      expect(tried.status, label).toBe(403);
      expect(String(tried.json?.error), label).toContain(says);
      expect(await accountsFor(`someone-${label}`), label).toBe(0);
    }

    // THE CONTROL, in the same case: a fresh link from the same founder opens.
    const fresh = await makeInvite();
    const orla = await signUp("Orla Finch", "orla", fresh.token);
    expect(orla.status, JSON.stringify(orla.json)).toBe(200);
  });

  it("lets only somebody who may vouch make a link, and says so before they press anything", async () => {
    const guest = await call("POST", "/api/invites", { token: wrenToken });
    expect(guest.status).toBe(403);
    expect(String(guest.json?.error)).toContain("Contributor");
    expect((await call("POST", "/api/invites")).status, "the founder, in the same case").toBe(200);

    // The list answers the same question the gate does, so a profile can
    // offer the button only to somebody the write would let through.
    const theirs = await call("GET", "/api/me/invites", { token: wrenToken });
    expect(theirs.json?.mayInvite).toBe(false);
    expect(String(theirs.json?.closed ?? "")).toContain("Contributor");
    const mine = await call("GET", "/api/me/invites");
    expect(mine.json?.mayInvite).toBe(true);
    expect(mine.json?.closed).toBeNull();
  });

  it("lists what became of each link for its maker, and never the link itself", async () => {
    const mine = await call("GET", "/api/me/invites");
    expect(mine.status).toBe(200);
    const invites: any[] = mine.json?.invites ?? [];
    for (const standing of ["used", "revoked", "expired", "open"]) {
      expect(invites.map((i) => i.standing), standing).toContain(standing);
    }
    expect(invites.filter((i) => i.standing === "used").map((i) => i.usedBy?.name).sort()).toEqual(["Orla", "Wren"]);
    expect(JSON.stringify(mine.json)).not.toContain(wrenLink);

    // Somebody else's list holds none of them.
    const theirs = await call("GET", "/api/me/invites", { token: wrenToken });
    expect(theirs.status).toBe(200);
    expect(theirs.json?.invites).toEqual([]);
  });

  it("refuses to withdraw somebody else's link, or one already used", async () => {
    const open = await makeInvite();
    expect((await call("POST", `/api/invites/${open.id}/revoke`, { token: wrenToken })).status).toBe(409);
    const usedId = ((await call("GET", "/api/me/invites")).json?.invites ?? []).find((i: any) => i.standing === "used")?.id;
    expect(usedId, "a used link to try").toBeTruthy();
    expect((await call("POST", `/api/invites/${usedId}/revoke`)).status).toBe(409);
    // And the founder's own open link still withdraws.
    expect((await call("POST", `/api/invites/${open.id}/revoke`)).status).toBe(200);
  });
});

describe.skipIf(!DB_CONFIGURED)("somebody with no invitation asks to join", () => {
  it("lands in the admin queue as a membership request, attributed to nobody, and makes no account", async () => {
    const asked = await call("POST", "/api/forms/submit", {
      token: null,
      body: {
        type: "membership-request",
        hp: "",
        data: { name: "Tess Asks", email: `tess-asks-${PORT}@example.test`, why: "I keep bees.", heardFrom: "a friend" },
      },
    });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    const [rows] = await pool.query<any[]>("SELECT type, status, user_id FROM submissions WHERE type = 'membership-request'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows).toHaveLength(1);
    expect(String(rows[0].status)).toBe("new");
    expect(rows[0].user_id).toBeNull();
    expect(await accountsFor("tess-asks"), "asking is not joining").toBe(0);

    // The lists say how long a link lasts, so no sentence has to carry its own copy of the number.
    expect((await call("GET", "/api/me/invites")).json?.days).toBe(14);
  });
});

describe.skipIf(!DB_CONFIGURED)("a village that turns the dial off", () => {
  it("lets anybody make an account, still counts a good link, and ignores a bad one", async () => {
    const off = await call("PUT", "/api/admin/variables/membership.invite_only", { body: { value: "false" } });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    try {
      expect((await call("GET", "/api/auth/methods", { token: null })).json?.inviteOnly).toBe(false);

      const walkIn = await signUp("Pax Merrow", "pax");
      expect(walkIn.status, JSON.stringify(walkIn.json)).toBe(200);

      const link = await makeInvite();
      const invited = await signUp("Juno Reed", "juno", link.token);
      expect(invited.status, JSON.stringify(invited.json)).toBe(200);
      const vouches = await call("GET", `/api/members/${invited.json?.user?.id}/vouches`);
      expect((vouches.json?.vouches ?? []).map((v: any) => v.kind)).toEqual(["arrival"]);

      const junk = await signUp("Tess Lowe", "tess", "B".repeat(43));
      expect(junk.status, "a bad link is no reason to refuse a village that is open").toBe(200);
    } finally {
      const on = await call("PUT", "/api/admin/variables/membership.invite_only", { body: { value: "true" } });
      expect(on.status).toBe(200);
    }
  });
});
