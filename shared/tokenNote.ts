/**
 * WHAT AN EQUITY-KIND TOKEN IS, IN PLAIN WORDS (the lead, 2026-11-11).
 *
 * "These tokens track contributions that weren't paid; they have no financial
 * value yet; and what they will represent is still being decided together."
 * Nothing here promises a conversion to cash or to equity. It is the platform's
 * neutral default for a token of kind `equity` whose village has written no
 * description of its own (`tokens.description`, Admin, Tokens). A village's own
 * words always win: Amora's are in server/seeds/amora/token-descriptions-seed.json.
 *
 * Words only. It changes no ledger behaviour, amount or rule.
 */
export function equityTokenNote(tokenName: string): string {
  const name = tokenName.trim() || "This token";
  return `${name} tracks contributions that were not paid. It has no financial value yet. What it will represent is still being decided together.`;
}
