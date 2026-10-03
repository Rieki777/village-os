/**
 * THE ONE-CLICK ANSWERS AN EMAIL CARRIES, as a registry keyed by what each
 * signed link is for (the comms build spec 5.4).
 *
 * `/email/a?t=` is one page for every answer an email can ask for: confirm
 * letters, a guest confirming, "can't make it", a time vote, a recap answer,
 * saying yes to the next gathering. Each of those is a PURPOSE
 * (`LINK_PURPOSES`, shared/comms/kinds.ts), and each purpose registers one
 * handler here with two halves:
 *
 *   describe(payload)       what the page shows: a heading, a few sentences,
 *                           the answers, and the one already on record. It
 *                           NEVER acts, because mail scanners GET every link
 *                           in an email and a GET that acted would answer for
 *                           a scanner.
 *   act(payload, body)      the answer itself, on the page's POST.
 *
 * This lane registers `letters_confirm` and `preferences`. The event email,
 * guests and recaps, and time vote lanes register theirs from their own route
 * modules with `registerAction`, and the page draws whatever their
 * `describe()` returns without knowing which purpose it is.
 *
 * WHICH HANDLER A LINK REACHES. The page does not say what a link is for, so
 * each registered purpose is tried in turn with `verifyLink`, which checks the
 * signature BEFORE it reads the body and refuses any purpose but its own. A
 * link signed for one purpose therefore reaches exactly one handler, and a
 * forged or altered link reaches none. The cost is one HMAC per purpose, a
 * few microseconds each.
 */
import type { LinkPurpose } from "../../../shared/comms/kinds";
import {
  BLOCKED_WORDS,
  preferencesChangeOf,
  type ActionDescription,
  type ActionOutcome,
} from "../../../shared/comms/preferences";
import { SUPPRESSION_REASONS, type SuppressionReason } from "../../../shared/comms/kinds";
import { contactById } from "../../repos/commsContacts";
import { suppressionOf } from "../../repos/commsPeople";
import { verifyLink, type LinkPayload } from "./links";
import { answerFor, memberOf, subscribe, unsubscribe } from "./permissions";
import { applyPreferencesChange, preferencesToken, preferencesView, type PreferencesDeps } from "./preferences";

/** What every handler is told about the request. */
export interface ActionContext {
  /** The village's own name, for the words on the page. */
  village: string;
}

export type ActResult = { ok: true; outcome: ActionOutcome } | { ok: false; status: number; error: string };

export interface ActionHandler {
  purpose: LinkPurpose;
  /** The page, before any press. Null when what the link was about is gone. */
  describe(payload: LinkPayload, ctx: ActionContext): Promise<ActionDescription | null>;
  /** The press. `body` is the page's POST body, as sent. */
  act(payload: LinkPayload, body: Record<string, unknown>, ctx: ActionContext): Promise<ActResult>;
}

const registry = new Map<LinkPurpose, ActionHandler>();

/**
 * Add a purpose's handler. Registering a purpose again replaces its handler,
 * so a route module may register on every boot of a test server.
 */
export function registerAction(handler: ActionHandler): void {
  registry.set(handler.purpose, handler);
}

/** The purposes that have a handler, in the order they were registered. */
export function registeredPurposes(): LinkPurpose[] {
  return Array.from(registry.keys());
}

/** Forget every handler. For tests. */
export function clearActions(): void {
  registry.clear();
}

/**
 * The handler a signed link reaches, with the link's payload, or null when
 * the link is forged, altered, expired, or for a purpose nothing handles.
 */
export function resolveActionLink(
  token: string,
  opts: { now?: number; key?: Buffer } = {},
): { purpose: LinkPurpose; payload: LinkPayload; handler: ActionHandler } | null {
  if (typeof token !== "string" || !token) return null;
  const handlers = Array.from(registry.values());
  for (const handler of handlers) {
    const payload = verifyLink(handler.purpose, token, opts);
    if (payload) return { purpose: handler.purpose, payload, handler };
  }
  return null;
}

/** The contact id a link names, or null when it names none. */
export const contactIdOf = (payload: LinkPayload): string | null => (typeof payload.c === "string" && payload.c ? payload.c : null);

const isReason = (r: string): r is SuppressionReason => (SUPPRESSION_REASONS as readonly string[]).includes(r);

const gone = { ok: false as const, status: 404, error: "We no longer hold this address." };

// ── letters_confirm ─────────────────────────────────────────────────────────

/**
 * The second step of a letters yes from somebody with no account: the press
 * in the confirmation email. The words the person saw beside the button are
 * kept as the evidence of what they agreed to.
 */
export function lettersConfirmAction(deps: PreferencesDeps): ActionHandler {
  const offer = (village: string) =>
    `Press the button and you will get letters from ${village}: news from the people here, sent only to those who ask for it.`;

  async function describe(payload: LinkPayload, ctx: ActionContext): Promise<ActionDescription | null> {
    const id = contactIdOf(payload);
    const contact = id ? await contactById(deps.getPool(), id) : null;
    if (!contact) return null;
    const held = await suppressionOf(deps.getPool(), contact.emailKey);
    const base = { purpose: "letters_confirm" as const, input: null };
    if (held && held.reason !== "unsubscribed_all") {
      const sentence = isReason(held.reason) ? BLOCKED_WORDS[held.reason] : BLOCKED_WORDS.manual;
      return { ...base, title: `Letters from ${ctx.village}`, paragraphs: [sentence], choices: [], current: null };
    }
    if (held) {
      return {
        ...base,
        title: `Letters from ${ctx.village}`,
        paragraphs: ["You asked us to stop every email to this address. Start your email again first, and then letters can come."],
        choices: [],
        current: null,
        data: { preferencesToken: preferencesToken(contact.id) },
      };
    }
    const answer = await answerFor(deps, contact, "letters", await memberOf(deps, contact));
    if (answer.state === "yes") {
      return {
        ...base,
        title: `You get letters from ${ctx.village}`,
        paragraphs: ["You can stop them any time, here or from the link at the foot of each one."],
        choices: [{ value: "no", label: "Stop my letters" }],
        current: "yes",
      };
    }
    return {
      ...base,
      title: `Letters from ${ctx.village}`,
      paragraphs: [offer(ctx.village), "If you did not ask for this, close this page. Nothing happens unless you press."],
      choices: [
        { value: "yes", label: "Yes, send me letters", primary: true },
        { value: "no", label: "No thanks" },
      ],
      current: answer.derived ? null : "no",
    };
  }

  return {
    purpose: "letters_confirm",
    describe,
    async act(payload, body, ctx) {
      const id = contactIdOf(payload);
      const contact = id ? await contactById(deps.getPool(), id) : null;
      if (!contact) return gone;
      const choice = body.choice;
      if (choice !== "yes" && choice !== "no") return { ok: false, status: 400, error: "Choose yes or no." };
      const held = await suppressionOf(deps.getPool(), contact.emailKey);
      if (held) {
        const sentence = isReason(held.reason) && held.reason !== "unsubscribed_all"
          ? BLOCKED_WORDS[held.reason]
          : "You asked us to stop every email to this address. Start your email again first.";
        return { ok: false, status: 409, error: sentence };
      }
      const r =
        choice === "yes"
          ? await subscribe(deps, {
              contactId: contact.id,
              kind: "letters",
              basis: "asked",
              source: "letters_confirm",
              evidence: { words: offer(ctx.village), confirmedBy: "email" },
            })
          : await unsubscribe(deps, { contactId: contact.id, kind: "letters", basis: "asked", source: "letters_confirm" });
      if (!r.ok) return r;
      return {
        ok: true,
        outcome: {
          ok: true,
          title: choice === "yes" ? "Your letters are on" : "No letters",
          paragraphs:
            choice === "yes"
              ? [`Thank you. The next letter from ${ctx.village} will reach you.`]
              : ["That is fine. We will not send you letters."],
          description: await describe(payload, ctx),
        },
      };
    },
  };
}

// ── preferences ─────────────────────────────────────────────────────────────

/**
 * Every choice at once, for a link that opens the whole preferences page. The
 * description carries the page's own view in `data.view`, and a press is one
 * change in the shape `preferencesChangeOf` reads.
 */
export function preferencesAction(deps: PreferencesDeps): ActionHandler {
  async function describe(payload: LinkPayload, ctx: ActionContext): Promise<ActionDescription | null> {
    const id = contactIdOf(payload);
    const view = id ? await preferencesView(deps, id) : null;
    if (!view) return null;
    return {
      purpose: "preferences",
      title: `Your email from ${ctx.village}`,
      paragraphs: [],
      choices: [],
      current: null,
      input: null,
      data: { view },
    };
  }
  return {
    purpose: "preferences",
    describe,
    async act(payload, body, ctx) {
      const id = contactIdOf(payload);
      if (!id) return gone;
      const change = preferencesChangeOf(body);
      if (!change) return { ok: false, status: 400, error: "That is not a change this page can make." };
      const result = await applyPreferencesChange(deps, id, change, "link");
      if (!result.ok) return result;
      return {
        ok: true,
        outcome: {
          ok: true,
          title: result.notice ?? "Saved",
          paragraphs: [],
          description: {
            purpose: "preferences",
            title: `Your email from ${ctx.village}`,
            paragraphs: [],
            choices: [],
            current: null,
            input: null,
            data: { view: result.view, notice: result.notice },
          },
        },
      };
    },
  };
}
