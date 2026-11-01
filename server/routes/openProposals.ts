/**
 * OPEN ROLE PROPOSALS, THE INTAKE: somebody with no account proposes to hold
 * roles next season (Rye, 2026-10-30; master coordinator's calls 1 to 3 of
 * 2026-10-31, sheet 19i). The words and the shape are shared/openProposals.ts,
 * the SQL is server/repos/openProposals.ts.
 *
 *   GET  /api/open-proposals/form?link=   next season's roles, when the page is open
 *   POST /api/open-proposals              the proposal; emails a confirmation link
 *   POST /api/open-proposals/confirm      the address answers; the proposal is confirmed
 *
 *   GET  /api/admin/open-proposals                    the switch, the links, the confirmed proposals
 *   PUT  /api/admin/open-proposals/settings           the public link on or off
 *   POST /api/admin/open-proposals/links              a link for one person, shown once
 *   POST /api/admin/open-proposals/links/:id/revoke   switch one off
 *
 * ── WHO CAN OPEN THE FORM ───────────────────────────────────────────────────
 *
 * The public link (`/propose-a-role`) is ON unless an admin switches it off
 * (sheet 19i). A link made for one person opens it whatever the switch says,
 * until it is switched off itself. Either way the governance module has to be
 * on, because the roles are its own.
 *
 * ── NOTHING UNCONFIRMED REACHES A PERSON ────────────────────────────────────
 *
 * A proposal is written UNCONFIRMED and the address is sent a link, as an
 * essential email through the one mail door. Until that link is opened the
 * proposal is visible to nobody, notifies nobody, and is deleted after 48
 * hours by the tidy job. A send that does not go deletes the row at once and
 * says so: a proposal nobody can confirm is not kept. The gates on the way in
 * are the honeypot field, a cap per connection and a cap per address; there is
 * no CAPTCHA (sheet 19i).
 *
 * The tidy job also takes the name and address off a declined or withdrawn
 * proposal 90 days after it was decided.
 *
 * Confirmed proposals wait on the admin's list here. Asking the circle and the
 * power to decide, and the account an adoption makes, are the next change.
 *
 * The desk side asks the gate on `intake.moderate`, as the other public queues do.
 */
import crypto from "node:crypto";
import type { Express } from "express";

import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { emailKeyOf } from "../../shared/comms/address";
import { civilDateKey } from "../../shared/lunar";
import {
  confirmLetter,
  OPEN_ANONYMISE_DAYS,
  OPEN_CONFIRM_HOURS,
  OPEN_NAME_MAX,
  OPEN_WORDS,
  parseOpenProposal,
} from "../../shared/openProposals";
import type { AppDeps } from "../lib/appDeps";
import { post } from "../lib/comms/postOffice";
import { effectiveLifecycle } from "../lib/modules";
import { listOrgRoles } from "../lib/orgChart";
import { singlePublicAddress } from "../lib/publicAddress";
import { registerJob } from "../lib/scheduler";
import { dbDocument } from "../repos/store-db";
import * as store from "../repos/openProposals";
import { villageCircles } from "../repos/roleProposals";

type Deps = Pick<
  AppDeps,
  "getPool" | "overLimit" | "clientIp" | "guardCapability" | "authedUser" | "commsPostOffice" | "deploymentOrigin" | "projectName" | "escapeHtml" | "seasonState"
> & {
  /** The one mail door. A suite hands in a fake to watch what would go out. */
  postEmail?: (email: OutgoingEmail) => Promise<PostResult>;
  /** The governance module's lifecycle; the roles are its own. */
  governanceLifecycle?: () => string;
  now?: () => Date;
};

/** The admin's switch for the public link (sheet 19i: on unless switched off). */
export interface OpenProposalSettings {
  publicLink: boolean;
}

export const OPEN_SETTINGS_KEY = "open-proposals";
export const TIDY_JOB = "open-proposals-tidy";
const TIDY_EVERY_MS = 60 * 60_000;

/** A send the provider took, or one already taken under the same key. */
const WENT: ReadonlySet<PostResult["status"]> = new Set<PostResult["status"]>(["sending", "sent", "delivered", "duplicate"]);

const hashOf = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");
const newToken = (): string => crypto.randomBytes(24).toString("base64url");
const firstNameOf = (name: string): string | null => name.trim().split(/\s+/)[0] || null;

export function register(app: Express, deps: Deps): void {
  const { getPool, overLimit, clientIp, guardCapability, authedUser, deploymentOrigin, projectName, escapeHtml } = deps;
  const postEmail = deps.postEmail ?? ((email: OutgoingEmail) => post(deps.commsPostOffice, email));
  const governance = deps.governanceLifecycle ?? (() => effectiveLifecycle("governance"));
  const now = () => (deps.now ? deps.now() : new Date());
  const site = () => deploymentOrigin().replace(/\/+$/, "");

  /** The switch, read fresh: one small row, and an admin who just flipped it sees it at once. */
  async function settings(): Promise<OpenProposalSettings> {
    const doc = dbDocument(getPool(), OPEN_SETTINGS_KEY, { publicLink: true } as any);
    await doc.load();
    return { publicLink: doc.get().publicLink !== false };
  }

  /** Next season by the village's calendar: the first that starts after today, or null. */
  function nextSeason() {
    const state = deps.seasonState();
    const today = civilDateKey(now(), state.timezone || "UTC");
    const next = (state.seasons ?? [])
      .filter((s: any) => s && s.id && s.startsOn)
      .sort((a: any, b: any) => String(a.startsOn).localeCompare(String(b.startsOn)))
      .find((s: any) => String(s.startsOn) > today);
    return next ? { id: String(next.id), name: String(next.name ?? "").trim() || null, startsOn: String(next.startsOn), endsOn: next.endsOn ? String(next.endsOn) : null } : null;
  }

  /** The roles a stranger may propose for: live, not an example, in a live circle. */
  async function offered() {
    const pool = getPool();
    const [roles, circles] = await Promise.all([listOrgRoles(pool), villageCircles(pool)]);
    const live = new Map(circles.filter((c) => c.live).map((c) => [c.id, c.name]));
    return roles
      .filter((r) => r.active && !r.isExample && r.circleId && live.has(r.circleId))
      .map((r) => ({ id: r.id, name: r.name, circle: live.get(r.circleId as string) as string, aim: r.aim ?? null }));
  }

  /** Whether the form opens for this request, and through which link. */
  async function door(rawLink: unknown): Promise<{ open: false } | { open: true; linkId: string | null }> {
    if (governance() === "off") return { open: false };
    const token = typeof rawLink === "string" ? rawLink.trim() : "";
    if (token) {
      const link = token.length <= 100 ? await store.openLinkByHash(getPool(), hashOf(token)) : null;
      return link ? { open: true, linkId: link.id } : { open: false };
    }
    return (await settings()).publicLink ? { open: true, linkId: null } : { open: false };
  }

  // ── The public side ───────────────────────────────────────────────────────

  app.get("/api/open-proposals/form", async (req, res) => {
    const d = await door(req.query.link);
    if (!d.open) return res.json({ open: false, message: OPEN_WORDS.closed });
    const season = nextSeason();
    res.json({ open: true, village: projectName(), season, roles: season ? await offered() : [] });
  });

  app.post("/api/open-proposals", async (req, res) => {
    const body = req.body ?? {};
    // Honeypot: a hidden field only a bot fills. Pretend it went, keep nothing.
    if (body.hp) return res.json({ sent: true });
    if (await overLimit(`open-proposal:ip:${clientIp(req)}`, 5, 60 * 60_000)) return res.status(429).json({ error: OPEN_WORDS.tooMany });
    const d = await door(body.link);
    if (!d.open) return res.status(403).json({ error: OPEN_WORDS.closed });
    const season = nextSeason();
    if (!season) return res.status(409).json({ error: OPEN_WORDS.noSeason });
    const roles = await offered();
    const parsed = parseOpenProposal(body, { roleIds: new Set(roles.map((r) => r.id)), address: singlePublicAddress });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
    const { name, email, body: proposal } = parsed.value;
    const emailKey = emailKeyOf(email);
    if (await overLimit(`open-proposal:email:${emailKey}`, 3, 24 * 60 * 60_000)) return res.status(429).json({ error: OPEN_WORDS.tooMany });

    const pool = getPool();
    const id = `op-${crypto.randomBytes(10).toString("hex")}`;
    const token = newToken();
    await store.insertOpenProposal(pool, { id, name: name.slice(0, OPEN_NAME_MAX), email, emailKey, targetSeasonId: season.id, body: proposal, confirmHash: hashOf(token), linkId: d.linkId, now: now() });

    const byId = new Map(roles.map((r) => [r.id, r.name]));
    const words = confirmLetter({
      firstName: firstNameOf(name),
      village: projectName(),
      roleNames: proposal.roles.map((r) => byId.get(r.roleId) ?? "").filter(Boolean),
      link: `${site()}/propose-a-role/confirm?token=${encodeURIComponent(token)}`,
    });
    const sent = await postEmail({
      idempotencyKey: `open-proposal:${id}:confirm`,
      kind: "essential",
      origin: "open_proposal.confirm",
      to: { email, ...(firstNameOf(name) ? { name: firstNameOf(name) as string } : {}) },
      subject: words.subject,
      html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f2937">${words.text
        .split("\n\n")
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("")}</body></html>`,
      text: words.text,
    });
    if (!WENT.has(sent.status)) {
      // Nobody can confirm a proposal whose link never went, so it is not kept.
      await store.deleteOpenProposal(pool, id);
      return res.status(503).json({ error: OPEN_WORDS.notSent });
    }
    res.json({ sent: true, email, message: OPEN_WORDS.sent(email) });
  });

  app.post("/api/open-proposals/confirm", async (req, res) => {
    if (await overLimit(`open-proposal:confirm:${clientIp(req)}`, 30, 60 * 60_000)) return res.status(429).json({ error: OPEN_WORDS.tooMany });
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const at = now();
    const confirmed = token && token.length <= 100 ? await store.confirmOpenProposal(getPool(), hashOf(token), new Date(at.getTime() - OPEN_CONFIRM_HOURS * 60 * 60_000), at) : null;
    if (!confirmed) return res.status(410).json({ error: OPEN_WORDS.confirmGone });
    res.json({ confirmed: true, message: OPEN_WORDS.confirmed });
  });

  // ── The desk ──────────────────────────────────────────────────────────────

  app.get("/api/admin/open-proposals", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const pool = getPool();
    const [s, links, waiting, roles] = await Promise.all([settings(), store.listOpenLinks(pool), store.listOpenProposals(pool, ["confirmed"]), offered()]);
    const roleName = new Map(roles.map((r) => [r.id, `${r.name} (${r.circle})`]));
    const linkLabel = new Map(links.map((l) => [l.id, l.label]));
    res.json({
      publicLink: s.publicLink,
      publicPath: "/propose-a-role",
      links: links.map((l) => ({ id: l.id, label: l.label, createdAt: l.createdAt, on: !l.revokedAt })),
      proposals: waiting.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        seasonId: p.targetSeasonId,
        via: p.linkId ? (linkLabel.get(p.linkId) ?? null) : null,
        roles: p.body.roles.map((r) => ({ roleId: r.roleId, name: roleName.get(r.roleId) ?? null, note: r.note })),
        why: p.body.why,
        aim: p.body.aim,
        createdAt: p.createdAt,
        confirmedAt: p.confirmedAt,
      })),
    });
  });

  app.put("/api/admin/open-proposals/settings", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    if (typeof req.body?.publicLink !== "boolean") return res.status(400).json({ error: "Say whether the public link is on." });
    const doc = dbDocument(getPool(), OPEN_SETTINGS_KEY, { publicLink: true } as any);
    await doc.put({ publicLink: req.body.publicLink });
    res.json({ publicLink: req.body.publicLink, message: req.body.publicLink ? OPEN_WORDS.publicOn : OPEN_WORDS.publicOff });
  });

  app.post("/api/admin/open-proposals/links", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, OPEN_NAME_MAX) : "";
    if (!label) return res.status(400).json({ error: "Say who the link is for, so you can tell your links apart." });
    const id = `opl-${crypto.randomBytes(8).toString("hex")}`;
    const token = newToken();
    await store.insertOpenLink(getPool(), { id, tokenHash: hashOf(token), label, createdBy: String(user.id), now: now() });
    // The only answer that ever carries the token: only its hash is kept.
    res.json({ id, label, url: `${site()}/propose-a-role/${encodeURIComponent(token)}`, message: OPEN_WORDS.linkMade });
  });

  app.post("/api/admin/open-proposals/links/:id/revoke", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const off = await store.revokeOpenLink(getPool(), String(req.params.id ?? ""), now());
    if (!off) return res.status(404).json({ error: "There is no link by that id that is still on." });
    res.json({ success: true, message: OPEN_WORDS.linkOff });
  });

  // ── The tidy job (sheet 19i) ──────────────────────────────────────────────

  registerJob(TIDY_JOB, TIDY_EVERY_MS, async () => tidyOpenProposals(getPool(), now()));
}

/** Delete what was never confirmed after 48 hours; take the name and address off what was declined or withdrawn after 90 days. */
export async function tidyOpenProposals(pool: Parameters<typeof store.deleteUnconfirmedBefore>[0], at: Date): Promise<string> {
  const deleted = await store.deleteUnconfirmedBefore(pool, new Date(at.getTime() - OPEN_CONFIRM_HOURS * 60 * 60_000));
  const anonymised = await store.anonymiseDecidedBefore(pool, new Date(at.getTime() - OPEN_ANONYMISE_DAYS * 24 * 60 * 60_000), at);
  return `${deleted} unconfirmed deleted, ${anonymised} anonymised`;
}
