/**
 * "LET AI HELP ME WITH THIS" on a role proposal: one door, one turn at a time.
 *
 *   POST /api/governance/role-proposals/:id/guide
 *
 * Rye, 2026-10-24. Only the draft's owner may ask, and only while it is a
 * draft. The answer goes back to the owner's page and nowhere else: nothing
 * here writes the draft, so an unaccepted suggestion is seen by nobody but the
 * owner, and an accepted one is saved by the owner's own autosave, under their
 * own session. The guide never saves or submits.
 *
 * THE CARD TRAVELS IN THE ROLE CARD TEXT FORMAT both ways, written and read
 * by shared/roleCardText.ts, so the guide's answer goes through the one strict
 * reader every other card does.
 *
 * THE DOCUMENT IS READ AND THROWN AWAY. It arrives in the request body as
 * extracted text, is handed to the guide for this one turn, and is never
 * written anywhere: not to the draft, not to a log, not to the usage row.
 *
 * WHO ANSWERS is the member's choice (shared/guideChoice.ts). When the outside
 * agent is chosen and cannot answer, the village guide answers this turn and
 * the answer says so. When neither can, the answer is 503 and the page carries
 * on by hand, though a page only draws the button when one can.
 *
 * Mounted behind `requireModule("governance")`: it is registered after the
 * `/api/governance` mount in server/index.ts.
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import type { AppDeps } from "../lib/appDeps";
import { DEFAULT_ASSISTANT_MODEL, callAssistant, readReplyFields, type AssistantResult } from "../lib/assistant";
import { recordAssistantUsage } from "../lib/assistantUsage";
import { instanceIdentity } from "../lib/identity";
import { resolveMemberKey } from "../lib/memberSecrets";
import type { LapseContext } from "../lib/orgChart";
import { roleGuideContext } from "../lib/roleGuideContext";
import { clipDocument, guideBrief, guideSystemPrompt, sentencesOf, suggestionsFrom, trimConversation } from "../lib/roleGuide";
import { ROLE_WORD_FIELDS } from "../lib/roleProposals";
import { readProposal } from "../repos/roleProposals";
import { docFromBody } from "@shared/roleCardApply";
import { readRoleCard, writeRoleCard } from "@shared/roleCardText";
import { MAX_PROPOSAL_ROLES } from "@shared/roleProposals";
import { guideStateFor } from "./guideChoice";
import { guidePromptName } from "@shared/guideName";
import type { GuideAnswer, RoleGuideStep } from "@shared/roleGuide";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "clientIp" | "overLimit" | "members" | "seasonState"> & {
  lapse: () => LapseContext;
  villageGuideName: () => string;
  villageName: () => string;
};

const HOUR_MS = 60 * 60 * 1000;
/** Turns one member may take in an hour: a long sitting over five roles. */
const TURNS_PER_HOUR = 40;
/** Turns one member may spend of the village's own key in a day. A member with their own key pays for theirs. */
const TURNS_PER_DAY = 60;
/** The longest question the guide may ask. */
const QUESTION_MAX = 400;

const dayBucket = (uid: string): string => `role-guide-day:${uid}:${new Date().toISOString().slice(0, 10)}`;

/** No dashes between words, whoever wrote them (the house voice). PURE. */
export function tidyWords(text: string): string {
  return text.replace(/\s*[–—]\s*/g, ", ");
}

async function noteUsage(pool: Pool, call: AssistantResult, userId: string): Promise<void> {
  const paid = call.ok
    ? { keySource: call.keySource, usage: call.usage, iterations: call.iterations, stopReason: call.stopReason }
    : call.spent;
  if (!paid) return;
  let villageId: string;
  try {
    villageId = instanceIdentity().instanceId;
  } catch (e) {
    console.error("[role guide] assistant usage not recorded: the instance identity is unread", e);
    return;
  }
  await recordAssistantUsage(pool, {
    villageId,
    mode: "roleGuide",
    model: DEFAULT_ASSISTANT_MODEL,
    keySource: paid.keySource,
    userId,
    usage: paid.usage,
    iterations: paid.iterations,
    stopReason: paid.stopReason,
    path: "prefetch",
  });
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, clientIp, overLimit, members, seasonState, lapse, villageGuideName, villageName } = deps;

  const goalsOf = (seasonId: string | null): string[] => {
    const s = (seasonState().seasons ?? []).find((x: any) => x && String(x.id) === seasonId);
    return (Array.isArray(s?.goals) ? s.goals : []).map((g: any) => String(g?.text ?? "").trim()).filter(Boolean);
  };

  app.post("/api/governance/role-proposals/:id/guide", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const uid = String(user.id);
    const step: RoleGuideStep | null = req.body?.step === "words" || req.body?.step === "season" ? req.body.step : null;
    if (!step) return res.status(400).json({ error: "Ask about the words step or the season step." });
    if (await overLimit(`role-guide:${uid}`, TURNS_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That's a lot of asking in an hour. The guide rests for a little while, and your draft works without it." });
    }

    const pool = getPool();
    const p = await readProposal(pool, String(req.params.id));
    // The same answer for "not yours" and "not there", so a draft's existence is not a probe.
    if (!p || p.userId !== uid) return res.status(404).json({ error: "No draft of yours by that link." });
    if (p.status !== "draft") return res.status(409).json({ error: "This proposal has been submitted, so its words are settled." });

    const state = guideStateFor(user, user.prefs?.guide, villageGuideName());
    if (!state.answering) return res.status(503).json({ error: "The guide can't answer right now. Your words are safe, and you can carry on by hand." });

    const memberKey = await resolveMemberKey(pool, uid);
    if (!memberKey && (await overLimit(dayBucket(uid), TURNS_PER_DAY, 24 * HOUR_MS))) {
      return res.status(429).json({ error: "You've asked the guide a lot today. It rests until tomorrow, and your draft works without it." });
    }

    const document = clipDocument(req.body?.document);
    const conversation = trimConversation(req.body?.conversation);
    const orgGoals = goalsOf(p.targetSeasonId);
    const ctx = await roleGuideContext(pool, { userId: uid, body: p.body, orgGoals, lapse: lapse(), records: await members.all() });
    const tidy = (t: string) => tidyWords(ctx.swap(t));
    // The card as it stands, in the role card text format, without its measures: they sit in the terms, which the guide never reads.
    const card = writeRoleCard({ ...docFromBody(p.body, { words: ROLE_WORD_FIELDS, roles: ctx.card.roles, circles: ctx.card.circles, village: villageName() }), measures: [] });
    const brief = guideBrief(step, card, ctx, document, conversation);

    // The outside agent has no guide call yet (server/lib/saberraGuide.ts), so
    // it never answers here; `guideStateFor` already falls back to the village
    // guide, with the note, for a member who chose it.
    const villageOption = state.options.find((o) => o.id === "village");
    if (state.answering !== "village" || !villageOption) {
      return res.status(503).json({ error: "The guide can't answer right now. Your words are safe, and you can carry on by hand." });
    }

    const call = await callAssistant({
      mode: "roleGuide",
      // The prompt's own form of the name: "You are your village guide" is not a sentence.
      system: guideSystemPrompt(guidePromptName(villageGuideName()), villageName()),
      messages: [{ role: "user", content: "Read what the village knows and suggest my card." }],
      model: DEFAULT_ASSISTANT_MODEL,
      clientIp: clientIp(req),
      burstKey: `assist-role-guide:${uid}`,
      burstPerHour: TURNS_PER_HOUR,
      userId: uid,
      prefetch: [{ key: "role.proposal", data: brief }],
      memberKey,
    });
    await noteUsage(pool, call, uid);
    if (!call.ok) return res.status(call.status).json({ error: call.error });

    const read = readReplyFields(call.text, ["card", "question"] as const, { stopReason: call.stopReason, proseField: "question" });
    const reading = read?.card
      ? readRoleCard(read.card, { words: ROLE_WORD_FIELDS, ...ctx.card, orgGoals, current: p.body, maxRoles: MAX_PROPOSAL_ROLES })
      : { proposalBody: {}, problems: [] };
    // The member's own words, names swapped, so a quoted source never prints a person's name either.
    const sources = sentencesOf(ctx.swap([document ?? "", ...conversation.filter((l) => l.from === "member").map((l) => l.text)].join("\n")));
    const answer: GuideAnswer = {
      guide: { id: "village", name: villageOption.name },
      note: state.note,
      suggestions: suggestionsFrom(step, p.body, reading.proposalBody, reading.problems, { roles: ctx.roles, swap: tidy }, sources),
      question: read?.question ? tidy(read.question).slice(0, QUESTION_MAX) || null : null,
      flags: ctx.checks,
    };
    res.json(answer);
  });
}
