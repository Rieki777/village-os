/**
 * THE WHOLE FOREST: every platform layer and every module the village has
 * switched on, each seed with where it really stands. The email layer is the
 * one plot that plays as a game today (the Spring); every other seed links to
 * the screen that plants it, so the Journey is a complete map from day one
 * and each plot becomes a game as it is built.
 */
import type { SettingsPayload } from "@/components/admin/comms/commsSettingsApi";
import type { LaunchItem, SeedState, SetupGameMap } from "./setupGameApi";
import { LAYER_WORD, nextYes, orderedLayers, seedLight, type SeedLight } from "./journeyModel";

interface Props {
  map: SetupGameMap;
  launch: LaunchItem[];
  comms: SettingsPayload | null;
  onPlaySpring: () => void;
}

const DOT: Record<SeedLight["light"], string> = { alive: "alive", planted: "planted", open: "open", unknown: "" };
const SAID: Record<SeedLight["light"], string> = { alive: "Alive", planted: "Planted, not proven", open: "Not planted", unknown: "Not knowable here" };

function SeedRow({ s, l, onPlaySpring }: { s: SeedState; l: SeedLight; onPlaySpring: () => void }) {
  return (
    <li className="sg-srow">
      <i className={`sg-dot ${DOT[l.light]}`} aria-label={SAID[l.light]} />
      <div>
        <span className="tt">{s.title}</span>
        <span className="how">
          {SAID[l.light]}.{l.detail ? ` ${l.detail}` : ""}
        </span>
      </div>
      <div className="sg-tags">
        {l.light === "alive" ? <span className="sg-tag alive">alive</span> : null}
        {s.keystone ? <span className="sg-tag key">keystone</span> : null}
        {s.bootstrap ? <span className="sg-tag thin">hosting</span> : null}
        {s.need === "optional" ? <span className="sg-tag">optional</span> : null}
      </div>
      <details>
        <summary>What it grants</summary>
        <p>{s.consequence}</p>
        <p>
          Cost: {s.cost} Undo: {s.undo}
        </p>
        {s.byHand ? <p>By hand: {s.byHand}</p> : null}
        {l.spring ? (
          <p>
            <button type="button" className="sg-link" onClick={onPlaySpring}>
              Plant it in the Spring plot
            </button>
          </p>
        ) : l.fixAt ? (
          <p>
            <a href={l.fixAt} target={/^https?:/.test(l.fixAt) ? "_blank" : undefined} rel="noreferrer">
              {l.fixLabel || "Plant it here"}
            </a>
          </p>
        ) : null}
      </details>
    </li>
  );
}

export default function JourneyView({ map, launch, comms, onPlaySpring }: Props) {
  const rows = new Map(launch.map((i) => [i.id, i]));
  const lightOf = (s: SeedState) => seedLight(s, rows, comms);
  const next = nextYes(map, lightOf);
  // A switched-on module joins the forest when it has seeds or setup to do. One with
  // neither (the core four, say) has nothing for a founder to plant here.
  const on = map.modules.filter((m) => m.lifecycle !== "off" && (m.seeds.length > 0 || m.setup !== "none"));
  const off = map.modules.filter((m) => m.lifecycle === "off" && !m.core);
  const platform = new Set(map.layers.flatMap((l) => l.seeds));
  const all = Object.values(map.seeds);
  const count = (light: SeedLight["light"]) => all.filter((s) => lightOf(s).light === light).length;
  return (
    <div className="sg-grid">
      <div className="sg-guilds">
        {orderedLayers(map).map((layer) => (
          <section key={layer.id} className="sg-guild sg-wood">
            <header>
              <h3>{layer.title}</h3>
              <span className="lay">platform · {LAYER_WORD[layer.layer] ?? layer.layer}</span>
            </header>
            <ul>
              {layer.seeds.map((id) => map.seeds[id]).filter(Boolean).map((s) => (
                <SeedRow key={s.id} s={s} l={lightOf(s)} onPlaySpring={onPlaySpring} />
              ))}
            </ul>
            {layer.layer === "water" ? (
              <div className="sg-play">
                <button type="button" className="sg-primary" onClick={onPlaySpring}>
                  Play the Spring plot
                </button>
              </div>
            ) : null}
          </section>
        ))}
        {on.map((m) => {
          const own = m.seeds.filter((id) => !platform.has(id));
          return (
            <section key={m.id} className="sg-guild sg-wood">
              <header>
                <h3>{m.name}</h3>
                <span className="lay">guild · {m.lifecycle}</span>
              </header>
              {own.length ? (
                <ul>
                  {own.map((id) => map.seeds[id]).filter(Boolean).map((s) => (
                    <SeedRow key={s.id} s={s} l={lightOf(s)} onPlaySpring={onPlaySpring} />
                  ))}
                </ul>
              ) : (
                <div className="sg-empty">
                  {m.seeds.length ? "Everything it needs grows in the platform layers above. " : "No keys to plant. "}
                  Its settings and content live on <a href={`/modules/${m.id}`}>its own page</a>.
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="sg-desk">
        <div className="sg-dock sg-wood">
          <div className="sg-dock-head">
            <div className="sg-av" aria-hidden="true" />
            <div>
              <div className="nm">Your next yes</div>
              <div className="rl">{next ? next.provider : "nothing waiting"}</div>
            </div>
          </div>
          <div className="sg-dock-body">
            {next ? (
              <>
                <p>{next.title}.</p>
                {lightOf(next).detail ? <p>{lightOf(next).detail}</p> : null}
                <div className="sg-actions" style={{ marginTop: 10 }}>
                  {lightOf(next).spring ? (
                    <button type="button" className="sg-primary" onClick={onPlaySpring}>
                      Do the next yes
                    </button>
                  ) : lightOf(next).fixAt ? (
                    <a className="sg-primary" href={lightOf(next).fixAt ?? undefined}>
                      Do the next yes
                    </a>
                  ) : (
                    <span className="sg-dim">{next.byHand ?? "Ask whoever runs your hosting."}</span>
                  )}
                </div>
              </>
            ) : (
              <p>Every needed seed in the layers and the switched-on guilds is planted.</p>
            )}
          </div>
        </div>
        <div className="sg-card">
          <h3>The forest today</h3>
          <ul className="sg-cellar">
            <li>
              {count("alive")} alive<span>A live check passed.</span>
            </li>
            <li>
              {count("planted")} planted, not proven<span>A value is set. Only a live check can say it works.</span>
            </li>
            <li>
              {count("open")} not planted<span>Waiting on a yes.</span>
            </li>
            <li>
              {count("unknown")} not knowable here<span>No live check is wired for these yet.</span>
            </li>
          </ul>
        </div>
        {off.length ? (
          <div className="sg-card">
            <h3>Guilds you have not planted</h3>
            <p className="sg-dim" style={{ margin: 0 }}>
              Switch one on in the Module Library and its seeds join the forest here.
            </p>
            <div className="sg-badges" style={{ marginTop: 8 }}>
              {off.map((m) => (
                <a key={m.id} className="sg-badge" href={`/modules/${m.id}`}>
                  {m.name}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
