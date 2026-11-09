/**
 * THE BUILDER'S JOURNEY on the Module Library page (build days S3).
 *
 * The builders' invitation used to be one small card with two links. Rye
 * asked (Village OS × Jared plan v3, §6 and §10) for it to be much bigger and
 * to link the repository, so a builder can hand it straight to their agent:
 * the five steps, worked examples, and a block of text to paste.
 *
 * Every link is derived from `BUILDER_GUIDE_URL`, the UPSTREAM repository, for
 * the reason that constant gives: modules ship by pull request to upstream and
 * by no other route, so every fork points at the same place.
 *
 * Words live here, in shared/, where `check-voice` reads them, as the rest of
 * this page's copy does. What the builders' pool pays is said by the existing
 * card's sentence and nowhere new (constitution V.1).
 */
import { BUILDER_GUIDE_URL } from "./moduleCatalog";

/** The upstream repository's blob root, e.g. `https://github.com/<owner>/<repo>/blob/main/`. */
export const REPO_BLOB_ROOT = BUILDER_GUIDE_URL.replace(/docs\/modules\/[^/]+$/, "");

/** The upstream repository's home page, for "open a pull request". */
export const REPO_HOME = REPO_BLOB_ROOT.replace(/\/blob\/[^/]+\/$/, "");

/** A file in the upstream repository, by its path from the root. */
export function repoDoc(path: string): string {
  return `${REPO_BLOB_ROOT}${path.replace(/^\/+/, "")}`;
}

export const START_HERE_URL = BUILDER_GUIDE_URL;
export const MODULE_CONTRACT_URL = repoDoc("docs/MODULE_LIBRARY_CONTRACT.md");

export interface BuilderStep {
  title: string;
  line: string;
  /** A command to show in code type, when the step has one. */
  command?: string;
  link?: { label: string; href: string };
}

export const BUILDER_STEPS: readonly BuilderStep[] = [
  {
    title: "Read the contract",
    line: "It says what a module may do, what it must never touch, and how a village switches it on and off.",
    link: { label: "The Module Library contract", href: MODULE_CONTRACT_URL },
  },
  {
    title: "Paste the guide into your agent",
    line: "Give START_HERE to the AI you build with. It walks you both through the repository and the first files to write.",
    link: { label: "START_HERE", href: START_HERE_URL },
  },
  {
    title: "Run the module facts",
    line: "One command prints every check the pull request will face, read from the workflows themselves.",
    command: "node scripts/module-facts.mjs",
  },
  {
    title: "Open the pull request",
    line: "Send it to the upstream repository. A person reads every module before it ships.",
    link: { label: "The repository", href: REPO_HOME },
  },
  {
    title: "Get listed",
    line: "Once it lands, your module appears on this page in every village, off until a village chooses it.",
  },
];

export interface WorkedExample {
  title: string;
  line: string;
  href: string;
}

export const BUILDER_EXAMPLES: readonly WorkedExample[] = [
  {
    title: "A connected tool: organisational memory",
    line: "An outside service keeps what an organisation knows, and the module syncs it in with a review step for people.",
    href: repoDoc("docs/modules/organisational-memory.md"),
  },
  {
    title: "A personal practice: Gene Keys",
    line: "Opt-in personal profiles, shown in context only, with every line the member's own to share or hide.",
    href: repoDoc("docs/modules/gene-keys.md"),
  },
  {
    title: "A shared ritual: live sessions",
    line: "Templates for gatherings, with drop-ins like a shared breath or a bell, run together in real time.",
    href: repoDoc("docs/modules/live-sessions.md"),
  },
];

/**
 * The text a builder copies into their agent. Plain, so it pastes anywhere,
 * and it names the two documents by full address because an agent cannot
 * follow a relative link.
 */
export function agentHandoffText(): string {
  return [
    "I want to build a module for Village OS, the open source village software.",
    `First read the guide: ${START_HERE_URL}`,
    `Then read the Module Library contract: ${MODULE_CONTRACT_URL}`,
    "Help me plan the module, write it test first, and keep to the contract.",
    "Before we open the pull request, run: node scripts/module-facts.mjs",
    `Open the pull request against ${REPO_HOME}`,
    "The module I want to build: ",
  ].join("\n");
}
