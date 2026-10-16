# BeatSense installation on Windows. In PowerShell:
#   irm https://raw.githubusercontent.com/hugomyb/beatsense/main/install.ps1 | iex
#
# Installs ffmpeg and uv if needed, the server in %LOCALAPPDATA%\BeatSense, starts it at
# Windows startup (without a window), then installs the extension in Firefox and/or Chrome.
# Rerunning the command repairs / reinstalls. The server then updates itself.

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
    Step "Installing ffmpeg (mp3 conversion)"
    winget install --id Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Step "Installing uv (manages Python for BeatSense, without touching the rest of the system)"
    powershell -NoProfile -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    Refresh-Path
}

Step "Stopping the previous version if it is running"
Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" |
    Where-Object { $_.CommandLine -like "*beatsense.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Step "Downloading the server"
New-Item -ItemType Directory -Force "$Dir\server" | Out-Null
Invoke-WebRequest "$Raw/server/beatsense.py" -OutFile "$Dir\server\beatsense.py"
Invoke-WebRequest "$Raw/server/requirements.txt" -OutFile "$Dir\server\requirements.txt"

Step "Setting up Python and yt-dlp"
uv venv --seed --allow-existing -q -p 3.12 "$Dir\.venv"
uv pip install -q -p "$Dir\.venv" -U -r "$Dir\server\requirements.txt"

Step "Starting at Windows startup"
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
    Write-Host "BeatSense server started, beats saved in $($health.dir)" -ForegroundColor Green
} catch {
    Write-Host "The server is not responding. Run it by hand to see the error:" -ForegroundColor Red
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
    Step "Installing the extension in Firefox"
    $XpiFile = Join-Path $env:TEMP "beatsense.xpi"
    Invoke-WebRequest $Xpi -OutFile $XpiFile
    Start-Process $Firefox -ArgumentList "`"$XpiFile`""
    Write-Host "Click "Add" in Firefox. Updates will then happen automatically." -ForegroundColor Green
}

$Chrome = Find-Browser "chrome.exe"
if ($Chrome) {
    Step "Preparing the Chrome extension"
    # The server keeps this folder up to date; Chrome reloads the extension when a version is released
    $ChromeDir = "$Dir\chrome-extension"
    if (-not (Test-Path "$ChromeDir\manifest.json")) {
        $Zip = Join-Path $env:TEMP "beatsense-chrome.zip"
        Invoke-WebRequest $ChromeZip -OutFile $Zip
        Expand-Archive $Zip -DestinationPath $ChromeDir -Force
    }
    Set-Clipboard $ChromeDir
    Start-Process $Chrome -ArgumentList "chrome://extensions"
    Write-Host "In Chrome (the extensions page that just opened):" -ForegroundColor Green
    Write-Host "  1. turn on "Developer mode" at the top right"
    Write-Host "  2. click "Load unpacked" and paste this folder (already copied):"
    Write-Host "     $ChromeDir"
    Write-Host "  Only needed once: updates will then happen automatically."
}

if (-not $Firefox -and -not $Chrome) {
    Write-Host "Neither Firefox nor Chrome found: install one of them, then rerun this command."
}
