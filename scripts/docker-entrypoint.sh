#!/bin/sh
# The image's first process after tini: hand the data volume to `node`, then
# run the server as `node`.
#
# WHY IT EXISTS. A hosting platform mounts its persistent volume over
# /app/data owned by root, whatever the image prepared underneath. The server
# runs as the unprivileged `node` user, so on such a host every upload failed
# with EACCES (photographs, logos, documents), and the upload route can only
# say that it could not store the file. Measured on a live village on
# 2026-10-14: "EACCES: permission denied, open '/app/data/uploads/...'".
#
# WHAT RUNS AS ROOT. Only the lines below, and only when the container was
# started as root: make the uploads directory, give every file under the data
# directory that `node` does not already own to `node`, then drop to `node`
# with setpriv before the server starts. The server itself never runs as root.
# A container started as another user (docker run --user, a platform that
# forces one) skips all of this and runs the command as that user.
#
# The walk only touches files `node` does not own, so after the first boot it
# changes nothing and costs one pass over the directory listing.
set -eu

data="${DATA_DIR:-/app/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data/uploads"
  # A read-only or foreign mount refuses chown. Say so and carry on: the
  # server will report what it cannot write, which is more useful than a
  # container that never starts.
  find "$data" ! -user node -exec chown -h node:node {} + \
    || echo "[entrypoint] could not hand every file under $data to node; uploads may fail" >&2
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
