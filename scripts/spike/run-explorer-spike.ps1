<#
  Real Explorer -> Twirly drag experiment (docs/native-integration.md, spike S1/S2/S4).
  Moves the mouse and presses Shift for ~3 seconds. Do not touch the mouse or keyboard while it runs.
  Works only on a throwaway fixture folder under tests/.tmp.

  Usage: powershell -ExecutionPolicy Bypass -File scripts/spike/run-explorer-spike.ps1 [-NoShift] [-Dy -110]
#>
param(
  [switch]$NoShift, [int]$Dx = 0, [int]$Dy = -110, [int]$HoldMs = 300, [string]$Trigger = 'Shift',
  # File manager to drag from: 'explorer' or 'files' (the Files app, process Files.exe).
  [ValidateSet('explorer', 'files')][string]$App = 'explorer',
  # Drag-summon scope written to the isolated settings, and the app list for 'custom'.
  [ValidateSet('explorer', 'custom', 'anywhere')][string]$Scope = 'explorer',
  [string[]]$Apps = @('explorer.exe'),
  # Optional "x,y" to move the file manager window (e.g. onto the second monitor).
  [string]$MoveTo = ''
)
# -Trigger: the settings key id (e.g. 'Shift', 'KeyQ'). The app runs with an isolated user-data
# folder whose settings.json sets that trigger, so the user's real settings are never touched.
$triggerVk = switch -Regex ($Trigger) { '^Shift$' { 0xA0 } '^Control$' { 0xA2 } '^Alt$' { 0xA4 } '^Key([A-Z])$' { [int][char]$Matches[1] } '^Digit([0-9])$' { 0x30 + [int]$Matches[1] } default { throw "Unsupported -Trigger $Trigger" } }
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\..\.."
$fixture = Join-Path $root 'tests\.tmp\explorer-spike'
$log = Join-Path $root 'tests\.tmp\explorer-spike.log'
$driverProj = Join-Path $root 'tests\native\ExplorerDragSpike\ExplorerDragSpike.csproj'

# 1. Fixture: a fresh PNG in an empty folder.
if (Test-Path $fixture) { Remove-Item $fixture -Recurse -Force }
New-Item -ItemType Directory $fixture | Out-Null
Remove-Item $log -ErrorAction SilentlyContinue
Push-Location $root
node -e "require('sharp')({create:{width:240,height:160,channels:3,background:'#3b82f6'}}).png().toFile(process.argv[1])" (Join-Path $fixture 'sample.png')
Pop-Location
$sourceHash = (Get-FileHash (Join-Path $fixture 'sample.png')).Hash

# 2. Build the input driver.
dotnet build $driverProj -c Release -o (Join-Path $root 'tests\.tmp\spike-driver') -v q -nologo | Out-Null

# 3. Launch Twirly (built app) with the evidence log; strip ELECTRON_RUN_AS_NODE inherited from editors.
$env:TWIRLY_SPIKE_LOG = $log
$userData = Join-Path $root 'tests\.tmp\spike-user-data'
if (Test-Path $userData) { Remove-Item $userData -Recurse -Force }
New-Item -ItemType Directory $userData | Out-Null
@{ dragSummon = @{ enabled = $true; scope = $Scope; apps = @($Apps); trigger = $Trigger } } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $userData 'settings.json') -Encoding ascii
$env:TWIRLY_USER_DATA = $userData
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$twirly = Start-Process $electron -ArgumentList "`"$(Join-Path $root 'out\main\index.js')`"" -PassThru
$deadline = (Get-Date).AddSeconds(15)
while (-not ((Test-Path $log) -and (Select-String -Path $log -Pattern '"ready"' -Quiet))) {
  if ((Get-Date) -gt $deadline) { taskkill /PID $twirly.Id /T /F 2>&1 | Out-Null; throw 'Helper did not report ready (is native/windows-helper published?)' }
  Start-Sleep -Milliseconds 200
}

# 4. Open Explorer on the fixture and drive the drag.
if ($App -eq 'files') { Start-Process "$env:LOCALAPPDATA\Microsoft\WindowsApps\files-stable.exe" -ArgumentList "`"$fixture`""; Start-Sleep -Seconds 5 }
else { Start-Process explorer.exe $fixture; Start-Sleep -Seconds 2 }
$driverArgs = @('--folder', $fixture, '--item', 'sample', '--dx', $Dx, '--dy', $Dy, '--hold-ms', $HoldMs, '--trigger-vk', $triggerVk, '--app', $App, '--close-explorer')
if ($MoveTo) { $driverArgs += @('--move-to', $MoveTo) }
if ($NoShift) { $driverArgs += '--no-shift' }
& (Join-Path $root 'tests\.tmp\spike-driver\ExplorerDragSpike.exe') @driverArgs

# 5. Wait for the job, then report.
$deadline = (Get-Date).AddSeconds(10)
while (-not (Select-String -Path $log -Pattern '"status":"(done|failed)"' -Quiet)) {
  if ((Get-Date) -gt $deadline) { break }
  Start-Sleep -Milliseconds 200
}
Start-Sleep -Seconds 2 # give Explorer time to act on the drop result (a MOVE would delete the source now)
taskkill /PID $twirly.Id /T /F 2>&1 | Out-Null

$src = Join-Path $fixture 'sample.png'
[pscustomobject]@{
  SourceExists    = Test-Path $src
  SourceUnchanged = (Test-Path $src) -and ((Get-FileHash $src).Hash -eq $sourceHash)
  FolderContents  = (Get-ChildItem $fixture -Name) -join ', '
} | Format-List
Write-Host '--- evidence log ---'
Get-Content $log
