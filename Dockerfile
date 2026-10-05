# syntax=docker/dockerfile:1.7
#
# One image, many villages.
#
# Every village runs this image: published as ghcr.io/regen-civics/village-os by
# .github/workflows/release.yml, started by docker-compose.yml on one machine,
# and built by Railway for a village deploying from source (railway.toml sets
# the Dockerfile builder). It replaced the nixpacks build on 2026-08-31.
#
# The two facts that shape everything below:
#
#  1. `scripts/build-server.mjs` bundles the server with esbuild
#     `packages: "external"`, so NOTHING from node_modules ends up inside
#     dist/index.js. Production node_modules must ship in the image. Measured
#     at 052d042 from the built bundle itself, the packages it imports are:
#     bcrypt, compression, dotenv, express, ical.js, multer, mysql2, viem, and
#     sharp. Two of those are easy to miss by reading the source: sharp arrives
#     through a dynamic `import("sharp")`, and dotenv through a side-effect
#     `import "dotenv/config"` with no `from` clause. The last RUN in this file
#     re-derives that list from the built bundle and fails the build if any of
#     it is unresolvable, so nobody has to maintain it by hand.
#
#  2. The running server reads real files off disk, not just dist/. Every one
#     of them is copied below with the line that reads it. A missing one is a
#     silent degradation, not a crash: `docs/knowledge` missing only prints
#     "[knowledge] docs/knowledge missing" and Maia serves an empty shelf.
#
# Running a village: START_HERE.md, with docker-compose.yml, which also starts
# the database. Building and running it by hand, against a MySQL you already
# have, with the .env that `node scripts/fork-init.mjs` writes:
#
#   docker build --build-arg GIT_SHA=$(git rev-parse HEAD) -t village-os .
#   docker run -p 3000:3000 --env-file .env -v village-data:/app/data village-os
#
# GIT_SHA is what lets /health say which commit is serving; without it the
# marker reads "dev". DATABASE_URL is the only variable the server refuses to
# boot without, and ADMIN_PASSWORD is what the /claim page needs to create the
# founder: without it nobody can ever sign in as one. AUTH_TOKEN_SECRET should
# be set too: unset, the server uses a random per-process secret, so every
# restart logs everybody out. The volume is where uploads live; without it
# they vanish with the container.
#
# Debian rather than Alpine on purpose. bcrypt resolves its native binding
# through node-gyp-build and sharp through @img/sharp-linux-x64, and both pick
# their glibc prebuilds here. Alpine would send both down the musl path, which
# is a different set of prebuilds and a compile when one is missing.

ARG NODE_IMAGE=node:22-bookworm-slim


# ---------------------------------------------------------------------------
# base: node plus pnpm, shared by every other stage.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:$PATH"
# corepack reads the pnpm version and its sha512 from package.json
# "packageManager", so the build cannot drift onto a different pnpm than CI
# and the worktrees use. The prompt is disabled because a build has no TTY to
# answer it on.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app


# ---------------------------------------------------------------------------
# deps: the full dependency tree. The BUILD needs devDependencies (vite,
# esbuild, tailwind, typescript), so this stage cannot be --prod.
# ---------------------------------------------------------------------------
FROM base AS deps
# The fallback toolchain for bcrypt and sharp. Both normally land a prebuilt
# binary and never touch this. It is here so that a version bump with no
# prebuilt for linux-x64 fails at BUILD time with a compiler error, rather
# than at boot with a module-not-found on a village's first login attempt.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# Lockfile-only layer: source edits do not re-run the install.
# patches/ is copied with them because package.json declares a patched
# dependency (wouter) and pnpm reads the patch file during install.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile


# ---------------------------------------------------------------------------
# prod-deps: only `dependencies`, for the runtime stage to copy.
# ---------------------------------------------------------------------------
FROM base AS prod-deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
# This tree is much larger than the nine packages the server actually
# imports, and that is a property of package.json rather than of this file:
# every client-only package (mermaid, lucide-react, date-fns, shiki, katex,
# cytoscape) sits in `dependencies`, so --prod cannot tell them apart from
# mysql2. They are already compiled into dist/public and are dead weight here.
# Measured 2026-08-30 on this lockfile: 455 MB installed, of which mermaid
# alone is 63 MB. Moving the client-only half to devDependencies is the fix,
# and it belongs to whoever owns package.json, not to this Dockerfile.
RUN pnpm install --frozen-lockfile --prod


# The `extra-deps` stage stood here until 2026-08-31, and its own comment said
# when to remove it: "The honest fix is one word in package.json: dotenv is a
# production dependency of this server and is declared as if it were not. When
# package.json is fixed, delete this stage and the COPY that reads it."
#
# package.json is now fixed, and the removal was not optional. `prod-deps`
# installs dotenv as a real dependency, so the stage copied its own dotenv over
# a directory that already existed and buildkit refused the whole build:
#
#   COPY --from=extra-deps /extra/ ./node_modules/
#   ERROR: cannot copy to non-directory: .../app/node_modules/dotenv
#
# Every deploy failed on it, the release workflow included. The bridge outlived
# the gap it bridged, which is the ordinary way a workaround turns into a bug:
# it kept doing exactly what it was told long after that stopped being right.
#
# The image still proves for itself that every runtime import resolves. That
# check is further down and is what would catch a genuine missing package now.


# ---------------------------------------------------------------------------
# build: client bundle plus server bundle.
# ---------------------------------------------------------------------------
FROM deps AS build

# Which commit this image is. scripts/build-server.mjs stamps it into the
# bundle as __BUILD_SHA__ and /health reports it as `build`, so a running
# container can be asked what it is instead of being assumed.
#
# It prefers RAILWAY_GIT_COMMIT_SHA, then GITHUB_SHA, then SOURCE_VERSION,
# then `git rev-parse`. .dockerignore keeps .git out of the build context on
# purpose (it is large and it is not needed), so git is NOT available here and
# this argument is the only way the marker gets a real value. Left empty, the
# marker honestly reads "dev" rather than guessing.
ARG GIT_SHA=""
ENV GITHUB_SHA=$GIT_SHA

# The same fact, arriving under Railway's own name.
#
# .github/workflows/release.yml passes GIT_SHA explicitly, so the published
# image always knows what it is. Railway does not: it builds this Dockerfile
# itself, nothing sets GIT_SHA there, and the marker fell back to "dev" on the
# first Docker deploy. That defeated the commit whose whole point was that the
# marker can never lie, and the marker is load-bearing (FORK_RUNBOOK tells a
# village to verify a deploy with it, and the feedback relay sends it upstream
# as the identity of the deployment a bug came from).
#
# Railway exposes the commit as RAILWAY_GIT_COMMIT_SHA. Declaring the ARG is
# what makes a service variable of that name reach the build; without the
# declaration the value is dropped silently. scripts/build-server.mjs prefers
# this over GITHUB_SHA and treats empty as absent, so if Railway does not pass
# it the marker still reads an honest "dev" rather than guessing.
ARG RAILWAY_GIT_COMMIT_SHA=""
ENV RAILWAY_GIT_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA

COPY . .
RUN pnpm run build


# ---------------------------------------------------------------------------
# runtime: what actually ships.
# ---------------------------------------------------------------------------
FROM base AS runtime

# tini is PID 1 because node is not a good one. The server registers no
# SIGTERM handler (server/lib/errors.ts wires unhandledRejection and
# uncaughtException only), and a PID 1 with no handler for a signal whose
# default action would kill it has that signal ignored by the kernel. Without
# this, every restart and every rollout waits out the platform's grace period
# and then SIGKILLs. tini runs as PID 1, forwards the signal to a node that is
# no longer PID 1, and the default action applies again.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

# Every package the bundle externalised. One COPY, because every runtime import
# now resolves from `dependencies` alone. See the note where the extra-deps
# stage used to sit.
COPY --from=prod-deps /app/node_modules ./node_modules

# The server bundle (dist/index.js) and the client bundle (dist/public).
# server/index.ts:31939 resolves staticPath as `<dirname>/public` when
# NODE_ENV=production, and dirname is /app/dist, so dist/public is where the
# SPA has to be.
COPY --from=build /app/dist ./dist

# package.json is NOT optional here. It carries "type": "module", and without
# it node reads dist/index.js as CommonJS and dies on the first `import`.
COPY --from=build /app/package.json ./package.json

# The files the RUNNING server reads, each with the line that reads it.
# Anything added to this list later must also be added to any fork runbook
# that describes the image contents.
#
#   drizzle/                         server/db/migrate.ts:25
#                                    MIGRATIONS_DIR, resolved against cwd, so
#                                    WORKDIR must stay /app. Migrations apply
#                                    themselves at boot; without this the
#                                    server refuses to serve.
#   server/seeds/                    server/index.ts:817 (SEEDS_DIR)
#                                    Deliberately outside data/, because a
#                                    volume mounted on data/ would shadow it.
#   docs/knowledge/, docs/modules/   server/lib/knowledge.ts:378 and :387
#   docs/skills/                     server/index.ts:6649
#   docs/prototypes/grounds-v0.html  server/index.ts:31976 (the Living Map)
#
# The rest of docs/ is not copied. It is 21 MB, of which 19 MB is
# docs/prototypes, and nothing outside the paths above is opened at runtime.
# Verified by grepping the BUILT BUNDLE for its own path literals rather than
# by reading the source: dist/index.js contains exactly six repo-path
# constants (the six above) plus DATA_DIR/uploads, which is runtime state.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/server/seeds ./server/seeds
COPY --from=build /app/docs/knowledge ./docs/knowledge
COPY --from=build /app/docs/modules ./docs/modules
COPY --from=build /app/docs/skills ./docs/skills
COPY --from=build /app/docs/prototypes/grounds-v0.html ./docs/prototypes/grounds-v0.html

# Can this image actually load its own server?
#
# The failure this catches has already happened once, on 2026-08-30: dotenv is
# imported by the bundle and declared as a devDependency, so the first --prod
# image died at boot with ERR_MODULE_NOT_FOUND. A hand-kept list of runtime
# packages in a comment would have gone stale the same way, so the list is
# re-derived here from the bundle that is actually in the image, every build.
#
# It reads the three import shapes esbuild emits (`from "x"`, bare
# `import "x"`, and `import("x")`), drops relative specifiers, and resolves
# what is left from /app. Node builtins resolve too, which is fine: this is
# asking "can node find it", not "is it a package".
#
# Verified to have a failure mode: with dotenv removed from the tree it exits
# 1 naming dotenv/config, which is how the defect above was found.
RUN node -e 'const fs=require("fs"),{createRequire}=require("module");const req=createRequire("/app/probe.cjs");const src=fs.readFileSync("dist/index.js","utf8");const specs=new Set();for(const re of [/(?:^|[\s;}])(?:import|export)[^;]*?from\s*"([^"]+)"/g,/(?:^|[\s;}])import\s*"([^"]+)"/g,/\bimport\(\s*"([^"]+)"\s*\)/g]){let m;while((m=re.exec(src))!==null)specs.add(m[1]);}const bare=[...specs].filter(s=>!s.startsWith(".")&&!s.startsWith("/"));const missing=bare.filter(s=>{try{req.resolve(s);return false}catch{return true}});console.log("runtime imports ("+bare.length+"): "+bare.sort().join(", "));if(missing.length){console.error("NOT RESOLVABLE IN THIS IMAGE: "+missing.join(", "));process.exit(1)}console.log("every runtime import resolves")'

# The uploads volume. server/index.ts creates DATA_DIR and DATA_DIR/uploads if
# they are missing, but it does that as the `node` user, so the parent has to
# be writable first. Production mounts a real volume over this path; the empty
# directory is what lets the image run without one.
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data

USER node
EXPOSE 3000

# Asks the same question the platform health check asks. node 22 has a global
# fetch, so this needs no curl in the image.
#
# /health is a real probe, not a liveness ping: it runs SELECT 1 through the
# live pool and answers 503 when the database is unreachable, so `r.ok` here
# means "serving AND can reach its database".
#
# start-period is long because boot is long. It applies every pending
# migration, loads the token registry, seeds the economy and walks the ledger
# invariants BEFORE it calls listen(). MEASURED 2026-08-30 against a
# completely empty schema, twice, doing identical work both times (107
# migrations): 228.5 seconds against a cold database server and 37.5 seconds
# against a warm one. Size against the cold number, because a container coming
# up on a freshly provisioned instance is the cold case. A 300s start period
# would leave a first boot about 72 seconds of margin. See railway.toml for
# the same reasoning applied to the platform's own probe.
HEALTHCHECK --start-period=600s --interval=30s --timeout=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
