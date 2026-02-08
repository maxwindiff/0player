#!/bin/bash
trap 'kill 0' EXIT
node server.js &
ngrok http 3000 &
wait
