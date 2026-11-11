/**
 * THE FIVE STEPS OF /roles/select, as stepping stones on a trail (the journey
 * kit's Trail, components/journey). Each stone is a real button.
 *
 * A step you have reached stays open to go back to; one ahead of you opens
 * only through "Next", so nobody lands on Apply with nothing chosen. The water
 * between the stones is a progressbar for a screen reader and fills for
 * everyone else.
 */
import Trail from "@/components/journey/Trail";

export default function SelectStepper({
  labels,
  step,
  reached,
  onGo,
  barLabel,
}: {
  labels: readonly string[];
  step: number;
  reached: number;
  onGo: (i: number) => void;
  barLabel: string;
}) {
  return <Trail className="mt-6" labels={labels} step={step} reached={reached} onGo={onGo} barLabel={barLabel} />;
}
