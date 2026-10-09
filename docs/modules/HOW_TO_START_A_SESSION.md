# How to start a coding session and build a module

Provenance: platform

The human steps, once. When you reach the end you will have a fork, a working checkout, and an
assistant that has read the right things. Then you open `docs/modules/START_HERE.md` and it takes over.

Nothing here is specific to one assistant. Any coding tool that can read files in a repository and run
commands in a terminal works. Claude Code is the worked example because it is what the platform's own
sessions use, so it is the path that gets exercised daily.

## 1. Fork the repository

Fork `ReGen-Civics/village-os` on GitHub, then clone your fork.

```
git clone https://github.com/<your-username>/village-os.git
cd village-os
git remote add upstream https://github.com/ReGen-Civics/village-os.git
```

The `upstream` remote matters later: modules ship by pull request to upstream and by no other route, so
you will be pulling from it and opening pull requests against it.

## 2. Get the toolchain

You need Node and pnpm. **Use Node 22.** The version is pinned in `.node-version` and CI runs it, so a
newer local runtime can build green and go red in CI with no local signal. That is a real trap and it
is written up in `CLAUDE.md`.

```
node --version          # expect 22.x
corepack enable         # pnpm comes from package.json "packageManager"
pnpm install --frozen-lockfile
```

A database is only needed for the database-backed test suites. Without one they skip loudly rather than
pass hollowly, which is enough to start building. When you want the full suite, `docs/FORK_RUNBOOK.md`
covers provisioning.

## 3. Install a coding assistant

Any tool that reads the repository and runs terminal commands will do. The worked example:

```
npm install -g @anthropic-ai/claude-code
```

Then open your fork and start a session in it:

```
cd village-os
claude
```

Installation commands change. If that one fails, take the current one from the tool's own
documentation rather than from this file.

**Whichever tool you use, start the session inside the repository directory.** The documents below
assume the assistant can read the files around it.

## 4. Give it the starting prompt

Open `docs/modules/START_HERE.md`, copy the whole file, and paste it as the first message of your
session.

That file is written to be read by an assistant. It routes to the living sources instead of restating
them, so it stays correct as the code changes, and its first instruction is to run
`node scripts/module-facts.mjs`, which prints the current field list, vocabularies, gate commands and
budgets. Let it run that before it writes anything. A module built against a remembered field list is a
module that fails the lint.

Then say what you want to build, in one sentence, naming the capability without marketing words. That
sentence is stage 0 of the listing process and you will reuse it in the pull request.

## 5. Know what "done" looks like

Three things, in this order. None of them is optional and the first two are mechanical.

**The gates, green, cold.** Run them in the order `node scripts/module-facts.mjs` prints, which is the
order CI runs them. Cold matters: the test typecheck's incremental cache will report an error that is
already fixed and miss one that is not.

**The listing lint, clean.**

```
node scripts/validate-module.mjs <your-module-id>
```

It loads the real registry and calls the same function the server asserts with at boot. Read its
closing section too, the one listing what it cannot check. Those are real obligations with a human
behind each.

**A pull request against upstream, using the module listing template.** The template is a checklist
mirroring the contract and the eleven stages. Fill it in honestly: an unchecked box with a sentence
explaining why is a good answer, and a checked box that is not true is the fastest way to lose a
reviewer's trust.

Within minutes an automated check comments with the first stage that is blocking. Within ten working
days a human answers the parts that need judgement. A human security review is required before any
merge, because your code runs inside every fork's server process and the review is the only boundary
there is. `docs/modules/REVIEW_CHECKLIST.md` is what that reviewer uses, and reading it first is the
cheapest way to pass it.

## If you get stuck

- `node scripts/module-facts.mjs` for anything shaped like "what are the valid values for".
- `docs/modules/BUILDING_A_MODULE.md` for anything shaped like "how do I".
- `docs/MODULE_LIBRARY_CONTRACT.md` for anything shaped like "what am I agreeing to".
- `CLAUDE.md` for anything shaped like "why did that fail".
