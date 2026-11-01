/**
 * One of the library's five shelves (L1): a headed row with the group's gloss
 * and its module cards in a responsive grid. One column on a phone, two from
 * `sm:`, three from `lg:`, and every card carries `min-w-0 break-words` so a
 * long token somewhere cannot scroll the page sideways at 390px.
 */
import type { ReactNode } from "react";

export default function ModuleShelf({
  label, gloss, children,
}: {
  label: string;
  gloss: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="font-display text-xl sm:text-2xl font-bold text-foreground [overflow-wrap:anywhere]">{label}</h2>
      <p className="text-sm text-muted-foreground mt-0.5 mb-4">{gloss}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </section>
  );
}
