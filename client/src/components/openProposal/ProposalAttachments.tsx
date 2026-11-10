/**
 * A PROPOSAL'S LINKS AND FILES (Rye, 10 Nov 2026; the contract is
 * shared/proposalAttachments.ts).
 *
 *   AttachmentFields   on the open form: up to five labelled https links and
 *                      up to three files, with the data promise under them
 *   AttachedView       on the proposal's page, for the people who decide it
 *
 * The form checks what it can before sending (count, size, https), so most
 * mistakes are answered at once; the server checks everything again, and
 * reads each file's type from its own bytes.
 *
 * A link is drawn as text the decider chooses to open, in a new tab, with no
 * referrer and no opener: the page never fetches or previews it.
 */
import { useLingui } from "@lingui/react/macro";
import { FileText, Link2, Paperclip, Plus, X } from "lucide-react";
import {
  PROPOSAL_FILES_MAX,
  PROPOSAL_FILE_ACCEPT,
  PROPOSAL_FILE_MAX_BYTES,
  PROPOSAL_LINKS_MAX,
  PROPOSAL_LINK_LABEL_MAX,
  PROPOSAL_LINK_URL_MAX,
  fileSizeWords,
  safeHttpsUrl,
  type ProposalFileKind,
  type ProposalLink,
} from "@shared/proposalAttachments";

const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SMALL_BUTTON =
  "inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The address bar's own prefix, the same in every language. */
const HTTPS = "https://";

export const EMPTY_LINK: ProposalLink = { label: "", url: "" };

/** The links worth sending: blank rows dropped. */
export const linksToSend = (links: readonly ProposalLink[]): ProposalLink[] =>
  links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })).filter((l) => l.label || l.url);

export function AttachmentFields({
  links,
  onLinks,
  files,
  onFiles,
  invalid,
}: {
  links: ProposalLink[];
  onLinks: (next: ProposalLink[]) => void;
  files: File[];
  onFiles: (next: File[]) => void;
  /** The server's refusal, when it is about these fields: the form says it at the top; here the field is marked. */
  invalid?: { field: "links" | "files"; message: string } | null;
}) {
  const { t } = useLingui();
  const rows = links.length ? links : [EMPTY_LINK];
  const setRow = (i: number, next: ProposalLink) => onLinks(rows.map((r, k) => (k === i ? next : r)));
  const tooBig = files.find((f) => f.size > PROPOSAL_FILE_MAX_BYTES);
  const add = (picked: FileList | null) => {
    if (!picked) return;
    onFiles([...files, ...Array.from(picked)].slice(0, PROPOSAL_FILES_MAX));
  };
  const mb = PROPOSAL_FILE_MAX_BYTES / 1024 / 1024;
  return (
    <div className="grid gap-5" data-attachments="">
      <fieldset className="grid gap-3" aria-invalid={invalid?.field === "links" || undefined}>
        <legend className="mb-1 text-sm font-semibold text-card-foreground">{t({ message: "Links to your work (optional)", context: "open proposal attachments" })}</legend>
        <p className="text-sm text-muted-foreground">
          {t`Up to ${PROPOSAL_LINKS_MAX} links, each starting with https://. We never open them for you: only the people who decide your proposal see them.`}
        </p>
        {rows.map((r, i) => {
          const bad = r.url.trim() !== "" && !safeHttpsUrl(r.url.trim());
          return (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]" data-link-row={i}>
              <input
                aria-label={t({ message: `Link ${i + 1}: what it is`, context: "open proposal attachments" })}
                placeholder={t({ message: "What it is", context: "open proposal link label placeholder" })}
                maxLength={PROPOSAL_LINK_LABEL_MAX}
                value={r.label}
                onChange={(e) => setRow(i, { ...r, label: e.target.value })}
                className={FIELD}
              />
              <input
                type="url"
                inputMode="url"
                aria-label={t({ message: `Link ${i + 1}: web address`, context: "open proposal attachments" })}
                placeholder={HTTPS}
                maxLength={PROPOSAL_LINK_URL_MAX}
                value={r.url}
                onChange={(e) => setRow(i, { ...r, url: e.target.value })}
                className={FIELD}
                aria-invalid={bad || undefined}
              />
              {rows.length > 1 && (
                <button type="button" className={SMALL_BUTTON} onClick={() => onLinks(rows.filter((_, k) => k !== i))}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">{t({ message: `Remove link ${i + 1}`, context: "open proposal attachments" })}</span>
                </button>
              )}
              {bad && (
                <p className="text-sm text-destructive sm:col-span-3" role="alert">
                  {t`Each link has to be a full web address starting with https://.`}
                </p>
              )}
            </div>
          );
        })}
        {rows.length < PROPOSAL_LINKS_MAX && (
          <div>
            <button type="button" className={SMALL_BUTTON} onClick={() => onLinks([...rows, EMPTY_LINK])}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t({ message: "Add a link", context: "open proposal attachments" })}
            </button>
          </div>
        )}
      </fieldset>

      <fieldset className="grid gap-3" aria-invalid={invalid?.field === "files" || !!tooBig || undefined}>
        <legend className="mb-1 text-sm font-semibold text-card-foreground">{t({ message: "Files (optional)", context: "open proposal attachments" })}</legend>
        <p className="text-sm text-muted-foreground">{t`Up to ${PROPOSAL_FILES_MAX} files: PDF, Word (.docx), PNG or JPG, ${mb} MB each.`}</p>
        {files.length > 0 && (
          <ul className="grid gap-2">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" data-file-row={i}>
                <span className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-muted-foreground">{fileSizeWords(f.size)}</span>
                </span>
                <button type="button" className={SMALL_BUTTON} onClick={() => onFiles(files.filter((_, k) => k !== i))}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">{t({ message: `Remove ${f.name}`, context: "open proposal attachments" })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length < PROPOSAL_FILES_MAX && (
          <label className={`${SMALL_BUTTON} w-fit cursor-pointer`}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t({ message: "Attach a file", context: "open proposal attachments" })}
            <input
              type="file"
              className="sr-only"
              accept={PROPOSAL_FILE_ACCEPT}
              multiple
              onChange={(e) => {
                add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
        {tooBig && (
          <p className="text-sm text-destructive" role="alert">
            {t`Each file has to be ${mb} MB or less.`}
          </p>
        )}
      </fieldset>
      <p className="text-sm text-muted-foreground" data-attachments-promise="">
        {t`Only the people who decide your proposal can see your links and files. No AI reads them. We delete them when we delete your proposal, or when we remove your name and email.`}
      </p>
    </div>
  );
}

/** What the server sends a decider: the links, and each file by name with where to download it. */
export interface ServedAttachments {
  links: ProposalLink[];
  files: Array<{ id: string; kind: ProposalFileKind; name: string; size: number; href: string }>;
}

export function AttachedView({ attached }: { attached: ServedAttachments | null | undefined }) {
  const { t } = useLingui();
  if (!attached || (!attached.links.length && !attached.files.length)) return null;
  return (
    <section aria-labelledby="op-attached" className="grid gap-3" data-attached="">
      <h2 id="op-attached" className="text-lg font-bold text-foreground">
        {t({ message: "Links and files", context: "open proposal attachments heading" })}
      </h2>
      <p className="text-sm text-muted-foreground">{t`Only the people who decide this proposal see these. Open links with care: they lead off this site.`}</p>
      {attached.links.length > 0 && (
        <ul className="grid gap-2">
          {attached.links.map((l) => (
            <li key={l.url} className="flex min-w-0 items-start gap-2 text-sm">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0">
                <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="font-semibold text-foreground underline">
                  {l.label}
                </a>
                <span className="block break-all text-muted-foreground">{l.url}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {attached.files.length > 0 && (
        <ul className="grid gap-2">
          {attached.files.map((f) => (
            <li key={f.id} className="flex min-w-0 items-center gap-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <a href={f.href} download={f.name} className="truncate font-semibold text-foreground underline">
                {f.name}
              </a>
              <span className="shrink-0 text-muted-foreground">{fileSizeWords(f.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
