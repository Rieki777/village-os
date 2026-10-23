import { Fragment, type ReactNode } from "react";

/**
 * A founder's paragraph with `**double stars**` drawn bold.
 *
 * The one piece of formatting the page fields accept. A full markup language
 * would be a second thing to learn and a way to break the layout; bold is the
 * emphasis the pages already used.
 */
export function Emphasized({ text, strongClassName }: { text: string; strongClassName?: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className={strongClassName}>
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * A headline with one phrase drawn in an accent colour. The phrase must appear
 * in the headline as typed; when it does not (the founder changed the
 * headline and not the phrase), the headline is drawn plain rather than with a
 * stray coloured word nobody asked for.
 */
export function Highlighted({
  text,
  phrase,
  render,
}: {
  text: string;
  phrase: string;
  render: (phrase: string) => ReactNode;
}) {
  const at = phrase ? text.indexOf(phrase) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      {render(phrase)}
      {text.slice(at + phrase.length)}
    </>
  );
}
