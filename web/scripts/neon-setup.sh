#!/usr/bin/env bash
# Neon setup + end-to-end proof for the web app. Run it on your Mac:
#
#   cd ~/Workspace/market-bot/web && bash scripts/neon-setup.sh
#
# Safe to re-run: steps that are already done are skipped.
#   0. Node 22.20+ for this run (the Neon skills installer needs it)
#   1. neon CLI at the latest version, signed in (browser only if needed)
#   2. Neon agent tooling: only what's missing (follows the Neon skill: agents
#      that got the Neon plugin need nothing else; others need skills + MCP)
#   3. Project link (.neon) — `neon init` only if not linked yet; neon.ts kept
#   4. npm install → neon deploy (pulls DATABASE_URL into .env.local)
#   5. db:migrate → build → start → end-to-end test against Neon
# Output is also written to neon-setup.log. No secret values are printed.

set -uo pipefail
cd "$(dirname "$0")/.."
exec > >(tee neon-setup.log) 2>&1

ORG=org-little-pine-41842727
PROJECT=calm-silence-47085807
BRANCH=production
PORT=3999
# Agents `neon init` configured with the MCP server but no plugin (from your first run).
NON_PLUGIN_AGENTS=(gemini-cli windsurf)

step() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\nFAILED: %s\n' "$*"; exit 1; }
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=20)?0:1)' 2>/dev/null; }
pick_node() {
  local d
  for d in "$(dirname "$(command -v node 2>/dev/null || echo /nonexistent/node)")" \
    /opt/homebrew/opt/node/bin /opt/homebrew/bin /usr/local/opt/node/bin /usr/local/bin; do
    if [ -x "$d/node" ] && node_ok "$d/node"; then echo "$d"; return 0; fi
  done
  return 1
}

step "0. Node.js 22.20+ (for this run only)"
echo "dir: $(pwd)"
echo "default node: $(command -v node || echo none) $(node -v 2>/dev/null)"
NODE_DIR=$(pick_node) || NODE_DIR=""
if [ -z "$NODE_DIR" ] && command -v brew >/dev/null; then
  echo "No Node 22.20+ found — upgrading Homebrew's 'node' formula (node@20 stays installed)."
  brew upgrade node || brew install node
  NODE_DIR=$(pick_node) || NODE_DIR=""
fi
if [ -z "$NODE_DIR" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  for f in "$NVM_DIR/nvm.sh" /opt/homebrew/opt/nvm/nvm.sh; do [ -s "$f" ] && . "$f" && break; done
  if command -v nvm >/dev/null; then
    nvm install 22 && NODE_DIR=$(dirname "$(nvm which 22)")
  fi
fi
[ -n "$NODE_DIR" ] || die "Node 22.20+ not found and could not be installed. Install it (brew install node), then re-run."
export PATH="$NODE_DIR:$PATH"
echo "using node $(node -v) from $NODE_DIR (npm $(npm -v))"
if [ -f db/schema.sql ]; then rm db/schema.sql && echo "removed db/schema.sql (now db/migrations/0001_init.sql)"; fi

step "1. Neon CLI (latest)"
npm i -g neon@latest || die "npm i -g neon@latest"
NEON=(neon)
command -v neon >/dev/null || NEON=(npx -y neon@latest)
echo "neon at $(command -v neon || echo npx)"
"${NEON[@]}" --version || die "neon CLI not runnable"

step "1b. Sign in"
if ! "${NEON[@]}" me >/dev/null 2>&1; then
  echo ">>> Not signed in. A browser sign-in is opening — finish it there."
  "${NEON[@]}" login || die "neon login failed — run 'neon login' yourself, then run this script again"
fi
"${NEON[@]}" me || die "still not signed in"

step "2. Neon agent tooling (skills + MCP)"
echo "-- skills before:"
"${NEON[@]}" skills status --global || echo "(skills status unavailable)"
# Plugin agents (claude-code, claude-desktop, codex, cursor, copilot-cli, vscode) already
# have skills + MCP via the Neon plugin — per the Neon skill, don't add neon mcp/skills there.
# gemini-cli and windsurf got the MCP server from `neon init`; only their skills are missing.
AGENT_FLAGS=(); for a in "${NON_PLUGIN_AGENTS[@]}"; do AGENT_FLAGS+=(--agent "$a"); done
"${NEON[@]}" skills -y --global "${AGENT_FLAGS[@]}" || die "neon skills install"
echo "-- skills after:"
"${NEON[@]}" skills status --global || true

step "3. Project link"
if [ -f .neon ] && grep -q "\"$PROJECT\"" .neon && grep -q "\"$BRANCH\"" .neon; then
  echo "already linked to $PROJECT / $BRANCH (.neon) — skipping neon init (it would mint another API key)"
else
  "${NEON[@]}" init -y --org-id "$ORG" --project-id "$PROJECT" --branch "$BRANCH" --services postgres || die "neon init"
fi
[ -f neon.ts ] || die "neon.ts missing"

step "4. Install dependencies + neon deploy"
npm install || die "npm install"
"${NEON[@]}" deploy || die "neon deploy"
ENVF=.env.local; [ -f .env ] && ENVF=.env
[ -f "$ENVF" ] || die "no .env.local / .env after neon deploy"
echo "keys in $ENVF (values hidden):"; grep -oE '^[A-Z0-9_]+=' "$ENVF" | sort -u | sed 's/=$//; s/^/  /'

step "5. Migrate (direct URL)"
npm run db:migrate || die "npm run db:migrate"

step "6. Build"
npm run build || die "npm run build"

step "7. Start the app + end-to-end test against Neon"
TOKEN=$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')
INGEST_TOKEN="$TOKEN" node node_modules/next/dist/bin/next start -p "$PORT" > next-start.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/health" >/dev/null && break; sleep 1; done
echo "app pid $PID on http://localhost:$PORT"
curl -s "http://localhost:$PORT/api/health"; echo
node scripts/smoke.mjs "http://localhost:$PORT" "$TOKEN" || die "end-to-end test (see next-start.log)"
curl -s -o /dev/null -w "GET / → HTTP %{http_code}\n" "http://localhost:$PORT/"

step "DONE — all steps passed"
echo "Note: this run used node $(node -v) from $NODE_DIR. Your shell's default 'node' is unchanged:"
type -a node 2>/dev/null | sed 's/^/  /'
