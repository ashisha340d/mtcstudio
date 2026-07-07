<#
.SYNOPSIS
  Generates mkcert TLS certificates for MTC Studio HTTPS support.

.DESCRIPTION
  Creates a single certificate valid for every hostname and IP listed below,
  covering LAN, loopback, and Tailscale addresses.

  Certificates are written to  server/certs/localhost.pem  and
  server/certs/localhost-key.pem  — the paths app.js expects.

.PREREQUISITES
  Install mkcert:
    winget install FiloSottile.mkcert

.AFTER RUNNING
  1. Confirm server/.env has  HTTPS_ENABLED=true  (already set)
  2. Restart the MTC Studio server
  3. Mobile / remote devices: install the mkcert root CA once (path shown at end)
#>

$ErrorActionPreference = "Stop"

# ══════════════════════════════════════════════════════════════════════════════
# SECURE CONNECTION LIST
# Add or remove hostnames and IPs here.  mkcert embeds all of them as SANs
# (Subject Alternative Names) so the certificate is valid for every entry.
# ══════════════════════════════════════════════════════════════════════════════
$AllHosts = @(
  # ── Loopback ──────────────────────────────────────────────────────────────
  "localhost"
  "127.0.0.1"

  # ── LAN (Wi-Fi / Ethernet) ────────────────────────────────────────────────
  "192.168.1.64"          # mtc.laptop  (this PC)
  "192.168.1.60"          # mtc.server  (server machine)

  # ── Tailscale VPN ─────────────────────────────────────────────────────────
  "100.97.170.28"                        # mtcpc
  "100.68.146.51"                        # piyadell
  "mtcpc.tailf9080f.ts.net"
  "piyadell.tailf9080f.ts.net"

  # ── Local hostnames (add to hosts file — see instructions below) ──────────
  "mtc.local"
  "mtc.laptop"
  "mtc.server"
)
# ══════════════════════════════════════════════════════════════════════════════

$certsDir = Join-Path $PSScriptRoot "..\certs"
$certsDir = [System.IO.Path]::GetFullPath($certsDir)

# ── Verify mkcert is available ───────────────────────────────────────────────
if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "  ERROR: mkcert not found in PATH." -ForegroundColor Red
  Write-Host ""
  Write-Host "  Install it with:" -ForegroundColor Yellow
  Write-Host "    winget install FiloSottile.mkcert"
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "  MTC Studio — Certificate Generator" -ForegroundColor Cyan
Write-Host "  ────────────────────────────────────"
Write-Host "  SANs covered:"
foreach ($h in $AllHosts) { Write-Host "    $h" }
Write-Host ""
Write-Host "  Output : $certsDir"
Write-Host ""

# ── Install local CA (no-op if already done) ─────────────────────────────────
Write-Host "  Installing mkcert local CA (first time only)..." -ForegroundColor Gray
mkcert -install
Write-Host ""

# ── Generate certificate ──────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $certsDir | Out-Null

Push-Location $certsDir
try {
  & mkcert -cert-file localhost.pem -key-file localhost-key.pem $AllHosts
} finally {
  Pop-Location
}


Write-Host ""
Write-Host "  Certificates generated successfully." -ForegroundColor Green
Write-Host ""
Write-Host "  $(Join-Path $certsDir 'localhost.pem')"
Write-Host "  $(Join-Path $certsDir 'localhost-key.pem')"
Write-Host ""

# ── Hosts file block to copy ─────────────────────────────────────────────────
Write-Host "  ── Add to C:\Windows\System32\drivers\etc\hosts (Notepad as admin) ──" -ForegroundColor Yellow
Write-Host ""
Write-Host "  192.168.1.64  mtc.local  mtc.laptop"
Write-Host "  192.168.1.60  mtc.server"
Write-Host ""

# ── mkcert CA location (needed for mobile / remote devices) ──────────────────
$caRoot = & mkcert -CAROOT 2>$null
if ($caRoot) {
  Write-Host "  ── Install root CA on every device that needs to trust this cert ──" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  CA file : $caRoot\rootCA.pem"
  Write-Host ""
  Write-Host "  Android  : copy rootCA.pem to phone → Settings → Security → Install certificate"
  Write-Host "  iOS      : AirDrop rootCA.pem → Settings → General → VPN & Device Management → trust it"
  Write-Host "  Windows  : double-click rootCA.pem → Install → Local Machine → Trusted Root CAs"
  Write-Host ""
}

Write-Host "  ── Access MTC Studio at ────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host ""
Write-Host "  https://mtc.local/"
Write-Host "  https://mtc.laptop/"
Write-Host "  https://mtc.server/"
Write-Host "  https://192.168.1.64/"
Write-Host "  https://192.168.1.60/"
Write-Host "  https://mtcpc.tailf9080f.ts.net/    (via Tailscale)"
Write-Host "  https://piyadell.tailf9080f.ts.net/  (via Tailscale)"
Write-Host ""
