/**
 * WHO A DRAFTED LETTER GOES TO, read on the server and shown only to the person
 * at the Admin screen (role journey L13, letters). The connector never sees an
 * address: it names an application, and this finds where that application's
 * mail goes. An open proposal keeps its own address; a member's application
 * goes to the candidate's account.
 */
import type { Pool } from "mysql2/promise";
import type { UsersRepo } from "../repos/users";
import { readOpenProposal } from "../repos/openProposals";
import { candidateOfApplication } from "../repos/agentProposals";

export interface LetterRecipient {
  email: string;
  name: string | null;
  userId: string | null;
}

export async function recipientFor(db: Pool, members: Pick<UsersRepo, "byId">, ref: string): Promise<LetterRecipient | null> {
  if (/^op-[0-9a-f]{20}$/.test(ref)) {
    const p = await readOpenProposal(db, ref);
    return p?.email ? { email: p.email, name: p.name ?? null, userId: null } : null;
  }
  if (/^sa-[A-Za-z0-9_-]{4,60}$/.test(ref)) {
    const id = await candidateOfApplication(db, ref);
    const m: any = id ? await members.byId(String(id)) : null;
    return m?.email ? { email: String(m.email), name: m.name ? String(m.name) : null, userId: String(m.id) } : null;
  }
  return null;
}
