/**
 * The count on a class tile: how many roles tagged for that class are open
 * now (build days S2). The number is drawn small in the tile's corner and
 * read in full by a screen reader through the tile's description.
 */
import { Plural } from "@lingui/react/macro";

export default function OpenNowBadge({ n, id }: { n: number; id: string }) {
  return (
    <>
      <span aria-hidden="true" className="absolute bottom-1 left-1 rounded-full bg-teal-deep px-1.5 text-[11px] font-semibold leading-5 text-white">
        {n}
      </span>
      <span id={id} className="sr-only">
        <Plural value={n} one="# role open now" other="# roles open now" />
      </span>
    </>
  );
}
