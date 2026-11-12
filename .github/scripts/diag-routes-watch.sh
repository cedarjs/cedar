#!/usr/bin/env bash
# Temporary diagnostics: once a second, record what the dev server serves for
# Routes.jsx next to what is on disk, so a 404 can be lined up with file writes.
project="$1"
out="$2"
while true; do
  ts=$(date +%H:%M:%S.%3N)
  served=$(curl -s --max-time 2 "http://localhost:8910/src/Routes.jsx" || true)
  served_posts=$(printf '%s' "$served" | grep -c "PostsPage" || true)
  served_size=${#served}
  disk_posts=$(grep -c "PostsPage" "$project/web/src/Routes.jsx" 2>/dev/null || true)
  pages=$(ls "$project/web/src/pages" 2>/dev/null | tr '\n' ',')
  echo "$ts served_size=$served_size served_PostsPage=$served_posts disk_PostsPage=$disk_posts pages=$pages" >> "$out"
  sleep 1
done
