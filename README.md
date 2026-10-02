# Village OS

Village OS is software for running a village: a land project, a co-op, a
community of any size. Members take on quests, thank each other in a way the
whole village can see, decide things together by proposal and vote, and can
always see who holds which power and how to give it back. Twenty-five modules
add the rest (a map of the land, a forum, messages, events, stays, a library,
a shared exchange, crowdfunding) and each village chooses which ones it runs.

Amora is the first village to run on it. It is developed with ReGen Civics.

- **Free and open source.** MIT licence (`LICENSE`). Use it, change it, run as
  many villages as you like.
- **You host it yourself.** On a laptop to try it, on a small server you rent,
  or on a hosting provider such as Railway. The software is free; you pay your
  own hosting provider, if you use one.
- **Setup needs a computer.** About an hour the first time, most of it
  waiting. An AI assistant can walk you through it, explaining each step and
  running each command only after you say yes.
- **English today.** The interface and the guides are in English. Other
  languages are planned and not built yet.

## Run your own village

- **[START_HERE.md](START_HERE.md)**: the guide, written for people.
- **[docs/FOUNDER_SETUP_PROMPT.md](docs/FOUNDER_SETUP_PROMPT.md)**: paste it
  into your own AI assistant and it guides you through every step.
- **[AGENTS.md](AGENTS.md)**: the rules that assistant follows.
- The starter kit (`village-os-starter-<version>.zip`), and the image
  `ghcr.io/rieki777/village-os:<version>`, are on the
  [releases page](https://github.com/Rieki777/village-os/releases).

A village runs one published image with its own database, domain and settings.
Its name, words, pictures and modules are set in its own Admin after the first
sign-in, so most villages never touch the code.

## Modules

There is no plugin system. A module is code in this repository, and new ones
reach villages in one of two ways:

- **Offer it to the shared Module Library** by pull request. It is reviewed,
  and once merged it ships in the next release, where every village can turn
  it on. [docs/modules/START_HERE.md](docs/modules/START_HERE.md) explains how
  a module is built and what review checks.
- **Keep it in a private fork** of your own. That is yours to change as you
  like. The further a fork drifts from this repository, the harder each
  upgrade is to merge.

## Get help

- Questions, bugs and ideas: [GitHub issues](https://github.com/Rieki777/village-os/issues).
  Say what you did and what you saw. Never paste a password or a key.
- About the project: <https://regencivics.earth/village-os>.
- A security problem: [SECURITY.md](SECURITY.md) has the private route. A
  public issue is not it.

## Understand it

- [docs/GOVERNANCE.md](docs/GOVERNANCE.md): what a decision is, how a vote is
  counted, and which of the founder's rulings are built. Generated from the
  engine, and a build step fails when the two come apart.
- [docs/TOKENS.md](docs/TOKENS.md): every token a village issues, who may move
  it, and what happens to it when a moon closes. Generated the same way.
- [docs/MODULES.md](docs/MODULES.md): all twenty-five modules.
- [docs/FORK_RUNBOOK.md](docs/FORK_RUNBOOK.md): every environment variable,
  seed and operational trap, with the reasoning.

## Change the platform

Start with [CONTRIBUTING.md](CONTRIBUTING.md): the gates and that they are
enforced, the house writing rules, how migrations are numbered, how a module
is reviewed. [CLAUDE.md](CLAUDE.md) is the working brief for contributors and
their coding assistants, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is
the system map.

`CODE_OF_CONDUCT.md` applies everywhere the project runs.
