/**
 * THE INVESTOR PACKET RECEIPT, through the village's Words (Admin, Comms,
 * Words, "Investor packet requests").
 *
 * A visitor asks for the investor packet on the investor page and gets one of
 * two emails, chosen by what actually happened: `investor.packet` when
 * documents went with it, `investor.thanks` when the packet is empty, so
 * nobody is told a packet is attached that is not.
 *
 * Until 2026-10-23 both were HTML typed into server/index.ts: a heading in
 * one fixed colour, words no village could change, and a promise that a
 * person would be in touch "within 48 hours", which only a village can make.
 * Now the words are the village's own (shared/comms/defaults/templates.ts
 * holds the platform's, which promise no time), and the frame is every other
 * comms email's: the village's name, logo and brand colours.
 *
 * The document list is a merge field of links: each document, and its page on
 * the site where it has one. Titles are escaped by the renderer like every
 * other value, and a link that is not http or https is dropped.
 */
import type { Pool } from "mysql2/promise";
import type { MergeLink } from "../../shared/comms/mergeFields";
import { loadEmailVillage, renderTemplate } from "./comms/render";

export interface PacketDocument {
  title: string;
  /** Where the document downloads from, absolute. */
  href: string;
  /** Its own page on the site, absolute, when it has one. */
  pageHref?: string | null;
}

/** The two keys, by whether the packet holds anything. */
export function investorPacketKey(documents: readonly PacketDocument[]): "investor.packet" | "investor.thanks" {
  return documents.length ? "investor.packet" : "investor.thanks";
}

/** The documents as the merge field's links: each one, then its page on the site. */
export function packetLinks(documents: readonly PacketDocument[]): MergeLink[] {
  return documents.flatMap((d) => [
    { label: d.title, href: d.href },
    ...(d.pageHref ? [{ label: `${d.title}, on the site`, href: d.pageHref }] : []),
  ]);
}

/** The receipt for one request: subject, HTML and plain text, in the village's own words and look. */
export async function investorPacketEmail(
  getPool: () => Pool,
  origin: string,
  input: { name: string; documents: readonly PacketDocument[] },
): Promise<{ subject: string; html: string; text: string }> {
  const village = await loadEmailVillage(getPool(), origin);
  const name = String(input.name ?? "").trim();
  const email = await renderTemplate(
    investorPacketKey(input.documents),
    {
      "person.firstName": name.split(/\s+/)[0] ?? "",
      "person.name": name,
      "packet.documents": { links: packetLinks(input.documents) },
    },
    { getPool, village },
  );
  return { subject: email.subject, html: email.html, text: email.text };
}
