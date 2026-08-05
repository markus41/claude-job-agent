#!/usr/bin/env bash
# claude-job-agent one-click setup (macOS / Linux)
#
# Run it either way:
#   - from a cloned repo:  ./setup.sh
#   - straight from the web:
#       curl -fsSL https://raw.githubusercontent.com/markus41/claude-job-agent/main/setup.sh | bash
#
# Checks prerequisites (git, Node 22+, Claude Code), asks before installing
# anything, clones the repo if needed, scaffolds your private files, and
# leaves you one command away from the guided /setup. Safe to re-run.

set -euo pipefail

REPO_URL="https://github.com/markus41/claude-job-agent.git"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32mOK\033[0m  %s\n' "$1"; }
warn() { printf '    \033[33m!!\033[0m  %s\n' "$1"; }

confirm() {
  # Reads from the terminal even when the script itself is piped in.
  local answer
  read -r -p "    $1 [Y/n] " answer < /dev/tty || answer="n"
  [[ -z "$answer" || "$answer" =~ ^[Yy] ]]
}

printf '\n  claude-job-agent — one-click setup\n'
printf '  Your data stays on this computer. Nothing is submitted without your approval.\n'

# --- 1. git ---------------------------------------------------------------
step "Checking git"
if command -v git >/dev/null 2>&1; then
  ok "$(git --version)"
else
  warn "git is not installed."
  if [[ "$(uname)" == "Darwin" ]]; then
    warn "Run: xcode-select --install   (or: brew install git), then re-run this script."
  else
    warn "Install git with your package manager (e.g. sudo apt install git), then re-run."
  fi
  exit 1
fi

# --- 2. Node 22+ -----------------------------------------------------------
step "Checking Node.js (22 or newer)"
node_ok=false
if command -v node >/dev/null 2>&1; then
  major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [[ "$major" -ge 22 ]]; then node_ok=true; ok "Node $(node -v)"; else warn "Node $(node -v) is too old."; fi
fi
if [[ "$node_ok" != true ]]; then
  if command -v brew >/dev/null 2>&1 && confirm "Install Node.js via Homebrew now?"; then
    brew install node
    ok "Node $(node -v)"
  else
    warn "Install Node.js 22+ from https://nodejs.org (or via your package manager), then re-run."
    exit 1
  fi
fi

# --- 3. The repo ------------------------------------------------------------
step "Locating the claude-job-agent folder"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || pwd)"
repo_dir=""
if [[ -f "$PWD/bin/jobagent.mjs" ]]; then
  repo_dir="$PWD"
elif [[ -f "$script_dir/bin/jobagent.mjs" ]]; then
  repo_dir="$script_dir"
else
  default="${JOBAGENT_DIR:-$HOME/claude-job-agent}"
  if [[ -f "$default/bin/jobagent.mjs" ]]; then
    repo_dir="$default"
    ok "Found existing install at $repo_dir"
  else
    printf '    Will download (git clone) into: %s\n' "$default"
    read -r -p "    Press Enter to accept, or type a different folder path: " answer < /dev/tty || answer=""
    [[ -n "${answer// /}" ]] && default="$answer"
    git clone "$REPO_URL" "$default"
    repo_dir="$default"
  fi
fi
cd "$repo_dir"
ok "Using $repo_dir"

# --- 4. Scaffold private files ------------------------------------------------
step "Creating your private profile/config files (never overwrites existing ones)"
node bin/jobagent.mjs init

# --- 5. Claude Code -------------------------------------------------------------
step "Checking Claude Code"
if command -v claude >/dev/null 2>&1; then
  ok "Claude Code is installed."
else
  warn "Claude Code is not installed."
  if confirm "Install Claude Code (Anthropic's official installer) now?"; then
    curl -fsSL https://claude.ai/install.sh | bash
    if ! command -v claude >/dev/null 2>&1; then
      warn "Installed, but not on PATH in this shell. Open a new terminal, cd into the folder above, and run: claude"
    else
      ok "Claude Code installed."
    fi
  else
    warn "Install it later from https://code.claude.com — then run: claude (in this folder)"
  fi
fi

# --- 6. Done ---------------------------------------------------------------------
step "Setup complete"
cat <<'EOF'

    Next steps:
      1. Have your resume file handy (PDF is perfect).
      2. Start Claude Code in this folder — approve the "playwright" server
         when it asks (that's the browser it uses to fill forms).
      3. Type:  /setup   and follow the interview.

    Nothing ever gets submitted without your personal approval.
EOF

if command -v claude >/dev/null 2>&1; then
  if confirm "Launch Claude Code now?"; then
    exec claude
  fi
fi
