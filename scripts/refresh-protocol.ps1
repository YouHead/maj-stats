$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$cachePath = Join-Path $projectPath '.cache'
$baseUrl = 'https://game.maj-soul.com/1/'
New-Item -ItemType Directory -Force -Path $cachePath | Out-Null

# The server does not consistently return application/json; parse explicitly.
$versionText = (Invoke-WebRequest -Uri ($baseUrl + 'version.json') -TimeoutSec 25).Content
$clientVersion = $versionText | ConvertFrom-Json
$resourceText = (Invoke-WebRequest -Uri ($baseUrl + 'resversion' + $clientVersion.version + '.json') -TimeoutSec 25).Content
$resourceIndex = $resourceText | ConvertFrom-Json -AsHashtable
$schemaPrefix = $resourceIndex.res['res/proto/liqi.json'].prefix
$configPrefix = $resourceIndex.res['config.json'].prefix
if (-not $schemaPrefix -or -not $configPrefix) {
    throw 'The official resource index no longer contains the expected protocol or config paths.'
}
Invoke-WebRequest -Uri ($baseUrl + $schemaPrefix + '/res/proto/liqi.json') -OutFile (Join-Path $cachePath 'liqi.json') -TimeoutSec 25
Invoke-WebRequest -Uri ($baseUrl + $configPrefix + '/config.json') -OutFile (Join-Path $cachePath 'client-config.json') -TimeoutSec 25
$versionText | Set-Content -LiteralPath (Join-Path $cachePath 'version.json') -Encoding utf8
Write-Output ('Cached official CN protocol: ' + $clientVersion.version)
