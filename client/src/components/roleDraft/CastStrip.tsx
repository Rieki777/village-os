/**
 * The cast as a row of portraits, the same stock art the character page uses,
 * for the pages around the selection board (/roles, /propose-a-role). It reads
 * the village's own cast (`GET /api/archetypes`) and draws nothing until it
 * has one, so a village with no cast shows no empty frame.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { characterArt } from "@shared/roleDraft";
import ArtImage from "./ArtImage";

export default function CastStrip({ href = "/roles/select", size = "size-20 sm:size-24" }: { href?: string | null; size?: string }) {
  const [cast, setCast] = useState<Array<{ key: string; name: string }>>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/archetypes")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!live || !Array.isArray(d)) return;
        setCast(d.filter((a: any) => a && typeof a.key === "string").map((a: any) => ({ key: a.key, name: String(a.name ?? a.key) })));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!cast.length) return null;
  const faces = cast.map((c, i) => (
    <li key={c.key} className="sel-rise text-center" style={{ animationDelay: `${i * 70}ms` }}>
      <ArtImage portrait src={characterArt(c.key)} className={`relative ${size} rounded-full border-2 border-notice`} imgClassName="object-top" />
      <span className="mt-1 block max-w-24 text-xs font-semibold text-foreground">{c.name}</span>
    </li>
  ));
  const row = <ul className="flex flex-wrap items-start justify-center gap-4">{faces}</ul>;
  return href ? (
    <Link href={href} aria-label={cast.map((c) => c.name).join(", ")} className="mx-auto mt-6 block w-fit rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
      {row}
    </Link>
  ) : (
    <div className="mt-6">{row}</div>
  );
}
