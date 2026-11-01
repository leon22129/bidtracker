# ============================================================================
# BidTracker - backend + frontend with optional Cloudflare Quick Tunnel
#
# Usage:
#   .\start.ps1
#   .\start.ps1 --dev
#   .\start.ps1 --rebuild
#   .\start.ps1 --no-cloudflare
#
# Ctrl+C or closing this terminal stops the backend, frontend, and optional tunnel.
# ============================================================================

$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Write-Error "start.ps1 requires Windows. Use the manual startup commands in README.md on this system."
    exit 1
}

# Keep every process started by this script in a Windows job object. Windows closes
# the job handle if this PowerShell process exits for any reason (including its
# terminal being closed), and KILL_ON_JOB_CLOSE then stops the complete process tree.
$ProcessJobTypeAvailable = $true
if (-not ("BidTrackerProcessJob" -as [type])) {
    try {
        Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class BidTrackerProcessJob
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private static IntPtr handle = IntPtr.Zero;

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int infoClass,
        IntPtr info,
        uint infoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr objectHandle);

    public static void Create()
    {
        Close();
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not create process job");

        var limits = new ExtendedLimitInformation();
        limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        int length = Marshal.SizeOf(typeof(ExtendedLimitInformation));
        IntPtr info = Marshal.AllocHGlobal(length);

        try
        {
            Marshal.StructureToPtr(limits, info, false);
            if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, info, (uint)length))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not configure process job");
        }
        catch
        {
            Close();
            throw;
        }
        finally
        {
            Marshal.FreeHGlobal(info);
        }
    }

    public static void AddProcess(IntPtr processHandle)
    {
        if (handle == IntPtr.Zero)
            throw new InvalidOperationException("Process job has not been created");
        if (!AssignProcessToJobObject(handle, processHandle))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not add process to job");
    }

    public static void Close()
    {
        if (handle == IntPtr.Zero)
            return;
        CloseHandle(handle);
        handle = IntPtr.Zero;
    }
}
"@
    }
    catch {
        $ProcessJobTypeAvailable = $false
    }
}

# ============================================================================
# Configuration
# ============================================================================

$Root = $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

$BackendBuild = Join-Path $Backend "dist\main.js"
$FrontendBuild = Join-Path $Frontend ".next"

$FrontendUrl = "http://127.0.0.1:3000"
$BackendUrl = "http://127.0.0.1:3001"
$HealthUrl = "$FrontendUrl/api/health"

$Rebuild = $false
$Dev = $false
$NoCloudflare = $false
$Processes = @()
$ProcessJobCreated = $false
$CloudflareProcess = $null

$LogDirectory = Join-Path ([IO.Path]::GetTempPath()) "bidtracker"

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

        "--dev" {
            $Dev = $true
        }

        "-dev" {
            $Dev = $true
        }

        "--no-cloudflare" {
            $NoCloudflare = $true
        }

        "--local" {
            $NoCloudflare = $true
        }

        "--help" {
            Write-Host "Usage: .\start.ps1 [--dev | --rebuild] [--no-cloudflare]"
            exit 0
        }

        "-h" {
            Write-Host "Usage: .\start.ps1 [--dev | --rebuild] [--no-cloudflare]"
            exit 0
        }

        default {
            Write-Host ""
            Write-Host "Unknown option: $Arg" -ForegroundColor Red
            Write-Host "Usage: .\start.ps1 [--dev | --rebuild] [--no-cloudflare]"
            Write-Host ""
            exit 2
        }
    }
}

if ($Dev -and $Rebuild) {
    Write-Host ""
    Write-Host "--dev and --rebuild cannot be used together." -ForegroundColor Red
    Write-Host "Usage: .\start.ps1 [--dev | --rebuild] [--no-cloudflare]"
    Write-Host ""
    exit 2
}

# Development mode is intentionally local-only. Hot-reload servers should not
# be exposed through a public quick tunnel.
if ($Dev) {
    $NoCloudflare = $true
}

# Keep the two services aligned even when the host has unrelated PORT or
# BACKEND_URL environment variables.
$PreviousPortEnv = $env:PORT
$PreviousBackendUrlEnv = $env:BACKEND_URL
$env:PORT = "3001"
$env:BACKEND_URL = $BackendUrl

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

function Start-ManagedNpmProcess {
    param(
        [string]$NpmScript,
        [string]$WorkingDirectory,
        [string]$StandardOutputPath,
        [string]$StandardErrorPath
    )

    # The helper waits before starting npm. This gives the launcher time to put
    # it in the job first, so npm and Node inherit job membership with no race.
    $GateName = "Local\BidTracker-$PID-$([Guid]::NewGuid().ToString('N'))"
    $ReadyName = "$GateName-Ready"
    $Gate = [Threading.EventWaitHandle]::new(
        $false,
        [Threading.EventResetMode]::ManualReset,
        $GateName
    )
    $Ready = [Threading.EventWaitHandle]::new(
        $false,
        [Threading.EventResetMode]::ManualReset,
        $ReadyName
    )
    $Process = $null

    $HelperScript = @"
`$gate = [Threading.EventWaitHandle]::OpenExisting('$GateName')
`$ready = [Threading.EventWaitHandle]::OpenExisting('$ReadyName')
try {
    `$ready.Set() | Out-Null
    `$gate.WaitOne() | Out-Null
}
finally {
    `$gate.Dispose()
    `$ready.Dispose()
}
& npm.cmd run $NpmScript
exit `$LASTEXITCODE
"@

    $EncodedCommand = [Convert]::ToBase64String(
        [Text.Encoding]::Unicode.GetBytes($HelperScript)
    )

    try {
        $Process = Start-Process `
            -FilePath "powershell.exe" `
            -ArgumentList @("-NoProfile", "-NonInteractive", "-EncodedCommand", $EncodedCommand) `
            -WorkingDirectory $WorkingDirectory `
            -WindowStyle Hidden `
            -RedirectStandardOutput $StandardOutputPath `
            -RedirectStandardError $StandardErrorPath `
            -PassThru

        if ($ProcessJobCreated) {
            try {
                [BidTrackerProcessJob]::AddProcess($Process.Handle)
            }
            catch {
                if ($Processes.Count -gt 0) {
                    throw
                }
                [BidTrackerProcessJob]::Close()
                $script:ProcessJobCreated = $false
                Write-Host "Process job unavailable; Ctrl+C will stop the servers, but closing the terminal may leave them running." -ForegroundColor Yellow
            }
        }
        if (!$Ready.WaitOne(30000)) {
            throw "npm process helper did not initialize within 30 seconds"
        }
        $Gate.Set() | Out-Null
        return $Process
    }
    catch {
        if ($null -ne $Process -and !$Process.HasExited) {
            Stop-ProcessTree $Process.Id
        }
        throw
    }
    finally {
        $Gate.Dispose()
        $Ready.Dispose()
    }
}

function Cleanup {
    Write-Host ""
    Write-Host "==> stopping" -ForegroundColor Yellow

    # Stop each tracked tree while its wrapper process still exists. Closing the
    # job first can make the wrappers exit before taskkill can discover escaped
    # npm/Node descendants, leaving dev watchers alive after the launcher stops.
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

    if ($ProcessJobCreated) {
        try {
            [BidTrackerProcessJob]::Close()
            $script:ProcessJobCreated = $false
            Start-Sleep -Milliseconds 250
        }
        catch {
            # Explicit process-tree cleanup above already made the best effort.
        }
    }

    $Processes = @()
    if ($null -eq $PreviousPortEnv) {
        Remove-Item Env:PORT -ErrorAction SilentlyContinue
    }
    else {
        $env:PORT = $PreviousPortEnv
    }
    if ($null -eq $PreviousBackendUrlEnv) {
        Remove-Item Env:BACKEND_URL -ErrorAction SilentlyContinue
    }
    else {
        $env:BACKEND_URL = $PreviousBackendUrlEnv
    }
}

function Die {
    param([string]$Message)

    Write-Host ""
    Write-Host "ERROR: $Message" -ForegroundColor Red

    Cleanup

    exit 1
}

function Assert-PortAvailable([int]$Port) {
    $Listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if ($Listeners | Where-Object { $_.Port -eq $Port } | Select-Object -First 1) {
        Die "Port $Port is in use. Stop the other server and run start.ps1 again."
    }
}

function Ensure-Dependencies([string]$Project) {
    $ProjectPath = Join-Path $Root $Project
    $InstalledLock = Join-Path $ProjectPath "node_modules\.package-lock.json"
    $LockFile = Join-Path $ProjectPath "package-lock.json"
    $ToolPath = if ($Project -eq "backend") {
        Join-Path $ProjectPath "node_modules\.bin\prisma.cmd"
    }
    else {
        Join-Path $ProjectPath "node_modules\.bin\next.cmd"
    }
    if (!(Test-Path -LiteralPath $LockFile)) {
        Die "$Project/package-lock.json is missing; cannot install its dependencies reproducibly."
    }
    $NeedsInstall = !(Test-Path -LiteralPath $InstalledLock) -or !(Test-Path -LiteralPath $ToolPath)
    if (!$NeedsInstall) {
        return
    }
    Say "installing $Project dependencies"
    Push-Location $ProjectPath
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) {
            Die "$Project dependency install failed. Check npm's error above and run start.ps1 again."
        }
    }
    finally {
        Pop-Location
    }
}

trap {
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    Cleanup
    exit 1
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

if (!(Test-Path (Join-Path $Backend ".env"))) {
    Die "Backend .env is missing. Copy .env.example to backend/.env and set DATABASE_URL, JWT_SECRET, and the admin credentials."
}

if (!(Get-Command node.exe -ErrorAction SilentlyContinue) -or !(Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Die "Node.js and npm are required. Install Node.js 20.19.4 or newer, then reopen PowerShell."
}

$NodeVersion = (& node.exe -p "process.versions.node").Trim()
$NodeParts = $NodeVersion.Split('.') | ForEach-Object { [int]$_ }
if ($NodeParts[0] -lt 20 -or ($NodeParts[0] -eq 20 -and
    ($NodeParts[1] -lt 19 -or ($NodeParts[1] -eq 19 -and $NodeParts[2] -lt 4)))) {
    Die "Node.js $NodeVersion is too old. Install Node.js 20.19.4 or newer."
}

if (!$NoCloudflare -and !(Get-Command cloudflared.exe -ErrorAction SilentlyContinue)) {
    Write-Host "cloudflared is unavailable; starting in local mode." -ForegroundColor Yellow
    $NoCloudflare = $true
}

if ($ProcessJobTypeAvailable) {
    try {
        [BidTrackerProcessJob]::Create()
        $ProcessJobCreated = $true
    }
    catch {
        $ProcessJobTypeAvailable = $false
    }
}
if (!$ProcessJobTypeAvailable) {
    Write-Host "Process job unavailable; Ctrl+C will stop the servers, but closing the terminal may leave them running." -ForegroundColor Yellow
}

Say "checking ports"

Assert-PortAvailable -Port 3001
Assert-PortAvailable -Port 3000

Ensure-Dependencies -Project "backend"
Ensure-Dependencies -Project "frontend"

# ============================================================================
# Build backend
# ============================================================================

$BackendBuildInfo = Join-Path $Backend "dist\tsconfig.build.tsbuildinfo"
$BackendBuildTime = if (Test-Path -LiteralPath $BackendBuildInfo) {
    (Get-Item -LiteralPath $BackendBuildInfo).LastWriteTimeUtc
}
else {
    [DateTime]::MinValue
}
$BackendSourceChanged = Get-ChildItem (Join-Path $Backend "src") -Recurse -File -Filter "*.ts" |
    Where-Object { $_.Name -notlike "*.spec.ts" -and $_.LastWriteTimeUtc -gt $BackendBuildTime } |
    Select-Object -First 1
$BackendConfigChanged = Get-Item (Join-Path $Backend "tsconfig.json"),
    (Join-Path $Backend "tsconfig.build.json"),
    (Join-Path $Backend "package.json") |
    Where-Object { $_.LastWriteTimeUtc -gt $BackendBuildTime } |
    Select-Object -First 1

if (!$Dev -and ($Rebuild -or !(Test-Path $BackendBuild) -or $BackendSourceChanged -or $BackendConfigChanged)) {

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

$FrontendBuildId = Join-Path $FrontendBuild "BUILD_ID"
$FrontendBuildTime = if (Test-Path -LiteralPath $FrontendBuildId) {
    (Get-Item -LiteralPath $FrontendBuildId).LastWriteTimeUtc
}
else {
    [DateTime]::MinValue
}
$FrontendSourceChanged = Get-ChildItem (Join-Path $Frontend "src") -Recurse -File |
    Where-Object { $_.LastWriteTimeUtc -gt $FrontendBuildTime } |
    Select-Object -First 1
$FrontendConfigChanged = Get-Item (Join-Path $Frontend "next.config.mjs"),
    (Join-Path $Frontend "package.json"),
    (Join-Path $Frontend "tsconfig.json") |
    Where-Object { $_.LastWriteTimeUtc -gt $FrontendBuildTime } |
    Select-Object -First 1

if (!$Dev -and ($Rebuild -or !(Test-Path -LiteralPath $FrontendBuildId) -or $FrontendSourceChanged -or $FrontendConfigChanged)) {

    Say "building frontend"

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

$CloudflareOut = Join-Path $LogDirectory "cloudflared-out.log"
$CloudflareErr = Join-Path $LogDirectory "cloudflared-err.log"

$script:AiUsageLogOffsets = @{}
$script:AiUsageLogBuffers = @{}

function Get-AiUsageLogPath {
    $UtcDate = [DateTime]::UtcNow.ToString("yyyy-MM-dd")
    return Join-Path (Join-Path $Backend "logs") "${UtcDate}.log"
}

function Initialize-AiUsageMonitor {
    $Path = Get-AiUsageLogPath
    $script:AiUsageLogOffsets[$Path] = if (Test-Path -LiteralPath $Path) {
        (Get-Item -LiteralPath $Path).Length
    }
    else {
        0
    }
    $script:AiUsageLogBuffers[$Path] = ""
}

function Format-AiTokenCount([object]$Value) {
    if ($null -eq $Value) {
        return "n/a"
    }
    return "{0:N0}" -f [long]$Value
}

function Format-AiCost([object]$Value, [object]$UsageAvailable, [object]$PricingConfigured) {
    if ($UsageAvailable -eq $false) {
        return "token usage unavailable"
    }
    if ($null -eq $Value) {
        if ($PricingConfigured -eq $false) {
            return "pricing not configured"
        }
        return "cost unavailable"
    }
    return '$' + ("{0:F6}" -f [double]$Value)
}

function Show-NewAiUsageSummaries {
    $Path = Get-AiUsageLogPath
    if (!(Test-Path -LiteralPath $Path)) {
        return
    }
    if (!$script:AiUsageLogOffsets.ContainsKey($Path)) {
        $script:AiUsageLogOffsets[$Path] = 0
        $script:AiUsageLogBuffers[$Path] = ""
    }

    $Stream = $null
    $Reader = $null
    try {
        $Stream = [IO.File]::Open(
            $Path,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::ReadWrite
        )
        $Offset = [long]$script:AiUsageLogOffsets[$Path]
        if ($Offset -gt $Stream.Length) {
            $Offset = 0
        }
        [void]$Stream.Seek($Offset, [IO.SeekOrigin]::Begin)
        $Reader = [IO.StreamReader]::new($Stream, [Text.Encoding]::UTF8, $true, 4096, $true)
        $Content = $Reader.ReadToEnd()
        $script:AiUsageLogOffsets[$Path] = $Stream.Position
    }
    catch {
        return
    }
    finally {
        if ($null -ne $Reader) {
            $Reader.Dispose()
        }
        if ($null -ne $Stream) {
            $Stream.Dispose()
        }
    }

    if (!$Content) {
        return
    }
    $Combined = [string]$script:AiUsageLogBuffers[$Path] + $Content
    $Lines = $Combined -split '\r?\n'
    if (!$Combined.EndsWith("`n")) {
        $script:AiUsageLogBuffers[$Path] = $Lines[-1]
        $Lines = @($Lines | Select-Object -SkipLast 1)
    }
    else {
        $script:AiUsageLogBuffers[$Path] = ""
    }

    foreach ($Line in $Lines) {
        if (!$Line -or $Line -notmatch '"event":"application_generation_usage"') {
            continue
        }
        try {
            $Entry = $Line | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            continue
        }

        Write-Host ""
        Write-Host "AI usage and estimated cost [$($Entry.model)]" -ForegroundColor Cyan
        Write-Host (
            "  Resume only:        {0} input + {1} output = {2}" -f `
                (Format-AiTokenCount $Entry.resume_input_tokens), `
                (Format-AiTokenCount $Entry.resume_output_tokens), `
                (Format-AiCost $Entry.resume_estimated_total_cost_usd $Entry.resume_usage_available $Entry.resume_pricing_rates_configured)
        )
        Write-Host (
            "  Initial application: {0} input + {1} output = {2}" -f `
                (Format-AiTokenCount $Entry.application_input_tokens), `
                (Format-AiTokenCount $Entry.application_output_tokens), `
                (Format-AiCost $Entry.application_estimated_total_cost_usd $Entry.application_usage_available $Entry.application_pricing_rates_configured)
        ) -ForegroundColor Green
        Write-Host "  Draft ID:           $($Entry.draft_id)"
        Write-Host "  Application total includes eligibility + resume; later answers are separate."
        Write-Host ""
    }
}

foreach ($Log in @(
    $BackendOut,
    $BackendErr,
    $FrontendOut,
    $FrontendErr,
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

if ($Dev) {
    $BackendStartCommand = "run start:dev"
    $FrontendStartCommand = "run dev"
    Say "starting backend from source (watch mode)"
}
else {
    $BackendStartCommand = "run start"
    $FrontendStartCommand = "run start"
    Say "starting backend"
}

$BackendProcess = Start-ManagedNpmProcess `
    -NpmScript ($BackendStartCommand -replace '^run ', '') `
    -WorkingDirectory $Backend `
    -StandardOutputPath $BackendOut `
    -StandardErrorPath $BackendErr
$Processes += $BackendProcess

Write-Host "Backend PID: $($BackendProcess.Id)"

# ============================================================================
# Start frontend
# ============================================================================

Say "starting frontend"

$FrontendProcess = Start-ManagedNpmProcess `
    -NpmScript ($FrontendStartCommand -replace '^run ', '') `
    -WorkingDirectory $Frontend `
    -StandardOutputPath $FrontendOut `
    -StandardErrorPath $FrontendErr
$Processes += $FrontendProcess

Write-Host "Frontend PID: $($FrontendProcess.Id)"

# ============================================================================
# Wait for application
# ============================================================================

Say "waiting for application"

$LocalHealthy = $false

for ($i = 1; $i -le 120; $i++) {

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

    try {
        $Response = Invoke-WebRequest `
            -Uri $HealthUrl `
            -TimeoutSec 3 `
            -UseBasicParsing `
            -ErrorAction Stop

        if ($Response.StatusCode -eq 200) {
            $LocalHealthy = $true
            Write-Host "Application is ready." -ForegroundColor Green
            break
        }
    }
    catch {
        # Still starting.
    }

    Write-Host "Waiting... $i/120"
    Start-Sleep -Seconds 1
}

if (!$LocalHealthy) {
    Write-Host ""
    Write-Host "Backend log:" -ForegroundColor Yellow
    if (Test-Path $BackendOut) {
        Get-Content $BackendOut -Tail 40
    }
    if (Test-Path $BackendErr) {
        Get-Content $BackendErr -Tail 40
    }

    Write-Host ""
    Write-Host "Frontend log:" -ForegroundColor Yellow
    if (Test-Path $FrontendOut) {
        Get-Content $FrontendOut -Tail 40
    }
    if (Test-Path $FrontendErr) {
        Get-Content $FrontendErr -Tail 40
    }

    Die "application did not become ready within 120 seconds."
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

try {
    $CloudflareProcess = Start-Process `
        -FilePath "cloudflared.exe" `
        -ArgumentList "tunnel --url $FrontendUrl --no-autoupdate" `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $CloudflareOut `
        -RedirectStandardError $CloudflareErr `
        -PassThru
    $Processes += $CloudflareProcess
    if ($ProcessJobCreated) {
        [BidTrackerProcessJob]::AddProcess($CloudflareProcess.Handle)
    }
}
catch {
    Write-Host "Cloudflare could not start: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Continuing in local mode." -ForegroundColor Yellow
    if ($null -ne $CloudflareProcess -and !$CloudflareProcess.HasExited) {
        Stop-ProcessTree $CloudflareProcess.Id
    }
    $CloudflareProcess = $null
    $NoCloudflare = $true
    $Public = $FrontendUrl
    $Reachable = $true
}

if (!$NoCloudflare) {

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

        Write-Host "Continuing in local mode." -ForegroundColor Yellow
        $CloudflareProcess = $null
        $NoCloudflare = $true
        $Public = $FrontendUrl
        $Reachable = $true
        break
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

    Write-Host "Continuing in local mode." -ForegroundColor Yellow
    if ($null -ne $CloudflareProcess -and !$CloudflareProcess.HasExited) {
        Stop-ProcessTree $CloudflareProcess.Id
    }
    $CloudflareProcess = $null
    $NoCloudflare = $true
    $Public = $FrontendUrl
    $Reachable = $true
}

# ============================================================================
# Verify public URL
# ============================================================================

if (!$NoCloudflare) {
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
if (!$Reachable) {
    Write-Host "Cloudflare URL did not become reachable; continuing in local mode." -ForegroundColor Yellow
    if ($null -ne $CloudflareProcess -and !$CloudflareProcess.HasExited) {
        Stop-ProcessTree $CloudflareProcess.Id
    }
    $CloudflareProcess = $null
    $NoCloudflare = $true
    $Public = $FrontendUrl
    $Reachable = $true
}
}
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
Write-Host "  FRONTEND URL:" -ForegroundColor White
Write-Host ""
Write-Host "  $Public" -ForegroundColor Green
Write-Host ""
Write-Host "  BACKEND API URL:" -ForegroundColor White
Write-Host ""
Write-Host "  $Public/api" -ForegroundColor Green
Write-Host ""
Write-Host "  STATUS:" -ForegroundColor White
Write-Host ""
Write-Host "  $Status" -ForegroundColor $StatusColor
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Backend:   http://127.0.0.1:3001"
Write-Host "  Frontend:  http://127.0.0.1:3000"
if ($Dev) {
    Write-Host "  Mode:      development (source watch; no build)"
}
Write-Host ""
if ($NoCloudflare) {
    Write-Host "  Cloudflare disabled; use the local URL above."
}
else {
    Write-Host "  Temporary Cloudflare Quick Tunnel."
    Write-Host "  The URL changes when you run the script again."
}
Write-Host ""
if ($ProcessJobCreated) {
    Write-Host "  Press Ctrl+C or close this terminal to stop everything."
}
else {
    Write-Host "  Press Ctrl+C to stop everything."
}
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

Initialize-AiUsageMonitor

# ============================================================================
# Keep running
# ============================================================================

try {

    while ($true) {

        Start-Sleep -Seconds 2

        Show-NewAiUsageSummaries

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

        if ($null -ne $CloudflareProcess -and $CloudflareProcess.HasExited) {
            Write-Host ""
            Write-Host "Cloudflare tunnel stopped. The app is still available at $FrontendUrl" -ForegroundColor Yellow
            $CloudflareProcess = $null
            $NoCloudflare = $true
        }
    }
}
finally {
    Cleanup
}
