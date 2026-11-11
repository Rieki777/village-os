# Amora's own wording

These files are the first village's own text, kept as data when it came
out of the client code. **Nothing loads them.** No boot step, migration or seed
reads this folder, so a new village never receives them.

| File | What it is |
|---|---|
| `brochure-legal-seed.json` | Amora's legal section: Costa Rica, its 508(c)(1)(a) entity, tax notes. |
| `pages-covenant-seed.json` | The two Love Letter paragraphs Amora wrote. |
| `money-claims-seed.json` | Amora's own land and money figures. |
| `investor-parcels-seed.json` | Amora's six parcels on the investor path, one already sold (Rye, 2026-11-09). Applied through the investor path's invitation routes once they land (slice S2b); the sold one is recorded with no buyer, so it earns nobody the Neighbour badge. |
| `agent-paths-seed.json` | Amora's agent paths list for the connector: the 72 paths prepared for rapid design plus the lead-approved writes (role card words, drafts with terms wording, seating and unseating with the approval quoted, six wording variables), 88 in all. Applied by a person, Admin, Agents (or `PUT /api/admin/agent-admin-paths`), and only after `agents.lead_approved_writes` is on, or the list refuses the lead-approved entries. |
| `faqs-steward-seed.json` | The three steward questions as they should read after the joining flow (no hours, no old journey). Applied by hand, Admin, FAQs. |
| `lead-financial-steward-terms-seed.json` | The eight wordings and the 100% commitment the Lead Financial Steward's terms on offer carry (joining lane PR 3). The role is only in the live database, so it is applied by hand, Admin, Roles, Terms on offer. |
| `pages/page-<id>.json` | Amora's own words for each of the 18 public page sections, adopted on production 2026-10-23 and kept here as its record. Read verbatim from production's public `GET /api/content/page-<id>` and pretty-printed; re-read 2026-10-31, words unchanged. Amora holds no `page-governance` (that spec arrived later). |

Amora applies them by hand, through Admin or `PUT /api/admin/content/legal` and
`PUT /api/admin/content/covenant` (capability `story.tell`). The page sections
are already in Amora's database; a copy here only restores one by hand, through
Admin, Pages or `PUT /api/admin/content/page-<id>`.

A new village starts from `../templates/` instead, which has the same shapes
with placeholders for its own name, legal entity, data controller and contact.
Its pages start from the neutral defaults in `shared/pageContent/`.
