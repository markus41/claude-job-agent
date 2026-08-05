# claude-job-agent one-click setup (Windows)
#
# Run it either way:
#   - double-click setup.cmd in the repo folder, or
#   - from PowerShell:  irm https://raw.githubusercontent.com/markus41/claude-job-agent/main/setup.ps1 | iex
#
# It checks prerequisites (git, Node 22+, Claude Code), asks before installing
# anything, clones the repo if needed, scaffolds your private files, and
# launches Claude Code ready for /setup. Safe to re-run anytime.

$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/markus41/claude-job-agent.git'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    !!  $msg" -ForegroundColor Yellow }

function Confirm-Install($what) {
  $answer = Read-Host "    Install $what now? [Y/n]"
  return ($answer -eq '' -or $answer -match '^[Yy]')
}

function Update-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

Write-Host ''
Write-Host '  claude-job-agent — one-click setup' -ForegroundColor White
Write-Host '  Your data stays on this computer. Nothing is submitted without your approval.' -ForegroundColor DarkGray

# --- 1. git -------------------------------------------------------------------
Write-Step 'Checking git'
if (Get-Command git -ErrorAction SilentlyContinue) {
  Write-Ok (git --version)
} else {
  Write-Warn2 'git is not installed.'
  if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Confirm-Install 'Git (via winget)')) {
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    Update-PathFromRegistry
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
      Write-Warn2 'Installed, but not on PATH yet. Close this window, reopen, and run setup again.'
      exit 1
    }
    Write-Ok (git --version)
  } else {
    Write-Warn2 'Install git from https://git-scm.com/download/win and run setup again.'
    exit 1
  }
}

# --- 2. Node.js 22+ -------------------------------------------------------------
Write-Step 'Checking Node.js (22 or newer)'
$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
  $major = [int]((node -v).TrimStart('v').Split('.')[0])
  if ($major -ge 22) { $nodeOk = $true; Write-Ok "Node $(node -v)" }
  else { Write-Warn2 "Node $(node -v) is too old." }
}
if (-not $nodeOk) {
  if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Confirm-Install 'Node.js LTS (via winget)')) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Update-PathFromRegistry
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
      Write-Warn2 'Installed, but not on PATH yet. Close this window, reopen, and run setup again.'
      exit 1
    }
    Write-Ok "Node $(node -v)"
  } else {
    Write-Warn2 'Install Node.js LTS from https://nodejs.org and run setup again.'
    exit 1
  }
}

# --- 3. The repo ----------------------------------------------------------------
Write-Step 'Locating the claude-job-agent folder'
$repoDir = $null
if (Test-Path (Join-Path (Get-Location) 'bin/jobagent.mjs')) {
  $repoDir = (Get-Location).Path
} elseif ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'bin/jobagent.mjs'))) {
  $repoDir = $PSScriptRoot
} else {
  $default = Join-Path $HOME 'claude-job-agent'
  if ($env:JOBAGENT_DIR) { $default = $env:JOBAGENT_DIR }
  if (Test-Path (Join-Path $default 'bin/jobagent.mjs')) {
    $repoDir = $default
    Write-Ok "Found existing install at $repoDir"
  } else {
    Write-Host "    Will download (git clone) into: $default"
    $answer = Read-Host '    Press Enter to accept, or type a different folder path'
    if ($answer.Trim()) { $default = $answer.Trim() }
    git clone $RepoUrl $default
    $repoDir = $default
  }
}
Set-Location $repoDir
Write-Ok "Using $repoDir"

# --- 4. Scaffold private files ----------------------------------------------------
Write-Step 'Creating your private profile/config files (never overwrites existing ones)'
node bin/jobagent.mjs init

# --- 5. Claude Code -----------------------------------------------------------------
Write-Step 'Checking Claude Code'
if (Get-Command claude -ErrorAction SilentlyContinue) {
  Write-Ok 'Claude Code is installed.'
} else {
  Write-Warn2 'Claude Code is not installed.'
  if (Confirm-Install "Claude Code (Anthropic's official installer)") {
    irm https://claude.ai/install.ps1 | iex
    Update-PathFromRegistry
    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
      Write-Warn2 'Installed, but not on PATH in this window. Close this window, reopen, cd into the folder above, and run: claude'
    } else {
      Write-Ok 'Claude Code installed.'
    }
  } else {
    Write-Warn2 'Install it later from https://code.claude.com — then run: claude (in this folder)'
  }
}

# --- 6. Done ------------------------------------------------------------------------
Write-Step 'Setup complete'
Write-Host @"

    Next steps:
      1. Have your resume file handy (PDF is perfect).
      2. Claude Code opens in this folder — approve the "playwright" server
         when it asks (that's the browser it uses to fill forms).
      3. Type:  /setup   and follow the interview.

    Nothing ever gets submitted without your personal approval.
"@

if (Get-Command claude -ErrorAction SilentlyContinue) {
  $answer = Read-Host 'Launch Claude Code now? [Y/n]'
  if ($answer -eq '' -or $answer -match '^[Yy]') { claude }
}
