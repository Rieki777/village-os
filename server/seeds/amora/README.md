# Amora's own wording

These files are the first village's own text, kept as data when it came
out of the client code. **Nothing loads them.** No boot step, migration or seed
reads this folder, so a new village never receives them.

| File | What it is |
|---|---|
| `brochure-legal-seed.json` | Amora's legal section: Costa Rica, its 508(c)(1)(a) entity, tax notes. |
| `pages-covenant-seed.json` | The two Love Letter paragraphs Amora wrote. |
| `money-claims-seed.json` | Amora's own land and money figures. |
| `pages/page-<id>.json` | Amora's own words for each of the 18 public page sections, adopted on production 2026-10-23 and kept here as its record. Read verbatim from production's public `GET /api/content/page-<id>` and pretty-printed; re-read 2026-10-31, words unchanged. Amora holds no `page-governance` (that spec arrived later). |

Amora applies them by hand, through Admin or `PUT /api/admin/content/legal` and
`PUT /api/admin/content/covenant` (capability `story.tell`). The page sections
are already in Amora's database; a copy here only restores one by hand, through
Admin, Pages or `PUT /api/admin/content/page-<id>`.

A new village starts from `../templates/` instead, which has the same shapes
with placeholders for its own name, legal entity, data controller and contact.
Its pages start from the neutral defaults in `shared/pageContent/`.
