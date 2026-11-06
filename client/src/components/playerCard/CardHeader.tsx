/**
 * The card's top, as the approved design draws it: the owner's character
 * portrait in the gold conic ring with the moon pill under it ("October Moon ·
 * Day 22 of 92"), then the village and season, the owner's name (the one
 * person the card names), the tagline and the term's span; then one tile per
 * role with its gold line icon, linking down to the role in full.
 *
 * The portrait is the owner's own: the character that fronts their sheet, as
 * this reader may see it (server/lib/playerCardData.ts). Only an owner with
 * no character, or a picture that fails to load, gets the initial.
 *
 * Each tile keeps the role's health as one small line under its title, a dot
 * and its words; the three facts behind the dot are drawn with the role in
 * full.
 */
import { useState, type ReactNode } from "react";
import { CARD_WORDS as W, type HeaderOut, type PlayerCard } from "@shared/playerCard";
import { RoleIconSvg } from "./roleIcons";

function Portrait({ header }: { header: HeaderOut }) {
  const [broken, setBroken] = useState(false);
  const p = header.portrait;
  const letter = (Array.from(header.name.trim())[0] ?? "").toUpperCase();
  return (
    <div className="pc-portrait" data-portrait={p.kind === "photo" && !broken ? "photo" : "initial"}>
      <div className="pc-crop">
        {p.kind === "photo" && !broken ? (
          <img src={p.src} alt={W.portraitAlt(header.name)} onError={() => setBroken(true)} />
        ) : (
          <span className="pc-initial" aria-hidden="true">
            {p.kind === "sigil" ? p.letter : letter}
          </span>
        )}
      </div>
    </div>
  );
}

export function CardHero({ header, actions }: { header: HeaderOut; actions?: ReactNode }) {
  return (
    <section className="pc-hero" aria-labelledby="pc-who">
      <div className="pc-pwrap">
        <Portrait header={header} />
        <span className="pc-ringpill" data-moon-pill>
          {header.moon.words}
        </span>
      </div>
      <div className="pc-herotext">
        {header.eyebrow ? <p className="pc-eyebrow">{header.eyebrow}</p> : null}
        <h2 id="pc-who" className="pc-name">
          {header.name}
        </h2>
        {header.tagline ? <p className="pc-tagline">{header.tagline}</p> : null}
        {header.span ? <p className="pc-dim">{header.span}</p> : null}
        {actions ? <div className="pc-heroactions">{actions}</div> : null}
      </div>
    </section>
  );
}

export function RoleTiles({ tiles }: { tiles: PlayerCard["tiles"] }) {
  if (tiles.items.kind !== "shown") return null;
  return (
    <nav className="pc-htiles" aria-label={tiles.heading}>
      {tiles.items.value.map((t) => (
        <a key={t.roleId} className="pc-htile" href={`#${t.anchor}`}>
          <RoleIconSvg icon={t.icon} />
          <span>{t.title}</span>
          {t.health ? (
            <small>
              <span className={`pc-dot pc-${t.health.dot}`} aria-hidden="true" />
              {t.health.dotWords}
            </small>
          ) : null}
        </a>
      ))}
    </nav>
  );
}
