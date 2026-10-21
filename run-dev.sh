#!/bin/zsh
cd "$(dirname "$0")"
set -a
source .env.local
set +a
exec vercel dev --listen 3000 --yes
