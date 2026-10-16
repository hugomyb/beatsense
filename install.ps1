# Installation de BeatSense sous Windows. Dans PowerShell :
#   irm https://raw.githubusercontent.com/hugomyb/beatsense/main/install.ps1 | iex
#
# Installe ffmpeg et uv si besoin, le serveur dans %LOCALAPPDATA%\BeatSense, le lance au
# démarrage de Windows (sans fenêtre), puis ouvre l'extension dans Firefox.
# Relancer la commande répare / réinstalle. Le serveur se met ensuite à jour tout seul.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Raw = "https://raw.githubusercontent.com/hugomyb/beatsense/main"
$Xpi = "https://github.com/hugomyb/beatsense/releases/latest/download/beatsense.xpi"
$Dir = Join-Path $env:LOCALAPPDATA "BeatSense"

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Step "Installation de ffmpeg (conversion en mp3)"
    winget install --id Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Step "Installation de uv (gère Python pour BeatSense, sans toucher au reste du système)"
    powershell -NoProfile -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    Refresh-Path
}

Step "Arrêt de l'ancienne version si elle tourne"
Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" |
    Where-Object { $_.CommandLine -like "*beatsense.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Step "Téléchargement du serveur"
New-Item -ItemType Directory -Force "$Dir\server" | Out-Null
Invoke-WebRequest "$Raw/server/beatsense.py" -OutFile "$Dir\server\beatsense.py"
Invoke-WebRequest "$Raw/server/requirements.txt" -OutFile "$Dir\server\requirements.txt"

Step "Préparation de Python et yt-dlp"
uv venv --seed --allow-existing -q -p 3.12 "$Dir\.venv"
uv pip install -q -p "$Dir\.venv" -U -r "$Dir\server\requirements.txt"

Step "Lancement au démarrage de Windows"
$Pythonw = "$Dir\.venv\Scripts\pythonw.exe"
$PyArgs = "-I `"$Dir\server\beatsense.py`""
$Shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath("Startup")) "BeatSense.lnk"))
$Shortcut.TargetPath = $Pythonw
$Shortcut.Arguments = $PyArgs
$Shortcut.WorkingDirectory = $Dir
$Shortcut.Save()
Start-Process $Pythonw -ArgumentList $PyArgs -WorkingDirectory $Dir

Start-Sleep -Seconds 3
try {
    $health = Invoke-RestMethod "http://127.0.0.1:7843/health"
    Write-Host "Serveur BeatSense lancé, prods enregistrées dans $($health.dir)" -ForegroundColor Green
} catch {
    Write-Host "Le serveur ne répond pas. Lance-le à la main pour voir l'erreur :" -ForegroundColor Red
    Write-Host "  & `"$Dir\.venv\Scripts\python.exe`" -I `"$Dir\server\beatsense.py`""
    return
}

Step "Installation de l'extension dans Firefox"
$XpiFile = Join-Path $env:TEMP "beatsense.xpi"
Invoke-WebRequest $Xpi -OutFile $XpiFile
try {
    Start-Process firefox -ArgumentList "`"$XpiFile`""
    Write-Host "Clique sur « Ajouter » dans Firefox. Les mises à jour se feront ensuite toutes seules." -ForegroundColor Green
} catch {
    Write-Host "Firefox introuvable : ouvre $XpiFile avec Firefox pour installer l'extension."
}
