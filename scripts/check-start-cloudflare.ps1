# Run with: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-start-cloudflare.ps1
# Import only the launcher's health-check functions and control-flow blocks so
# these regressions do not start servers, access the network, or change data.
$ErrorActionPreference = 'Stop'
$Launcher = Join-Path (Split-Path $PSScriptRoot -Parent) 'start.ps1'
$ParseErrors = $null
$Ast = [Management.Automation.Language.Parser]::ParseFile($Launcher, [ref]$null, [ref]$ParseErrors)
if ($ParseErrors.Count -gt 0) {
    throw ($ParseErrors | Out-String)
}

foreach ($Name in @('Test-PublicHealth', 'Wait-PublicHealth')) {
    $Function = $Ast.Find({
        param($Node)
        $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq $Name
    }, $true)
    if ($null -eq $Function) { throw "Missing launcher function: $Name" }
    . ([scriptblock]::Create($Function.Extent.Text))
}

$Verification = $Ast.Find({
    param($Node)
    $Node -is [Management.Automation.Language.IfStatementAst] -and
        $Node.Extent.Text -match '^if \(!\$NoCloudflare\) \{\s*Say "checking public URL"'
}, $true)
$Retry = $Ast.Find({
    param($Node)
    $Node -is [Management.Automation.Language.IfStatementAst] -and
        $Node.Extent.Text -match '^if \(!\$NoCloudflare -and !\$Reachable -and'
}, $true)
if ($null -eq $Verification -or $null -eq $Retry) { throw 'Missing public verification or retry block.' }
$VerificationBlock = [scriptblock]::Create($Verification.Extent.Text)
$RetryBlock = [scriptblock]::Create($Retry.Extent.Text)

function Assert([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}

function Set-Probes([object[]]$Responses) {
    $script:Responses = $Responses
    $script:Requests = 0
    $script:Sleeps = 0
}

function Invoke-WebRequest {
    param($Uri, $TimeoutSec, [switch]$UseBasicParsing, $ErrorAction)
    Assert ($Uri -eq 'https://fixture.trycloudflare.com/api/health') 'Wrong health URL.'
    Assert ($TimeoutSec -eq 10) 'Public requests must have a timeout.'
    $Response = $script:Responses[[Math]::Min($script:Requests, $script:Responses.Count - 1)]
    $script:Requests++
    if ($Response -is [Exception]) { throw $Response }
    return $Response
}

function Start-Sleep { param($Seconds) $script:Sleeps++ }
function Say { param($Message) }
function Stop-ProcessTree { throw 'A failed health check must not kill the running tunnel.' }

$Url = 'https://fixture.trycloudflare.com'
$Healthy = [pscustomobject]@{ StatusCode = 200; Content = '{"ok":true,"db":"up"}' }
$DnsError = [Net.WebException]::new('Fixture DNS lookup failed.', [Net.WebExceptionStatus]::NameResolutionFailure)
$LiveProcess = [pscustomobject]@{ HasExited = $false; ExitCode = $null }

Set-Probes @($Healthy)
$Result = Test-PublicHealth -Url $Url
Assert $Result.Reachable 'Valid health JSON must pass.'
Assert (!$Result.DnsFailure -and $null -eq $Result.Error) 'Healthy responses must not retain an error.'
Write-Output 'PASS: healthy API response'

foreach ($Body in @('<html>"ok":true</html>', '{"ok":false}', '{"ok":"true"}', '{"nested":{"ok":true}}')) {
    Set-Probes @([pscustomobject]@{ StatusCode = 200; Content = $Body })
    $Result = Test-PublicHealth -Url $Url
    Assert (!$Result.Reachable -and $Result.Error -match 'HTTP 200') 'Invalid health responses must not pass.'
}
Set-Probes @([pscustomobject]@{ StatusCode = 503; Content = '{"ok":true}' })
$Result = Test-PublicHealth -Url $Url
Assert (!$Result.Reachable -and $Result.Error -match 'HTTP 503') 'Non-200 responses must not pass.'
Write-Output 'PASS: HTML, wrong JSON, and non-200 responses are rejected'

foreach ($Failure in @(
    $DnsError,
    [Exception]::new('Wrapped DNS failure.', [Net.Sockets.SocketException]::new(11001))
)) {
    Set-Probes @($Failure)
    $Result = Test-PublicHealth -Url $Url
    Assert (!$Result.Reachable -and $Result.DnsFailure -and $Result.Error) 'DNS errors must be identified and retained.'
}
Set-Probes @([Net.WebException]::new('Fixture TLS failure.', [Net.WebExceptionStatus]::TrustFailure))
$Result = Test-PublicHealth -Url $Url
Assert (!$Result.Reachable -and !$Result.DnsFailure -and $Result.Error -match 'TLS') 'TLS errors must not be classified as DNS.'
Write-Output 'PASS: DNS and TLS failures remain distinguishable'

Set-Probes @($DnsError, $Healthy)
$Result = Wait-PublicHealth -Url $Url -TunnelProcess $LiveProcess -Attempts 3 6>$null
Assert ($Result.Reachable -and $script:Requests -eq 2 -and $script:Sleeps -eq 1) 'A delayed hostname must recover on retry.'
Write-Output 'PASS: delayed DNS recovery'

# Exercise the actual launcher branch that used to stop a healthy tunnel.
$FrontendUrl = 'http://127.0.0.1:3000'
$CloudflareErr = Join-Path $PSScriptRoot 'nonexistent-fixture-cloudflared.log'
$CloudflareProcess = $LiveProcess
$NoCloudflare = $false
$Public = $Url
Set-Probes @($DnsError)
. $VerificationBlock 6>$null
Assert (!$NoCloudflare -and !$Reachable -and $Public -eq $Url) 'DNS failure must keep the public URL with unverified status.'
Assert ([object]::ReferenceEquals($CloudflareProcess, $LiveProcess)) 'The live tunnel must remain tracked for cleanup.'
Assert ($script:Requests -eq 30 -and $script:Sleeps -eq 29) 'Startup retries must be bounded.'
Write-Output 'PASS: failed verification preserves the running tunnel and public URL'

$NextPublicHealthCheck = [DateTime]::UtcNow.AddSeconds(-1)
Set-Probes @($DnsError)
. $RetryBlock 6>$null
Assert (!$Reachable -and !$NoCloudflare) 'A background DNS failure must retain unverified status.'
Assert ($NextPublicHealthCheck -gt [DateTime]::UtcNow) 'Background retries must be spaced out.'

$NextPublicHealthCheck = [DateTime]::UtcNow.AddSeconds(-1)
Set-Probes @($Healthy)
. $RetryBlock 6>$null
Assert $Reachable 'Background recovery must update verified status.'
. $RetryBlock 6>$null
Assert ($script:Requests -eq 1) 'Stop retrying once public health has passed.'
Write-Output 'PASS: background recovery updates status and ends retries'

$CloudflareProcess = [pscustomobject]@{ HasExited = $true; ExitCode = 1 }
$NoCloudflare = $false
$Public = $Url
Set-Probes @($Healthy)
. $VerificationBlock 6>$null
Assert ($NoCloudflare -and $Public -eq $FrontendUrl -and $null -eq $CloudflareProcess) 'An exited tunnel must fall back to local mode.'
Assert ($script:Requests -eq 0) 'Do not wait on public health after the tunnel exits.'
$NextPublicHealthCheck = [DateTime]::UtcNow.AddSeconds(-1)
. $RetryBlock 6>$null
Assert ($script:Requests -eq 0) 'Local mode must not run public health checks.'
Write-Output 'PASS: exited tunnel falls back locally without public requests'
