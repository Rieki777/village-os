/**
 * The Comms screens, one file each (docs/comms/BUILD_SPEC.md 6), gathered so
 * client/src/pages/Admin.tsx imports them on one line: that page has no
 * lines to spare, and every screen's own work belongs in its own file.
 */
export { default as CommsOverview } from "./CommsOverview";
export { default as CommsJourneys } from "./CommsJourneys";
export { default as CommsWords } from "./CommsWords";
export { default as CommsPeople } from "./CommsPeople";
export { default as CommsLetters } from "./CommsLetters";
export { default as CommsSentMail } from "./CommsSentMail";
export { default as CommsSettings, EmailField } from "./CommsSettings";
