/**
 * The plain words for "What is this?" on every admin tab.
 *
 * The sentences live with the area map, so a new tab cannot ship without a
 * line a person can read. This file is the door a translation would use.
 */
import { ADMIN_AREAS, tabEntry } from "./adminAreas";

export function whatIsThis(key: string): { name: string; help: string } {
  const tab = tabEntry(key);
  if (tab) return { name: tab.name, help: tab.help };
  const area = ADMIN_AREAS.find((item) => item.id === key);
  if (area) return { name: area.name, help: area.help };
  return { name: "This page", help: "This is part of admin. The section list has every page." };
}
