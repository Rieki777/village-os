/**
 * THE SPRING PLOT: the email guild, played against the village's real comms
 * setup. Its state is the comms checklist (springModel.ts); its buttons are
 * the routes Comms Settings uses (SpringPackets.tsx). The guide in the dock
 * speaks in fixed lines chosen by that state, so it needs no AI key and can
 * never say something the checklist does not.
 */
import { useState } from "react";
import type { DomainPanel, SettingsPayload } from "@/components/admin/comms/commsSettingsApi";
import ForestScene from "./ForestScene";
import SpringPacket from "./SpringPackets";
import type { SeedState } from "./setupGameApi";
import { commsIsOn, springBeats, springJournal, stoneWeather, type BeatId } from "./springModel";

const ACCOUNT_KEY = "setup-game:resend-account";

function readTick(): boolean {
  try {
    return window.localStorage.getItem(ACCOUNT_KEY) === "yes";
  } catch {
    return false;
  }
}

export interface SpringProps {
  comms: SettingsPayload | null;
  domain: DomainPanel | null;
  seeds: Record<string, SeedState>;
  village: string;
  guide: string;
  phase: "before-launch" | "after-launch";
  setComms: (p: SettingsPayload) => void;
  setDomain: (d: DomainPanel | null) => void;
}

function lines(current: BeatId | "done", comms: SettingsPayload | null, storm: boolean, phase: SpringProps["phase"]): string[] {
  switch (current) {
    case "account":
      return ["First the village needs its own post office. Resend carries your village's email.", "I can't open accounts for you, so this one's yours. It takes about two minutes."];
    case "key":
      return comms && !comms.secretsKeySet
        ? ["The root cellar has no lock yet, so nothing can be planted in it.", "Whoever runs your hosting sets its lock. Then we carry on from here."]
        : ["Now one key. Paste it at the cellar door below, never into a chat.", "With full access, this screen adds your domain and connects delivery reports for you."];
    case "stones":
      if (!comms?.settings.domain) return ["Next, a few small stones so the internet trusts mail from your village.", "Which web address do your letters come from?"];
      return storm
        ? ["A storm came through. DNS changes can take a few hours.", "Come back later, or check the sky now. Everything you planted stays planted."]
        : ["Lay each stone where your web address lives, then check the sky."];
    case "reports":
      return ["Now let Resend tell the village what became of each letter. One press does it."];
    case "sign":
      return ["Your letters need a signature: the name and address they come from, and the postal address their footer carries."];
    case "nursery":
      return comms?.testEmail && !comms.testEmail.delivered
        ? ["The test letter is out. I'm watching for Resend's delivery report.", "When it says delivered, the bees come."]
        : ["Time for the nursery. Send one test letter to yourself.", "When Resend reports it delivered, the bees visit, and we know the spring really works."];
    case "transplant":
      return phase === "before-launch"
        ? ["The post office is ready. Opening it is a keystone, so read the packet slowly.", "Before launch, any founder can do this alone."]
        : ["The post office is ready. Opening it is a keystone, so read the packet slowly."];
    case "trade":
      return comms?.settings.keyRights === "full"
        ? ["Resend says the key in the cellar can run your whole account. The village only needs to send.", "Trade it for a key that can only send, and only from your domain."]
        : ["One last planting. The key you planted for the setup can do far more than send.", "Check it first. If it can only send already, you are done."];
    case "done":
      return ["Water runs. The spring is established, and the bees keep visiting.", "If a check ever fails, it shows up here as something to tend."];
  }
}

export default function SpringPlot(props: SpringProps) {
  const { comms, domain, seeds, guide, phase } = props;
  const [ticked, setTicked] = useState(readTick);
  const [revisit, setRevisit] = useState<BeatId | null>(null);
  const { beats, current } = springBeats(comms, { account: ticked });
  const weather = stoneWeather(comms, domain);
  const done = (id: BeatId) => !!beats.find((b) => b.id === id)?.done;
  const verified = done("stones");
  const scene = {
    account: done("account"),
    keyed: done("key"),
    stones: verified ? 4 : weather.total ? Math.round((weather.seen / weather.total) * 4) : 0,
    storm: weather.storm,
    nursery: current === "nursery" || (current === "transplant" && !commsIsOn(comms)),
    bees: done("nursery"),
    flowing: current === "done",
    busy: current === "stones" || current === "transplant",
    stake: "ops@",
  };
  const shown: BeatId | "done" = revisit ?? current;
  const journal = springJournal(comms);
  const fmt = (t: number) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const badges: Array<[string, boolean]> = [
    ["Stones laid", verified],
    ["Reports flowing", done("reports")],
    ["Letters signed", done("sign")],
    ["Bees came", done("nursery")],
    ["Spring runs", current === "done"],
  ];
  return (
    <div className="sg-grid">
      <div className="sg-scenecol">
        <div className="sg-frame">
          <ForestScene s={scene} />
          <div className="sg-coords">
            <span>{comms?.settings.domain || "your web address"} · water layer</span>
            <span>{props.village}</span>
          </div>
        </div>
        <div className="sg-weather sg-wood" aria-live="polite">
          {weather.storm ? (
            <>
              <p>A storm came through. Come back in a few hours.</p>
              <small>
                DNS: {weather.seen} of {weather.total || "the"} records seen. Press Check the sky to look again.
              </small>
            </>
          ) : done("nursery") ? (
            <>
              <p>Clear skies. Bees about.</p>
              <small>The latest test letter was reported delivered.</small>
            </>
          ) : (
            <>
              <p>Clear skies.</p>
              <small>{new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>
            </>
          )}
        </div>
        <ol className="sg-track" aria-label="Plantings in this plot">
          {beats.map((b) => (
            <li key={b.id} className={[b.done ? "done" : "", shown === b.id ? "now" : "", b.keystone ? "key" : ""].join(" ")}>
              <button type="button" disabled={!b.done} aria-current={current === b.id ? "step" : undefined} onClick={() => setRevisit(b.id)}>
                <b>{b.n}</b>
                {b.short}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="sg-desk">
        <div className="sg-dock sg-wood">
          <div className="sg-dock-head">
            <div className="sg-av" aria-hidden="true" />
            <div>
              <div className="nm">{guide}</div>
              <div className="rl">your village guide · advisor dock</div>
            </div>
            <span className="pill">{phase === "before-launch" ? "before launch" : "after launch"}</span>
          </div>
          <div className="sg-dock-body" aria-live="polite">
            {(revisit ? ["That planting is done. Here is what it grants and how to undo it."] : lines(current, comms, weather.storm, phase)).map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        </div>
        <SpringPacket
          beat={shown}
          revisit={!!revisit}
          comms={comms}
          domain={domain}
          seeds={seeds}
          village={props.village}
          phase={phase}
          accountTicked={ticked}
          onAccount={() => {
            try {
              window.localStorage.setItem(ACCOUNT_KEY, "yes");
            } catch {
              /* the tick lives for this visit only */
            }
            setTicked(true);
          }}
          setComms={props.setComms}
          setDomain={props.setDomain}
          onBack={() => setRevisit(null)}
        />
        <div className="sg-side">
          <div className="sg-card">
            <h3>Root cellar</h3>
            <ul className="sg-cellar">
              <li>
                resend_api_key{comms?.key.configured ? ` ····${comms.key.last4 ?? ""}` : ""}
                <span>{comms?.key.configured ? `Planted${comms.key.source === "env" ? " on the hosting service" : ""}` : "Not planted yet"}</span>
              </li>
              <li>
                resend_webhook_secret
                <span>{comms?.webhook.configured ? "Planted" : "Not planted yet"}</span>
              </li>
              <li className="hint">Nothing comes back out of the cellar. The game sees names and the last four only.</li>
            </ul>
          </div>
          <div className="sg-card">
            <h3>Forest journal</h3>
            <ul className="sg-journal">
              {journal.length ? (
                journal.map((j) => (
                  <li key={`${j.at}-${j.text}`}>
                    <time>{fmt(j.at)}</time>
                    <span>{j.text}</span>
                  </li>
                ))
              ) : (
                <li>
                  <span className="sg-why">Nothing planted yet.</span>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="sg-card">
          <h3>What you've grown</h3>
          <div className="sg-badges">
            {badges.map(([label, got]) => (
              <span key={label} className={`sg-badge${got ? " got" : ""}`}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
