/**
 * "EDIT THIS ROLE": the routes behind the role card's editor (role journey,
 * PR-B). Registered from server/routes/orgDraftDecide.ts, which already holds
 * the publish door, the live holders of `org.decide` and the publish
 * dependencies, so nothing here reaches into server/index.ts.
 *
 *   GET  /api/org/role-edit/access           which door the reader has: "power", "admin" or none
 *   POST /api/org/role-edit/new-from-card    read a card (dryRun) or make a new role from it, unlisted
 *   GET  /api/org/role-edit/:id              the role as the editor opens it
 *   GET  /api/org/role-edit/:id/text         the role as an "Amora role card v1" text
 *   POST /api/org/role-edit/:id/import       read a pasted card, a file or a Google Doc against this role
 *   GET  /api/org/role-edit/:id/sera         Sera's version, and the pay group Sera's figures suggest
 *   POST /api/org/role-edit/:id              SAVE: one human org draft, published at once
 *   GET  /api/org/role-edit/:id/history      who changed this role, when and what
 *   POST /api/org/role-edit/:id/history/:draftId/revert   put the newest change back
 *
 * ── WHO MAY ────────────────────────────────────────────────────────────────
 *
 * The publish door and nobody else: a live holder of `org.decide` ("power"), or
 * an admin until a launch vote has carried ("admin"), exactly who may publish
 * any org draft (`publishDoorFor`). A member without the power meets a 403 on
 * every route here but `/access`, which answers `door: null` to anybody, so the
 * card knows whether to draw the button at all. Admin is asked of the request,
 * not assumed from the account.
 *
 * ── READING A CARD WRITES NOTHING ──────────────────────────────────────────
 *
 * The import reads and answers; the gold in the editor is the person's to
 * accept, and only SAVE writes. A file is held in memory and dropped
 * (server/routes/roleCardImport.ts `wordsOf`).
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import type { PublishDeps } from "../lib/orgDraftDecide";
import { ORG_DECIDE, publishDoorFor, publishOrgDraft, draftReadiness, type PublishDoor } from "../lib/orgDraftDecide";
import { addChange, createDraft, getDraft, withdrawDraft } from "../lib/orgDrafts";
import { listOrgRoles, type OrgRole } from "../lib/orgChart";
import { ROLE_WORD_FIELDS } from "../lib/roleProposals";
import { editorState, labelOf, listingProblems, revertEdit, roleHistory, saveRoleEdit, suggestionFor, type EditorState } from "../lib/roleEdit";
import { liveParameterKeys } from "../lib/roleParameterColumns";
import { wordsOf } from "./roleCardImport";
import { isRoleCardText, readRoleCard, writeRoleCard, type RoleCardRoleIn } from "../../shared/roleCardText";
import type { WordValue } from "../../shared/roleProposals";
import {
  interviewerFromLine,
  interviewerToLines,
  payFromLines,
  payToLines,
  PARAMETER_CARD_FIELDS,
  readParameter,
  type Interviewer,
  type ParameterKey,
} from "../../shared/roleParameters";
import { canonicalJson } from "../../shared/canonicalJson";
import type { PaySettings } from "../../shared/seatSettings";
import crypto from "node:crypto";

type Gate = {
  authedUser(req: any): Promise<any | null>;
  isAdmin(req: any): Promise<boolean>;
  getPool(): Pool;
  overLimit(key: string, max: number, windowMs: number): Promise<boolean>;
  liveHoldersOf(capability: string): Promise<string[]>;
  publishDeps: PublishDeps;
  circleName(id: string): string | null;
  /** Whether this person holds `terms.read`: Sera's pay range is the same class of fact as the terms. */
  canReadTerms(req: any): Promise<boolean>;
  villageName?(): string | null;
};

const WINDOW_MS = 10 * 60 * 1000;
const READS = 120;
const WRITES = 30;
const IMPORTS = 20;

const fold = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

export function registerRoleEditRoutes(app: Express, g: Gate): void {
  const BASE = "/api/org/role-edit";

  const door = async (req: any): Promise<{ userId: string; door: PublishDoor | null } | null> => {
    const user = await g.authedUser(req);
    if (!user) return null;
    const userId = String(user.id);
    return { userId, door: await publishDoorFor(g.getPool(), { userId, isAdmin: await g.isAdmin(req) }, await g.liveHoldersOf(ORG_DECIDE)) };
  };

  /** The one gate every route but /access asks. Answers the request when the answer is no. */
  async function gate(req: any, res: any, bucket: string, max: number): Promise<{ userId: string; door: PublishDoor } | null> {
    const who = await door(req);
    if (!who) {
      res.status(401).json({ error: "auth_required", message: "Sign in to edit a role." });
      return null;
    }
    if (!who.door) {
      res.status(403).json({ error: "not_a_holder", message: "Editing a role is for a holder of the power to decide the structure." });
      return null;
    }
    if (await g.overLimit(`role-edit-${bucket}:${who.userId}`, max, WINDOW_MS)) {
      res.status(429).json({ error: "too_many_asks", message: "That is a lot in a few minutes. Wait a little and try again." });
      return null;
    }
    return { userId: who.userId, door: who.door };
  }

  const roleOf = async (res: any, id: string): Promise<{ role: OrgRole; roles: OrgRole[] } | null> => {
    const roles = await listOrgRoles(g.getPool());
    const role = roles.find((r) => r.id === id);
    if (!role) {
      res.status(404).json({ error: "no_such_role", message: "There is no role by that id." });
      return null;
    }
    return { role, roles };
  };

  app.get(`${BASE}/access`, async (req, res) => {
    // Read by every card to decide whether to draw a button, so anybody may ask; the answer names no one.
    const key = (await g.authedUser(req))?.id ?? req.ip ?? "anon";
    if (await g.overLimit(`role-edit-access:${String(key)}`, READS, WINDOW_MS)) return res.status(429).json({ error: "too_many_asks" });
    const who = await door(req);
    res.set("Cache-Control", "no-store").json({ door: who?.door ?? null });
  });

  // ── A new role from a card ──────────────────────────────────────────────

  app.post(`${BASE}/new-from-card`, async (req, res) => {
    const me = await gate(req, res, "new", IMPORTS);
    if (!me) return;
    const got = await wordsOf(req, res);
    if (!got) return;
    res.set("Cache-Control", "no-store");
    if (!got.ok) return res.status(got.status).json({ error: got.error, source: got.source });
    if (!isRoleCardText(got.text)) return res.json({ isCard: false, text: got.text, source: got.source });
    const pool = g.getPool();
    const roles = (await listOrgRoles(pool)).filter((r) => !r.isExample);
    const circles = circlesOf(g, roles);
    const chosen = typeof (req.body ?? {}).circleId === "string" ? String(req.body.circleId) : "";
    const read = readRoleCard(got.text, { words: ROLE_WORD_FIELDS, roles: roleIn(roles), circles, orgGoals: [], maxRoles: 5 });
    const made = read.proposalBody.newRoles ?? [];
    const problems = read.problems.filter((p) => !(chosen && p.kind === "circle"));
    const extra: string[] = [];
    if (made.length !== 1 || (read.proposalBody.roles ?? []).length > 0) extra.push("Bring in one new role at a time: a card with exactly one role that this village does not have yet.");
    const circleId = chosen || made[0]?.circleId || "";
    if (!circleId || !circles.some((c) => String(c.id) === circleId)) extra.push("Choose the circle the new role sits in.");
    const section = read.sections.find((s) => s.path.startsWith("newRoles.")) ?? null;
    const preview = {
      isCard: true,
      source: got.source,
      text: got.text,
      title: typeof made[0]?.words.name === "string" ? made[0].words.name : null,
      circleId: circleId || null,
      circleName: circleId ? g.circleName(circleId) : null,
      problems: [...problems.map((p) => ({ field: p.field, sentence: p.sentence, blocks: p.blocks })), ...extra.map((sentence) => ({ field: "card", sentence, blocks: true }))],
      parameterKeys: Object.keys(section?.parameters ?? {}),
    };
    const create = (req.body ?? {}).create === true || (req.body ?? {}).create === "true";
    if (!create) return res.json({ ...preview, created: false });
    if (preview.problems.some((p) => p.blocks)) return res.status(409).json({ ...preview, created: false, error: preview.problems.find((p) => p.blocks)?.sentence });
    const role = made[0];
    const id = `role-${crypto.randomBytes(6).toString("hex")}`;
    const params = await parametersFromSection(section?.parameters ?? {}, roles, null);
    if (!params.ok) return res.status(400).json({ ...preview, created: false, error: params.error });
    const live = await liveParameterKeys(pool);
    const wanted = Object.keys(params.values).filter((k) => k !== "recruiting");
    if (wanted.some((k) => !live.includes(k as ParameterKey))) {
      return res.status(409).json({ ...preview, created: false, error: "This village's roles do not carry the listing details yet, so a card that gives them cannot be brought in whole." });
    }
    const draft = await createDraft(pool, {
      title: `New role from a card: ${String(role.words.name ?? "a role")}`.slice(0, 200),
      rationale: "Brought in from a role card by a holder of the power to decide the structure. It starts unlisted.",
      createdBy: me.userId,
      sourceKind: "human",
      openCap: null,
    });
    if (!draft.ok) return res.status(409).json({ error: draft.error });
    const creates: Record<string, unknown> = { ...wordsPayload(role.words), circleId, seats: 1, recruiting: false };
    if (params.pay) creates.termsOffer = { v: 1, pay: params.pay };
    const steps: Array<{ op: "create_seat" | "update_seat"; payload: Record<string, unknown> }> = [{ op: "create_seat", payload: creates }];
    // Unlisted by saying so: a role with no listing answer reads as listed.
    const details: Record<string, unknown> = { ...Object.fromEntries(Object.entries(params.values).filter(([k]) => k !== "recruiting")) };
    if (live.includes("listed")) details.listed = false;
    if (Object.keys(details).length) steps.push({ op: "update_seat", payload: details });
    for (const step of steps) {
      const added = await addChange(pool, draft.id, { op: step.op, orgRoleId: id, payload: step.payload });
      if (!added.ok) {
        await withdrawDraft(pool, draft.id);
        return res.status(409).json({ error: added.error });
      }
    }
    const loaded = await getDraft(pool, draft.id);
    const ready = loaded ? await draftReadiness(pool, loaded) : { blocked: 1, blockedLines: [], changes: 0 };
    if (ready.blocked > 0) {
      await withdrawDraft(pool, draft.id);
      return res.status(409).json({ error: `${ready.blockedLines[0]?.blocked ?? "This does not fit the village as it stands"}. Nothing was made.` });
    }
    const published = await publishOrgDraft(g.publishDeps, draft.id, me.userId, me.userId);
    if (!published.ok) {
      await withdrawDraft(pool, draft.id);
      return res.status(409).json({ error: `${published.error}. Nothing was made.` });
    }
    res.json({ ...preview, created: true, roleId: id, draftId: draft.id, listed: live.includes("listed") ? false : null });
  });

  // ── One role ───────────────────────────────────────────────────────────

  app.get(`${BASE}/:id`, async (req, res) => {
    const me = await gate(req, res, "read", READS);
    if (!me) return;
    const found = await roleOf(res, String(req.params.id ?? ""));
    if (!found) return;
    const pool = g.getPool();
    const state = await editorState(pool, found.role);
    res.set("Cache-Control", "no-store").json({
      state,
      door: me.door,
      lacksToList: listingProblems(state),
      mayReadTerms: await g.canReadTerms(req),
      roles: found.roles.filter((r) => !r.isExample && r.id !== found.role.id).map((r) => ({ id: r.id, name: r.name })),
      words: PARAMETER_CARD_FIELDS.map((f) => ({ key: f.key, heading: f.heading, limit: f.limit })),
    });
  });

  app.get(`${BASE}/:id/text`, async (req, res) => {
    const me = await gate(req, res, "read", READS);
    if (!me) return;
    const found = await roleOf(res, String(req.params.id ?? ""));
    if (!found) return;
    const state = await editorState(g.getPool(), found.role);
    const text = writeRoleCard({
      village: g.villageName?.() ?? null,
      roles: [{ title: state.name, id: state.id, circle: state.circleId ? g.circleName(state.circleId) : null, words: wordsOnly(state), parameters: parameterLines(state, found.roles) }],
      measures: [],
      season: null,
    });
    res.status(200).set("Content-Type", "text/plain; charset=utf-8").set("Content-Disposition", 'attachment; filename="role-card.txt"').set("Cache-Control", "no-store").send(text);
  });

  app.post(`${BASE}/:id/import`, async (req, res) => {
    const me = await gate(req, res, "import", IMPORTS);
    if (!me) return;
    const found = await roleOf(res, String(req.params.id ?? ""));
    if (!found) return;
    const got = await wordsOf(req, res);
    if (!got) return;
    res.set("Cache-Control", "no-store");
    if (!got.ok) return res.status(got.status).json({ error: got.error, source: got.source });
    if (!isRoleCardText(got.text)) return res.json({ isCard: false, text: got.text, source: got.source });
    const pool = g.getPool();
    const live = found.roles.filter((r) => !r.isExample);
    const read = readRoleCard(got.text, { words: ROLE_WORD_FIELDS, roles: roleIn(live), circles: circlesOf(g, live), orgGoals: [], maxRoles: 5 });
    const idx = (read.proposalBody.roles ?? []).findIndex((r) => r.roleId === found.role.id);
    const section = idx >= 0 ? read.sections.find((s) => s.path === `roles.${idx}`) ?? null : null;
    if (idx < 0 || !section) {
      const named = read.sections.map((s) => s.title).filter(Boolean);
      return res.json({
        isCard: true,
        matched: false,
        text: got.text,
        sentence: named.length
          ? `This card is for ${named.map((n) => `"${n}"`).join(" and ")}, not for ${found.role.name}. To bring it in as a new role, use New role from a card.`
          : "This card does not name a role. Start it with a Role title.",
        problems: read.problems.map((p) => ({ field: p.field, sentence: p.sentence, blocks: p.blocks })),
      });
    }
    const state = await editorState(pool, found.role);
    const words = (read.proposalBody.roles ?? [])[idx].words;
    const wordChanges: Record<string, { before: WordValue; after: WordValue; label: string }> = {};
    for (const [k, after] of Object.entries(words)) {
      if (k === "name") continue;
      wordChanges[k] = { before: state.words[k] ?? null, after, label: labelOf(k) };
    }
    const params = await parametersFromSection(section.parameters ?? {}, found.roles, state);
    const mine = read.problems.filter((p) => p.field.startsWith(section.path) || p.field === "card");
    res.json({
      isCard: true,
      matched: true,
      source: got.source,
      text: got.text,
      renamed: typeof words.name === "string" ? { before: state.name, after: words.name } : null,
      words: wordChanges,
      parameters: params.ok ? params.changes : {},
      pay: params.ok && params.payChange ? params.payChange : null,
      problems: [
        ...mine.map((p) => ({ field: p.field, sentence: p.sentence, blocks: p.blocks })),
        ...(params.ok ? [] : [{ field: "parameters", sentence: params.error, blocks: true }]),
      ],
    });
  });

  app.get(`${BASE}/:id/sera`, async (req, res) => {
    const me = await gate(req, res, "sera", READS);
    if (!me) return;
    const found = await roleOf(res, String(req.params.id ?? ""));
    if (!found) return;
    try {
      const s = await suggestionFor(g.getPool(), found.role.id);
      // The range is a term-class fact: without `terms.read` the differences stay and the pay is left out.
      const terms = await g.canReadTerms(req);
      res.set("Cache-Control", "no-store").json(terms ? s : { ...s, pay: null, payFrom: null });
    } catch {
      res.status(500).json({ error: "Could not read Sera's version." });
    }
  });

  app.post(`${BASE}/:id`, async (req, res) => {
    const me = await gate(req, res, "save", WRITES);
    if (!me) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const pool = g.getPool();
    const out = await saveRoleEdit({ pool, publish: g.publishDeps }, String(req.params.id ?? ""), me.userId, {
      words: body.words,
      parameters: body.parameters,
      pay: body.pay,
      archetypes: body.archetypes,
    });
    if (!out.ok) return res.status(out.status).json({ error: out.error, message: out.error, ...(out.fields ? { fields: out.fields } : {}) });
    const found = await roleOf(res, String(req.params.id ?? ""));
    if (!found) return;
    res.json({ success: true, draftId: out.draftId, changed: out.changed, state: await editorState(pool, found.role) });
  });

  app.get(`${BASE}/:id/history`, async (req, res) => {
    const me = await gate(req, res, "history", READS);
    if (!me) return;
    const found = await roleOf(res, String(req.params.id ?? ""));
    if (!found) return;
    res.set("Cache-Control", "no-store").json({ entries: await roleHistory(g.getPool(), found.role.id) });
  });

  app.post(`${BASE}/:id/history/:draftId/revert`, async (req, res) => {
    const me = await gate(req, res, "revert", WRITES);
    if (!me) return;
    const found = await roleOf(res, String(req.params.id ?? ""));
    if (!found) return;
    const out = await revertEdit({ pool: g.getPool(), publish: g.publishDeps }, found.role.id, String(req.params.draftId ?? ""), me.userId);
    if (!out.ok) return res.status(out.status).json({ error: out.error, message: out.error });
    const again = await roleOf(res, found.role.id);
    if (!again) return;
    res.json({ success: true, state: await editorState(g.getPool(), again.role) });
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function roleIn(roles: readonly OrgRole[]): RoleCardRoleIn[] {
  return roles.map((r) => ({ id: r.id, name: r.name, circleId: r.circleId, posted: r as unknown as Record<string, unknown> }));
}

function circlesOf(g: Gate, roles: readonly OrgRole[]): Array<{ id: string; name: string }> {
  const ids = Array.from(new Set(roles.map((r) => r.circleId).filter((x): x is string => !!x)));
  return ids.map((id) => ({ id, name: g.circleName(id) ?? id }));
}

/** A role's words as a draft payload: a list cleared goes as an empty list, as the proposal path does. */
function wordsPayload(words: Record<string, WordValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(words)) out[k] = v === null && ROLE_WORD_FIELDS.lists.has(k) ? [] : v;
  return out;
}

function wordsOnly(state: EditorState) {
  const out: Record<string, WordValue> = {};
  for (const [k, v] of Object.entries(state.words)) if (k !== "name" && v !== null) out[k] = v;
  return out as never;
}

/** The card lines a role's parameters and pay are written as. */
function parameterLines(state: EditorState, roles: readonly OrgRole[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const p = state.parameters;
  const titleOf = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const put = (k: string, v: string[]) => v.length && (out[k] = v);
  if (p.listed !== undefined) put("listed", [p.listed ? "Yes" : "No"]);
  if (p.alwaysChecked !== undefined) put("alwaysChecked", [p.alwaysChecked ? "Yes" : "No"]);
  if (p.heldBy) put("heldBy", [p.heldBy]);
  if (p.recruiting !== undefined) put("recruiting", [p.recruiting ? "Open" : "Closed"]);
  if (p.track) put("track", [p.track]);
  if (p.whereWorked) put("whereWorked", [p.whereWorked]);
  put("languages", p.languages ?? []);
  put("villageGoals", p.villageGoals ?? []);
  if (p.budgetLine) put("budgetLine", [p.budgetLine]);
  if (p.fundedFrom) put("fundedFrom", [p.fundedFrom]);
  if (p.reviewAfterDays) put("reviewAfterDays", [String(p.reviewAfterDays)]);
  put("selectionCriteria", p.selectionCriteria ?? []);
  put("conversations", interviewerToLines((p.conversations ?? []) as Interviewer[], titleOf));
  put("accessBundle", p.accessBundle ?? []);
  if (p.bookingUrl) put("bookingUrl", [p.bookingUrl]);
  put("pay", payToLines(state.pay));
  return out;
}

type FromSection =
  | {
      ok: true;
      /** The values, for a new role. */
      values: Record<string, unknown>;
      pay: PaySettings | null;
      /** The ones that differ from the role as it stands, for the gold. */
      changes: Record<string, { before: unknown; after: unknown; label: string }>;
      payChange: { before: unknown; after: unknown; label: string } | null;
    }
  | { ok: false; error: string };

/** Card lines into parameter values, judged by the one reader. A role title in the interview order must be a role the village has. */
async function parametersFromSection(lines: Record<string, string[]>, roles: readonly OrgRole[], state: EditorState | null): Promise<FromSection> {
  const values: Record<string, unknown> = {};
  const changes: Record<string, { before: unknown; after: unknown; label: string }> = {};
  let pay: PaySettings | null = null;
  let payChange: { before: unknown; after: unknown; label: string } | null = null;
  const ids = new Set(roles.map((r) => r.id));
  for (const spec of PARAMETER_CARD_FIELDS) {
    const given = lines[spec.key];
    if (!given) continue;
    if (spec.key === "pay") {
      const r = payFromLines(given);
      if (!r.ok) return { ok: false, error: `${spec.heading}: ${r.problem}` };
      pay = r.value;
      if (canonicalJson(pay) !== canonicalJson(state?.pay ?? null)) payChange = { before: state?.pay ?? null, after: pay, label: spec.heading };
      continue;
    }
    let raw: unknown = spec.list ? given : given[0];
    if (spec.key === "conversations") {
      const list: Interviewer[] = [];
      for (const line of given) {
        const it = interviewerFromLine(line);
        if (!it) continue;
        const hits = roles.filter((r) => fold(r.name) === fold(it.title));
        if (hits.length !== 1) return { ok: false, error: `${spec.heading}: "${it.title}" is not one role in this village.` };
        if (it.minutes === null) return { ok: false, error: `${spec.heading}: say how many minutes "${it.title}" is, like ${it.title} | 20 minutes.` };
        list.push({ roleId: hits[0].id, minutes: it.minutes, final: it.final });
      }
      raw = list;
    }
    const r = readParameter(spec.key as ParameterKey, raw, (id) => ids.has(id));
    if (!r.ok) return { ok: false, error: `${spec.heading}: ${r.problem}` };
    values[spec.key] = r.value;
    const before = state ? (state.parameters as Record<string, unknown>)[spec.key] : undefined;
    if (state && canonicalJson(r.value ?? null) !== canonicalJson(before ?? null)) changes[spec.key] = { before: before ?? null, after: r.value, label: spec.heading };
  }
  return { ok: true, values, pay, changes, payChange };
}
