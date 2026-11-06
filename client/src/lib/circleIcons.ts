/**
 * THE ICON A CIRCLE OR A ROLE STORES, AS SOMETHING TO DRAW.
 *
 * Circles and roles carry a lucide icon name in their own row, and the seeds
 * fill it in. Two pages each kept a private map of the names they knew, and
 * neither knew the ones the live village actually uses: of its thirteen circle
 * icons (Crown, Sprout, Music, Heart, Hammer, TrendingUp, TreePine...) the
 * circles page drew seven as a plain dot. One map now, holding every name the
 * seeds and the live data use, read the same way everywhere.
 *
 * The names are written in more than one spelling across the seeds ("Users",
 * "users", "shield-check"), so a lookup ignores case, dashes and spaces.
 * Explicit imports on purpose: lucide has no tree-shakeable dynamic access,
 * and an icon nobody named should cost nothing.
 */
import {
  Baby,
  BookOpen,
  Briefcase,
  Brush,
  Building,
  Building2,
  Calendar,
  Camera,
  ChefHat,
  CircleDot,
  ClipboardList,
  Compass,
  Crown,
  DollarSign,
  FileText,
  Flower,
  Globe,
  Hammer,
  Handshake,
  Heart,
  Home,
  Laptop,
  Leaf,
  Lightbulb,
  MessageCircle,
  Music,
  Palette,
  Percent,
  Scale,
  Shield,
  ShieldCheck,
  Sprout,
  Star,
  Stethoscope,
  TreePine,
  TrendingUp,
  Users,
  Users2,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS = {
  Baby, BookOpen, Briefcase, Brush, Building, Building2, Calendar, Camera, ChefHat, CircleDot,
  ClipboardList, Compass, Crown, DollarSign, FileText, Flower, Globe, Hammer, Handshake, Heart,
  Home, Laptop, Leaf, Lightbulb, MessageCircle, Music, Palette, Percent, Scale, Shield,
  ShieldCheck, Sprout, Star, Stethoscope, TreePine, TrendingUp, Users, Users2, Wrench, Zap,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Short names the seeds use for an icon lucide spells longer. */
const SHORT_NAMES: ReadonlyArray<readonly [string, IconName]> = [
  ["dollar", "DollarSign"],
];

const keyOf = (name: string): string => name.toLowerCase().replace(/[\s_-]+/g, "");

const BY_KEY = new Map<string, LucideIcon>([
  ...Object.entries(ICONS).map(([name, icon]) => [keyOf(name), icon] as const),
  ...SHORT_NAMES.map(([short, name]) => [keyOf(short), ICONS[name]] as const),
]);

/** Whether a stored name resolves to a real icon, rather than the fallback. */
export function knowsIcon(name: string | null | undefined): boolean {
  return !!name && BY_KEY.has(keyOf(name));
}

/** The icon for a stored name; anything unknown or missing draws `CircleDot`. */
export function iconFor(name: string | null | undefined): LucideIcon {
  return (name && BY_KEY.get(keyOf(name))) || CircleDot;
}
