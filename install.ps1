# Installation de BeatSense sous Windows. Dans PowerShell :
#   irm https://raw.githubusercontent.com/hugomyb/beatsense/main/install.ps1 | iex
#
# Installe ffmpeg et uv si besoin, le serveur dans %LOCALAPPDATA%\BeatSense, le lance au
# démarrage de Windows (sans fenêtre), puis installe l'extension dans Firefox et/ou Chrome.
# Relancer la commande répare / réinstalle. Le serveur se met ensuite à jour tout seul.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Raw = "https://raw.githubusercontent.com/hugomyb/beatsense/main"
$Xpi = "https://github.com/hugomyb/beatsense/releases/latest/download/beatsense.xpi"
$ChromeZip = "https://github.com/hugomyb/beatsense/releases/latest/download/beatsense-chrome.zip"
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

function Find-Browser($exe) {
    $key = "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe"
    foreach ($root in "HKCU:", "HKLM:") {
        $path = (Get-ItemProperty "$root\$key" -ErrorAction SilentlyContinue).'(default)'
        if ($path) { $path = $path.Trim('"') }
        if ($path -and (Test-Path $path)) { return $path }
    }
}

$Firefox = Find-Browser "firefox.exe"
if ($Firefox) {
    Step "Installation de l'extension dans Firefox"
    $XpiFile = Join-Path $env:TEMP "beatsense.xpi"
    Invoke-WebRequest $Xpi -OutFile $XpiFile
    Start-Process $Firefox -ArgumentList "`"$XpiFile`""
    Write-Host "Clique sur « Ajouter » dans Firefox. Les mises à jour se feront ensuite toutes seules." -ForegroundColor Green
}

$Chrome = Find-Browser "chrome.exe"
if ($Chrome) {
    Step "Préparation de l'extension Chrome"
    # Le serveur tient ce dossier à jour ; Chrome recharge l'extension quand une version sort
    $ChromeDir = "$Dir\chrome-extension"
    if (-not (Test-Path "$ChromeDir\manifest.json")) {
        $Zip = Join-Path $env:TEMP "beatsense-chrome.zip"
        Invoke-WebRequest $ChromeZip -OutFile $Zip
        Expand-Archive $Zip -DestinationPath $ChromeDir -Force
    }
    Set-Clipboard $ChromeDir
    Start-Process $Chrome -ArgumentList "chrome://extensions"
    Write-Host "Dans Chrome (page des extensions qui vient de s'ouvrir) :" -ForegroundColor Green
    Write-Host "  1. active le « Mode développeur » en haut à droite"
    Write-Host "  2. « Charger l'extension non empaquetée » et colle ce dossier (déjà copié) :"
    Write-Host "     $ChromeDir"
    Write-Host "  À faire une seule fois : les mises à jour se feront ensuite toutes seules."
}

if (-not $Firefox -and -not $Chrome) {
    Write-Host "Ni Firefox ni Chrome trouvés : installe l'un des deux puis relance cette commande."
}
