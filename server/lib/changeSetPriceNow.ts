/**
 * WHAT A CHANGE SET WOULD BE VOTED AT IF IT WENT TO THE VOTE NOW.
 *
 * The open-ballot route and the dry run both ask this, so the price a member
 * previews is the price the ballot freezes (I.21). It reads the village's
 * method and its own unity and quorum the way the open-ballot route always
 * has: a village that decides on Hypha is priced as `custom` here, because
 * the on-site engine conducts its numbers.
 *
 * Two things the open-ballot route adds on top, because they depend on the
 * proposal's own history and not on its changes: a proposal brought back after
 * a steward's veto, and a held Hypha outcome, are both priced at the village's
 * highest set tier. The preview of a change set that is not yet a proposal has
 * neither.
 */
import { numberVar, stringVar } from "./variables";
import { priceChangeSetItems, type ChangeInput, type ChangeSetItemsPrice } from "./mechanics";
import { thresholdSettingsFrom } from "../../shared/ballotSubjects";
import { villageBallotMethod, type BallotMethod } from "../../shared/governanceEngine";

export interface VillageReaders {
  numberVar: (key: string) => number;
  stringVar: (key: string) => string;
}

const LIVE: VillageReaders = { numberVar, stringVar };

/** The method a village-wide ballot conducts here, with Hypha read as `custom`. */
export function conductedMethod(read: VillageReaders = LIVE): BallotMethod {
  const conducts = villageBallotMethod(read.stringVar("governance.default_method"));
  return conducts === "hypha" ? "custom" : conducts;
}

export function changeSetPriceNow(changes: readonly ChangeInput[], read: VillageReaders = LIVE): ChangeSetItemsPrice {
  return priceChangeSetItems(
    changes,
    conductedMethod(read),
    {
      unityPct: Math.max(0, read.numberVar("governance.unity_pct")),
      quorumPct: Math.max(0, read.numberVar("governance.quorum_pct")),
    },
    thresholdSettingsFrom((key) => read.numberVar(key), (key) => read.stringVar(key)),
  );
}

/** The price as the dry run returns it: numbers and indexes, no internal names. */
export interface PricePreview {
  criticality: string;
  method: BallotMethod;
  unityPct: number;
  quorumPct: number;
  /** Set when two changes want two different methods and so cannot share a vote. */
  conflict: string | null;
  setBy: number[];
  items: { index: number; criticality: string; unityPct: number; quorumPct: number; setsTheBar: boolean }[];
}

export function pricePreview(changes: readonly ChangeInput[], read: VillageReaders = LIVE): PricePreview {
  const { set, items, setBy } = changeSetPriceNow(changes, read);
  return {
    criticality: set.criticality,
    method: set.method ?? conductedMethod(read),
    unityPct: set.dials.unityPct,
    quorumPct: set.dials.quorumPct,
    conflict: set.conflict,
    setBy,
    items: items.map((i) => ({
      index: i.index,
      criticality: i.criticality,
      unityPct: i.dials.unityPct,
      quorumPct: i.dials.quorumPct,
      setsTheBar: i.setsTheBar,
    })),
  };
}
