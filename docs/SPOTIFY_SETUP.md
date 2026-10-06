# Настройка Spotify для BSC

BSC работает с Spotify через официальный Web API. Чтобы приложение видело твою библиотеку,
нужны Client ID и Client Secret из Spotify Developer Dashboard.

Приложение запускается локально и не имеет собственного сервера, поэтому OAuth идёт через
localhost и перехват кода выполняет само приложение.

---

## 1. Создать приложение

1. Открой https://developer.spotify.com/dashboard и войди под своим аккаунтом Spotify.
2. Нажми **Create app**.
3. Заполни:
   - **App name** — например `BSC`
   - **App description** — `BetterSoundCloud на десктопе`
   - **Redirect URI** — см. следующий раздел, значение must be exact
4. Нажми **Save**.

Из Dashboard тебе понадобятся:

| Что | Где взять | Для чего |
|---|---|---|
| **Client ID** | карточка приложения, верхнее поле | идентификация приложения при OAuth |
| **Client Secret** | «View client secret» | обмен кода на токен |

Client Secret приложение показывает один раз. Если потерял — удали приложение и создай новое.

---

## 2. Redirect URI

В поле **Redirect URI** укажи ровно:

```
http://localhost:8888/callback
```

Требования к значению:

- только `http`, не `https` — для localhost Spotify разрешает оба, но backend ждёт `http`;
- порт **8888** — он зашит в приложение;
- путь `/callback` — он зашит в приложение;
- без завершающего слэша.

Если ввести другое значение, Spotify вернёт `redirect_uri_mismatch`, и вход не завершится.

---

## 3. Внести данные в BSC

1. Открой BSC → **Настройки** → раздел **«Подключённые аккаунты»** → **Spotify**.
2. Вставь **Client ID** и **Client Secret**.
3. Нажми **«Войти через Spotify»**.

Приложение откроет окно авторизации. После согласия Spotify вернёт код на
`localhost:8888/callback`, BSC перехватит его, обменяет на токены в бэкенде и закроет окно.

Токены хранятся локально и не покидают машину.

---

## Что нужно для полноценного воспроизведения

Полное воспроизведение треков Spotify требует **Spotify Premium** — только у него работает
Web Playback SDK.

| Подписка | Что доступно |
|---|---|
| Premium | полное воспроизведение, полный доступ к плейлистам и рекомендациям |
| Free | только 30-секундные превью (`preview_url`); превью есть не у всех треков |

Если Premium нет, треки без превью будут видны в библиотеке, но не воспроизведутся. Это
ограничение Spotify, а не ошибка приложения.

---

## Области разрешений

Приложение запрашивает минимальный набор:

| Область | Зачем |
|---|---|
| `user-read-private`, `user-read-email` | имя профиля |
| `user-library-read` | сохранённые треки |
| `playlist-read-private`, `playlist-read-collaborative` | плейлисты пользователя |
| `user-top-read` | подборки на главной |
| `user-read-playback-state`, `user-modify-playback-state` | воспроизведение через Web Playback SDK |

---

## Если вход не работает

| Симптом | Причина |
|---|---|
| `redirect_uri_mismatch` | Redirect URI в Dashboard не совпадает с `http://localhost:8888/callback` посимвольно |
| Окно авторизации открылось и сразу закрылось | Проверь, что порт 8888 свободен: другой процесс мог занять его |
| `invalid_client` | Неверный Client ID или Client Secret |
| Токен сразу истёкает | У Spotify access_token живёт час; приложение обновляет его через refresh_token автоматически |
| Треки не играют, превью нет | Нет Spotify Premium и у трека нет `preview_url` |

---

## Ссылки

- [Spotify for Developers](https://developer.spotify.com/documentation/web-api)
- [Dashboard](https://developer.spotify.com/dashboard)
- [Authorization Guide](https://developer.spotify.com/documentation/web-api/tutorials/code-flow)
