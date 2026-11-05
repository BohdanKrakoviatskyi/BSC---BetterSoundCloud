#!/usr/bin/env python3
"""JSON-lines adapter around ytmusicapi for the YouTube Music provider.

The worker is deliberately small: it owns the unofficial YouTube Music web
protocol, credential storage, and response normalization. Credentials travel
only over stdin/stdout or the owner-only credential file under the app data
directory; they are never passed in argv or written to logs.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

try:
    from ytmusicapi import YTMusic
except ImportError:  # Keep this module importable before the pinned deps are installed.
    YTMusic = None  # type: ignore[assignment]


class WorkerError(Exception):
    """An error that is safe to show to the user after redaction."""


ORIGIN = "https://music.youtube.com"
CREDENTIALS_FILE = "ytmusic-auth.json"
ARTWORK_FIELDS = ("thumbnails", "thumbnail")


# ---------------------------------------------------------------------------
# Header handling
# ---------------------------------------------------------------------------


def derive_authorization(cookie: str) -> str:
    """Build SAPISIDHASH from the cookie.

    ytmusicapi regenerates Authorization from ``__Secure-3PAPISID`` on every
    request, so the login window only has to provide the native session cookie.
    """
    try:
        from ytmusicapi.helpers import get_authorization, sapisid_from_cookie

        sapisid = sapisid_from_cookie(cookie)
        if sapisid:
            return get_authorization(f"{sapisid} {ORIGIN}")
    except Exception:
        pass
    # A shaped placeholder still selects ytmusicapi's browser auth mode; the
    # real header is recomputed from the cookie before any request is sent.
    return "SAPISIDHASH 0_0"


def validate_headers(headers: Any) -> dict[str, str]:
    """Normalize the six browser headers ytmusicapi needs.

    Cookie and Authorization identify the signed-in user. The remaining values
    are protocol constants captured from the account-menu request.
    """
    if not isinstance(headers, dict):
        raise WorkerError("YouTube Music sign-in data is invalid. Please reconnect.")

    normalized = {
        str(key).strip().lower(): str(value).strip()
        for key, value in headers.items()
        if key is not None and value is not None
    }
    cookie = normalized.get("cookie", "")
    if not re.search(r"(?:^|;\s*)__Secure-3PAPISID=[^;]+", cookie, re.IGNORECASE):
        raise WorkerError("YouTube Music session cookie is missing. Please reconnect.")

    authorization = normalized.get("authorization", "")
    if not re.match(r"^SAPISIDHASH\s+\S+$", authorization, re.IGNORECASE):
        authorization = derive_authorization(cookie)

    auth_user = normalized.get("x-goog-authuser", "0") or "0"
    if not re.fullmatch(r"\d+", auth_user):
        auth_user = "0"

    return {
        "Accept": normalized.get("accept") or "*/*",
        "Authorization": authorization,
        "Content-Type": normalized.get("content-type") or "application/json",
        "X-Goog-AuthUser": auth_user,
        "x-origin": ORIGIN,
        "Cookie": cookie,
    }


def redact_error(text: Any) -> str:
    """Strip cookie/token material from an error before it leaves the worker."""
    message = str(text)
    message = re.sub(
        r"(?i)(cookie|authorization)\s*[:=]\s*([^\r\n]+)",
        r"\1=[redacted]",
        message,
    )
    message = re.sub(r"(?i)(SAPISIDHASH\s+)[^\s\"']+", r"\1[redacted]", message)
    message = re.sub(
        r"(?i)(?:__Secure-[^=;:\s]+|SID|SSID|HSID|APISID|SAPISID)=[^;:\s]+",
        "[redacted]",
        message,
    )
    return message[:500]


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _first_thumbnail(value: Any) -> str | None:
    if not isinstance(value, list):
        return None
    # YouTube thumbnail lists are ordered from smallest to largest.
    for thumbnail in reversed(value):
        if isinstance(thumbnail, dict) and thumbnail.get("url"):
            return str(thumbnail["url"])
    return None


def _artwork(raw: Any) -> str | None:
    if not isinstance(raw, dict):
        return None
    for field in ARTWORK_FIELDS:
        artwork = _first_thumbnail(raw.get(field))
        if artwork:
            return artwork
    return None


def _duration_seconds(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if not text:
        return None
    if ":" in text:
        try:
            parts = [int(part) for part in text.split(":")]
        except ValueError:
            return None
        seconds = 0
        for part in parts:
            seconds = seconds * 60 + part
        return seconds
    try:
        return int(float(text))
    except ValueError:
        return None


def _artists(track: dict[str, Any]) -> list[str]:
    artists = track.get("artists") or []
    names: list[str] = []
    if isinstance(artists, list):
        for artist in artists:
            if isinstance(artist, dict):
                name = _text(artist.get("name"))
            else:
                name = _text(artist)
            if name and name not in names:
                names.append(name)
    if not names:
        fallback = _text(track.get("artist"))
        if fallback:
            names.append(fallback)
    return names


def normalize_track(track: Any) -> dict[str, Any] | None:
    if not isinstance(track, dict):
        return None
    video_id = _text(track.get("videoId") or track.get("id"))
    if not video_id:
        return None
    artists = _artists(track)
    return {
        "videoId": video_id,
        "title": _text(track.get("title")) or "Unknown title",
        "artist": ", ".join(artists),
        "artists": artists,
        "artworkUrl": _artwork(track),
        "durationSeconds": _duration_seconds(track.get("duration_seconds", track.get("duration"))),
        "available": track.get("isAvailable", True) is not False,
    }


def _track_count(raw: dict[str, Any], tracks: list[dict[str, Any]] | None = None) -> int:
    candidate = raw.get("trackCount", raw.get("count"))
    if candidate is None and tracks is not None:
        return len(tracks)
    if isinstance(candidate, (int, float)) and not isinstance(candidate, bool):
        return max(0, int(candidate))
    digits = re.sub(r"\D", "", str(candidate or ""))
    return int(digits) if digits else (len(tracks) if tracks is not None else 0)


def normalize_playlist_summary(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise WorkerError("YouTube Music returned an invalid playlist.")
    playlist_id = _text(raw.get("playlistId") or raw.get("id"))
    if not playlist_id:
        raise WorkerError("YouTube Music returned a playlist without an id.")
    return {
        "playlistId": playlist_id,
        "title": _text(raw.get("title")) or "Untitled playlist",
        "artworkUrl": _artwork(raw),
        "trackCount": _track_count(raw),
    }


def normalize_playlist(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise WorkerError("YouTube Music returned an invalid playlist.")
    tracks = [
        normalized
        for item in (raw.get("tracks") or [])
        if (normalized := normalize_track(item))
    ]
    summary = normalize_playlist_summary(raw)
    summary["trackCount"] = _track_count(raw, tracks)
    summary["tracks"] = tracks
    return summary


def normalize_profile(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {
        "name": _text(raw.get("accountName") or raw.get("name")),
        "handle": _text(raw.get("channelHandle") or raw.get("handle")),
        "picture": _text(raw.get("accountPhotoUrl") or raw.get("accountPhoto") or raw.get("picture")),
    }


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------


def default_data_dir() -> Path:
    configured = os.environ.get("BSC_DATA_DIR")
    if configured:
        return Path(configured)
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "Resonance"


def _credentials_path(data_dir: Path) -> Path:
    return data_dir / CREDENTIALS_FILE


def _read_credentials(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def save_credentials(path: Path, headers: dict[str, str], profile: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != "nt":
        path.parent.chmod(0o700)
    payload = {"headers": validate_headers(headers), "profile": profile}
    temporary = path.with_suffix(path.suffix + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8") as file:
            if os.name != "nt":
                os.chmod(temporary, 0o600)
            json.dump(payload, file, ensure_ascii=True, separators=(",", ":"))
            file.flush()
            os.fsync(file.fileno())
        temporary.replace(path)
        if os.name != "nt":
            path.chmod(0o600)
    finally:
        temporary.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# ytmusicapi operations
# ---------------------------------------------------------------------------


def _ytmusic(headers: dict[str, str]):
    if YTMusic is None:
        raise WorkerError("YouTube Music support is unavailable. Reinstall the application.")
    return YTMusic(auth=validate_headers(headers))


def _status(profile: dict[str, str] | None) -> dict[str, Any]:
    result: dict[str, Any] = {"authorized": True}
    if profile:
        result["profile"] = normalize_profile(profile)
    return result


def _load_headers(credential_path: Path) -> tuple[dict[str, str], dict[str, str]]:
    credentials = _read_credentials(credential_path)
    if not credentials:
        raise WorkerError("Connect YouTube Music before loading your library.")
    try:
        headers = validate_headers(credentials.get("headers", {}))
    except WorkerError:
        credential_path.unlink(missing_ok=True)
        raise
    profile = credentials.get("profile") if isinstance(credentials.get("profile"), dict) else {}
    return headers, profile


def sync_library(headers: dict[str, str], saved_profile: dict[str, str]) -> dict[str, Any]:
    client = _ytmusic(headers)
    try:
        raw_profile = client.get_account_info() or {}
    except Exception:
        raw_profile = saved_profile
    profile = normalize_profile(raw_profile)
    if not profile.get("name"):
        profile = normalize_profile(saved_profile)

    playlists_raw = client.get_library_playlists(limit=None) or []
    playlists = [
        normalize_playlist_summary(item)
        for item in playlists_raw
        if isinstance(item, dict) and (item.get("playlistId") or item.get("id"))
    ]

    liked_raw = client.get_liked_songs(limit=None) or {}
    liked_items = liked_raw.get("tracks", []) if isinstance(liked_raw, dict) else liked_raw
    liked = [
        normalized
        for item in liked_items
        if (normalized := normalize_track(item))
    ]

    saved_raw = client.get_library_songs(limit=None) or []
    saved = [
        normalized
        for item in saved_raw
        if (normalized := normalize_track(item))
    ]

    return {
        "profile": profile,
        "playlists": playlists,
        "likedSongs": liked,
        "savedSongs": saved,
    }


def handle(request: dict[str, Any], data_dir: Path) -> Any:
    method = request.get("method")
    params = request.get("params") or {}
    credential_path = _credentials_path(data_dir)

    if method == "auth.status":
        credentials = _read_credentials(credential_path)
        if not credentials:
            return {"authorized": False}
        try:
            validate_headers(credentials.get("headers", {}))
        except WorkerError:
            credential_path.unlink(missing_ok=True)
            return {"authorized": False}
        profile = credentials.get("profile") if isinstance(credentials.get("profile"), dict) else {}
        return _status(profile)

    if method == "auth.save":
        headers = validate_headers(params.get("headers"))
        try:
            profile_raw = _ytmusic(headers).get_account_info() or {}
        except WorkerError:
            raise
        except Exception as error:
            raise WorkerError(
                "YouTube Music rejected the captured session. Please sign in again."
            ) from error
        profile = normalize_profile(profile_raw)
        if not profile.get("name"):
            raise WorkerError("YouTube Music did not return an account. Please sign in again.")
        save_credentials(credential_path, headers, profile)
        return _status(profile)

    if method == "auth.logout":
        credential_path.unlink(missing_ok=True)
        return {"authorized": False}

    if method == "library.sync":
        headers, profile = _load_headers(credential_path)
        return sync_library(headers, profile)

    if method == "playlist.tracks":
        headers, _profile = _load_headers(credential_path)
        playlist_id = _text(params.get("playlistId"))
        if not playlist_id:
            raise WorkerError("Playlist ID is required.")
        return normalize_playlist(_ytmusic(headers).get_playlist(playlist_id, limit=None))

    raise WorkerError("Unknown YouTube Music operation.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    args = parser.parse_args()
    for line in sys.stdin:
        request: dict[str, Any] = {}
        try:
            request = json.loads(line)
            response = {"id": request.get("id"), "result": handle(request, args.data_dir)}
        except Exception as error:
            if isinstance(error, WorkerError):
                message = redact_error(error)
            else:
                message = "YouTube Music request failed. Please reconnect and try again."
            response = {
                "id": request.get("id") if isinstance(request, dict) else None,
                "error": message,
            }
        sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
