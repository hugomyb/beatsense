"""Serveur local BeatSense : télécharge l'audio d'une vidéo YouTube et en extrait BPM + tonalité.

Écoute uniquement sur 127.0.0.1 et n'accepte que les requêtes venant de l'extension
(origine moz-extension://), pour qu'une page web quelconque ne puisse pas le piloter.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import essentia
import essentia.standard as es
import yt_dlp

essentia.log.infoActive = False

HOST = "127.0.0.1"
PORT = int(os.environ.get("BEATSENSE_PORT", "7843"))
OUT_DIR = Path(os.environ.get("BEATSENSE_DIR", Path.home() / "Musique" / "Prods")).expanduser()
CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "beatsense"
MAX_DURATION = 20 * 60  # secondes : on refuse les mix / lives de plusieurs heures

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Roue Camelot (notation utilisée par Tunebat et les DJ)
CAMELOT = {
    ("Ab", "minor"): "1A", ("B", "major"): "1B",
    ("Eb", "minor"): "2A", ("F#", "major"): "2B",
    ("Bb", "minor"): "3A", ("C#", "major"): "3B",
    ("F", "minor"): "4A", ("Ab", "major"): "4B",
    ("C", "minor"): "5A", ("Eb", "major"): "5B",
    ("G", "minor"): "6A", ("Bb", "major"): "6B",
    ("D", "minor"): "7A", ("F", "major"): "7B",
    ("A", "minor"): "8A", ("C", "major"): "8B",
    ("E", "minor"): "9A", ("G", "major"): "9B",
    ("B", "minor"): "10A", ("D", "major"): "10B",
    ("F#", "minor"): "11A", ("A", "major"): "11B",
    ("C#", "minor"): "12A", ("E", "major"): "12B",
}
# Essentia peut sortir des dièses là où la roue utilise des bémols
ENHARMONIC = {"G#": "Ab", "D#": "Eb", "A#": "Bb", "Db": "C#", "Gb": "F#"}

# Un verrou par vidéo : deux clics rapides ne lancent pas deux téléchargements
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(video_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(video_id, threading.Lock())


def _ydl_opts(**extra) -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": "bestaudio/best",
        **extra,
    }


def fetch_audio(video_id: str) -> tuple[Path, dict]:
    """Télécharge l'audio en mp3 320k dans le cache (une seule fois par vidéo)."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    mp3 = CACHE_DIR / f"{video_id}.mp3"
    meta_file = CACHE_DIR / f"{video_id}.json"
    if mp3.exists() and meta_file.exists():
        return mp3, json.loads(meta_file.read_text())

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

    meta = {"title": info.get("title") or video_id, "channel": info.get("channel") or "", "duration": info.get("duration")}
    meta_file.write_text(json.dumps(meta, ensure_ascii=False))
    return mp3, meta


def analyze(path: Path) -> dict:
    audio = es.MonoLoader(filename=str(path), sampleRate=44100)()
    bpm, *_ = es.RhythmExtractor2013(method="multifeature")(audio)
    key, scale, strength = es.KeyExtractor(profileType="bgate")(audio)
    key = ENHARMONIC.get(key, key)
    bpm_rounded = round(bpm)
    # Ambiguïté classique demi/double tempo (trap à 140 détectée à 70, etc.)
    alt = bpm_rounded * 2 if bpm_rounded < 90 else round(bpm_rounded / 2) if bpm_rounded > 160 else None
    return {
        "bpm": bpm_rounded,
        "bpm_exact": round(bpm, 2),
        "bpm_alt": alt,
        "key": key,
        "scale": scale,
        "key_label": f"{key} {'Major' if scale == 'major' else 'Minor'}",
        "camelot": CAMELOT.get((key, scale), ""),
        "confidence": round(strength, 2),
    }


def analysis_for(video_id: str) -> dict:
    with _lock_for(video_id):
        mp3, meta = fetch_audio(video_id)
        result_file = CACHE_DIR / f"{video_id}.analysis.json"
        if result_file.exists():
            result = json.loads(result_file.read_text())
        else:
            result = analyze(mp3)
            result_file.write_text(json.dumps(result))
    return {**meta, **result, "video_id": video_id}


def safe_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:150] or "prod"


def save_to_library(video_id: str) -> dict:
    data = analysis_for(video_id)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # BPM et tonalité dans le nom : visibles directement dans le navigateur de FL Studio
    name = safe_filename(f"{data['title']} [{data['bpm']} BPM {data['key_label']}]") + ".mp3"
    dest = OUT_DIR / name
    if not dest.exists():
        shutil.copyfile(CACHE_DIR / f"{video_id}.mp3", dest)
    return {**data, "file": str(dest)}


def open_folder(path: Path):
    if sys.platform == "win32":
        os.startfile(path)  # noqa: S606
    else:
        cmd = "open" if sys.platform == "darwin" else "xdg-open"
        subprocess.Popen([cmd, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class Handler(BaseHTTPRequestHandler):
    server_version = "BeatSense/1.0"

    def _origin_ok(self) -> bool:
        # Un navigateur envoie toujours Origin sur un POST cross-origin : une origine absente
        # vient d'un process local (curl...), une origine http(s) d'une page web.
        origin = self.headers.get("Origin")
        return origin is None or origin.startswith("moz-extension://")

    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        origin = self.headers.get("Origin", "")
        if origin.startswith("moz-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self._origin_ok():
            return self._send(403, {"error": "origine refusée"})
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "dir": str(OUT_DIR)})
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
        if self.path in ("/analyze", "/download") and not VIDEO_ID.match(video_id):
            return self._send(400, {"error": "video_id invalide"})

        try:
            if self.path == "/analyze":
                return self._send(200, analysis_for(video_id))
            if self.path == "/download":
                return self._send(200, save_to_library(video_id))
            if self.path == "/open-folder":
                OUT_DIR.mkdir(parents=True, exist_ok=True)
                open_folder(OUT_DIR)
                return self._send(200, {"ok": True})
        except ValueError as e:
            return self._send(422, {"error": str(e)})
        except yt_dlp.utils.DownloadError as e:
            return self._send(502, {"error": re.sub(r"^ERROR: ", "", str(e))[:300]})
        except Exception as e:  # noqa: BLE001 - on renvoie l'erreur à l'extension plutôt que de couper la connexion
            print(f"[beatsense] {video_id}: {e!r}", file=sys.stderr)
            return self._send(500, {"error": str(e)[:300]})
        self._send(404, {"error": "introuvable"})

    def log_message(self, fmt, *args):
        print(f"[beatsense] {fmt % args}", file=sys.stderr)


if __name__ == "__main__":
    print(f"[beatsense] écoute sur http://{HOST}:{PORT}, prods dans {OUT_DIR}", file=sys.stderr)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
