#!/usr/bin/env python3
import requests
import time
import os

ACCESS_TOKEN = os.environ.get("SOUNDCLOUD_ACCESS_TOKEN", "").strip()
CLIENT_ID    = os.environ.get("SOUNDCLOUD_CLIENT_ID", "").strip()
USER_ID      = 1323227109
TRACK_ID     = 2366824175

if not ACCESS_TOKEN or not CLIENT_ID:
    raise SystemExit("Задайте SOUNDCLOUD_ACCESS_TOKEN и SOUNDCLOUD_CLIENT_ID в окружении.")

BASE = "https://api-v2.soundcloud.com"

session = requests.Session()

# Максимально похожие на браузер заголовки
session.headers.update({
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Origin": "https://soundcloud.com",
    "Referer": "https://soundcloud.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "X-Requested-With": "XMLHttpRequest",
})

def url(path: str) -> str:
    return (
        f"{BASE}{path}"
        f"?client_id={CLIENT_ID}"
        f"&oauth_token={ACCESS_TOKEN}"
        f"&app_version=1790249475"
        f"&app_locale=en"
    )

def like(track_id: int):
    # Сначала делаем "человеческий" GET (как будто открыли страницу)
    session.get(url(f"/tracks/{track_id}"))
    time.sleep(0.8)  # небольшая пауза

    r = session.put(url(f"/users/{USER_ID}/track_likes/{track_id}"))
    print(f"LIKE → {r.status_code}")
    if r.status_code != 200:
        print(r.text[:400])
    return r.status_code in (200, 201, 204)

def unlike(track_id: int):
    r = session.delete(url(f"/users/{USER_ID}/track_likes/{track_id}"))
    print(f"UNLIKE → {r.status_code}")
    return r.status_code in (200, 201, 204)


print("Убираем лайк...")
unlike(TRACK_ID)

time.sleep(1.2)

print("Ставим лайк...")
like(TRACK_ID)
