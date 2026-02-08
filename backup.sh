#!/bin/bash
DIR="$(dirname "$0")"
while true; do
  if [ -f "$DIR/state.json" ]; then
    cp "$DIR/state.json" "$DIR/backup/state-$(date +%Y%m%d-%H%M%S).json"
  fi
  sleep 60
done
