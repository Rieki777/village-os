/** A civil day written out, "8 February 2027", beside a date field. */
import { civilDayWords } from "@shared/seasonPlans";

export default function WrittenDate({ iso }: { iso: string }) {
  const words = civilDayWords(iso);
  if (!iso.trim() || words === iso.trim()) return null;
  return (
    <span className="break-words text-sm font-normal text-muted-foreground" data-written-date="">
      {words}
    </span>
  );
}
