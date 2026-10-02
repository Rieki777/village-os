# Reporting a security problem

This codebase runs on many separate instances, each one a real community, and each instance holds
that community's member data in its own database. A flaw here is not a flaw in one deployment. It is
a flaw in every village running the image, and most of them will not know until somebody tells them.

So the first rule is the one that matters most.

## Do not open a public issue

A public issue is a disclosure. It reaches every reader of this repository at the same moment it
reaches the maintainer, and it reaches the villages last, because they are running the code and not
watching the repository.

## How to report privately

**Use GitHub private vulnerability reporting.** Go to the Security tab of this repository, choose
"Report a vulnerability", and write it there. The report is visible to the maintainers and to nobody
else, the conversation happens in that thread, and it becomes the advisory when there is one.

That feature is available on public repositories and has to be switched on by the maintainer. If you
are reading this and the button is not there, it has not been enabled yet.

**If private reporting is not available, this is the fallback.** Open an issue whose entire content
is one line saying you have a security report and need a private channel. Put no details in it: not
the file, not the endpoint, not the shape of the bug. A maintainer will open a private thread and
you say the rest there. An empty flag is not a disclosure; a detailed issue is.

**There is no security email address on this project yet.** That is a real gap and not an oversight
you are meant to work around. When there is one it goes on this line, and the two routes above keep
working either way.

## What to put in a report

Enough that somebody can reproduce it without guessing:

- What an attacker gets: read another member's data, write as somebody else, reach an admin surface,
  move value in the ledger, and so on. Impact first.
- The steps, in order, with the request or the input that triggers it.
- The build it was found on. Every instance serves `/health`, which reports a `build` field carrying
  the release label and the git commit the running image was built from. Paste that field. It is the
  single fastest way to tell a real finding from a fixed one.
- Whether you found it by reading this repository or against a running village, and if a village,
  which one and whether you had permission.

## What is in scope

**In scope: the platform code in this repository.** The server, the client, the shared layer, the
migrations, the guards, the workflows, the provisioning documents, and the defaults a fresh village
inherits. Anything that is wrong here is wrong for everybody.

**Out of scope, and it goes to the village instead: one instance's own deployment.** Its hosting, its
environment variables, its domain, its email provider, its uploads volume, its admin's choices, and
its member data are the village's, and only the village can act on them. `docs/PROVISIONING.md` is
the founder's side of that line. If what you found is a misconfiguration of one village rather than a
defect in the code, tell that village. If you cannot reach them, tell us and we will try to.

Some findings are both, and those are the valuable ones. A default that is safe only if an operator
notices something is a platform problem wearing a village's clothes. Report it here.

## Please do not

- Test against a live village. It is somebody's community, the data is real people, and a
  proof-of-concept against a production instance is an incident whatever your intent.
- Read, copy, or keep member data. If you reach some by accident, stop, say so in the report, and
  do not keep a copy.
- Run anything that degrades an instance: load testing, brute force, automated scanners against a
  running village.
- Sit on it. A private report that goes unanswered is a reason to escalate, and the fallback route
  above is there for exactly that.

A report made in good faith under these terms is welcome, and finding a real problem is a
contribution to every community running this code.

## What happens next

One maintainer reads these today, so the honest version of the timeline is:

- **An acknowledgement, with a first read.** You are told whether it reproduces and whether it is
  understood, or what is still unclear.
- **A fix, and an advisory when the fix is real.** Villages run their own infrastructure and upgrade
  on their own schedule, so a merged fix is not a deployed fix. A finding that affects running
  instances gets a published advisory naming the affected builds, so an operator can read their own
  `/health` build marker and know whether it applies to them.
- **Credit, if you want it.** Say in the report whether you want to be named, and how.

If a finding is serious and the villages need to act before a fix exists, the advisory says what to
turn off in the meantime.

## Dependency advisories

`pnpm audit --prod --audit-level high` is a blocking step in CI. Advisories with no upstream fix that
have been assessed for reachability in this codebase are documented in `docs/SECURITY_ADVISORIES.md`,
one entry each, dated, with the argument for why it is not reachable and what would change that. The
suppression list in `package.json` under `pnpm.auditConfig.ignoreGhsas` is not allowed to hold
anything that page does not explain.

If you think one of those reachability arguments is wrong, that is a security report and it belongs
in the private channel, not in a pull request against that page.

## For village operators

The platform reports what it is running. `/health` carries the build marker, and it answers 503
rather than 200 when its database is unreachable, so a probe that says ok is a probe that asked.
`.env.example` is the reference for every environment variable, what it does and what breaks
without it. `docs/FORK_RUNBOOK.md` is the operational reference behind it: every environment
variable, every seed, every provisioning step, and the traps in the order they were learned.

Two things worth checking on your own instance today, whatever else is going on:

- Every secret in your environment is yours and was never shared with another village. The
  integration secrets store is write-only and reads back masked to the last four characters, and it
  refuses to store a plaintext value when no encryption key is set.
- Your backups are yours, are encrypted, and have been restored at least once. A backup nobody has
  restored is a hypothesis.
