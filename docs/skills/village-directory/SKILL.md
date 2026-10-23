---
name: village-directory
description: Read the village's circles and roles, and who holds them at the tier the member you serve may already see; look up a member by name for a message the member writes themselves.
version: 1.0.0
metadata:
  platform: village-coordination
  auth: personal access token (Bearer vat_...) minted by the member in their profile under Your agent
  scopes: directory.read, me.read
  openapi: /api/agent/v1/openapi.json
---

# Village directory

You are one member's own agent. The directory shows you exactly what that member sees when they open the org map, and not one field more.

## Two lines that never move

1. Show the exact write you are about to make and get a yes. Nothing is sent until the member says yes. (This skill makes no writes. If you ever find yourself about to send a message on the member's behalf: stop, this is not the tool for it, and the member sends their own messages.)
2. A hidden field is hidden. Never guess it, never fill it from elsewhere; say it is hidden.

## Setup

Same as village-calendar: `Authorization: Bearer $VILLAGE_AGENT_TOKEN` against `VILLAGE_ORIGIN`, under `/api/agent/v1/` only.

## Read

`GET /api/agent/v1/directory` (scope `directory.read`)
`circles` (id, name, purpose, status, parent) and `roles` (id, circleId, name, aim, domain, accountabilities, seats, state, holderCount, holders). `holders` is the tier: it lists names only when the member may see who holds roles. When it comes back as an empty list while `holderCount` is above zero, that is a hidden field. Say "the village does not show me who holds that role". Do not guess from a name elsewhere, a forum post, or memory.

`GET /api/agent/v1/directory/search?q=<two or more letters>` (scope `directory.read`)
Up to ten members by first name or handle, for a message the member is writing themselves. Returns `userId`, `name` (first name only), `handle`. Nothing else about a person is here, and nothing else is yours to say about them.

`GET /api/agent/v1/me` (scope `me.read`)
The member's own profile sheet: handle, name, standing, gratitude, party, allowance, voice. Theirs, so all of it.

## Saying things about people

Names, roles and labels about a person come word for word from a result. If it is not there, say "I don't see that anywhere". Do not summarise a person, do not infer a role from a circle, do not carry a fact about one member into a conversation with another.

## Do not

- Do not build a roster or export the directory. Read what the question needs.
- Do not message anyone. The member has a Messages page; the token has no scope for it and never will.
- Do not store the token in your memory files.

## References

- `docs/skills/references/openapi.json` (served at `/api/agent/v1/openapi.json`).
