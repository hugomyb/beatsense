"""Serveur local BeatSense : récupère l'audio des vidéos YouTube pour l'extension.

L'analyse BPM / tonalité se fait dans l'extension (essentia.js) ; ce serveur ne fait que
ce qu'une extension ne peut pas faire : lancer yt-dlp et écrire dans le dossier des prods.

Écoute uniquement sur 127.0.0.1 et refuse les requêtes venant d'une page web
(origine http(s)://), pour qu'un site quelconque ne puisse pas le piloter.

Se met à jour tout seul : yt-dlp une fois par jour, et ce fichier depuis GitHub
(sauf quand il tourne depuis un clone git, pour ne pas écraser le travail en cours).
Tient aussi à jour le dossier de l'extension Chrome (chargée "non empaquetée", Chrome ne
la met pas à jour lui-même) : l'extension voit la nouvelle version via /health et se recharge.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# yt-dlp cherche deno (signatures YouTube) dans le PATH : celui du venv est à côté de python
os.environ["PATH"] = str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", "")

import yt_dlp  # noqa: E402

HOST = "127.0.0.1"
PORT = int(os.environ.get("BEATSENSE_PORT", "7843"))
WINDOWS = sys.platform == "win32"
HERE = Path(__file__).resolve().parent
SOURCE_URL = "https://raw.githubusercontent.com/hugomyb/beatsense/main/server/beatsense.py"
LATEST_RELEASE_URL = "https://api.github.com/repos/hugomyb/beatsense/releases/latest"
CHROME_ASSET = "beatsense-chrome.zip"
CHECK_EVERY = 6 * 3600
CACHE_TTL = 7 * 24 * 3600
MAX_DURATION = 20 * 60  # secondes : on refuse les mix / lives de plusieurs heures

EXTENSION_ORIGINS = ("moz-extension://", "chrome-extension://")
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def music_dir() -> Path:
    if sys.platform.startswith("linux"):
        try:
            out = subprocess.run(["xdg-user-dir", "MUSIC"], capture_output=True, text=True, timeout=5).stdout.strip()
            if out and out != str(Path.home()):
                return Path(out)
        except (OSError, subprocess.SubprocessError):
            pass
    return Path.home() / "Music"


def cache_dir() -> Path:
    if WINDOWS:
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "BeatSense" / "cache"
    return Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "beatsense"


def data_dir() -> Path:
    if WINDOWS:
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "BeatSense"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "beatsense"


OUT_DIR = Path(os.environ.get("BEATSENSE_DIR") or music_dir() / "Prods").expanduser()
CACHE_DIR = cache_dir()
CHROME_DIR = data_dir() / "chrome-extension"

# Un verrou par vidéo : deux clics rapides ne lancent pas deux téléchargements
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(video_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(video_id, threading.Lock())


def _ydl_opts(**extra) -> dict:
    return {"quiet": True, "no_warnings": True, "noplaylist": True, "format": "bestaudio/best", **extra}


def fetch_audio(video_id: str) -> dict:
    """Télécharge l'audio en mp3 320k dans le cache (une seule fois par vidéo) et renvoie ses infos."""
    with _lock_for(video_id):
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        mp3 = CACHE_DIR / f"{video_id}.mp3"
        meta_file = CACHE_DIR / f"{video_id}.json"
        if mp3.exists() and meta_file.exists():
            return json.loads(meta_file.read_text(encoding="utf-8"))

        url = f"https://www.youtube.com/watch?v={video_id}"
        with yt_dlp.YoutubeDL(_ydl_opts()) as ydl:
            info = ydl.extract_info(url, download=False)
        if (info.get("duration") or 0) > MAX_DURATION:
            raise ValueError(f"Vidéo trop longue ({info['duration'] // 60} min), max {MAX_DURATION // 60} min")

        opts = _ydl_opts(
            outtmpl=str(CACHE_DIR / f"{video_id}.%(ext)s"),
            postprocessors=[{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320"}],
        )
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        meta = {
            "video_id": video_id,
            "title": info.get("title") or video_id,
            "channel": info.get("channel") or "",
            "duration": info.get("duration"),
        }
        meta_file.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        return meta


def safe_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:150] or "prod"


def save_to_library(video_id: str, bpm, key_label: str) -> dict:
    meta = fetch_audio(video_id)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # BPM et tonalité dans le nom : visibles directement dans le navigateur de FL Studio
    tag = f" [{int(bpm)} BPM {safe_filename(key_label)}]" if bpm else ""
    dest = OUT_DIR / (safe_filename(meta["title"] + tag) + ".mp3")
    if not dest.exists():
        shutil.copyfile(CACHE_DIR / f"{video_id}.mp3", dest)
    return {**meta, "file": str(dest)}


def open_folder(path: Path):
    if WINDOWS:
        os.startfile(path)  # noqa: S606
    else:
        cmd = "open" if sys.platform == "darwin" else "xdg-open"
        subprocess.Popen([cmd, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def clean_cache():
    if not CACHE_DIR.exists():
        return
    limit = time.time() - CACHE_TTL
    for f in CACHE_DIR.iterdir():
        if f.is_file() and f.stat().st_mtime < limit:
            f.unlink(missing_ok=True)


# --- Mises à jour automatiques -------------------------------------------------------

def update_ytdlp() -> bool:
    """Met yt-dlp à jour (YouTube le casse régulièrement). Renvoie True si quelque chose a changé."""
    stamp = CACHE_DIR / ".ytdlp-updated"
    if stamp.exists() and time.time() - stamp.stat().st_mtime < 24 * 3600:
        return False
    res = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "-U", "yt-dlp[default]", "deno"],
        capture_output=True, text=True, timeout=600,
        creationflags=subprocess.CREATE_NO_WINDOW if WINDOWS else 0,
    )
    if res.returncode != 0:
        log(f"mise à jour yt-dlp échouée : {res.stderr.strip()[-300:]}")
        return False
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    stamp.touch()
    return "Successfully installed" in res.stdout


def update_self() -> bool:
    if (HERE.parent / ".git").exists():
        return False
    with urllib.request.urlopen(SOURCE_URL, timeout=30) as r:
        remote = r.read()
    me = Path(__file__).resolve()
    if hashlib.sha256(remote).digest() == hashlib.sha256(me.read_bytes()).digest():
        return False
    compile(remote, str(me), "exec")  # on ne remplace pas par un fichier cassé
    tmp = me.with_suffix(".new")
    tmp.write_bytes(remote)
    tmp.replace(me)
    return True


def chrome_version() -> str | None:
    try:
        return json.loads((CHROME_DIR / "manifest.json").read_text(encoding="utf-8"))["version"]
    except (OSError, ValueError, KeyError):
        return None


def _version_tuple(v: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", v))


def update_chrome_extension():
    """Remplace le dossier de l'extension Chrome par celui de la dernière release, si plus récente."""
    req = urllib.request.Request(LATEST_RELEASE_URL, headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        release = json.load(r)
    latest = release["tag_name"].lstrip("v")
    current = chrome_version()
    if current and _version_tuple(latest) <= _version_tuple(current):
        return
    asset = next((a for a in release["assets"] if a["name"] == CHROME_ASSET), None)
    if not asset:
        return
    tmp = CHROME_DIR.with_name("chrome-extension.zip")
    tmp.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(asset["browser_download_url"], timeout=120) as r:
        tmp.write_bytes(r.read())
    with zipfile.ZipFile(tmp) as z:
        new_files = {Path(n) for n in z.namelist() if not n.endswith("/")}
        # On écrit dans le dossier existant plutôt que de le remplacer : c'est ce chemin que Chrome a chargé
        z.extractall(CHROME_DIR)
    for f in CHROME_DIR.rglob("*"):
        if f.is_file() and f.relative_to(CHROME_DIR) not in new_files:
            f.unlink()
    tmp.unlink()
    log(f"extension Chrome mise à jour : {current} -> {latest}")


def restart(httpd: ThreadingHTTPServer):
    log("mise à jour installée, redémarrage")
    httpd.shutdown()
    httpd.server_close()
    if not WINDOWS:
        os._exit(75)  # systemd (Restart=always) relance le service
    # Sous Windows rien ne nous relance : on démarre la nouvelle version nous-mêmes
    subprocess.Popen([sys.executable, "-I", str(Path(__file__).resolve())], creationflags=subprocess.DETACHED_PROCESS)
    os._exit(0)


def updater(httpd: ThreadingHTTPServer):
    time.sleep(10)
    while True:
        changed = False
        try:
            clean_cache()
            try:
                update_chrome_extension()
            except Exception as e:  # noqa: BLE001 - ne doit pas bloquer les autres mises à jour
                log(f"mise à jour de l'extension Chrome impossible : {e!r}")
            changed = update_self() | update_ytdlp()
        except Exception as e:  # noqa: BLE001 - pas de réseau, GitHub en panne... on réessaiera plus tard
            log(f"vérification des mises à jour impossible : {e!r}")
        if changed:
            restart(httpd)
        time.sleep(CHECK_EVERY)


# --- HTTP ---------------------------------------------------------------------------

def log(msg: str):
    if sys.stderr:  # None sous pythonw.exe (Windows, sans console)
        print(f"[beatsense] {msg}", file=sys.stderr, flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "BeatSense/2"

    def _origin_ok(self) -> bool:
        # Un navigateur envoie toujours Origin sur un POST cross-origin : une origine absente
        # vient d'un process local (curl...), une origine http(s) d'une page web.
        origin = self.headers.get("Origin")
        return origin is None or origin.startswith(EXTENSION_ORIGINS)

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin.startswith(EXTENSION_ORIGINS):
            self.send_header("Access-Control-Allow-Origin", origin)

    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self._origin_ok():
            return self._send(403, {"error": "origine refusée"})
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {
                "ok": True,
                "dir": str(OUT_DIR),
                "chrome_dir": str(CHROME_DIR),
                "chrome_version": chrome_version(),
            })
        m = re.fullmatch(r"/audio/([A-Za-z0-9_-]{11})", self.path)
        if m and self._origin_ok():
            mp3 = CACHE_DIR / f"{m[1]}.mp3"
            if not mp3.exists():
                return self._send(404, {"error": "audio pas encore récupéré"})
            data = mp3.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return
        self._send(404, {"error": "introuvable"})

    def do_POST(self):
        if not self._origin_ok():
            return self._send(403, {"error": "origine refusée"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "JSON invalide"})

        video_id = str(body.get("video_id", ""))
        if self.path in ("/fetch", "/download") and not VIDEO_ID.match(video_id):
            return self._send(400, {"error": "video_id invalide"})

        try:
            if self.path == "/fetch":
                return self._send(200, fetch_audio(video_id))
            if self.path == "/download":
                return self._send(200, save_to_library(video_id, body.get("bpm"), str(body.get("key_label", ""))))
            if self.path == "/open-folder":
                OUT_DIR.mkdir(parents=True, exist_ok=True)
                open_folder(OUT_DIR)
                return self._send(200, {"ok": True})
        except ValueError as e:
            return self._send(422, {"error": str(e)})
        except yt_dlp.utils.DownloadError as e:
            return self._send(502, {"error": re.sub(r"^ERROR: ", "", str(e))[:300]})
        except Exception as e:  # noqa: BLE001 - on renvoie l'erreur à l'extension plutôt que de couper la connexion
            log(f"{video_id}: {e!r}")
            return self._send(500, {"error": str(e)[:300]})
        self._send(404, {"error": "introuvable"})

    def log_message(self, fmt, *args):
        log(fmt % args)


if __name__ == "__main__":
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        log(f"port {PORT} déjà utilisé : BeatSense tourne sans doute déjà")
        sys.exit(0)
    threading.Thread(target=updater, args=(httpd,), daemon=True).start()
    log(f"écoute sur http://{HOST}:{PORT}, prods dans {OUT_DIR}")
    httpd.serve_forever()
