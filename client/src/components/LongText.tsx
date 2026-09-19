/**
 * A `longtext` value, rendered to a member as TEXT.
 *
 * THE PROMISE THIS KEEPS. A longtext dial is words a founder types in Admin
 * and members read on a page. That makes it the one variable type whose value
 * travels from one person's keyboard to another person's screen, so it is the
 * one that must never be interpreted as markup. Everything here renders
 * through React children, which escape by construction: there is no
 * `dangerouslySetInnerHTML` in this file and there must never be one. A value
 * holding a script tag renders as the characters of a script tag.
 *
 * WHAT IT DOES DO:
 *
 *   - keeps the line breaks the author typed (`whitespace-pre-wrap`, so runs
 *     of spaces and tabs survive too and the text still wraps at the edge)
 *   - turns http(s) addresses into links, and nothing else into anything.
 *     `javascript:`, `data:` and `mailto:` are left as plain characters,
 *     because the only reason to linkify at all is that a village's process
 *     text points at its own documents, and the schemes that carry code are
 *     exactly the ones a village never needs a click to run.
 *   - breaks long words (`break-words`), since a pasted URL is one 200
 *     character word and would otherwise push a card sideways on a phone.
 *
 * Trailing punctuation comes off the href. A sentence ending "see
 * https://example.org/guide." means the guide, not a page whose path ends in a
 * full stop, and the stripped characters stay in the visible text so nothing a
 * person typed disappears.
 */

/** http(s) only. The scheme list IS the safety, so keep it closed. */
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

/**
 * Characters that end a sentence rather than an address. Brackets are here in
 * their closing form only: a URL may legitimately contain "(" and a wrapped
 * "(https://example.org/x)" would otherwise link the closing paren.
 */
const TRAILING = /[.,;:!?)\]}'"]+$/;

export interface LongTextPart {
  text: string;
  href: string | null;
}

/**
 * Split a value into text and link parts. Exported so the behaviour is
 * testable without a DOM, and so another surface can render the same parts
 * its own way without a second copy of the rules.
 */
export function longTextParts(value: string): LongTextPart[] {
  const source = String(value ?? "");
  const parts: LongTextPart[] = [];
  let at = 0;
  // `exec` in a loop rather than `for (… of matchAll(…))`: this file compiles
  // under the repo's TypeScript target, where iterating a matchAll result needs
  // downlevelIteration. A fresh regex object per call keeps `lastIndex` local,
  // since the pattern is module-scope and global.
  const scan = new RegExp(URL_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = scan.exec(source)) !== null) {
    const start = match.index;
    const whole = match[0];
    if (start > at) parts.push({ text: source.slice(at, start), href: null });
    const trimmed = whole.replace(TRAILING, "");
    if (trimmed) parts.push({ text: trimmed, href: trimmed });
    const tail = whole.slice(trimmed.length);
    if (tail) parts.push({ text: tail, href: null });
    at = start + whole.length;
  }
  if (at < source.length) parts.push({ text: source.slice(at), href: null });
  return parts;
}

export default function LongText({ text, className }: { text: string; className?: string }) {
  const parts = longTextParts(text);
  return (
    <span className={`whitespace-pre-wrap break-words ${className ?? ""}`}>
      {parts.map((part, i) =>
        part.href ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline"
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}
