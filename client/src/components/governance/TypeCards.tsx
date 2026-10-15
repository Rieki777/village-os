/**
 * THE FIRST STEP: what kind of decision is this?
 *
 * Ported from Hypha's `button-radio.vue` and `StepProposalType.vue` (harvest
 * section 1): icon, title, description in a selectable card, grouped under
 * headings. Their groups are "One-time contributions / Recurring assignments /
 * Organizational assets"; ours are the four in the config, and they are read
 * from the config rather than typed here so a new type joins a group by
 * declaring one.
 *
 * WHAT THE SERVER DECIDES, NOT THIS FILE: whether a type can be published. The
 * executors land lane by lane, and a card that walks a member through five
 * steps toward a route nobody mounted is worse than a card that says plainly
 * that this village cannot open that kind of decision yet. So a type outside
 * `conductable` is not clickable as a proposal. It is still SHOWN, because
 * hiding it would make the village's own governance look smaller than it is.
 *
 * THE LOCK NOW OFFERS SOMETHING, which is the point of this whole card.
 * Four of the five cards ended in a grey rectangle saying the village cannot
 * do this yet: true, and a dead end, and the same sentence four times over is
 * the closest this interface came to telling a village it was behind. Every
 * one of those kinds is in the server's `advisory` list, so the same question
 * can go to the whole village on the real engine as a PRACTICE VOTE, with the
 * real roll and the real weights, and come back with a real answer that
 * changes nothing on its own. A card in that state is live, not greyed, and
 * pressing it opens the practice vote rather than a wizard walk.
 *
 * R55 GOVERNS THESE WORDS. Nothing here counts what the village has not got or
 * ranks it against anything, and no card says a member is not allowed. A card
 * that cannot yet be proposed and cannot yet be practised (no `proposal.open`
 * on this member, or a village that has taken every power already) keeps the
 * plain locked sentence, because at that point saying nothing more IS the
 * honest answer.
 *
 * A TYPE WHOSE ROUTE OPENS THE VOTE ITSELF (`opensVote`: an agreement, a seat,
 * the purpose statement) is live only for a member who may open one, which
 * the server sends as `mayOpenBallot` (audit of Wave 4, 2026-10-01). When the
 * agreement became conductable its card went live for every member, and one
 * without `proposal.open` wrote the whole agreement and was refused at the
 * last step. The village CAN open these, so the locked card says who carries
 * one instead of the plain locked sentence, and still says no member is not
 * allowed.
 *
 * ACCESSIBILITY. The cards are toggle buttons in a named group, not a
 * radiogroup: a radiogroup promises roving focus, where Tab reaches the group
 * and arrows move within it, and every card here stays individually reachable
 * by Tab so a keyboard reader can read all five before choosing. aria-pressed
 * carries the choice, and the chosen card is marked with a ring AND a check,
 * never with colour alone. A type this village cannot conduct is disabled and
 * says why in words.
 */
import { Check, Lock, MessageCircleQuestion } from "lucide-react";
import { TYPE_GROUPS, WIZARD_TYPE_CONFIGS, type WizardType } from "./wizardConfig";

export default function TypeCards({
  chosen,
  conductable,
  advisory,
  mayOpenAdvisory,
  mayOpenBallot,
  onChoose,
  onPractice,
}: {
  chosen: WizardType | null;
  /** Subject types this deployment can actually take to a vote today. */
  conductable: string[];
  /** Subject types it can put to a non-binding vote today. */
  advisory: string[];
  /** Whether THIS member may open one. */
  mayOpenAdvisory: boolean;
  /** Whether THIS member may open a binding vote, which every `opensVote` type's route asks. */
  mayOpenBallot: boolean;
  onChoose: (id: WizardType) => void;
  onPractice: (id: WizardType) => void;
}) {
  return (
    <div role="group" aria-label="What kind of decision" className="space-y-6">
      {TYPE_GROUPS.map((group) => {
        const types = WIZARD_TYPE_CONFIGS.filter((t) => t.group === group);
        if (types.length === 0) return null;
        return (
          <div key={group}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{group}</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {types.map((t) => {
                const Icon = t.icon;
                // A type whose route opens the vote itself asks the opener
                // for proposal.open; without it the card is carried by
                // somebody else, and says so.
                const carried = conductable.includes(t.id) && !!t.opensVote && !mayOpenBallot;
                const available = conductable.includes(t.id) && !carried;
                // A kind this member can put to the whole village as a
                // practice vote. Both halves come from the server: the list
                // is what has no executor yet, the permission is this
                // member's own proposal.open.
                const practice = !available && mayOpenAdvisory && advisory.includes(t.id);
                const isChosen = chosen === t.id;
                const live = available || practice;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={available ? isChosen : undefined}
                    disabled={!live}
                    onClick={() => (available ? onChoose(t.id) : onPractice(t.id))}
                    className={`relative flex min-h-[44px] items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 ${
                      !live
                        ? "cursor-not-allowed border-stone-200 bg-stone-50 opacity-70"
                        : isChosen
                          ? "border-teal-deep bg-teal-deep/5"
                          : "border-stone-200 bg-white hover:border-stone-400 hover:bg-stone-50"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        live ? "bg-teal-deep/10 text-teal-deep" : "bg-stone-200 text-stone-500"
                      }`}
                    >
                      {available ? (
                        <Icon className="w-5 h-5" aria-hidden="true" />
                      ) : practice ? (
                        <MessageCircleQuestion className="w-5 h-5" aria-hidden="true" />
                      ) : (
                        <Lock className="w-4 h-4" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-bold text-stone-900">
                        {t.title}
                        {available && isChosen && <Check className="w-4 h-4 text-teal-deep" aria-hidden="true" />}
                      </span>
                      <span className="mt-0.5 block text-sm text-stone-600 leading-relaxed">{t.description}</span>
                      {practice && (
                        <span className="mt-1.5 block text-xs font-medium text-teal-deep">
                          Ask the village about this one. A real vote, on the real roll, and nothing changes until the
                          village decides it should.
                        </span>
                      )}
                      {!live && (
                        <span className="mt-1.5 block text-xs font-medium text-stone-500">
                          {carried
                            ? "A member who holds the power to open votes puts this one to the village. Ask one of them to carry it."
                            : "This village cannot open that kind of decision yet."}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
