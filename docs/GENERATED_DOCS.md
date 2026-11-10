# Generated docs: main owns them

Eight files are written by generators out of the code. A pull request never commits them.
Main regenerates them after every merge.

| File | Generator | Kind |
|---|---|---|
| `docs/GOVERNANCE.md` | `scripts/generate-governance-doc.mjs` | whole file |
| `docs/knowledge/governance-lineage.md` | same script | whole file |
| `docs/TOKENS.md` | `scripts/generate-token-doc.mjs` | whole file |
| `docs/VARIABLES.md` | `scripts/generate-variables-doc.mjs` | whole file |
| `docs/MODULES.md` | `scripts/generate-modules-doc.mjs` | whole file |
| `docs/CAPABILITIES.md` | `scripts/generate-capabilities-doc.mjs` | whole file |
| `docs/ECONOMICS.md` | `scripts/generate-economics-doc.mjs` | only the `<!-- generated:NAME start/end -->` regions; the prose around them is a person's |
| `client/src/locales/en.po` | `pnpm i18n:extract` (lingui) | whole file |

The registry is `GENERATED_FILES` in `scripts/lib/generatedDocs.mjs`. Add a new generated file there
first; the guard and the tests read that list.

`client/src/locales/es.po` is not on the list: it holds people's translations, so a pull request that
translates a string edits it. The workflow's extraction keeps its structure (new messages, obsolete
ones) current without touching a translation.

## Why

Every pull request that added a route or a capability had to commit these files regenerated. Every
landing on main then made every open pull request conflict on them, GitHub runs no CI on a conflicted
pull request, and on 9 November 2026 about twelve lanes re-merged main and re-pushed, six runners
each time, for hours. The documents were the most common reason a pull request went red.

## The flow

1. **A lane changes code.** It does not run a generator and does not commit a generated file.
2. **CI runs in PR mode.**
   - `check-generated-docs-untouched.mjs` fails the pull request if it edits a generated file
     (or a generated region of ECONOMICS.md). The message says "main regenerates these after every
     merge; drop your change" and prints the `git checkout <base> -- <file>` that restores it.
   - Each doc guard (`check-governance-doc.mjs` and its siblings, `server/db/governanceDoc.test.ts`,
     `server/db/tokenDoc.test.ts`, `check-i18n-catalogs.mjs`) still RUNS the generator and still fails
     when it throws or when a rule inside it breaks (an unclassified route, a house-voice breach, a
     missing marker, a new short message with no context). What they no longer ask is that the
     committed file equal the output.
   - The would-be diff of `GOVERNANCE.md`, `governance-lineage.md` and the `ECONOMICS.md` regions is
     written to the job summary of the `verify` job, so a reviewer sees every governance and economics
     change the pull request makes. It is the committed file against what this tree generates, so it
     can also show a neighbouring change main has not yet regenerated.
3. **The merge.** The integrator composes and lands without regenerating anything.
4. **Main regenerates.** `.github/workflows/generated-docs.yml` runs every generator on the push to
   main and, when anything changed, makes ONE bot commit (author `github-actions[bot]`). It checks the
   generators are idempotent before it commits, and then runs every doc guard in strict mode.
5. **A generator fails.** The job goes red, nothing is committed, and ONE issue titled "Generated docs
   failed on main" is opened or updated naming the generator. Close it when a run is green.

## Modes

`GENERATED_DOCS_MODE` is `strict` only inside `generated-docs.yml`. Everything else is PR mode, the
default, including a lane's machine, so a lane never has to think about it.

`ci.yml` never sets strict. The merge commit of a pull request is one bot commit older than its docs,
so a strict check there would be red on every merge. "Main's docs equal the code" is a claim that can
only be made after the bot has written, which is where strict runs.

To check a tree strictly by hand (for example to see what the bot will do): `GENERATED_DOCS_MODE=strict node scripts/check-governance-doc.mjs`.
To see what changes locally, run the generator, read `git diff`, and then `git checkout -- docs client/src/locales`
before you commit. Do not commit it.

## A generator is broken

Fix the generator or the code it reads, in a pull request. Never fix a generator's output by hand.
If a pull request ADDS a generated region to `ECONOMICS.md`, it adds the markers (a new region is
allowed); main fills it.

## Deploys

The bot commit is a push to main, so the host deploys it. That is wanted: `governance-lineage.md` ships
in the image and the assistant reads it, so a deploy that skipped the docs would leave the assistant
describing the previous code. Do not add watch paths that skip it.

The bot commit starts no CI run (a push made with the built-in `GITHUB_TOKEN` starts no workflow), which
is also what stops a loop.

## Moving to a new repository

The workflow uses only the built-in `GITHUB_TOKEN`, no secret and no repository name. Two settings must
hold on the new repository:

- Settings, Actions, General, Workflow permissions: the workflow asks for `contents: write` and
  `issues: write` itself, which works under the default "read" setting; an organization policy that
  forbids elevating it must be relaxed for this workflow.
- Main must allow the Actions bot to push. If main ever gets branch protection or a ruleset that
  requires pull requests, the bot cannot push. Stop and decide before changing it: the safe options are a
  bypass entry for the `github-actions` app in that rule, or a second workflow that opens a pull request
  with the regenerated files (which then needs a human merge each time and is slower).

## For lane briefs and the integrator

One line for every lane brief: "Do not run or commit the generators' output (GOVERNANCE.md, ECONOMICS.md
regions, TOKENS.md, VARIABLES.md, MODULES.md, CAPABILITIES.md, en.po); main regenerates them after the merge."

Integrator compose checklist: do not regenerate or re-extract on the composed tree, and do not commit
generated files in a batch commit. Read the job summary for the GOVERNANCE.md and ECONOMICS.md diffs
before landing. A lane branch that still carries a regenerated copy (made before this flow) drops it with
`git checkout origin/main -- <file>`; the guard names the files.
