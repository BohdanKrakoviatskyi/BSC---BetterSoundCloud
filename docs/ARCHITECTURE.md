# Архитектура BetterSoundCloud

## Текущая реализация

Приложение использует Tauri 2 как desktop-оболочку, React + TypeScript для интерфейса и Go sidecar для локального API и настроек. Сетевой сервер и база данных не нужны.

```mermaid
flowchart LR
  UI[React + TypeScript] -->|Tauri Shell plugin| G[Локальный Go sidecar]
  G -->|settings.json| D[Папка конфигурации пользователя]
  T[Rust / Tauri runtime] --> UI
```

Tauri webview не получает Node.js доступ. Frontend запускает только заранее сконфигурированный sidecar `binaries/local-api`; capability запрещает произвольные аргументы. Команды Go передаются JSON-строками через stdin, ответы возвращаются JSON-строками через stdout. stderr используется только для локальной диагностики.

## Компоненты

- `src/renderer` — интерфейс React, стили и точка входа Vite.
- `src/renderer/lib/desktop.ts` — запускает sidecar, связывает ID запросов с ответами и ограничивает доступ UI методами приложения.
- `src-tauri/src/main.rs` — запускает Tauri и подключает shell plugin.
- `src-tauri/tauri.conf.json` — окно, CSP, frontend и sidecar bundle.
- `src-tauri/capabilities/default.json` — разрешает запуск только Go sidecar без аргументов и запись в его stdin.
- `backend/cmd/local-api` — локальные команды приложения, сохранение настроек и авторизация SoundCloud.
- `backend/cmd/local-api/main_test.go` — тесты авторизации на подставном SoundCloud-сервере.
- `scripts/build-go.mjs` — кросс-компилирует Go sidecar и именует бинарник по Tauri target triple.
- `scripts/backend-console.mjs` — интерактивная JSON-RPC консоль sidecar для ручной проверки методов без Tauri.
- `backend/cmd/local-api/main.go` — при `BSC_SWAGGER=1` дополнительно поднимает Swagger UI и loopback HTTP bridge для ручной отладки JSON-RPC.
- `scripts/test-backend-live.mjs` — запускает живой тест SoundCloud с токеном из `.env`.

## Локальный API

Каждый запрос и ответ занимает одну JSON-строку. Запрос: `{ "id": 1, "method": "settings.get", "params": {} }`. Ответ включает тот же `id`, а также `result` или `error`.

| Метод | Назначение |
| --- | --- |
| `app.info` | Имя, версия и тип локального backend |
| `settings.get` | Чтение настроек |
| `settings.update` | Проверка и запись части настроек |
| `auth.login` | Проверка access token в SoundCloud и сохранение сессии |
| `auth.status` | Признак входа и кэшированный профиль (без токена) |
| `auth.refresh` | Перепроверка сохранённого токена; отклонённый токен удаляется |
| `auth.logout` | Локальное удаление токена |

Настройки: цвет акцента, компактный режим и начальная громкость. Go валидирует цвет и диапазон громкости, пишет JSON во временный файл и атомарно заменяет `settings.json` в системном каталоге конфигурации пользователя.

Новые функции следует добавлять как узкие методы этого API и явные функции в `desktop.ts`; не предоставлять renderer произвольный запуск процессов или системный доступ.

В режиме разработки `BSC_SWAGGER=1 npm run dev` sidecar дополнительно слушает только `127.0.0.1` на случайном порту, печатает URL Swagger UI в stderr и публикует `/openapi.json` и `POST /rpc`. Генератор автоматически находит экспортированные методы `RPC...` на `service`; имена методов, типы параметров и результатов берутся из сигнатур Go, а поля моделей — из Go-типов и JSON-тегов. Добавление метода не требует отдельной записи в реестре. Этот HTTP bridge выключен по умолчанию; desktop-приложение продолжает использовать stdin/stdout. Swagger UI раздаётся через unpkg CDN.

## Авторизация (текущая реализация)

Полный OAuth-поток из [SOUNDCLOUD_INTEGRATION.md](SOUNDCLOUD_INTEGRATION.md) пока не подключён. Сейчас работает ручное подключение аккаунта по access token, что позволяет проверять интеграцию с SoundCloud API до регистрации OAuth-приложения.

1. Renderer показывает экран входа и передаёт вставленный токен в `auth.login` (таймаут запроса — 30 секунд).
2. Go sidecar проверяет токен запросом `GET /me`: сначала `https://api-v2.soundcloud.com` (токены веб-сессии), затем `https://api.soundcloud.com` (OAuth-токены зарегистрированных приложений). Хост можно переопределить через `BSC_SOUNDCLOUD_API_BASE`.
3. При успехе Go сохраняет `{ token, profile, savedAt }` в `auth.json` в системном каталоге конфигурации приложения с правами `0600` и атомарной записью. Renderer получает только признак входа и профиль (`username`, `avatarUrl`, счётчики) — сам токен никогда не покидает sidecar и не попадает в `localStorage`.
4. При старте приложения renderer вызывает `auth.refresh`: если SoundCloud отклонил токен, сессия очищается и показывается экран входа; при сетевой ошибке кэшированный профиль сохраняется.
5. Выход (`auth.logout`) удаляет токен только локально и не отзывает доступ в аккаунте SoundCloud.

Хранилище токена в файле — промежуточное решение. Целевая схема из SOUNDCLOUD_INTEGRATION.md переносит токены в системный credential store и добавляет OAuth 2.1 + PKCE через сервер авторизации.

## Запуск и сборка

Нужны Node.js, Rust/Cargo, Go 1.22+ и системные зависимости Tauri 2.

```bash
npm install
npm run dev
```

Tauri запускает `prepare:dev`: сборку Go sidecar и Vite dev server. Production:

```bash
npm run build
npm run package
```

Go sidecar кладётся в `src-tauri/binaries/local-api-<TARGET_TRIPLE>` и добавляется в bundle как external binary. Текущий скрипт автоматически определяет распространённые desktop-архитектуры; для новых или кросс-целей нужно добавить соответствие Go OS/ARCH и Tauri triple в `scripts/build-go.mjs`.

## Текущие границы

Реализованы desktop-окно, локальный backend, настройки и ручная авторизация по access token. Полный OAuth-вход, методы SoundCloud API (медиатека, поиск, лайки), воспроизведение и системный credential store для токенов не входят в текущую реализацию.
