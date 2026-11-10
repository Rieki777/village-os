---
name: generated-docs
description: Use when a change touches routes, capabilities, tokens, dials, modules, or user-facing strings, or when CI complains about GOVERNANCE.md, ECONOMICS.md, TOKENS.md, VARIABLES.md, MODULES.md, CAPABILITIES.md or en.po. Main regenerates these; a pull request never commits them.
---

# Generated docs

Main owns eight generated files. Read `docs/GENERATED_DOCS.md` for the full flow; this is the short form.

- Do NOT run a generator and commit its output. Do NOT hand-edit `docs/GOVERNANCE.md`,
  `docs/knowledge/governance-lineage.md`, `docs/TOKENS.md`, `docs/VARIABLES.md`, `docs/MODULES.md`,
  `docs/CAPABILITIES.md`, `client/src/locales/en.po`, or the `generated:` regions of `docs/ECONOMICS.md`.
  The prose around those regions is yours to edit.
- Do change the code. CI runs the generator on your tree and fails if it throws or a rule inside it breaks
  (an unclassified route, a voice breach, a short message with no context).
- Your change to GOVERNANCE.md or ECONOMICS.md appears in the `verify` job summary as a diff. Read it: it is
  what main will publish.
- `check-generated-docs-untouched` fails with "main regenerates these after every merge; drop your change".
  Restore the file: `git checkout origin/main -- <file>`.
- A generator that is wrong is fixed in a pull request on the generator, never on its output.
- Integrator: compose without regenerating or re-extracting. Main's `generated-docs` workflow commits the
  result and opens one issue if a generator fails.
- `GENERATED_DOCS_MODE=strict` makes the doc guards compare byte for byte. Only `generated-docs.yml` sets it.
