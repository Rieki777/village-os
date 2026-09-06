# The admin guide: design, and the decisions it needs

Status: **decided, not built.** Written 2026-09-03 from a read of what already
exists; all five decisions answered by Rye on 2026-09-04 and recorded in
section 11. Every claim below was checked against the code on `main`; the file
paths and line references are the evidence, not decoration.

## 0. What was asked, and what of it already exists

> "In admin the LLM of your choosing that you set up would follow you around
> admin and be able to help answer questions and fill out forms and give more
> support."

Most of this is built. It is in the wrong place, and one third of it is not
configurable.

| The ask | State today |
| --- | --- |
| an LLM that answers questions | Built. One engine, `server/lib/assistant.ts`, seven modes, three of them already admin-audience. Read `ASSISTANT_MODES` for the current list rather than trusting this row. |
| follows you around admin | Not built. The dock that would do it exists on `/journey-to-launch` and is roughly 80% of the UI. It has no per-tab context. |
| of your choosing that you set up | **Not true for a village.** A founder can set one Anthropic key. Provider, model and base URL are hardcoded. |
| fills out forms | Not built, and this is where the cost is. 47 of 50 admin tabs have no machine-readable description of their fields. |
| gives more support | Partly. The Village Brain grounds the public guide already; nothing grounds an admin guide in what a tab does. |

The honest summary: this is mostly an **integration and safety** job with one
large content job attached (the form schemas), rather than a new AI feature.

## 1. The machine that already exists

- **One engine.** `server/lib/assistant.ts` (555 lines): seven declared modes,
  per-mode daily budgets, a per-IP burst guard, a gated reader registry, a
  keyword router that answers some questions with zero tokens, and a provider
  seam that already speaks both the Anthropic wire and an OpenAI-compatible one.
- **Admin-audience modes already exist**: `launch`, `organize` and `studio`.
  Two of them are driven from a floating dock on `/journey-to-launch`, and
  `studio` has no browser caller at all.
- **The safety model exists and is the right one.** Her Drafts, which Rye has
  already seen, states it: "Roles and circles your guide proposes land here for
  you to read before they exist. She never creates anything herself." The guide
  proposes; a human decides. `assistant_drafts` plus an escalation computation
  is the mechanism.
- **The Village Brain exists**: 14 sections, revisioned, each `blank`,
  `proposed` or `confirmed`, with confirming as a separate named act.

**DECISION 1. ANSWERED: extend it, and make it the SOLE source of truth for the
assistant.** So this is not two docks converging later; the journey dock moves
to the shell and the `/journey-to-launch` mount becomes one caller of it among
several. Nothing else may grow its own assistant UI. Original reasoning: A second dock means two chat
UIs, two histories and two places to fix a bug, and the existing one already
handles modes, spend and refusals.

## 2. Per-tab context

Everything needed is already in scope in the admin shell. The proposed envelope,
sent with every turn:

```
{ tab, tabLabel, groupTitle, moduleId, moduleLifecycle, setupComplete, villageName }
```

`tab` is already in the URL as `?tab=<key>`. `tabLabel` and `groupTitle` come
from `navGroups()` in `client/src/components/admin/adminNavGroups.ts`.
`moduleId` and `moduleLifecycle` come from `TAB_MODULE` in
`client/src/lib/adminNav.ts`, already fetched by the shell. Nothing new is
computed and nothing new is stored.

**What is missing is the other half**: there is no source anywhere for "what
does this tab do". `server/lib/knowledge.ts` loads organizing literature and
per-module contracts, neither of which describes an admin screen.

**DECISION 2. ANSWERED: do both.** One paragraph per tab beside the nav
registry is the start, so a contributor adding a tab adds its sentence in the
same edit and the guide is never mute about a screen. AND a real documentation
project is commissioned as its own piece of work, sequenced after the current
admin work. The paragraph is the floor, not the ceiling.

## 3. Filling forms: the boundary

**The guide never calls a write route.** It returns a `fill` object keyed by
field name for the tab currently open. The client merges it into the form's
local state, the changed fields show as dirty, and the founder presses the
tab's own Save button, which hits the tab's own route with the tab's own
validation. `GuideChat.tsx` already does exactly this merge for a proposal.

That gives three properties worth stating plainly:

1. No new write route exists, so no new authorization surface exists.
2. Every existing refusal still fires, because the save is the save that was
   always there.
3. A founder cannot be surprised. Nothing changes until they press a button
   they already know.

**The tab allowlist is a server-side registry, never a prompt rule.** A guide
that follows you around admin follows you onto Integrations, where every field
is a credential. There is a prompt sentence today telling the model not to
repeat a secret. A prompt rule is not a boundary. A tab is unfillable until
someone writes its schema, and three tabs stay unfillable permanently:

- `integrations`: every field is a credential.
- `exits-admin`: opening an involuntary exit is an act against a person.
- `players`: it holds the identities that hold everything else.

State it as an allowlist. A denylist is wrong the day somebody adds a tab.

**DECISION 3. ANSWERED: start with those five.** `variables` (122 described
fields already), `legal` and `covenant` (field specs landed with the content
editors, so they are free), then `setup` and `work-with-us`, which need schemas
written. Five that work rather than fifty that shrug.

## 4. The cost nobody should discover later

**47 of 50 tabs have no machine-readable field list.** Their fields exist only
as JSX inside `client/src/pages/Admin.tsx`. There are three exceptions:
`variables` (122 described fields in `shared/gameVariables.ts`), and `legal`
and `covenant`, whose field lists landed earlier on this same branch in
`client/src/components/admin/contentFields.ts`. That file is the second worked
example of the shape a schema needs: a path, a label, an input kind, and help
that says what the page does when the box is empty.

Writing those schemas by hand is the single largest line item in this feature,
larger than the dock, the context envelope and the allowlist combined. Any plan
that assumes otherwise ships two working tabs and a guide that is useless on
the rest, which is worse than no guide because it teaches a founder not to
trust it.

## 5. "The LLM of your choosing", which is not true yet

For a village, only the key value is configurable. The provider is hardcoded to
Anthropic and the model is a constant at every call site.

The plumbing already exists one level down, for **members**: `member_llm_keys`
carries a provider, a base URL and a model, and there is a UI for it. So the
work is to lift a shape that exists rather than to invent one.

**DECISION 4. ANSWERED, and it is two rulings.**

*The admin surface uses the VILLAGE key, never the founder's personal one.* A
founder is also a member, and key resolution currently prefers the member key
with the stated reason "It is their money and their provider". That is right
for a member surface and wrong here: work done on behalf of the village is
billed to the village. Admin modes must resolve the village key explicitly
rather than falling through the member-first chain.

*The village key must accept OpenRouter, not only Anthropic.* This was built in
regen civics and should be operable here, so a village can reach other models.
The shape already exists one level down for members (`member_llm_keys` carries
a provider, a base URL and a model): lift it to the village key rather than
inventing a second one. This is its own piece of work and is sequenced BEFORE
the dock, because the dock's error states depend on what can go wrong with a
provider.

**A trap that must be settled either way.** Key resolution puts the **member**
key first. A founder is also a member. A founder who set a personal key on
their profile would have every admin-guide turn billed to themselves and routed
to their own provider, silently, with the village key sitting unused. Decide
explicitly which key an admin surface uses, and say so on screen.

## 6. What is genuinely absent

- **Streaming.** Nothing anywhere. Every reply is one JSON body after the whole
  turn completes. For a several-hundred-token admin answer that is a multi
  second silent wait, on every turn, from a companion that is meant to be
  ambient. Deferring it is defensible; the doc that defers it owes a design for
  the waiting state.
- **Conversation persistence.** Threads live in React state and are resent
  whole each turn. A page reload loses the conversation. What IS persisted is
  spend and drafts.
- **Admin-audience readers.** The nine existing readers cover roles, seats,
  circles, members, quests, badges, decisions, events and map gaps. None of
  them can see brand state, module lifecycles, or which integrations are
  configured, which is most of what a founder will ask about.

## 7. Rate limiting, and how it will look when it bites

The per-IP burst limit is 30 an hour, shared across every mode. A follow-me
guide is used many times per session by definition, and three founders behind
one office address share the bucket. The refusal reads "Slow down a moment,
then keep going", which a founder will read as the guide being broken.

**DECISION 5. ANSWERED: key the limit per USER, not per address, and require a
signed-in user.** Anonymous use of the admin guide is not a thing that should
exist, and keying per user is what makes usage attributable: the point of the
change is that spend and abuse can actually be monitored per person, which a
shared office address makes impossible.

## 8. The blank-brain problem

The guide is grounded in the Village Brain, and the Brain ships blank. Thirteen
founders will meet a guide whose grounding is 14 empty sections.

The studio prompt already has the right instinct for this: with nothing
written, ask about their work rather than assert. An admin guide should do the
same and should say what it does not know, rather than answering from the
platform's defaults as though they were this village's decisions. That failure
mode is the same one the identity guard and the brand ratchet exist to prevent,
arriving through a new door.

## 9. One constraint for whoever builds it

`server/index.ts` is held by a ratchet on BOTH its line count and its number of
registered routes, and the ratchet only ever turns down. **The new route goes
in `server/routes/`**, which already holds 24 route modules. An implementer who
adds it to `server/index.ts` will fail CI without being told why by the error.

Do not read a headroom figure out of this document. It was written on a day the
Hypha merge had just removed a route, so the number was briefly generous and is
already wrong. Run `node scripts/check-server-index-size.mjs` and read your own
tree, the same way `CLAUDE.md` says to read the bundle budget.

## 10. What this doc does not settle

The five decisions above were open when this was written and are answered now.
What remains for the implementer is ordinary sequencing, with one constraint
from the answers: the village-key and OpenRouter work in DECISION 4 lands
BEFORE the dock, because the dock has to render what a provider can do wrong.

## 11. The decisions, as answered

Answered by Rye, 2026-09-04:

1. **Extend the existing dock**, and make it the sole source of truth for the
   assistant. No second assistant UI.
2. **A paragraph per tab AND a documentation project.** The paragraph ships
   with the guide; the documentation project is commissioned separately and
   sequenced after the current admin work.
3. **First tranche of fillable tabs**: variables, legal, covenant, setup,
   work-with-us.
4. **Admin uses the village key**, never the founder's personal one, and the
   village key accepts OpenRouter so a village is not locked to one model
   vendor. Sequenced before the dock.
5. **Rate limit per signed-in user**, not per IP address, so usage is
   attributable and can be monitored.
