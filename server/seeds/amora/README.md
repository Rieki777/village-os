# Amora's own wording

These three files are the first village's own text, kept as data when it came
out of the client code. **Nothing loads them.** No boot step, migration or seed
reads this folder, so a new village never receives them.

| File | What it is |
|---|---|
| `brochure-legal-seed.json` | Amora's legal section: Costa Rica, its 508(c)(1)(a) entity, tax notes. |
| `pages-covenant-seed.json` | The two Love Letter paragraphs Amora wrote. |
| `money-claims-seed.json` | Amora's own land and money figures. |

Amora applies them by hand, through Admin or `PUT /api/admin/content/legal` and
`PUT /api/admin/content/covenant` (capability `story.tell`).

A new village starts from `../templates/` instead, which has the same shapes
with placeholders for its own name, legal entity, data controller and contact.
