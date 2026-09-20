# ============================================================================
# BidTracker - Production + optional Cloudflare Quick Tunnel
#
# Usage:
#   .\start.ps1
#   .\start.ps1 --rebuild
#   .\start.ps1 --no-cloudflare
#
# Ctrl+C stops backend, both frontends, and the optional Cloudflare tunnel.
# ============================================================================

$ErrorActionPreference = "Stop"

# ============================================================================
# Configuration
# ============================================================================

$Root = $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$ResumeBuilder = Join-Path $Root "resume-builder-frontend"

$BackendBuild = Join-Path $Backend "dist\main.js"
$FrontendBuild = Join-Path $Frontend ".next"

$FrontendUrl = "http://127.0.0.1:3000"
$HealthUrl = "$FrontendUrl/api/health"
$ResumeBuilderUrl = "http://127.0.0.1:3002"

$Rebuild = $false
$NoCloudflare = $false
$Processes = @()

$LogDirectory = Join-Path $env:TEMP "bidtracker"

if (!(Test-Path $LogDirectory)) {
    New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
}

# ============================================================================
# Arguments
# ============================================================================

foreach ($Arg in $args) {
    switch ($Arg.ToLower()) {

        "--rebuild" {
            $Rebuild = $true
        }

        "-rebuild" {
            $Rebuild = $true
        }

        "--no-cloudflare" {
            $NoCloudflare = $true
        }

        "--local" {
            $NoCloudflare = $true
        }

        "--help" {
            Write-Host "Usage: .\start.ps1 [--rebuild] [--no-cloudflare]"
            exit 0
        }

        "-h" {
            Write-Host "Usage: .\start.ps1 [--rebuild] [--no-cloudflare]"
            exit 0
        }

        default {
            Write-Host ""
            Write-Host "Unknown option: $Arg" -ForegroundColor Red
            Write-Host "Usage: .\start.ps1 [--rebuild] [--no-cloudflare]"
            Write-Host ""
            exit 2
        }
    }
}

# ============================================================================
# Functions
# ============================================================================

function Say {
    param([string]$Message)

    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-ProcessTree {
    param([int]$ProcessId)

    if ($ProcessId -le 0) {
        return
    }

    try {
        taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    }
    catch {
        # Process may already be stopped.
    }
}

function Cleanup {
    Write-Host ""
    Write-Host "==> stopping" -ForegroundColor Yellow

    foreach ($Process in $Processes) {
        if ($null -eq $Process) {
            continue
        }

        try {
            if (!$Process.HasExited) {
                Write-Host "Stopping PID $($Process.Id)..."
                Stop-ProcessTree $Process.Id
            }
        }
        catch {
            # Already stopped.
        }
    }

    $Processes = @()
}

function Die {
    param([string]$Message)

    Write-Host ""
    Write-Host "ERROR: $Message" -ForegroundColor Red

    Cleanup

    exit 1
}

function Stop-PortProcess {
    param(
        [int]$Port
    )

    $Connections = Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue

    foreach ($Connection in $Connections) {

        $ProcessId = $Connection.OwningProcess

        if ($ProcessId -and $ProcessId -ne 0) {

            Write-Host `
                "Port $Port is already in use by PID $ProcessId. Stopping it..." `
                -ForegroundColor Yellow

            try {
                taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
            }
            catch {
                # Process may already have exited.
            }
        }
    }
}

# ============================================================================
# Preflight
# ============================================================================

Say "checking environment"

if (!(Test-Path $Backend)) {
    Die "Backend directory not found: $Backend"
}

if (!(Test-Path $Frontend)) {
    Die "Frontend directory not found: $Frontend"
}

if (!(Test-Path $ResumeBuilder)) {
    Die "Resume-builder directory not found: $ResumeBuilder"
}

if (!(Test-Path (Join-Path $ResumeBuilder "node_modules"))) {
    Die "Resume-builder dependencies are missing. Run: Push-Location resume-builder-frontend; npm install; Pop-Location"
}

if (!(Test-Path (Join-Path $Backend ".env"))) {
    Die "Backend .env not found: $Backend\.env"
}

if (!(Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Die "npm was not found in PATH."
}

if (!$NoCloudflare -and !(Get-Command cloudflared.exe -ErrorAction SilentlyContinue)) {
    Die "cloudflared was not found in PATH."
}

Say "checking ports"

Stop-PortProcess -Port 3001
Stop-PortProcess -Port 3000
Stop-PortProcess -Port 3002

Start-Sleep -Milliseconds 500

# ============================================================================
# Build backend
# ============================================================================

if ($Rebuild -or !(Test-Path $BackendBuild)) {

    Say "building backend"

    Push-Location $Backend

    try {
        & npm.cmd run build

        if ($LASTEXITCODE -ne 0) {
            Die "backend build failed."
        }
    }
    finally {
        Pop-Location
    }
}

# ============================================================================
# Build frontend
# ============================================================================

if ($Rebuild -or !(Test-Path $FrontendBuild)) {

    Say "building frontend"

    if ($Rebuild -and (Test-Path $FrontendBuild)) {
        Remove-Item $FrontendBuild -Recurse -Force
    }

    Push-Location $Frontend

    try {
        & npm.cmd run build

        if ($LASTEXITCODE -ne 0) {
            Die "frontend build failed."
        }
    }
    finally {
        Pop-Location
    }
}

# ============================================================================
# Log files
# ============================================================================

$BackendOut = Join-Path $LogDirectory "backend-out.log"
$BackendErr = Join-Path $LogDirectory "backend-err.log"

$FrontendOut = Join-Path $LogDirectory "frontend-out.log"
$FrontendErr = Join-Path $LogDirectory "frontend-err.log"

$ResumeBuilderOut = Join-Path $LogDirectory "resume-builder-out.log"
$ResumeBuilderErr = Join-Path $LogDirectory "resume-builder-err.log"

$CloudflareOut = Join-Path $LogDirectory "cloudflared-out.log"
$CloudflareErr = Join-Path $LogDirectory "cloudflared-err.log"

foreach ($Log in @(
    $BackendOut,
    $BackendErr,
    $FrontendOut,
    $FrontendErr,
    $ResumeBuilderOut,
    $ResumeBuilderErr,
    $CloudflareOut,
    $CloudflareErr
)) {
    if (Test-Path $Log) {
        Remove-Item $Log -Force -ErrorAction SilentlyContinue
    }
}

# ============================================================================
# Start backend
# ============================================================================

Say "starting backend"

$BackendProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "run start" `
    -WorkingDirectory $Backend `
    -WindowStyle Hidden `
    -RedirectStandardOutput $BackendOut `
    -RedirectStandardError $BackendErr `
    -PassThru

$Processes += $BackendProcess

Write-Host "Backend PID: $($BackendProcess.Id)"

# ============================================================================
# Start frontend
# ============================================================================

Say "starting frontend"

$FrontendProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "run start" `
    -WorkingDirectory $Frontend `
    -WindowStyle Hidden `
    -RedirectStandardOutput $FrontendOut `
    -RedirectStandardError $FrontendErr `
    -PassThru

$Processes += $FrontendProcess

Write-Host "Frontend PID: $($FrontendProcess.Id)"

# ============================================================================
# Start resume-builder frontend
# ============================================================================

Say "starting resume-builder"

$ResumeBuilderProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList "run dev -- --host 127.0.0.1 --port 3002" `
    -WorkingDirectory $ResumeBuilder `
    -WindowStyle Hidden `
    -RedirectStandardOutput $ResumeBuilderOut `
    -RedirectStandardError $ResumeBuilderErr `
    -PassThru

$Processes += $ResumeBuilderProcess

Write-Host "Resume-builder PID: $($ResumeBuilderProcess.Id)"

# ============================================================================
# Wait for application
# ============================================================================

Say "waiting for application"

$LocalHealthy = $false

for ($i = 1; $i -le 60; $i++) {

    if ($BackendProcess.HasExited) {
        Write-Host ""
        Write-Host "Backend stopped unexpectedly." -ForegroundColor Red

        if (Test-Path $BackendOut) {
            Get-Content $BackendOut -Tail 30
        }

        if (Test-Path $BackendErr) {
            Get-Content $BackendErr -Tail 30
        }

        Die "backend failed to start."
    }

    if ($FrontendProcess.HasExited) {
        Write-Host ""
        Write-Host "Frontend stopped unexpectedly." -ForegroundColor Red

        if (Test-Path $FrontendOut) {
            Get-Content $FrontendOut -Tail 30
        }

        if (Test-Path $FrontendErr) {
            Get-Content $FrontendErr -Tail 30
        }

        Die "frontend failed to start."
    }

    if ($ResumeBuilderProcess.HasExited) {
        Write-Host ""
        Write-Host "Resume-builder stopped unexpectedly." -ForegroundColor Red

        if (Test-Path $ResumeBuilderOut) {
            Get-Content $ResumeBuilderOut -Tail 30
        }

        if (Test-Path $ResumeBuilderErr) {
            Get-Content $ResumeBuilderErr -Tail 30
        }

        Die "resume-builder failed to start."
    }

    try {
        $Response = Invoke-WebRequest `
            -Uri $HealthUrl `
            -TimeoutSec 3 `
            -UseBasicParsing `
            -ErrorAction Stop

        if ($Response.StatusCode -eq 200) {
            try {
                $ResumeBuilderResponse = Invoke-WebRequest `
                    -Uri $ResumeBuilderUrl `
                    -TimeoutSec 3 `
                    -UseBasicParsing `
                    -ErrorAction Stop

                if ($ResumeBuilderResponse.StatusCode -eq 200) {
                    $LocalHealthy = $true
                    Write-Host "Application is ready." -ForegroundColor Green
                    break
                }
            }
            catch {
                # Resume-builder is still starting.
            }
        }
    }
    catch {
        # Still starting.
    }

    Write-Host "Waiting... $i/60"
    Start-Sleep -Seconds 1
}

if (!$LocalHealthy) {
    Die "application did not become ready within 60 seconds."
}

if ($NoCloudflare) {
    $Public = $FrontendUrl
    $Reachable = $true
}
else {
    # ========================================================================
    # Start Cloudflare Quick Tunnel
    # ========================================================================

Say "opening Cloudflare tunnel"

$CloudflareProcess = Start-Process `
    -FilePath "cloudflared.exe" `
    -ArgumentList "tunnel --url $FrontendUrl --no-autoupdate" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $CloudflareOut `
    -RedirectStandardError $CloudflareErr `
    -PassThru

$Processes += $CloudflareProcess

Write-Host "Cloudflare PID: $($CloudflareProcess.Id)"

# ============================================================================
# Wait for Cloudflare URL
# ============================================================================

Say "waiting for Cloudflare URL"

$Public = $null

for ($i = 1; $i -le 40; $i++) {

    # Check whether cloudflared exited.
    if ($CloudflareProcess.HasExited) {

        Write-Host ""
        Write-Host "Cloudflare exited unexpectedly." -ForegroundColor Red
        Write-Host "Exit code: $($CloudflareProcess.ExitCode)" -ForegroundColor Red

        Write-Host ""
        Write-Host "Cloudflare stdout:" -ForegroundColor Yellow

        if (Test-Path $CloudflareOut) {
            Get-Content $CloudflareOut -Tail 50
        }

        Write-Host ""
        Write-Host "Cloudflare stderr:" -ForegroundColor Yellow

        if (Test-Path $CloudflareErr) {
            Get-Content $CloudflareErr -Tail 50
        }

        Die "Cloudflare tunnel failed to start."
    }

    $Output = ""

    if (Test-Path $CloudflareOut) {
        $Output += (Get-Content $CloudflareOut -Raw -ErrorAction SilentlyContinue)
    }

    if (Test-Path $CloudflareErr) {
        $Output += (Get-Content $CloudflareErr -Raw -ErrorAction SilentlyContinue)
    }

    if ($Output -match "https://[a-zA-Z0-9-]+\.trycloudflare\.com") {
        $Public = $Matches[0]
        break
    }

    Write-Host "Waiting... $i/40"
    Start-Sleep -Seconds 1
}

if (!$Public) {

    Write-Host ""
    Write-Host "Cloudflare did not provide a URL." -ForegroundColor Red

    Write-Host ""
    Write-Host "Cloudflare stdout:" -ForegroundColor Yellow
    if (Test-Path $CloudflareOut) {
        Get-Content $CloudflareOut
    }

    Write-Host ""
    Write-Host "Cloudflare stderr:" -ForegroundColor Yellow
    if (Test-Path $CloudflareErr) {
        Get-Content $CloudflareErr
    }

    Die "Cloudflare tunnel did not provide a public URL."
}

# ============================================================================
# Verify public URL
# ============================================================================

Say "checking public URL"

$Reachable = $false

# Quick Tunnel hostnames can take a little while to become reachable after
# cloudflared prints the URL. Keep the local services alive while the edge settles.
for ($i = 1; $i -le 30; $i++) {

    try {

        $HealthResponse = Invoke-WebRequest `
            -Uri "$Public/api/health" `
            -TimeoutSec 10 `
            -UseBasicParsing `
            -ErrorAction Stop

        if (
            $HealthResponse.StatusCode -eq 200 -and
            $HealthResponse.Content -match '"ok"\s*:\s*true'
        ) {
            $Reachable = $true
            break
        }
    }
    catch {
        # Tunnel may still be connecting.
    }

    Start-Sleep -Seconds 2
}
}

# ============================================================================
# Display
# ============================================================================

if ($NoCloudflare) {
    $Status = "local mode; Cloudflare tunnel disabled"
    $StatusColor = "Green"
}
elseif ($Reachable) {
    $Status = "verified reachable from the internet"
    $StatusColor = "Green"
}
else {
    $Status = "WARNING: public URL did not pass /api/health"
    $StatusColor = "Yellow"
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  PUBLIC URL:" -ForegroundColor White
Write-Host ""
Write-Host "  $Public" -ForegroundColor Green
Write-Host ""
Write-Host "  STATUS:" -ForegroundColor White
Write-Host ""
Write-Host "  $Status" -ForegroundColor $StatusColor
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Backend:   http://127.0.0.1:3001"
Write-Host "  Frontend:  http://127.0.0.1:3000"
Write-Host "  Resume:    http://127.0.0.1:3002"
Write-Host ""
if ($NoCloudflare) {
    Write-Host "  Cloudflare disabled; use the local URL above."
}
else {
    Write-Host "  Temporary Cloudflare Quick Tunnel."
    Write-Host "  The URL changes when you run the script again."
}
Write-Host ""
Write-Host "  Press Ctrl+C to stop everything."
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

# ============================================================================
# Keep running
# ============================================================================

try {

    while ($true) {

        Start-Sleep -Seconds 2

        if ($BackendProcess.HasExited) {
            Write-Host ""
            Write-Host "WARNING: backend has stopped." -ForegroundColor Yellow
            break
        }

        if ($FrontendProcess.HasExited) {
            Write-Host ""
            Write-Host "WARNING: frontend has stopped." -ForegroundColor Yellow
            break
        }

        if ($ResumeBuilderProcess.HasExited) {
            Write-Host ""
            Write-Host "WARNING: resume-builder has stopped." -ForegroundColor Yellow
            break
        }

        if ($null -ne $CloudflareProcess -and $CloudflareProcess.HasExited) {
            Write-Host ""
            Write-Host "WARNING: Cloudflare tunnel has stopped." -ForegroundColor Yellow
            break
        }
    }
}
finally {
    Cleanup
}