/**
 * THE SETUP GAME, `/setup-game` (Rye, 2026-10-31: "let's get this shipped and
 * I want to be able to play this game right now for setting up amora's
 * settings like resend").
 *
 * The approved prototype, built on the village's real state:
 *   Journey      every platform layer and every switched-on guild, each seed
 *                with where it really stands (journeyModel.ts)
 *   Spring plot  the email guild, played step by step against the real comms
 *                setup (SpringPlot.tsx)
 *   Field notes  the same state as a plain table
 *
 * For founders and admins. The server refuses everyone else on every route
 * this page calls, so the check below only decides what to draw.
 *
 * Its own route and its own world (forest.css): a theme-frozen game surface
 * like the profile and the map, outside the light-only Admin shell.
 */
import { useCallback, useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import type { DomainPanel, SettingsPayload } from "@/components/admin/comms/commsSettingsApi";
import FieldNotes from "@/components/setupGame/FieldNotes";
import JourneyView from "@/components/setupGame/JourneyView";
import SpringPlot from "@/components/setupGame/SpringPlot";
import WaitingKeys from "@/components/setupGame/WaitingKeys";
import { LAYER_WORD, layerEstablished, orderedLayers, seedLight } from "@/components/setupGame/journeyModel";
import { readComms, readDomain, readLaunch, readMap, said, type LaunchItem, type SetupGameMap } from "@/components/setupGame/setupGameApi";
import "@/components/setupGame/forest.css";

type View = "journey" | "spring" | "notes";
const VIEW_KEY = "setup-game:view";

function firstView(): View {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    if (v === "journey" || v === "spring" || v === "notes") return v;
  } catch {
    /* the Journey it is */
  }
  return "journey";
}

export default function SetupGame() {
  const { user, loading } = useAuth();
  const isFounder = !!user && (user.role === "admin" || user.role === "founder");
  const [view, setView] = useState<View>(firstView);
  const [map, setMap] = useState<SetupGameMap | null>(null);
  const [launch, setLaunch] = useState<LaunchItem[]>([]);
  const [comms, setComms] = useState<SettingsPayload | null>(null);
  const [domain, setDomain] = useState<DomainPanel | null>(null);
  const [guide, setGuide] = useState("Your guide");
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    const [m, l, c, d] = await Promise.all([readMap(), readLaunch(), readComms(), readDomain()]);
    if (!m.ok) {
      setProblem(said(m.data, "The forest could not be read. Sign in as a founder and try again."));
      return;
    }
    setProblem("");
    setMap(m.data);
    if (l.ok) setLaunch(l.data.items ?? []);
    if (c.ok) setComms(c.data);
    if (d.ok) setDomain(d.data);
  }, []);

  useEffect(() => {
    if (isFounder) void load();
  }, [isFounder, load]);

  useEffect(() => {
    fetch("/api/work-with-us-config")
      .then((r) => r.json())
      .then((w) => {
        if (typeof w?.assistantName === "string" && w.assistantName.trim()) setGuide(w.assistantName.trim());
      })
      .catch(() => {
        /* "Your guide" stands */
      });
  }, []);

  function choose(v: View) {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* remembered for this visit only */
    }
    if (v !== "spring" && isFounder) void load();
    window.scrollTo({ top: 0 });
  }

  if (loading) {
    return (
      <Layout>
        <div className="sg-world">
          <div className="sg-wrap">
            <p className="sg-note">Checking your access.</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isFounder) {
    return (
      <Layout>
        <div className="sg-world">
          <div className="sg-wrap">
            <div className="sg-title">
              <h1>The Setup Game</h1>
              <span className="sg-where">for the village's founders</span>
            </div>
            <div className="sg-card">
              <p style={{ margin: 0 }}>
                {user ? "This is where a village's founders plant its keys and accounts. It opens for a founder's or an admin's account." : "Sign in with a founder's account to play."}
              </p>
              {!user ? (
                <p style={{ margin: "10px 0 0" }}>
                  <a className="sg-hbtn" href="/login">
                    Sign in
                  </a>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const rows = new Map(launch.map((i) => [i.id, i]));
  const layers = map ? orderedLayers(map) : [];
  const established = map ? layers.filter((l) => layerEstablished(l.seeds, map, (s) => seedLight(s, rows, comms))).length : 0;

  return (
    <Layout>
      <div className="sg-world">
        <div className="sg-wrap">
          <div className="sg-hud">
            <div className="sg-hud-l">
              <span className="sg-hbtn" style={{ cursor: "default" }}>
                ⚘ Setup game
              </span>
              <div className="sg-toggle" role="group" aria-label="View">
                <button type="button" aria-pressed={view === "journey"} onClick={() => choose("journey")}>
                  Journey
                </button>
                <button type="button" aria-pressed={view === "spring"} onClick={() => choose("spring")}>
                  Spring plot
                </button>
                <button type="button" aria-pressed={view === "notes"} onClick={() => choose("notes")}>
                  Field notes
                </button>
              </div>
            </div>
            <div className="sg-hud-r">
              <a className="sg-hbtn" href="/journey-to-launch">
                Journey to Launch
              </a>
            </div>
          </div>

          <div className="sg-title">
            <h1>{view === "spring" ? "The Spring" : "Your Village's Journey"}</h1>
            <span className="sg-where">{view === "spring" ? "water layer · email guild" : "every layer · every guild · one game"}</span>
            <span className="sg-note">
              {map?.phase === "after-launch"
                ? "Your village has launched. Keystones now need a second founder's yes."
                : "Before launch, any founder can plant anything alone. Everything here is your village's real setup."}
            </span>
          </div>

          {map ? (
            <div className="sg-stats sg-wood" aria-label="Forest layers">
              <div className="sg-layers">
                {layers.map((l) => {
                  const est = layerEstablished(l.seeds, map, (s) => seedLight(s, rows, comms));
                  const here = view === "spring" && l.layer === "water";
                  return (
                    <span key={l.id} className={`sg-layer${est ? " est" : here ? " here" : ""}`}>
                      <i className="ic" />
                      <span className="n">{LAYER_WORD[l.layer] ?? l.title}</span>
                      <span className="s">{est ? "established" : here ? "this plot" : "to grow"}</span>
                    </span>
                  );
                })}
              </div>
              <div className="sg-rewild">
                <span className="sg-sc">ready to rewild</span>
                <b>
                  {established} of {layers.length}
                </b>
              </div>
            </div>
          ) : null}

          {problem ? <div className="sg-card">{problem}</div> : null}
          <WaitingKeys />
          {!map && !problem ? <p className="sg-note">Reading the forest.</p> : null}

          {map && view === "journey" ? <JourneyView map={map} launch={launch} comms={comms} onPlaySpring={() => choose("spring")} /> : null}
          {map && view === "spring" ? (
            <SpringPlot
              comms={comms}
              domain={domain}
              seeds={map.seeds}
              village={map.village}
              guide={guide}
              phase={map.phase}
              setComms={setComms}
              setDomain={setDomain}
            />
          ) : null}
          {map && view === "notes" ? <FieldNotes map={map} launch={launch} comms={comms} /> : null}
        </div>
      </div>
    </Layout>
  );
}
