import { useState } from "react";
import { CheckCircle2, Download, ExternalLink, TriangleAlert } from "lucide-react";
import {
  GO_LIVE_ENV,
  GO_LIVE_PREREQS,
  GO_LIVE_REFERENCES,
  GO_LIVE_STEPS,
  goLivePackageFilename,
  needLabel,
  needWord,
  renderGoLivePackage,
} from "./goLivePlan";

/**
 * The Go live step, drawn from `goLivePlan.ts`, with a button that saves the
 * same plan as a file.
 *
 * WHY A COMPONENT AND NOT MORE JSX IN Admin.tsx. That file carries a hard line
 * ratchet in CI (`scripts/check-file-lines.mjs`, baseline in
 * `scripts/file-lines-baseline.json`) that permits no growth at all, and it is
 * the file every module contributor has to edit. Wiring: replace the `<ol>`
 * inside the `id="technical"` SetupSection with `<GoLivePackagePanel />` and
 * the step shrinks by about thirty lines while saying more.
 *
 * EVERY COMPONENT IN THIS FILE IS DECLARED AT MODULE SCOPE, including the two
 * small ones below. A component declared inside another component's body is a
 * new type on every render, and React replaces a subtree it cannot match by
 * type. `SetupSection.tsx` carries the full account of what that cost: a
 * founder on a phone lost the keyboard on every keystroke, because the focused
 * input was a different DOM node each time.
 *
 * NO `text-gray-*` ANYWHERE IN THIS FILE. `scripts/check-tailwind-gray.mjs`
 * ratchets those, and a new file is born at zero, so it can only ever stay
 * there. Text colours here are semantic tokens (`text-foreground`,
 * `text-muted-foreground`), which follow a village's own brand. Grey borders
 * and grey surfaces are outside that guard's scope and are used as before.
 */

function PrereqRow({ id }: { id: string }) {
  const p = GO_LIVE_PREREQS.find((entry) => entry.id === id);
  if (!p) return null;
  return (
    <li className="border border-gray-200 rounded-lg px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{p.name}</p>
        <span
          className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${
            p.need === "required"
              ? "bg-teal-deep/10 text-teal-deep"
              : "bg-gray-100 text-muted-foreground"
          }`}
        >
          {needWord(p.need)}
        </span>
      </div>
      {p.when ? (
        <p className="text-xs text-muted-foreground mt-1">
          <span className="font-medium text-foreground">{needWord(p.need)} </span>
          {p.when}.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground mt-1.5">{p.what}</p>
      <p className="text-xs text-muted-foreground mt-1">
        <span className="font-medium text-foreground">Cost: </span>
        {p.cost}
      </p>
      {p.where ? (
        <p className="text-xs text-muted-foreground mt-1">
          <ExternalLink className="w-3 h-3 inline-block mr-1 align-[-1px]" />
          {p.where}
        </p>
      ) : null}
      {p.certainty === "unverified" ? (
        <p className="text-xs text-amber-700 mt-1.5 flex items-start gap-1.5">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Unverified. {p.note}</span>
        </p>
      ) : p.note ? (
        <p className="text-xs text-muted-foreground mt-1.5 italic">{p.note}</p>
      ) : null}
    </li>
  );
}

function StepBlock({ id }: { id: string }) {
  const s = GO_LIVE_STEPS.find((entry) => entry.id === id);
  if (!s) return null;
  return (
    <li className="border-l-2 border-gray-200 pl-4">
      <p className="text-sm font-semibold text-foreground">
        {s.n}. {s.title}
        {s.humanOnly ? (
          <span className="ml-2 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-muted-foreground align-middle">
            Only you can do this one
          </span>
        ) : null}
      </p>
      <p className="text-xs text-muted-foreground mt-1">{s.why}</p>
      <ul className="mt-2 space-y-1">
        {s.points.map((point) => (
          <li key={point} className="text-xs text-muted-foreground flex items-start gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-40" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      {(s.commands ?? []).map((c) => (
        <div key={c.code} className="mt-2">
          <pre className="bg-gray-900 text-green-300 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre">
            {c.code}
          </pre>
          {c.note ? (
            <p
              className={`text-xs mt-1 ${c.unverified ? "text-amber-700" : "text-muted-foreground"}`}
            >
              {c.unverified ? "Unverified. " : ""}
              {c.note}
            </p>
          ) : null}
        </div>
      ))}
    </li>
  );
}

export default function GoLivePackagePanel({
  villageName,
}: {
  /** The village's own name, when the caller has the brand record loaded. */
  villageName?: string;
}) {
  const [saved, setSaved] = useState(false);

  /* One click, one file, built from the same lists the page above renders.
     The blob is revoked straight after the click, which is what every other
     download in this codebase does (VillageMap's SVG export, the member data
     export in NotifyPrefsPanel). */
  const download = () => {
    const text = renderGoLivePackage({
      villageName,
      generatedOn: new Date().toISOString().slice(0, 10),
    });
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = goLivePackageFilename(villageName);
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-semibold text-foreground">Take this with you</p>
        <p className="text-xs text-muted-foreground mt-1">
          One markdown file with every step below, the commands, the variables and the
          repository references. Save it, hand it to a developer, or give it to your own AI
          assistant, which explains each step and runs a command only after you say yes. It
          carries none of your secrets: every value in it is a placeholder.
        </p>
        <button
          type="button"
          onClick={download}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium"
        >
          <Download className="w-4 h-4" />
          Download the go-live package
        </button>
        {saved ? (
          <p className="text-xs text-muted-foreground mt-2">
            Saved as {goLivePackageFilename(villageName)}. Check your downloads folder.
          </p>
        ) : null}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-foreground">
          Before any command here can run
        </h4>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          Accounts and access, in the order you need them. Each one says what it is for and
          what it costs. Where this platform's own repository could not confirm something, the
          entry says so instead of guessing.
        </p>
        <ul className="space-y-2">
          {GO_LIVE_PREREQS.map((p) => (
            <PrereqRow key={p.id} id={p.id} />
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-foreground">The steps</h4>
        <ul className="mt-3 space-y-5">
          {GO_LIVE_STEPS.map((s) => (
            <StepBlock key={s.id} id={s.id} />
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-foreground">The variables</h4>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          What each one is, and what breaks without it. The full list, with the reasoning, is
          in .env.example.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-gray-200">
                <th className="py-1.5 pr-3 font-medium">Variable</th>
                <th className="py-1.5 pr-3 font-medium">Needed</th>
                <th className="py-1.5 pr-3 font-medium">What breaks without it</th>
                <th className="py-1.5 font-medium">Where it is set</th>
              </tr>
            </thead>
            <tbody>
              {GO_LIVE_ENV.map((v) => (
                <tr key={v.name} className="border-b border-gray-100 align-top">
                  <td className="py-1.5 pr-3">
                    <code className="text-foreground">{v.name}</code>
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{needLabel(v)}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{v.breaks}</td>
                  <td className="py-1.5 text-muted-foreground">{v.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-foreground">
          Where the detail lives in the repository
        </h4>
        <ul className="mt-2 space-y-1">
          {GO_LIVE_REFERENCES.map((r) => (
            <li key={r.path} className="text-xs text-muted-foreground">
              <code className="text-foreground">{r.path}</code> {r.what}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
