/**
 * COMMS SETTINGS AND THE OVERVIEW, `/api/admin/comms/settings*` and
 * `/api/admin/comms/overview` (the comms build spec 5.2, 5.15, 5.16 and 6).
 *
 * Rye, 2026-10-02: everything a founder has to supply is added and edited in
 * the Comms admin, so every founder of every village can do it themselves.
 * These routes are the server half of that screen: the checklist, an editor
 * behind each item, the provider setup through Resend's own API, and the test
 * email that proves the whole chain.
 *
 *   GET  /settings                 the checklist and everything the editors show
 *   PUT  /settings                 a person's edit: postal address, tick-box words,
 *                                  recap questions, path contacts, rehearsal inbox,
 *                                  Pause all, investor words reviewed
 *   PUT  /settings/sender          the From line's name and address
 *   GET  /settings/domain          the domain's live status and DNS records
 *   POST /settings/domain          add (or adopt) the sending domain
 *   POST /settings/domain/verify   ask the provider to look again
 *   POST /settings/domain/confirm  a person vouches, when the key cannot ask
 *   POST /settings/webhook         connect delivery reports with one press
 *   PUT  /settings/webhook         paste the signing secret by hand, or clear it
 *   POST /settings/test            send yourself a test email
 *   GET  /overview                 the Overview screen
 *
 * The provider key itself is saved through the existing secrets route,
 * `PUT /api/admin/integrations/resend_api_key`, and the dials through the
 * existing variables route. Neither has a second door here.
 *
 * ── WHERE THIS IS REGISTERED ───────────────────────────────────────────────
 *
 * From server/routes/comms.ts, so it inherits that module's placement: after
 * `express.json()`, the admin audit and the default-deny gate, and NOT behind
 * `requireModule("comms")`. A village sets up its sending before it turns
 * anything on (shared/modules.ts says the same for the `comms` module).
 *
 * Every change asks the one gate for `comms.manage` through `guardCapability`;
 * every read through `mayStillSee`, because a GET carries no break-glass.
 */
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { addressProblem } from "../../shared/comms/address";
import { DEFAULT_JOURNEYS } from "../../shared/comms/defaults/journeys";
import { addressOnDomain, domainProblem, normalizeDomain, senderNameProblem } from "../../shared/comms/settings";
import { GAME_CONFIG } from "../../shared/gameConfig";
import type { AppDeps } from "../lib/appDeps";
import { escapeHtml, validEmailSender } from "../lib/comms/mailer";
import { post } from "../lib/comms/postOffice";
import {
  DELIVERY_REPORT_EVENTS,
  manualDomainSteps,
  manualWebhookSteps,
  resendAdmin,
  webhookUrl,
  type AdminAnswer,
  type ProviderDomain,
} from "../lib/comms/resendAdmin";
import { adminAddresses, readCommsSettings, recordCommsSettings, senderParts, writeCommsSettings } from "../lib/comms/settings";
import { PATH_INBOX, buildChecklist, gatherSetupFacts, readinessOf, testEmailDelivered } from "../lib/comms/setup";
import { effectiveLifecycle } from "../lib/modules";
import { NO_VILLAGE_SECRETS_KEY_SENTENCE, putSecret, secretStatus, secretValue, villageSecretsConfigured } from "../lib/secrets";
import { messageCountsByStatus } from "../repos/commsMessages";
import {
  TEST_EMAIL_ORIGIN,
  activeEnrollmentCounts,
  journeyStates,
  messageCountsByKind,
  recentFailures,
  scheduledLetters,
  upcomingEmails,
} from "../repos/commsOverview";

export type CommsSettingsDeps = Pick<
  AppDeps,
  | "authedUser"
  | "guardCapability"
  | "mayStillSee"
  | "adminActor"
  | "getPool"
  | "commsPostOffice"
  | "members"
  | "isPresent"
  | "projectName"
> & {
  /**
   * Who holds a power live, counted the way the gate counts (lapsed terms
   * out, a warning badge's deny beating a role): `liveHoldersOf` in
   * server/index.ts, the one spelling the redemption door and a raised hand use.
   */
  liveHoldersOf(capability: string): Promise<string[]>;
  /**
   * The `email-config` document through its boot cache. It holds the From
   * line and the path inboxes, and the mailer reads it from that cache, so a
   * sender saved anywhere else would not be used until a restart.
   */
  emailConfigRepo: { get(): any; put(doc: any): Promise<any> };
  /** The jobs "run now" runs (server/routes/comms.ts), for the Overview's buttons. */
  jobs: readonly string[];
};

/** The Overview's window for numbers and failures, and its window for what is scheduled. */
const NUMBERS_DAYS = 30;
const UPCOMING_DAYS = 7;

/** One person may send themselves this many tests in this window. */
const TESTS_PER_WINDOW = 6;
const TEST_WINDOW_MS = 10 * 60 * 1000;

const REFUSED = { status: 403, body: { error: "Running the village's email is an appointment" } };

const nowIso = (): string => new Date().toISOString();

/** A provider refusal, in the words a founder can act on, and the status to answer it with. */
function providerRefusal(a: Extract<AdminAnswer<unknown>, { ok: false }>): { status: number; error: string } {
  switch (a.refusal) {
    case "no_key":
      return { status: 409, error: "Paste the Resend key first. This step talks to Resend with it." };
    case "bad_key":
      return { status: 409, error: `Resend did not accept the key. Paste it again from resend.com/api-keys. (${a.error})` };
    case "not_found":
      return { status: 404, error: "Resend has no record of that domain any more. Add it again." };
    case "unavailable":
      return { status: 502, error: `Resend is busy or having trouble. Try again in a minute. (${a.error})` };
    case "unreachable":
      return { status: 502, error: `Resend could not be reached. Try again in a minute. (${a.error})` };
    default:
      return { status: 422, error: a.error };
  }
}

export function register(app: Express, deps: CommsSettingsDeps): void {
  const { authedUser, guardCapability, mayStillSee, adminActor, getPool, commsPostOffice } = deps;
  const { members, isPresent, projectName, liveHoldersOf, emailConfigRepo, jobs } = deps;

  const admin = () => resendAdmin({ apiKey: () => secretValue("resend_api_key") });
  const pathIds = (): string[] => GAME_CONFIG.paths.map((p) => p.id);
  const displayName = (m: any): string => String(m?.name ?? "").trim() || String(m?.handle ?? "").trim() || "A member";

  /** Who is acting, by name, for the record. A shared admin password is "an admin". */
  async function actorOf(req: Request): Promise<{ id: string; name: string } | null> {
    const user = await authedUser(req);
    if (user) return { id: String(user.id), name: displayName(user) };
    const a = adminActor(req);
    return a ? { id: String(a.id), name: String(a.name ?? "").trim() || "an admin" } : null;
  }

  /** The look every read and every change answers with, so the screen redraws from one source. */
  async function settingsPayload(req: Request) {
    const facts = await gatherSetupFacts({ getPool });
    const all = await members.all();
    const present = all.filter((m) => isPresent(m));
    const names: Record<string, string> = Object.fromEntries(present.map((m) => [String(m.id), displayName(m)]));
    const holderIds = await liveHoldersOf("comms.manage");
    facts.holders = holderIds.map((id) => names[id]).filter((n): n is string => !!n);
    facts.memberNames = names;
    facts.adminEmails = adminAddresses(all, isPresent);
    const checklist = buildChecklist(facts);
    const { ready } = readinessOf(checklist);
    const key = secretStatus("resend_api_key");
    const hook = secretStatus("resend_webhook_secret");
    const parts = senderParts(facts.sender.line);
    const user = await authedUser(req);
    const s = facts.settings;
    return {
      lifecycle: effectiveLifecycle("comms"),
      ready,
      checklist,
      settings: s,
      key: { configured: key.configured, source: key.source, last4: key.last4, setAt: key.setAt, setBy: key.setBy ? names[key.setBy] ?? null : null },
      webhook: {
        configured: hook.configured,
        source: hook.source,
        url: webhookUrl(commsPostOffice.origin()),
        events: DELIVERY_REPORT_EVENTS,
        connectedAt: s.webhookConnectedAt,
        connectedBy: s.webhookConnectedBy,
        byHand: hook.configured && hook.source === "admin" && !s.webhookId,
        lastReportAt: facts.lastReportAt,
      },
      sender: { line: facts.sender.line, source: facts.sender.source, name: parts.name || s.senderName, address: parts.address },
      paths: facts.paths.map((p) => ({ ...p, inbox: PATH_INBOX[p.id] ?? null })),
      members: present.map((m) => ({ id: String(m.id), name: displayName(m) })).sort((a, b) => a.name.localeCompare(b.name)),
      holders: holderIds.map((id) => ({ id, name: names[id] ?? "A member who has left" })),
      admins: facts.adminEmails,
      testEmail: facts.testEmail
        ? {
            status: facts.testEmail.status,
            toEmail: facts.testEmail.toEmail,
            createdAt: facts.testEmail.createdAt,
            delivered: testEmailDelivered(facts.testEmail),
          }
        : null,
      me: { email: user?.email ? String(user.email) : null },
      secretsKeySet: villageSecretsConfigured(),
    };
  }

  /** A read's two refusals, the status route's own: no member session, then no power to look. */
  async function mayLook(req: Request, res: Response): Promise<boolean> {
    if (!(await authedUser(req))) {
      res.status(401).json({ error: "Sign in to see the village's email" });
      return false;
    }
    if (!(await mayStillSee(req, "comms.manage"))) {
      res.status(403).json(REFUSED.body);
      return false;
    }
    return true;
  }


  app.get("/api/admin/comms/settings", async (req, res) => {
    if (!(await mayLook(req, res))) return;
    res.json(await settingsPayload(req));
  });

  app.put("/api/admin/comms/settings", async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSED))) return;
    const body = req.body ?? {};
    // A path's contact must be somebody who can actually write back.
    if (body.pathContacts && typeof body.pathContacts === "object") {
      for (const id of Object.values(body.pathContacts as Record<string, unknown>)) {
        if (typeof id !== "string" || !id.trim()) continue;
        const m = await members.byId(id.trim());
        if (!m || !isPresent(m)) {
          return res.status(400).json({ error: "That person is not a member who can write back. Choose somebody from the list." });
        }
      }
    }
    const actor = await actorOf(req);
    const r = await writeCommsSettings(getPool(), body, { pathIds: pathIds(), reviewer: actor?.name ?? null });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ changed: r.changed, ...(await settingsPayload(req)) });
  });

  app.put("/api/admin/comms/settings/sender", async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSED))) return;
    const name = String(req.body?.name ?? "").trim();
    const address = String(req.body?.address ?? "").trim();
    const pool = getPool();
    if (!name && !address) {
      // Clearing the sender stops every email, which is a real choice and
      // says so on the checklist.
      await emailConfigRepo.put({ ...(emailConfigRepo.get() ?? {}), sender: "" });
      await recordCommsSettings(pool, { senderName: null });
      return res.json(await settingsPayload(req));
    }
    const nameProblem = senderNameProblem(name);
    if (nameProblem) return res.status(400).json({ error: nameProblem });
    if (addressProblem(address) !== null) return res.status(400).json({ error: "The sender address does not look like an email address." });
    const settings = await readCommsSettings(pool);
    if (settings.domain && !addressOnDomain(address, settings.domain)) {
      return res.status(400).json({ error: `The address has to end in @${settings.domain}, the domain this village sends from.` });
    }
    const line = `${name} <${address}>`;
    if (!validEmailSender(line)) return res.status(400).json({ error: "That name and address cannot make an email's From line." });
    await emailConfigRepo.put({ ...(emailConfigRepo.get() ?? {}), sender: line });
    await recordCommsSettings(pool, { senderName: name });
    res.json(await settingsPayload(req));
  });

  /** The domain panel: what the provider says now, recorded so the checklist agrees. */
  async function domainPanel(pool: ReturnType<typeof getPool>) {
    const s = await readCommsSettings(pool);
    if (!s.domain) return { domain: null, status: "none", records: [], byHand: false, steps: [] as string[] };
    if (!s.domainId) {
      return { domain: s.domain, status: s.domainStatus, records: [], byHand: true, steps: manualDomainSteps(s.domain) };
    }
    const got = await admin().getDomain(s.domainId);
    if (!got.ok) {
      if (got.refusal === "no_rights") {
        return { domain: s.domain, status: s.domainStatus, records: [], byHand: true, steps: manualDomainSteps(s.domain) };
      }
      return { domain: s.domain, status: s.domainStatus, records: [], byHand: false, steps: [], error: providerRefusal(got).error };
    }
    if (got.value.status !== s.domainStatus) {
      await recordCommsSettings(pool, { domainStatus: got.value.status, domainCheckedAt: nowIso() });
    }
    return { domain: s.domain, status: got.value.status, records: got.value.records, byHand: false, steps: [] };
  }

  app.get("/api/admin/comms/settings/domain", async (req, res) => {
    if (!(await mayLook(req, res))) return;
    res.json(await domainPanel(getPool()));
  });

  app.post("/api/admin/comms/settings/domain", async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSED))) return;
    const name = normalizeDomain(String(req.body?.name ?? ""));
    const problem = domainProblem(name);
    if (problem) return res.status(400).json({ error: problem });
    const pool = getPool();
    const api = admin();
    // Adopt a domain already added in Resend before making a second one.
    const listed = await api.listDomains();
    let made: AdminAnswer<ProviderDomain>;
    if (listed.ok) {
      const existing = listed.value.find((d) => d.name === name);
      made = existing ? await api.getDomain(existing.id) : await api.createDomain(name);
    } else {
      made = listed;
    }
    if (!made.ok) {
      if (made.refusal !== "no_rights") {
        const r = providerRefusal(made);
        return res.status(r.status).json({ error: r.error });
      }
      // A key that can only send: keep the name, and hand the founder the steps.
      await recordCommsSettings(pool, { domain: name, domainId: null, domainStatus: "unknown", domainCheckedAt: null, domainConfirmedBy: null });
    } else {
      await recordCommsSettings(pool, {
        domain: name,
        domainId: made.value.id,
        domainStatus: made.value.status,
        domainCheckedAt: nowIso(),
        domainConfirmedBy: null,
      });
    }
    res.json({ ...(await settingsPayload(req)), domainPanel: await domainPanel(pool) });
  });

  app.post("/api/admin/comms/settings/domain/verify", async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSED))) return;
    const pool = getPool();
    const s = await readCommsSettings(pool);
    if (!s.domain) return res.status(409).json({ error: "Add the sending domain first." });
    if (!s.domainId) {
      return res.status(409).json({ error: "This key cannot ask Resend about the domain. Verify it in Resend's dashboard, then confirm it here." });
    }
    const api = admin();
    const asked = await api.verifyDomain(s.domainId);
    const got = asked.ok ? await api.getDomain(s.domainId) : asked;
    if (!got.ok) {
      const r = providerRefusal(got);
      return res.status(r.status).json({ error: r.error });
    }
    await recordCommsSettings(pool, { domainStatus: got.value.status, domainCheckedAt: nowIso() });
    res.json({ ...(await settingsPayload(req)), domainPanel: await domainPanel(pool) });
  });

  app.post("/api/admin/comms/settings/domain/confirm", async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSED))) return;
    const pool = getPool();
    const s = await readCommsSettings(pool);
    if (!s.domain) return res.status(409).json({ error: "Add the sending domain first." });
    if (s.domainId) {
      return res.status(409).json({ error: "This key can ask Resend about the domain itself, so press Check verification." });
    }
    if (typeof req.body?.verified !== "boolean") return res.status(400).json({ error: "Say whether Resend shows the domain as verified, yes or no." });
    const actor = await actorOf(req);
    if (req.body.verified) {
      if (!actor) return res.status(401).json({ error: "Confirming the domain by hand needs a named person." });
      await recordCommsSettings(pool, { domainStatus: "verified", domainConfirmedBy: actor.name, domainCheckedAt: nowIso() });
    } else {
      await recordCommsSettings(pool, { domainStatus: "unknown", domainConfirmedBy: null, domainCheckedAt: null });
    }
    res.json({ ...(await settingsPayload(req)), domainPanel: await domainPanel(pool) });
  });

  app.post("/api/admin/comms/settings/webhook", async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSED))) return;
    // Checked before anything is made at the provider: a webhook whose secret
    // this village cannot keep would only send reports nobody can verify.
    if (!villageSecretsConfigured()) return res.status(503).json({ error: NO_VILLAGE_SECRETS_KEY_SENTENCE });
    const url = webhookUrl(commsPostOffice.origin());
    if (!url) {
      return res.status(409).json({
        error: "This server does not know its own public address yet, so Resend would have nowhere to send reports. Set FRONTEND_URL in the host's settings.",
      });
    }
    const actor = await actorOf(req);
    if (!actor) return res.status(401).json({ error: "Connecting delivery reports needs a named person." });
    const made = await admin().createWebhook(url, DELIVERY_REPORT_EVENTS);
    if (!made.ok) {
      if (made.refusal === "no_rights") {
        return res.json({
          byHand: true,
          steps: manualWebhookSteps(url),
          ...(await settingsPayload(req)),
        });
      }
      const r = providerRefusal(made);
      return res.status(r.status).json({ error: r.error });
    }
    const pool = getPool();
    await putSecret(pool, "resend_webhook_secret", made.value.signingSecret, actor.id);
    await recordCommsSettings(pool, { webhookConnectedAt: nowIso(), webhookConnectedBy: actor.name, webhookId: made.value.id || null });
    res.json(await settingsPayload(req));
  });

  app.put("/api/admin/comms/settings/webhook", async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSED))) return;
    const secret = String(req.body?.secret ?? "").trim();
    const actor = await actorOf(req);
    if (!actor) return res.status(401).json({ error: "Changing the delivery-report secret needs a named person." });
    const pool = getPool();
    if (!secret) {
      // Clearing needs no sealing key, the way the secrets store allows it.
      await putSecret(pool, "resend_webhook_secret", "", actor.id);
      await recordCommsSettings(pool, { webhookConnectedAt: null, webhookConnectedBy: null, webhookId: null });
      return res.json(await settingsPayload(req));
    }
    if (!/^whsec_[A-Za-z0-9+/=]{16,}$/.test(secret)) {
      return res.status(400).json({
        error: "That does not look like a Resend signing secret. It starts with whsec_, and Resend shows it on the webhook's page.",
      });
    }
    if (!villageSecretsConfigured()) return res.status(503).json({ error: NO_VILLAGE_SECRETS_KEY_SENTENCE });
    await putSecret(pool, "resend_webhook_secret", secret, actor.id);
    await recordCommsSettings(pool, { webhookConnectedAt: nowIso(), webhookConnectedBy: actor.name, webhookId: null });
    res.json(await settingsPayload(req));
  });

  /** Tests per person, in memory. Bounded, and a restart forgets it, which costs nothing. */
  const tests = new Map<string, { n: number; resetAt: number }>();

  app.post("/api/admin/comms/settings/test", async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSED))) return;
    const user = await authedUser(req);
    const address = String(user?.email ?? "").trim();
    if (!user || addressProblem(address) !== null) {
      return res.status(409).json({
        error: "Sign in with your own account to send yourself a test. A shared admin password has no inbox to send it to.",
      });
    }
    const now = Date.now();
    const slot = tests.get(String(user.id));
    if (!slot || slot.resetAt < now) {
      if (tests.size > 1000) tests.clear();
      tests.set(String(user.id), { n: 1, resetAt: now + TEST_WINDOW_MS });
    } else if (++slot.n > TESTS_PER_WINDOW) {
      return res.status(429).json({ error: "That is a lot of tests in a few minutes. Wait a little and try again." });
    }

    /*
     * THE ONE EMAIL THIS SCREEN WRITES, built simply on purpose. The village's
     * letter layout is being written in the words lane at the same time
     * (shared/comms/letterHtml.ts), and a test of the sending chain must not
     * wait on it or depend on it: plain HTML and a plain-text part.
     */
    const village = projectName();
    const first = displayName(user).split(/\s+/)[0] || "there";
    const from = commsPostOffice.sender();
    const lines = [
      `Hello ${first},`,
      "This is the test email you asked for from Comms Settings.",
      `If you are reading it, ${village} can send email. Comms Settings marks this test as delivered once the delivery report arrives.`,
      `Sent to ${address}${from ? ` from ${from}` : ""}.`,
    ];
    const html =
      '<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#1f2937;padding:24px;line-height:1.5">' +
      lines.map((l, i) => `<p${i === lines.length - 1 ? ' style="color:#6b7280;font-size:13px"' : ""}>${escapeHtml(l)}</p>`).join("") +
      "</body></html>";
    const result = await post(commsPostOffice, {
      // Every press is its own test.
      idempotencyKey: `${TEST_EMAIL_ORIGIN}:${user.id}:${crypto.randomUUID()}`,
      kind: "essential",
      origin: TEST_EMAIL_ORIGIN,
      to: { email: address, name: user.name ? String(user.name) : null, userId: String(user.id) },
      subject: `A test email from ${village}`,
      html,
      text: lines.join("\n\n"),
      urgent: true,
    });
    res.json({ result, ...(await settingsPayload(req)) });
  });

  app.get("/api/admin/comms/overview", async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const pool = getPool();
    const facts = await gatherSetupFacts({ getPool });
    const checklist = buildChecklist(facts);
    const { ready, open } = readinessOf(checklist);
    const required = checklist.filter((i) => i.required);
    const [byStatus, byKind, upcoming, letters, rows, active, failures] = await Promise.all([
      messageCountsByStatus(pool, NUMBERS_DAYS),
      messageCountsByKind(pool, NUMBERS_DAYS),
      upcomingEmails(pool, UPCOMING_DAYS, 25),
      scheduledLetters(pool, UPCOMING_DAYS),
      journeyStates(pool),
      activeEnrollmentCounts(pool),
      recentFailures(pool, NUMBERS_DAYS, 20),
    ]);
    const held = new Map(rows.map((r) => [r.journeyKey, r]));
    const journeys = [
      ...DEFAULT_JOURNEYS.map((j) => j.key),
      ...rows.map((r) => r.journeyKey).filter((k) => !DEFAULT_JOURNEYS.some((j) => j.key === k)),
    ].map((key) => {
      const def = DEFAULT_JOURNEYS.find((j) => j.key === key);
      const row = held.get(key);
      return {
        key,
        kind: def?.kind ?? null,
        steps: def?.steps.length ?? null,
        state: row?.state ?? "off",
        edited: row?.edited ?? false,
        active: active[key] ?? 0,
      };
    });
    res.json({
      lifecycle: effectiveLifecycle("comms"),
      paused: facts.settings.paused,
      setup: {
        ready,
        done: required.filter((i) => i.done).length,
        total: required.length,
        open: open.map((i) => ({ key: i.key, label: i.label, fix: i.fix })),
      },
      numbers: { days: NUMBERS_DAYS, byStatus, byKind },
      upcoming: { days: UPCOMING_DAYS, total: upcoming.total, next: upcoming.next, letters },
      journeys,
      failures,
      jobs,
    });
  });
}
