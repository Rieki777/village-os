<!--
Adding or changing a MODULE LISTING? Use the module template instead:
https://github.com/ReGen-Civics/village-os/compare?template=module-listing.md

New here? CONTRIBUTING.md. Security problem? Do not open this. See SECURITY.md.
-->

## What this changes, and why

<!-- One or two sentences. The why is the part a reviewer cannot reconstruct. -->

## Gates

Run cold, in the order `node scripts/module-facts.mjs` prints. **Paste the real exit codes.** A
guard whose last line is blank on failure is why the code matters and the output does not.

| Gate | Exit code |
|---|---|
| `pnpm check` | |
| `pnpm build` | |
| `pnpm test` | |
| the guard scripts this change touches | |

- [ ] Everything above ran on the current head of this branch, not on an earlier one.
- [ ] Anything I did not run is listed here with a sentence saying why.

## Migration

- [ ] **No migration in this pull request.**
- [ ] **Migration included.** Number: `________`. Named here before the file was created
      (maintainers keep the claims in the private fleet ledger), and `node scripts/check-migration-numbers.mjs --next` agrees.
  - [ ] It only ADDS. The previous release can still read and write what it produces.
  - [ ] It is a new file. No shipped migration file was edited.
  - [ ] It is below 9000. That band belongs to villages, never to upstream.

## The platform and village boundary

One codebase runs every village. A change that assumes one village's name, domain, data or
arrangement is a change every other village inherits and has to work around.

- [ ] This change carries no village's brand into platform code, and the brand guard agrees.
- [ ] Anything village-specific went to config, not to code. If it is a knob, it is almost
      certainly a game variable.
- [ ] It does not require an operator to notice something for a fresh village to be safe.

## Copy

- [ ] Any language a member reads passes `node scripts/check-voice.mjs` and
      `node scripts/check-hyphen-dash.mjs`, and any `voice-ok:` waiver in this diff is explained
      below.

<!-- Waivers, and why: -->
