# Amora's own wording

These files are the first village's own text, kept as data when it came
out of the client code. **Nothing loads them.** No boot step, migration or seed
reads this folder, so a new village never receives them.

| File | What it is |
|---|---|
| `brochure-legal-seed.json` | Amora's legal section: Costa Rica, its 508(c)(1)(a) entity, tax notes. |
| `pages-covenant-seed.json` | The two Love Letter paragraphs Amora wrote. |
| `money-claims-seed.json` | Amora's own land and money figures. Its `valueConversion` line says what the value token is in plain words (it tracks unpaid contributions, has no financial value yet, and what it will represent is still being decided together). Applied by Admin, Content, Money & Value Claims. |
| `token-descriptions-seed.json` | Amora's member-facing description of Earned Equity, for the wallet. Applied by hand, Admin, Tokens (11 Nov 2026). |
| `investor-parcels-seed.json` | Amora's six parcels on the investor path, one already sold (Rye, 2026-11-09). Applied through the investor path's invitation routes once they land (slice S2b); the sold one is recorded with no buyer, so it earns nobody the Neighbour badge. |
| `agent-paths-seed.json` | Amora's agent paths list for the connector: the 72 paths prepared for rapid design plus the lead-approved writes (role card words, drafts with terms wording, seating and unseating with the approval quoted, six wording variables), 88 in all. Applied by a person, Admin, Agents (or `PUT /api/admin/agent-admin-paths`), and only after `agents.lead_approved_writes` is on, or the list refuses the lead-approved entries. |
| `faqs-steward-seed.json` | The three steward questions as they should read after the joining flow (no hours, no old journey). Applied by hand, Admin, FAQs. |
| `lead-financial-steward-terms-seed.json` | The eight wordings and the 100% commitment the Lead Financial Steward's terms on offer carry (joining lane PR 3). The role is only in the live database, so it is applied by hand, Admin, Roles, Terms on offer. |
| `journey-tracks-seed.json` | A DRAFT of Amora's words for the steward page as one flow (the first steps with the exceptions line, the two tracks, the steward track ending in the optional "Join the resident track too" step, the founding team invitation, the optional extras) and for the resident track with the stage names from "Journey from visitor to resident", Founding Seeders inside it (lane A5, 2026-11-11). The content lane may refine it. Applied by hand, Admin, Pages, or `PUT /api/admin/content/page-journey-steward` and `page-journey-resident`; each document replaces that page's saved words whole. |
| `onboarding-technical-operations-seed.json` | The Technical Operations conversation as a first-days onboarding step (10 days in), after it left the interviews (lead's ruling, 11 Nov 2026). Applied by hand, Admin, Onboarding path. |
| `pages/page-<id>.json` | Amora's own words for each of the 18 public page sections, adopted on production 2026-10-23 and kept here as its record. Read verbatim from production's public `GET /api/content/page-<id>` and pretty-printed; re-read 2026-10-31, words unchanged. Amora holds no `page-governance` (that spec arrived later). |

Amora applies them by hand, through Admin or `PUT /api/admin/content/legal` and
`PUT /api/admin/content/covenant` (capability `story.tell`). The page sections
are already in Amora's database; a copy here only restores one by hand, through
Admin, Pages or `PUT /api/admin/content/page-<id>`.

A new village starts from `../templates/` instead, which has the same shapes
with placeholders for its own name, legal entity, data controller and contact.
Its pages start from the neutral defaults in `shared/pageContent/`.
