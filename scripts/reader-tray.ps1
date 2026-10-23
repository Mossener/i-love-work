param(
    [switch]$NoBrowser,
    [switch]$Stop,
    [ValidateRange(0, 3600)][int]$ExitAfterSeconds = 0,
    [ValidateRange(1024, 65535)][int]$Port = 5173
)

$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$readerUrl = "http://127.0.0.1:$Port/"
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
try {
    $instanceKey = ([BitConverter]::ToString($hashAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectDirectory.ToLowerInvariant() + ':' + $Port)))).Replace('-', '').Substring(0, 16)
} finally { $hashAlgorithm.Dispose() }
$stateDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "ILoveWork\$instanceKey"
[void][IO.Directory]::CreateDirectory($stateDirectory)
$launcherLog = Join-Path $stateDirectory 'launcher.log'
$stateFile = Join-Path $stateDirectory 'launcher.json'
$serverOutput = Join-Path $stateDirectory 'server.stdout.log'
$serverErrors = Join-Path $stateDirectory 'server.stderr.log'
$mutex = $null
$openEvent = $null
$stopEvent = $null
$tray = $null
$timer = $null
$context = $null
$serverProcess = $null
$serverProcessId = $null
$script:serverFailureReported = $false
$script:exitRequested = $false
$ownsMutex = $false
$ready = $false
$reusedServer = $false
$exitCode = 0

function Write-LauncherLog([string]$Message) {
    Add-Content -LiteralPath $launcherLog -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $Message) -Encoding UTF8
}

function Write-LauncherState([string]$Status) {
    [ordered]@{
        status = $Status
        launcherPid = $PID
        serverPid = $serverProcessId
        ownsServer = [bool]($serverProcess)
        reusedServer = $reusedServer
        projectDirectory = $projectDirectory
        url = $readerUrl
        updatedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
}

function Test-ReaderServer {
    try {
        $health = Invoke-WebRequest -Uri ($readerUrl + '__reader_health') -UseBasicParsing -TimeoutSec 2
        $metadata = $health.Content | ConvertFrom-Json
        if ($metadata.app -eq 'i-love-work' -and
            [IO.Path]::GetFullPath([string]$metadata.root).TrimEnd('\') -eq $projectDirectory -and
            $health.Headers['X-I-Love-Work'] -eq '1') {
            $index = Invoke-WebRequest -Uri $readerUrl -UseBasicParsing -TimeoutSec 2
            return $index.StatusCode -eq 200 -and $index.Headers['X-I-Love-Work'] -eq '1'
        }
    } catch { }
    try {
        $package = Invoke-WebRequest -Uri ($readerUrl + 'package.json') -UseBasicParsing -TimeoutSec 2
        if (($package.Content | ConvertFrom-Json).name -notin @('i-love-work', 'ban-shang-you-shu')) { return $false }
        $index = Invoke-WebRequest -Uri $readerUrl -UseBasicParsing -TimeoutSec 2
        return $index.StatusCode -eq 200 -and $index.Content -match '/src/main\.tsx'
    } catch { return $false }
}

function Open-Reader {
    if (-not $ready) { return }
    try {
        # This is the user-facing browser, rather than a background helper.
        Start-Process -FilePath $readerUrl
        Write-LauncherLog 'Opened reader in the default browser.'
    } catch {
        Write-LauncherLog ("Browser open failed: " + $_.Exception.Message)
        [void][Windows.Forms.MessageBox]::Show("无法打开默认浏览器，请手动访问：`n$readerUrl", '我爱上班', 'OK', 'Warning')
    }
}

try {
    if ($Stop) {
        try {
            $stopEvent = [Threading.EventWaitHandle]::OpenExisting("Local\ILoveWork-Stop-$instanceKey")
            [void]$stopEvent.Set()
            Write-LauncherLog 'Running tray received an exit request.'
        } catch [Threading.WaitHandleCannotBeOpenedException] { Write-LauncherLog 'No running tray to stop.' }
        return
    }
    $createdNew = $false
    $mutex = New-Object Threading.Mutex($true, "Local\ILoveWork-$instanceKey", [ref]$createdNew)
    if (-not $createdNew) {
        # A second desktop click asks the running instance to open its browser.
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            try {
                $openEvent = [Threading.EventWaitHandle]::OpenExisting("Local\ILoveWork-Open-$instanceKey")
                [void]$openEvent.Set()
                Write-LauncherLog 'Existing instance signalled; no second server or tray created.'
                break
            } catch [Threading.WaitHandleCannotBeOpenedException] { Start-Sleep -Milliseconds 100 }
        }
        return
    }
    $ownsMutex = $true
    $openEvent = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, "Local\ILoveWork-Open-$instanceKey")
    $stopEvent = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, "Local\ILoveWork-Stop-$instanceKey")
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()
    $context = New-Object Windows.Forms.ApplicationContext
    $tray = New-Object Windows.Forms.NotifyIcon
    $tray.Text = '我爱上班 · 正在启动'
    $iconPath = Join-Path $projectDirectory 'assets\icons\pdf-reader.ico'
    $tray.Icon = if (Test-Path -LiteralPath $iconPath) { New-Object Drawing.Icon($iconPath) } else { [Drawing.SystemIcons]::Application }
    $menu = New-Object Windows.Forms.ContextMenuStrip
    $openItem = $menu.Items.Add('打开阅读器')
    $openItem.Enabled = $false
    $openItem.add_Click({ Open-Reader })
    [void]$menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
    $logsItem = $menu.Items.Add('打开启动日志')
    $logsItem.add_Click({ Start-Process -FilePath notepad.exe -ArgumentList ('"' + $launcherLog + '"') })
    $exitItem = $menu.Items.Add('退出')
    $exitItem.add_Click({ $script:exitRequested = $true; $context.ExitThread() })
    $tray.ContextMenuStrip = $menu
    $tray.add_DoubleClick({ Open-Reader })
    $tray.Visible = $true
    Write-LauncherState 'starting'
    Write-LauncherLog ("Starting launcher PID $PID for $projectDirectory")

    if (Test-ReaderServer) {
        $reusedServer = $true
        Write-LauncherLog 'Reusing the existing reader server; this launcher will not stop it.'
    } else {
        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($listener) { throw "端口 $Port 已被其他程序占用。请关闭占用该端口的程序后再试；为保留原来的书籍和进度，不会自动更换端口。" }
        $bundledNode = Join-Path $projectDirectory 'runtime\node.exe'
        if (Test-Path -LiteralPath $bundledNode) {
            $nodeExecutable = $bundledNode
        } else {
            $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
            if (-not $nodeCommand) { throw '未找到 Node.js。请下载带内置运行环境的 Windows 版本，或安装 Node.js 20 及更新版本：https://nodejs.org/' }
            $nodeExecutable = $nodeCommand.Source
        }
        $nodeVersion = & $nodeExecutable --version
        $versionMatch = [regex]::Match($nodeVersion, '^v(\d+)\.')
        if ($LASTEXITCODE -ne 0 -or -not $versionMatch.Success -or [int]$versionMatch.Groups[1].Value -lt 20) {
            throw '需要 Node.js 20 或更新版本。请更新后重试：https://nodejs.org/'
        }
        $productionServer = Join-Path $projectDirectory 'scripts\reader-server.mjs'
        $distributionDirectory = Join-Path $projectDirectory 'dist'
        if ((Test-Path -LiteralPath (Join-Path $distributionDirectory 'index.html')) -and (Test-Path -LiteralPath $productionServer)) {
            $serverArguments = @(('"' + $productionServer + '"'), '--port', $Port, '--root', ('"' + $distributionDirectory + '"'))
            Write-LauncherLog 'Using the production reader; no npm dependencies are required.'
        } else {
            $viteScript = Join-Path $projectDirectory 'node_modules\vite\bin\vite.js'
            if (-not (Test-Path -LiteralPath $viteScript)) {
                throw "缺少阅读器文件。请重新解压完整的 Windows 发布包；源码版本请运行 npm install 后重试。`n项目目录：$projectDirectory"
            }
            $serverArguments = @(('"' + $viteScript + '"'), '--host', '127.0.0.1', '--port', $Port, '--strictPort')
            Write-LauncherLog 'Using the development reader.'
        }
        $serverProcess = Start-Process -FilePath $nodeExecutable -ArgumentList $serverArguments -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput $serverOutput -RedirectStandardError $serverErrors -PassThru
        $serverProcessId = $serverProcess.Id
        Write-LauncherLog ("Started owned reader server PID " + $serverProcess.Id)
        $deadline = [DateTime]::UtcNow.AddSeconds(35)
        while (-not (Test-ReaderServer)) {
            [Windows.Forms.Application]::DoEvents()
            if ($script:exitRequested -or $stopEvent.WaitOne(0)) { return }
            if ($serverProcess.HasExited) { throw "阅读服务启动失败。请查看启动日志和 server.stderr.log。日志目录：$stateDirectory" }
            if ([DateTime]::UtcNow -ge $deadline) { throw "阅读服务启动超时。日志目录：$stateDirectory" }
            Start-Sleep -Milliseconds 200
        }
    }

    if ($script:exitRequested) { return }
    $ready = $true
    $openItem.Enabled = $true
    $tray.Text = '我爱上班 · 阅读服务运行中'
    Write-LauncherState 'ready'
    Write-LauncherLog 'Reader is ready; tray menu has Open reader, Open logs and Exit.'
    if (-not $NoBrowser) { Open-Reader }
    $startedAt = [DateTime]::UtcNow
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 250
    $timer.add_Tick({
        if ($stopEvent.WaitOne(0)) { $context.ExitThread(); return }
        if ($openEvent.WaitOne(0)) { Open-Reader }
        if ($ExitAfterSeconds -gt 0 -and ([DateTime]::UtcNow - $startedAt).TotalSeconds -ge $ExitAfterSeconds) { $context.ExitThread() }
        if ($serverProcess -and $serverProcess.HasExited -and -not $script:serverFailureReported) {
            $script:serverFailureReported = $true
            $script:ready = $false
            Write-LauncherLog 'Owned reader server stopped unexpectedly.'
            Write-LauncherState 'server-stopped'
            $tray.ShowBalloonTip(5000, '我爱上班', '阅读服务已停止，请重新启动。可在托盘菜单查看启动日志。', 'Error')
            $openItem.Enabled = $false
            $tray.Text = '我爱上班 · 阅读服务已停止'
        }
    })
    $timer.Start()
    [Windows.Forms.Application]::Run($context)
} catch {
    $exitCode = 1
    Write-LauncherLog ("ERROR: " + $_.Exception.ToString())
    if ($ExitAfterSeconds -eq 0) {
        Add-Type -AssemblyName System.Windows.Forms
        [void][Windows.Forms.MessageBox]::Show(($_.Exception.Message + "`n`n启动日志：$launcherLog"), '我爱上班 · 启动失败', 'OK', 'Error')
    }
} finally {
    if ($timer) { $timer.Stop(); $timer.Dispose() }
    if ($tray) { $tray.Visible = $false; $tray.Dispose() }
    if ($serverProcess) {
        # Keep the actual process handle; never kill by a saved/recycled PID or by port.
        if (-not $serverProcess.HasExited) {
            Write-LauncherLog ("Stopping owned reader server PID " + $serverProcess.Id)
            $serverProcess.Kill()
            [void]$serverProcess.WaitForExit(5000)
        }
        $serverProcess.Dispose()
    }
    if ($context) { $context.Dispose() }
    if ($openEvent) { $openEvent.Dispose() }
    if ($stopEvent) { $stopEvent.Dispose() }
    if ($ownsMutex) {
        Write-LauncherState 'stopped'
        Write-LauncherLog 'Tray launcher exited.'
        $mutex.ReleaseMutex()
    }
    if ($mutex) { $mutex.Dispose() }
}
exit $exitCode
