param(
    [Parameter(Mandatory = $true)][string]$ProjectDirectory,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [Parameter(Mandatory = $true)][int]$TestPort,
    [switch]$QuietStartup
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$global:trayTestUrls = [Collections.Generic.List[string]]::new()
$global:trayTestPhase = 0
$global:trayTestStarted = [DateTime]::UtcNow
$global:trayTestDuplicate = $null
$global:trayTestResultPath = $ResultPath
$global:trayTestProject = $ProjectDirectory
$global:trayTestPort = $TestPort
$global:trayTestInitialOpens = if ($QuietStartup) { 0 } else { 1 }

# Only intercept the browser boundary; the real tray, server and IPC still run.
function Start-Process {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, Position = 0)][string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory,
        [string]$WindowStyle,
        [string]$RedirectStandardOutput,
        [string]$RedirectStandardError,
        [switch]$PassThru
    )
    if ($FilePath -match '^https?://') {
        $global:trayTestUrls.Add($FilePath)
        return
    }
    Microsoft.PowerShell.Management\Start-Process @PSBoundParameters
}

function Assert-OpenCount([int]$Expected, [string]$Action) {
    if ($global:trayTestUrls.Count -ne $Expected) {
        throw "$Action expected $Expected browser opens, received $($global:trayTestUrls.Count)."
    }
}

function Save-TestResult([bool]$Passed, [string]$Message) {
    [ordered]@{
        passed = $Passed
        message = $Message
        phase = $global:trayTestPhase
        urls = $global:trayTestUrls.ToArray()
        launcherPid = $PID
        serverPid = $serverProcessId
        stateDirectory = $stateDirectory
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $global:trayTestResultPath -Encoding UTF8
}

$global:trayTestTimer = New-Object Windows.Forms.Timer
$global:trayTestTimer.Interval = 100
$global:trayTestTimer.add_Tick({
    try {
        if (([DateTime]::UtcNow - $global:trayTestStarted).TotalSeconds -gt 30) { throw 'Tray interaction test timed out.' }
        if (-not $ready) { return }
        if ($global:trayTestPhase -eq 0) {
            # Prevent nested WinForms message dispatch from reentering this stage.
            $global:trayTestTimer.Stop()
            Assert-OpenCount $global:trayTestInitialOpens 'Startup'
            if (-not $openItem.Enabled) { throw 'The ready tray menu is disabled.' }
            $openItem.PerformClick()
            Assert-OpenCount ($global:trayTestInitialOpens + 1) 'Open reader menu'

            $script:ready = $false
            $openItem.PerformClick()
            Assert-OpenCount ($global:trayTestInitialOpens + 1) 'Reader before ready'
            $script:ready = $true

            $doubleClick = [Windows.Forms.NotifyIcon].GetMethod('OnDoubleClick', [Reflection.BindingFlags]'Instance,NonPublic')
            [void]$doubleClick.Invoke($tray, @([EventArgs]::Empty))
            Assert-OpenCount ($global:trayTestInitialOpens + 2) 'Tray double-click'

            $arguments = @('-NoLogo', '-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $global:trayTestProject 'scripts\reader-tray.ps1') + '"'), '-Port', $global:trayTestPort, '-NoBrowser', '-ExitAfterSeconds', '10')
            $global:trayTestDuplicate = Start-Process -FilePath powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
            $global:trayTestPhase = 1
            $global:trayTestTimer.Start()
        } elseif ($global:trayTestPhase -eq 1 -and $global:trayTestUrls.Count -ge ($global:trayTestInitialOpens + 3)) {
            Assert-OpenCount ($global:trayTestInitialOpens + 3) 'Repeated launcher'
            $global:trayTestPhase = 2
            Save-TestResult $true 'Startup, menu, readiness, double-click and repeated launch passed.'
            $global:trayTestTimer.Stop()
            [void]$stopEvent.Set()
        }
    } catch {
        Save-TestResult $false $_.Exception.Message
        $global:trayTestTimer.Stop()
        if ($context) { $context.ExitThread() }
    }
})
$global:trayTestTimer.Start()

# The launcher exits this process after its own finally block cleans up.
. (Join-Path $ProjectDirectory 'scripts\reader-tray.ps1') -Port $TestPort -NoBrowser:$QuietStartup -ExitAfterSeconds 35
