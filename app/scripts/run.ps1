# Quits any running lokey (only processes started from this repo), rebuilds the sidecar and the app, then starts it.
$app = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $app
Get-Process electron, Lokey.Host -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase) } |
  Stop-Process -Force
Start-Sleep -Milliseconds 600
dotnet build "$repo\native\Lokey.Host" -c Release
if ($LASTEXITCODE -ne 0) { throw "sidecar build failed" }
Push-Location $app
npx electron-vite build
npx electron .
Pop-Location
