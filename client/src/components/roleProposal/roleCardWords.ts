/**
 * Every sentence the role card panels say: bringing a description in, the
 * own-AI prompt, and downloading the card as text (Rye, 2026-10-24). The
 * reader's own problems are shared/roleCardText.ts's and the server's
 * refusals are the server's, drawn as sent.
 *
 * Plain words, "role" for a role, and the village's own name where the
 * sentence names who reads the document.
 */
export const RC_WORDS = {
  // Bring in a description of your role.
  bringIn: "Bring in a description of your role",
  bringInLede: "A document about your role, its words pasted here, or a Google Doc link. A role card fills your draft directly.",
  keepsNothing: (village: string) => `${village} reads your document and does not keep it.`,
  how: "How to bring it in",
  fromFile: "A file",
  fromPaste: "Paste",
  fromLink: "Google Doc",
  chooseFile: "Choose a file",
  fileHint: ".docx, .pdf, .md or .txt, up to 5 MB.",
  pasteLabel: "Your role description, or a role card",
  read: "Read it",
  linkLabel: "Google Doc link",
  linkHint: 'Shared as "anyone with the link".',
  fetchLink: "Bring it in",
  reading: "Reading it",
  fallback: (village: string) =>
    `${village} reads the role card format directly. Paste your description into your own AI with the prompt below, then bring back what it gives you.`,
  copyBoth: "Copy the prompt with your words",
  guideReads: (guide: string) => `${guide} will read it, and suggest what to fill.`,
  theGuide: "The village's guide",
  whatFills: "What this card fills",
  fillsLede: "Untick anything you want to keep as it is. What you keep shows in gold, as every change does.",
  nothingNew: "This card says what your draft says already. There is nothing to fill.",
  checkFirst: "Check these first",
  notRead: (headings: string) => `Not read, since a role card has no place for it: ${headings}.`,
  addsRole: "Adds this role to your proposal",
  backToPosted: "Back to the posted words",
  pickCircle: "Pick its circle",
  fix: "Fix this in the card above, then read it again.",
  keep: (label: string) => `Keep: ${label}`,
  fill: "Fill my draft",
  notNow: "Not now",
  filled: "Your draft is filled. Changed words show in gold below.",

  // Design my role with my own AI.
  ownAi: "Design my role with my own AI",
  ownAiLede: "Copy this prompt into the AI you use. It asks about your role one question at a time, then gives you a role card. Paste that card into Bring in a description of your role, above.",
  copyPrompt: "Copy the prompt",
  copied: "Copied",
  copyFailed: "Copy did not work. Open the prompt below, select it and copy it.",
  readPrompt: "Read the prompt",

  // Download my card as text.
  download: "Download my card as text",
  downloadLine: "Your card in the role card format, to keep, edit, or take to your own AI.",
  downloadFailed: "The card did not download. Try again.",
} as const;
