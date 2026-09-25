#!/usr/bin/env python3
"""
BetterSoundCloud — MVP Backend
Просто вставь токен ниже
"""

import requests
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field


# ====================== ВСТАВЬ ТОКЕН СЮДА ======================
ACCESS_TOKEN = ""
# ==============================================================

BASE_URL = "https://api-v2.soundcloud.com"


@dataclass
class Track:
    id: int
    title: str
    artist: str
    artwork_url: Optional[str] = None
    duration: Optional[int] = None
    permalink_url: Optional[str] = None
    stream_url: Optional[str] = None
    raw: Dict = field(default_factory=dict)


class SoundCloudAPI:
    def __init__(self, token: str):
        self.token = token.strip()
        self.user_id: Optional[int] = None
        self.username: Optional[str] = None
        self.session = requests.Session()
        self.queue: List[Track] = []
        self.current_index: int = -1
        self.is_playing: bool = False

        self.session.headers.update({
            "Authorization": f"OAuth {self.token}",
            "Accept": "application/json",
            "Origin": "https://soundcloud.com",
            "Referer": "https://soundcloud.com/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })

    def _request(self, method: str, endpoint: str, params: dict = None, data: dict = None) -> Optional[Any]:
        url = f"{BASE_URL}{endpoint}"
        try:
            r = self.session.request(method, url, params=params, json=data, timeout=15)

            if r.status_code == 401:
                print("❌ 401 — токен недействителен")
                return None
            if r.status_code == 429:
                print("❌ 429 — Rate limit")
                return None
            if r.status_code >= 400:
                print(f"❌ {r.status_code} → {endpoint}")
                print(r.text[:200])
                return None

            if r.status_code == 204:
                return True

            return r.json()
        except Exception as e:
            print(f"❌ Ошибка сети: {e}")
            return None

    # ---------- Основные методы ----------
    def get_me(self) -> Optional[Dict]:
        data = self._request("GET", "/me")
        if data:
            self.user_id = data.get("id")
            self.username = data.get("username")
        return data

    def get_user_likes(self, user_id: int = None, limit: int = 20) -> Optional[Dict]:
        uid = user_id or self.user_id
        return self._request("GET", f"/users/{uid}/likes", {
            "limit": limit,
            "linked_partitioning": "1"
        })

    def get_user_playlists(self, user_id: int = None, limit: int = 20) -> Optional[Dict]:
        uid = user_id or self.user_id
        return self._request("GET", f"/users/{uid}/playlists", {
            "limit": limit,
            "linked_partitioning": "1"
        })

    def get_user_tracks(self, user_id: int = None, limit: int = 20) -> Optional[Dict]:
        uid = user_id or self.user_id
        return self._request("GET", f"/users/{uid}/tracks", {
            "limit": limit,
            "linked_partitioning": "1"
        })

    def get_track(self, track_id: int) -> Optional[Dict]:
        return self._request("GET", f"/tracks/{track_id}")

    def get_stream_url(self, track_id: int) -> Optional[str]:
        data = self._request("GET", f"/tracks/{track_id}/streams")
        if data:
            for key in ["http_mp3_128_url", "hls_mp3_128_url", "preview_mp3_128_url"]:
                if data.get(key):
                    return data[key]
        return None

    def search_tracks(self, query: str, limit: int = 20) -> Optional[Dict]:
        return self._request("GET", "/search/tracks", {
            "q": query,
            "limit": limit,
            "linked_partitioning": "1"
        })

    def like_track(self, track_id: int) -> bool:
        return bool(self._request("POST", f"/likes/tracks/{track_id}"))

    def unlike_track(self, track_id: int) -> bool:
        return bool(self._request("DELETE", f"/likes/tracks/{track_id}"))

    def follow_user(self, user_id: int) -> bool:
        return bool(self._request("PUT", f"/me/followings/{user_id}"))

    def unfollow_user(self, user_id: int) -> bool:
        return bool(self._request("DELETE", f"/me/followings/{user_id}"))

    # ---------- Плеер ----------
    def add_to_queue(self, track_data: Dict) -> Track:
        track = Track(
            id=track_data["id"],
            title=track_data.get("title", "Unknown"),
            artist=track_data.get("user", {}).get("username", "Unknown"),
            artwork_url=track_data.get("artwork_url"),
            duration=track_data.get("duration"),
            permalink_url=track_data.get("permalink_url"),
            raw=track_data
        )
        self.queue.append(track)
        return track

    def clear_queue(self):
        self.queue.clear()
        self.current_index = -1
        self.is_playing = False

    def play(self, index: int = None) -> Optional[Track]:
        if not self.queue:
            print("Очередь пуста")
            return None

        if index is not None:
            self.current_index = index
        if self.current_index < 0:
            self.current_index = 0

        track = self.queue[self.current_index]
        stream = self.get_stream_url(track.id)
        if stream:
            track.stream_url = stream
            self.is_playing = True
            print(f"▶ {track.title} — {track.artist}")
            return track
        print(f"❌ Нет stream для {track.title}")
        return None

    def pause(self):
        self.is_playing = False
        print("⏸ Paused")

    def next(self) -> Optional[Track]:
        if self.current_index + 1 < len(self.queue):
            self.current_index += 1
            return self.play()
        print("Конец очереди")
        return None

    def prev(self) -> Optional[Track]:
        if self.current_index > 0:
            self.current_index -= 1
            return self.play()
        print("Начало очереди")
        return None


# ====================== ЗАПУСК ======================
if __name__ == "__main__":
    api = SoundCloudAPI(ACCESS_TOKEN)

    print("=" * 60)
    print("BetterSoundCloud MVP Backend")
    print("=" * 60)

    me = api.get_me()
    if not me:
        print("Не удалось авторизоваться. Проверь токен.")
        exit(1)

    print(f"✅ Авторизован: {me.get('username')} (ID: {me.get('id')})")

    # Лайки
    print("\n--- Лайки ---")
    likes = api.get_user_likes(limit=5)
    if likes and likes.get("collection"):
        for item in likes["collection"]:
            if item.get("track"):
                t = item["track"]
                print(f"  ♥ {t['title']}")
                api.add_to_queue(t)

    # Поиск
    print("\n--- Поиск ---")
    search = api.search_tracks("lofi", limit=3)
    if search and search.get("collection"):
        for t in search["collection"]:
            print(f"  🔍 {t.get('title')}")

    # Плеер
    if api.queue:
        print("\n--- Плеер ---")
        api.play()
        api.next()
        api.pause()

    print("\n✅ Готово")