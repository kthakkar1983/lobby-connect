# Lobby Connect — hotel-PC RustDesk provisioning (stack-consolidation Phase 2 template,
# becomes the Phase-3 onboarding tool).
#
# What it does: silent-installs RustDesk on a Windows hotel PC, points it at OUR
# self-hosted server (relay.lobby-connect.com, key-pinned), sets the unattended
# password, and prints the peer ID to record.
#
# Flow + flags follow the official client-deployment guide
# (https://rustdesk.com/docs/en/self-host/client-deployment/): --silent-install →
# wait → --install-service → wait → --get-id / --config / --password.
#
# Run as Administrator. Fill BOTH placeholders in a LOCAL copy first — NEVER commit the
# filled values (public repo; the config string encodes the server key, which under -k _
# doubles as the relay's access token — runbook §12):
#   $rustdesk_cfg — the exported server config string: PM entry "RustDesk exported server
#                   config" (produced once via Settings → Network → Export Server Config
#                   on a configured client — Phase-2 runsheet H3).
#   $rustdesk_pw  — per-PC unattended password. Generate fresh per property; enter it
#                   into the property's Remote-access admin card (PM keeps a backup copy).
#
# Manual fallback (if --config is ever flaky): RustDesk → Settings → Network → unlock →
#   ID server:    relay.lobby-connect.com
#   Relay server: relay.lobby-connect.com
#   API server:   (blank)
#   Key:          <server public key — sources listed in runbook §12>

$ErrorActionPreference = "Stop"

$rustdesk_cfg = "PASTE-EXPORTED-SERVER-CONFIG-STRING-HERE"
$rustdesk_pw  = "PASTE-PER-PC-UNATTENDED-PASSWORD-HERE"

# Pinned client version — bump deliberately, in step with the server (runbook §12).
# 1.4.8 = latest release at template time (github.com/rustdesk/rustdesk/releases, 2026-07-03).
$rustdesk_version = "1.4.8"
$installer = "$env:TEMP\rustdesk-$rustdesk_version-x86_64.exe"

if ($rustdesk_cfg -like "PASTE-*" -or $rustdesk_pw -like "PASTE-*") {
    Write-Error "Fill in `$rustdesk_cfg and `$rustdesk_pw before running (see header)."
}

Write-Output "Downloading RustDesk $rustdesk_version..."
Invoke-WebRequest "https://github.com/rustdesk/rustdesk/releases/download/$rustdesk_version/rustdesk-$rustdesk_version-x86_64.exe" -OutFile $installer

Write-Output "Silent install..."
Start-Process $installer -ArgumentList "--silent-install" -Wait
Start-Sleep -Seconds 20   # per the official guide: let install settle

Set-Location "$env:ProgramFiles\RustDesk"

Write-Output "Installing service..."
Start-Process .\rustdesk.exe -ArgumentList "--install-service" -Wait
Start-Sleep -Seconds 20   # per the official guide: let the service come up

if ((Get-Service -Name "Rustdesk" -ErrorAction SilentlyContinue).Status -ne "Running") {
    Write-Error "Rustdesk service is not running — stop and investigate before configuring."
}

Write-Output "Applying server config + unattended password..."
.\rustdesk.exe --config $rustdesk_cfg
.\rustdesk.exe --password $rustdesk_pw

$rustdesk_id = (.\rustdesk.exe --get-id | Out-String).Trim()
Write-Output ""
Write-Output "=== Provisioned ==="
Write-Output "Peer ID: $rustdesk_id   <- enter this into the property's Remote-access admin card"
Write-Output "Unattended password: enter into the same Remote-access admin card (PM keeps a backup copy)"
Write-Output "Verify in the RustDesk UI: Ready (green) + our server under Settings -> Network."
