param(
    [string]$RuntimeDirectory = 'C:\nvm4w\nodejs',
    [string]$OutputDirectory = '',
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageMetadata = Get-Content -LiteralPath (Join-Path $projectDirectory 'package.json') -Raw | ConvertFrom-Json
$version = [string]$packageMetadata.version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version in package.json.' }
if ($packageMetadata.name -ne 'i-love-work') { throw 'The release must use the i-love-work package name.' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectDirectory 'output\releases' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$runtimeNode = Join-Path $RuntimeDirectory 'node.exe'
$runtimeLicense = Join-Path $RuntimeDirectory 'LICENSE'
$requiredFiles = @('dist\index.html', 'assets\icons\pdf-reader.ico', 'assets\icons\fontawesome-LICENSE.txt', 'scripts\reader-tray.ps1', 'scripts\reader-server.mjs', 'start.vbs', 'start.bat', 'README.md', 'LICENSE', 'package-lock.json')
foreach ($relative in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory $relative) -PathType Leaf)) { throw "Missing release file: $relative. Run npm run build first." }
}
if (-not (Test-Path -LiteralPath $runtimeNode -PathType Leaf)) { throw "Node.js runtime is missing: $runtimeNode" }
if (-not (Test-Path -LiteralPath $runtimeLicense -PathType Leaf)) { throw "Node.js license is missing: $runtimeLicense" }
$runtimeDetails = (& $runtimeNode -p 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $runtimeDetails.platform -ne 'win32' -or $runtimeDetails.arch -ne 'x64' -or [int]($runtimeDetails.version.TrimStart('v').Split('.')[0]) -lt 20) { throw 'The portable release requires a Windows x64 Node.js 20+ runtime.' }
$archiveName = "i-love-work-v$version-windows-x64"
$zipPath = Join-Path $OutputDirectory ($archiveName + '.zip')
if (Test-Path -LiteralPath $zipPath) { throw "The release already exists: $zipPath. Choose another output directory to rebuild without overwriting it." }
if ($ValidateOnly) {
    [ordered]@{ version = $version; runtime = $runtimeDetails; zip = $zipPath; validated = $true } | ConvertTo-Json -Depth 4
    return
}

[void][IO.Directory]::CreateDirectory($OutputDirectory)
$stagingDirectory = Join-Path $OutputDirectory ('staging-' + [Guid]::NewGuid().ToString('N'))
$packageDirectory = Join-Path $stagingDirectory $archiveName
[void][IO.Directory]::CreateDirectory($packageDirectory)
foreach ($directory in @('dist', 'assets\icons', 'docs\images')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory $directory) -PathType Container)) { continue }
    $destination = Join-Path $packageDirectory $directory
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $destination))
    Copy-Item -LiteralPath (Join-Path $projectDirectory $directory) -Destination (Split-Path -Parent $destination) -Recurse
}
[void][IO.Directory]::CreateDirectory((Join-Path $packageDirectory 'scripts'))
foreach ($relative in @('scripts\reader-tray.ps1', 'scripts\reader-server.mjs', 'start.vbs', 'start.bat', 'README.md', 'LICENSE')) {
    Copy-Item -LiteralPath (Join-Path $projectDirectory $relative) -Destination (Join-Path $packageDirectory $relative)
}
if (Test-Path -LiteralPath (Join-Path $projectDirectory 'README.en.md') -PathType Leaf) {
    Copy-Item -LiteralPath (Join-Path $projectDirectory 'README.en.md') -Destination (Join-Path $packageDirectory 'README.en.md')
}
if (Test-Path -LiteralPath (Join-Path $projectDirectory 'output\releases\release-notes.md') -PathType Leaf) {
    Copy-Item -LiteralPath (Join-Path $projectDirectory 'output\releases\release-notes.md') -Destination (Join-Path $packageDirectory 'RELEASE-NOTES.md')
}
[void][IO.Directory]::CreateDirectory((Join-Path $packageDirectory 'runtime'))
Copy-Item -LiteralPath $runtimeNode -Destination (Join-Path $packageDirectory 'runtime\node.exe')
Copy-Item -LiteralPath $runtimeLicense -Destination (Join-Path $packageDirectory 'runtime\LICENSE')

# Include license files for the installed production dependency tree, including
# PDF.js font/CMap licenses. No package implementation or node_modules is shipped.
$licenseIndex = [Collections.Generic.List[object]]::new()
$dependencyQueue = [Collections.Generic.Queue[object]]::new()
$visitedDependencies = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($dependency in $packageMetadata.dependencies.PSObject.Properties) {
    $dependencyQueue.Enqueue(@{ from = $projectDirectory; name = $dependency.Name })
}
while ($dependencyQueue.Count -gt 0) {
    $requestedDependency = $dependencyQueue.Dequeue()
    $searchDirectory = [string]$requestedDependency.from
    $dependencyDirectory = $null
    while ($searchDirectory) {
        $candidate = Join-Path $searchDirectory ('node_modules\' + $requestedDependency.name)
        if (Test-Path -LiteralPath (Join-Path $candidate 'package.json') -PathType Leaf) { $dependencyDirectory = $candidate; break }
        $searchDirectory = Split-Path -Parent $searchDirectory
    }
    if (-not $dependencyDirectory -or -not $visitedDependencies.Add($dependencyDirectory)) { continue }
    $metadataPath = Join-Path $dependencyDirectory 'package.json'
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    foreach ($dependency in @($metadata.dependencies.PSObject.Properties) + @($metadata.optionalDependencies.PSObject.Properties)) {
        if ($dependency.Name) { $dependencyQueue.Enqueue(@{ from = $dependencyDirectory; name = $dependency.Name }) }
    }
    $licenseDirectoryName = ($metadata.name + '-' + $metadata.version) -replace '[^A-Za-z0-9._-]', '_'
    $licenseFiles = @(Get-ChildItem -LiteralPath $dependencyDirectory -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE)([._-].*)?$' })
    $copiedFiles = [Collections.Generic.List[string]]::new()
    foreach ($licenseFile in $licenseFiles) {
        $relativeLicense = $licenseFile.FullName.Substring($dependencyDirectory.Length).TrimStart([char[]]@('\', '/'))
        if ($relativeLicense -match '(^|[\\/])node_modules[\\/]') { continue }
        $licenseDestination = Join-Path $packageDirectory (Join-Path ('licenses\' + $licenseDirectoryName) $relativeLicense)
        [void][IO.Directory]::CreateDirectory((Split-Path -Parent $licenseDestination))
        Copy-Item -LiteralPath $licenseFile.FullName -Destination $licenseDestination
        $copiedFiles.Add(('licenses/' + $licenseDirectoryName + '/' + $relativeLicense.Replace('\', '/')))
    }
    $licenseIndex.Add([ordered]@{ name = $metadata.name; version = $metadata.version; license = $metadata.license; files = $copiedFiles.ToArray() })
}
$licenseIndex | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $packageDirectory 'licenses\index.json') -Encoding UTF8
$notices = @(
    '# Third-party notices',
    '',
    'I Love Work application source code is released under the MIT License. The full application license is included in LICENSE at the root of this distribution.',
    'Third-party components retain their respective licenses listed below.',
    '',
    "This I Love Work $version Windows x64 portable distribution bundles Node.js $($runtimeDetails.version).",
    'The Node.js license and bundled component notices are in runtime/LICENSE.',
    '',
    'The PDF desktop icon is derived from Font Awesome Free 6.7.2, copyright 2024 Fonticons, Inc., under CC BY 4.0.',
    'The original source, attribution, modifications and license are in assets/icons/NOTICE.md and assets/icons/fontawesome-LICENSE.txt.',
    '',
    'The browser bundle contains third-party software. Its production dependency versions, license declarations and license-file locations are indexed in licenses/index.json.',
    'Full available upstream license files are retained in licenses/. PDF.js font and CMap notices are included there.'
)
$notices | Set-Content -LiteralPath (Join-Path $packageDirectory 'THIRD-PARTY-NOTICES.md') -Encoding UTF8
[ordered]@{ app = 'i-love-work'; product = 'I Love Work'; version = $version; runtime = $runtimeDetails; builtAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $packageDirectory 'release-info.json') -Encoding UTF8

Compress-Archive -LiteralPath $packageDirectory -DestinationPath $zipPath -CompressionLevel Optimal
$checksum = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($zipPath + '.sha256') -Value ($checksum + '  ' + [IO.Path]::GetFileName($zipPath)) -Encoding ASCII
[ordered]@{ version = $version; runtime = $runtimeDetails.version; packageDirectory = $packageDirectory; zip = $zipPath; bytes = (Get-Item -LiteralPath $zipPath).Length; sha256 = $checksum } | ConvertTo-Json
