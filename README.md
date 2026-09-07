# game-amora

A white-label village-coordination platform. One codebase runs every
instance; each village gets its own database, domain and environment, never
its own copy of the code (`docs/ARCHITECTURE.md`).

Pick the door that matches why you are here.

## Standing up your own village

Read **`docs/PROVISIONING.md`**. It is the ordered walkthrough from nothing
to a running instance with your own name on it, for both self-hosting and
having ReGen Civics host it for you.

Never used a terminal before? Paste **`docs/FOUNDER_SETUP_PROMPT.md`** into
your own Claude session instead and let it walk you through
`docs/PROVISIONING.md` step by step.

## Operating an existing instance

Read **`docs/FORK_RUNBOOK.md`**. It is the living reference for every
environment variable, seed, provisioning step and operational trap this
platform has, in the order they were learned. `docs/PROVISIONING.md` is
distilled from it; this is where the full reasoning lives.

## Understanding the tokens

Read **`docs/TOKENS.md`**. It names every token a village issues, what each one
means in one sentence, who may issue it, who may move it, and what happens to
it when a moon closes. It is generated from the migrations and the server
source, and a build step fails when it and the code have come apart, so it is
safe to trust rather than a snapshot of what was true once.

## Understanding governance

Read **`docs/GOVERNANCE.md`**. It says what a decision is, how a vote is
counted, what each kind of decision asks of the village, what happens when one
carries, and which of the founder's rulings are built today. It is generated
from the engine and the route registrations, and a build step fails when it and
the code have come apart, so it is safe to trust. It names what is broken as
well as what works.

## Building or changing the platform

Start with **`CLAUDE.md`** at the repository root, then
**`docs/ARCHITECTURE.md`** for the system map. Adding a module has its own
guide at **`docs/modules/START_HERE.md`**.

Before you open a pull request, read **`CONTRIBUTING.md`**: the gates and that
they are enforced, the house writing rules, the migration numbering rules, and
how a module is reviewed. Found a security problem? **`SECURITY.md`** has the
private route, and a public issue is not it.

MIT licensed (`LICENSE`). `CODE_OF_CONDUCT.md` applies everywhere the project
runs.
