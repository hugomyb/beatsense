"""BeatSense local server: fetches the audio of YouTube videos for the extension.

The BPM / key analysis happens in the extension (essentia.js); this server only does
what an extension cannot: run yt-dlp and write to the beats folder.

Listens on 127.0.0.1 only and rejects requests coming from a web page
(http(s):// origin), so that no random website can drive it.

Updates itself: yt-dlp once a day, and this file from GitHub
(except when running from a git clone, to avoid overwriting work in progress).
Also keeps the Chrome extension folder up to date (loaded "unpacked", Chrome does not
update it by itself): the extension sees the new version via /health and reloads.
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

# yt-dlp looks for deno (YouTube signatures) in the PATH: the venv one sits next to python
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
MAX_DURATION = 20 * 60  # seconds: we refuse multi-hour mixes / livestreams

EXTENSION_ORIGINS = ("moz-extension://", "chrome-extension://")
# Web pages allowed to drive the server, e.g. a self-hosted beat library:
# BEATSENSE_ALLOWED_ORIGINS="https://digr.test:8443,https://digr.example.com"
WEB_ORIGINS = tuple(o.strip().rstrip("/") for o in os.environ.get("BEATSENSE_ALLOWED_ORIGINS", "").split(",") if o.strip())
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

# One lock per video: two quick clicks do not start two downloads
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(video_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(video_id, threading.Lock())


def _ydl_opts(**extra) -> dict:
    return {"quiet": True, "no_warnings": True, "noplaylist": True, "format": "bestaudio/best", **extra}


def fetch_audio(video_id: str) -> dict:
    """Download the audio as 320k mp3 into the cache (once per video) and return its info."""
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
            raise ValueError(f"Video too long ({info['duration'] // 60} min), max {MAX_DURATION // 60} min")

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


def _flat(e: dict, complete: bool = False) -> dict | None:
    vid = e.get("id")
    if not vid or not VIDEO_ID.match(str(vid)) or e.get("live_status") in ("is_live", "is_upcoming"):
        return None
    item = {
        "id": vid,
        "title": e.get("title") or "",
        "description": e.get("description") or "",
        "duration": int(e["duration"]) if e.get("duration") else None,
        "view_count": e.get("view_count"),
        "timestamp": e.get("timestamp") or e.get("release_timestamp"),
        "channel_id": e.get("channel_id"),
        "channel": e.get("channel") or e.get("uploader"),
        "channel_handle": e.get("uploader_id"),
    }
    if complete:
        item.update({
            "tags": e.get("tags") or [],
            "like_count": e.get("like_count"),
            "upload_date": e.get("upload_date"),
            "live_status": e.get("live_status"),
        })
    return item


def search_videos(query: str, limit: int, recent: bool) -> list:
    """YouTube search without downloading anything (used by self-hosted beat libraries)."""
    limit = max(1, min(limit, 60))
    if recent:
        from urllib.parse import quote_plus
        url = f"https://www.youtube.com/results?search_query={quote_plus(query)}&sp=CAI%253D"
        opts = _ydl_opts(extract_flat="in_playlist", playlistend=limit, noplaylist=False)
    else:
        url = f"ytsearch{limit}:{query}"
        opts = _ydl_opts(extract_flat="in_playlist", noplaylist=False)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return [x for x in (_flat(e) for e in info.get("entries") or []) if x]


def channel_videos(ref: str, limit: int) -> dict:
    """A channel's info and latest uploads, without downloading anything."""
    ref = ref.strip()
    if ref.startswith("http"):
        url = re.sub(r"/(videos|shorts|streams|featured|playlists|about)/?$", "", ref.split("?")[0].rstrip("/")) + "/videos"
    elif re.fullmatch(r"UC[\w-]{22}", ref):
        url = f"https://www.youtube.com/channel/{ref}/videos"
    else:
        url = f"https://www.youtube.com/{ref if ref.startswith('@') else '@' + ref}/videos"
    opts = _ydl_opts(extract_flat="in_playlist", playlistend=max(1, min(limit, 300)), noplaylist=False)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    channel_id = info.get("channel_id") or info.get("id")
    name = info.get("channel") or re.sub(r" - Videos$", "", info.get("title") or "")
    entries = []
    for e in info.get("entries") or []:
        item = _flat(e)
        if item:
            item["channel_id"] = item["channel_id"] or channel_id
            item["channel"] = item["channel"] or name
            entries.append(item)
    return {
        "channel": {
            "id": channel_id,
            "name": name,
            "handle": info.get("uploader_id"),
            "description": info.get("description") or "",
            "subscribers": info.get("channel_follower_count"),
        },
        "entries": entries,
    }


def video_details(ids: list) -> list:
    """Full metadata (description, tags, date) of a few videos, without downloading them."""
    out = []
    with yt_dlp.YoutubeDL(_ydl_opts(skip_download=True)) as ydl:
        for vid in ids[:20]:
            if not VIDEO_ID.match(str(vid)):
                continue
            try:
                e = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
            except yt_dlp.utils.DownloadError:
                continue
            item = _flat(e, complete=True)
            if item:
                out.append(item)
    return out


def safe_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:150] or "prod"


def save_to_library(video_id: str, bpm, key_label: str) -> dict:
    meta = fetch_audio(video_id)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # BPM and key in the name: visible right in FL Studio's browser
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


# --- Automatic updates -------------------------------------------------------

def update_ytdlp() -> bool:
    """Update yt-dlp (YouTube breaks it regularly). Return True if something changed."""
    stamp = CACHE_DIR / ".ytdlp-updated"
    if stamp.exists() and time.time() - stamp.stat().st_mtime < 24 * 3600:
        return False
    res = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "-U", "yt-dlp[default]", "deno"],
        capture_output=True, text=True, timeout=600,
        creationflags=subprocess.CREATE_NO_WINDOW if WINDOWS else 0,
    )
    if res.returncode != 0:
        log(f"yt-dlp update failed: {res.stderr.strip()[-300:]}")
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
    compile(remote, str(me), "exec")  # never replace with a broken file
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
    """Replace the Chrome extension folder with the one from the latest release, if newer."""
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
        # Write into the existing folder rather than replacing it: this is the path Chrome loaded
        z.extractall(CHROME_DIR)
    for f in CHROME_DIR.rglob("*"):
        if f.is_file() and f.relative_to(CHROME_DIR) not in new_files:
            f.unlink()
    tmp.unlink()
    log(f"Chrome extension updated: {current} -> {latest}")


def restart(httpd: ThreadingHTTPServer):
    log("update installed, restarting")
    httpd.shutdown()
    httpd.server_close()
    if not WINDOWS:
        os._exit(75)  # systemd (Restart=always) restarts the service
    # On Windows nothing restarts us: we start the new version ourselves
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
            except Exception as e:  # noqa: BLE001 - must not block the other updates
                log(f"Chrome extension update failed: {e!r}")
            changed = update_self() | update_ytdlp()
        except Exception as e:  # noqa: BLE001 - no network, GitHub down... we will retry later
            log(f"update check failed: {e!r}")
        if changed:
            restart(httpd)
        time.sleep(CHECK_EVERY)


# --- HTTP ---------------------------------------------------------------------------

def log(msg: str):
    if sys.stderr:  # None under pythonw.exe (Windows, no console)
        print(f"[beatsense] {msg}", file=sys.stderr, flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "BeatSense/2"

    def _origin_ok(self) -> bool:
        # A browser always sends Origin on a cross-origin POST: a missing origin
        # comes from a local process (curl...), an http(s) origin from a web page.
        origin = self.headers.get("Origin")
        return origin is None or origin.startswith(EXTENSION_ORIGINS) or origin in WEB_ORIGINS

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin.startswith(EXTENSION_ORIGINS) or origin in WEB_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

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
            return self._send(403, {"error": "origin rejected"})
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Chrome "Private Network Access": an https page calling 127.0.0.1 needs this opt-in
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {
                "ok": True,
                "dir": str(OUT_DIR),
                "chrome_dir": str(CHROME_DIR),
                "chrome_version": chrome_version(),
                "features": ["download", "audio", "search", "details", "channel"],
            })
        m = re.fullmatch(r"/audio/([A-Za-z0-9_-]{11})", self.path)
        if m and self._origin_ok():
            mp3 = CACHE_DIR / f"{m[1]}.mp3"
            if not mp3.exists():
                return self._send(404, {"error": "audio not fetched yet"})
            data = mp3.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._origin_ok():
            return self._send(403, {"error": "origin rejected"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "invalid JSON"})

        video_id = str(body.get("video_id", ""))
        if self.path in ("/fetch", "/download") and not VIDEO_ID.match(video_id):
            return self._send(400, {"error": "invalid video_id"})

        try:
            if self.path == "/fetch":
                return self._send(200, fetch_audio(video_id))
            if self.path == "/download":
                return self._send(200, save_to_library(video_id, body.get("bpm"), str(body.get("key_label", ""))))
            if self.path == "/search":
                query = str(body.get("query", "")).strip()[:120]
                if len(query) < 2:
                    return self._send(400, {"error": "query too short"})
                return self._send(200, {"entries": search_videos(query, int(body.get("limit") or 40), bool(body.get("recent")))})
            if self.path == "/channel":
                ref = str(body.get("ref", "")).strip()[:200]
                if not ref:
                    return self._send(400, {"error": "missing ref"})
                return self._send(200, channel_videos(ref, int(body.get("limit") or 30)))
            if self.path == "/details":
                return self._send(200, {"entries": video_details(list(body.get("ids") or []))})
            if self.path == "/open-folder":
                OUT_DIR.mkdir(parents=True, exist_ok=True)
                open_folder(OUT_DIR)
                return self._send(200, {"ok": True})
        except ValueError as e:
            return self._send(422, {"error": str(e)})
        except yt_dlp.utils.DownloadError as e:
            return self._send(502, {"error": re.sub(r"^ERROR: ", "", str(e))[:300]})
        except Exception as e:  # noqa: BLE001 - return the error to the extension rather than dropping the connection
            log(f"{video_id}: {e!r}")
            return self._send(500, {"error": str(e)[:300]})
        self._send(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        log(fmt % args)


if __name__ == "__main__":
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        log(f"port {PORT} already in use: BeatSense is probably already running")
        sys.exit(0)
    threading.Thread(target=updater, args=(httpd,), daemon=True).start()
    log(f"listening on http://{HOST}:{PORT}, beats in {OUT_DIR}")
    httpd.serve_forever()
