/**
 * TWO CIRCLES MEETING, for a circle that consented (decider calm, Phase D).
 *
 * Handed to `CircleConsent` as its `seal` by the decider pages, which already
 * carry the nature kit, so the consent panel itself never imports it (it also
 * feeds the applicant's status page, which must stay off the first page's set).
 */
import { Vesica } from "@/components/journey/nature";

export default function ConsentSeal({ label }: { label: string }) {
  return <Vesica met label={label} size="sm" className="mt-1" />;
}
