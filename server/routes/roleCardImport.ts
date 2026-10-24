/**
 * THE ROLE CARD AS TEXT, AND BRINGING A DESCRIPTION OF YOUR ROLE IN (Rye,
 * 2026-10-24). Registered from inside the role proposal routes
 * (server/routes/roleProposals.ts), which hand over their own helpers, so who
 * may read a draft, the draft-only rule and the rate limits are one
 * implementation, not two.
 *
 *   GET  /api/governance/role-proposals/mine/text    your card as text: your draft, or your current card
 *   GET  /api/governance/role-proposals/:id/text     a proposal as text (owner only)
 *   POST /api/governance/role-proposals/:id/import   read a document, pasted text or a Google Doc link
 *
 * The text is the role card format, version 1 (shared/roleCardText.ts),
 * downloaded as `role-card.txt`.
 *
 * ── IMPORT READS, AND KEEPS NOTHING ────────────────────────────────────────
 *
 * The import takes ONE of: a file (`multipart/form-data`, field `file`: .docx,
 * .pdf, .md or .txt, at most 5 MB), `{ text }` (pasted, at most 60,000
 * characters) or `{ link }` (a Google Doc shared as "anyone with the link").
 * The words are pulled out in memory (server/lib/roleDocumentText.ts), and the
 * document is never written: multer holds it in memory and nothing here
 * touches a table, the uploads volume or a log. The draft does not change
 * either. When the words are a role card, the one reader answers what the
 * card would make of the draft and which lines need a second look; the page
 * shows those, and the member's own ticks go back through the ordinary PUT.
 * When they are not a card, the words go back to the page alone, for the AI
 * half or the copy-and-paste prompt.
 *
 * The name rule reads the village's members and the roles each holds, so a
 * name in a card is reported and, where it can be, written as the role.
 * Members' names never leave the server: only the card's own words come back.
 */
import type { Express } from "express";
import multer from "multer";
import type { Pool } from "mysql2/promise";
import { MAX_PROPOSAL_ROLES, type ProposalBody } from "../../shared/roleProposals";
import { isRoleCardText, readRoleCard, writeRoleCard, type RoleCardContext, type RoleCardPerson } from "../../shared/roleCardText";
import { changesOf, docFromBody } from "../../shared/roleCardApply";
import { listOrgAssignments, type LapseContext, type OrgRole } from "../lib/orgChart";
import { ROLE_WORD_FIELDS } from "../lib/roleProposals";
import { extractRoleDocumentText, fetchGoogleDocText, ROLE_DOCUMENT_MAX_BYTES, ROLE_DOCUMENT_TEXT_MAX, DOCUMENT_WORDS, type Extracted } from "../lib/roleDocumentText";
import type * as store from "../repos/roleProposals";

const BASE = "/api/governance/role-proposals";
/** Reads of a document in ten minutes, per member: each one is a parse, and a link is a call to Google. */
const IMPORTS_PER_WINDOW = 20;
/** The name a downloaded card is saved under. */
export const ROLE_CARD_FILENAME = "role-card.txt";

/** What the role proposal routes know about the village, read once a request. */
interface KnownLike {
  posted: Map<string, OrgRole>;
  circles: Map<string, string>;
}

interface TargetLike {
  goals: string[];
}

/** The role proposal routes' own helpers, handed in by `register` there. */
export interface RoleCardRouteHelpers {
  getPool(): Pool;
  member(req: any, res: any): Promise<any | null>;
  owned(req: any, res: any, user: any, draftOnly?: boolean): Promise<store.StoredProposal | null>;
  known(pool: Pool): Promise<KnownLike>;
  targetFor(p: store.StoredProposal): Promise<TargetLike | null>;
  nextSeason(): TargetLike | null;
  prefilled(pool: Pool, userId: string, k: KnownLike, target: TargetLike | null): Promise<ProposalBody>;
  limited(res: any, bucket: string, max: number): Promise<boolean>;
  draftOf(pool: Pool, userId: string): Promise<store.StoredProposal | null>;
  villageName(): string | null;
  members: { all(): Promise<any[]> };
  lapse(): LapseContext;
  now(): Date;
}

/** The roles and circles a card is read against and written from. */
function rolesAndCircles(k: KnownLike) {
  return {
    roles: Array.from(k.posted.values()).map((r) => ({ id: r.id, name: r.name, circleId: r.circleId, posted: r as unknown as Record<string, unknown> })),
    circles: Array.from(k.circles, ([id, name]) => ({ id, name })),
  };
}

/** Every member and documented holder by name, with the titles of the roles they hold now. */
async function peopleOf(h: RoleCardRouteHelpers, pool: Pool, k: KnownLike): Promise<RoleCardPerson[]> {
  const [members, live] = await Promise.all([h.members.all(), listOrgAssignments(pool, { ...h.lapse(), now: h.now() })]);
  const byUser = new Map<string, string[]>();
  const documented = new Map<string, string[]>();
  for (const a of live) {
    const role = k.posted.get(a.orgRoleId);
    if (!role || a.isExample) continue;
    if (a.holderKind === "member" && a.userId) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), role.name]);
    else if (a.displayName) documented.set(a.displayName, [...(documented.get(a.displayName) ?? []), role.name]);
  }
  const unique = (xs: string[]) => Array.from(new Set(xs));
  return [
    ...members.map((m: any) => ({ name: String(m?.name ?? ""), roles: unique(byUser.get(String(m?.id ?? "")) ?? []) })),
    ...Array.from(documented, ([name, roles]) => ({ name, roles: unique(roles) })),
  ].filter((p) => p.name.trim());
}

const sendCard = (res: any, text: string) =>
  res
    .status(200)
    .set("Content-Type", "text/plain; charset=utf-8")
    .set("Content-Disposition", `attachment; filename="${ROLE_CARD_FILENAME}"`)
    .set("Cache-Control", "no-store")
    .send(text);

export function registerRoleCardRoutes(app: Express, h: RoleCardRouteHelpers): void {
  const write = (body: ProposalBody, k: KnownLike) => writeRoleCard(docFromBody(body, { words: ROLE_WORD_FIELDS, ...rolesAndCircles(k), village: h.villageName() }));

  // Before `/:id/text`, which would take "mine" for an id.
  app.get(`${BASE}/mine/text`, async (req, res) => {
    const user = await h.member(req, res);
    if (!user) return;
    const pool = h.getPool();
    const userId = String(user.id);
    const [draft, k] = await Promise.all([h.draftOf(pool, userId), h.known(pool)]);
    const body = draft ? draft.body : await h.prefilled(pool, userId, k, h.nextSeason());
    sendCard(res, write(body, k));
  });

  app.get(`${BASE}/:id/text`, async (req, res) => {
    const user = await h.member(req, res);
    if (!user) return;
    const p = await h.owned(req, res, user);
    if (!p) return;
    sendCard(res, write(p.body, await h.known(h.getPool())));
  });

  // Held in memory and never written: the bytes go to the extractor and are dropped with the request.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ROLE_DOCUMENT_MAX_BYTES, files: 1, fields: 4, fieldSize: 1024 } });

  /** The words out of whatever the request carries, or the sentence why not. */
  async function wordsOf(req: any, res: any): Promise<(Extracted & { source: "file" | "text" | "link" }) | null> {
    if (req.is("multipart/form-data")) {
      const err = await new Promise<any>((resolve) => upload.single("file")(req, res, resolve));
      if (err) {
        const tooBig = err?.code === "LIMIT_FILE_SIZE";
        return { ok: false, status: tooBig ? 413 : 400, error: tooBig ? DOCUMENT_WORDS.tooBig : "That upload could not be read. Try the file again.", source: "file" };
      }
      if (!req.file) return { ok: false, status: 400, error: "Choose the file to bring in.", source: "file" };
      return { ...(await extractRoleDocumentText({ bytes: req.file.buffer, filename: req.file.originalname })), source: "file" };
    }
    const b = req.body && typeof req.body === "object" ? req.body : {};
    if (typeof b.link === "string" && b.link.trim()) return { ...(await fetchGoogleDocText(b.link)), source: "link" };
    if (typeof b.text === "string") {
      const text = b.text.replace(/\r\n?/g, "\n").trim();
      if (!text) return { ok: false, status: 400, error: "Paste the words first.", source: "text" };
      if (text.length > ROLE_DOCUMENT_TEXT_MAX) return { ok: false, status: 413, error: DOCUMENT_WORDS.tooLong, source: "text" };
      return { ok: true, kind: "txt", text, source: "text" };
    }
    return { ok: false, status: 400, error: "Bring in a file, paste the words, or share a Google Doc link.", source: "text" };
  }

  app.post(`${BASE}/:id/import`, async (req, res) => {
    const user = await h.member(req, res);
    if (!user) return;
    if (await h.limited(res, `role-proposal-import:${String(user.id)}`, IMPORTS_PER_WINDOW)) return;
    const p = await h.owned(req, res, user, true);
    if (!p) return;
    const got = await wordsOf(req, res);
    if (!got) return;
    res.set("Cache-Control", "no-store");
    if (!got.ok) return res.status(got.status).json({ error: got.error, source: got.source });
    if (!isRoleCardText(got.text)) {
      // Not the format: the words go back for the AI half or the member's own AI. Nothing is read into the draft.
      return res.json({ source: got.source, kind: got.kind, isCard: false, text: got.text });
    }
    const pool = h.getPool();
    const k = await h.known(pool);
    const target = await h.targetFor(p);
    const ctx: RoleCardContext = {
      words: ROLE_WORD_FIELDS,
      ...rolesAndCircles(k),
      orgGoals: target?.goals ?? [],
      people: await peopleOf(h, pool, k),
      current: p.body,
      maxRoles: MAX_PROPOSAL_ROLES,
    };
    const read = readRoleCard(got.text, ctx);
    const names = (id: string) => k.posted.get(id)?.name ?? id;
    res.json({ source: got.source, kind: got.kind, isCard: true, text: got.text, read, changes: changesOf(read.proposalBody, p.body, names), current: p.body });
  });
}
