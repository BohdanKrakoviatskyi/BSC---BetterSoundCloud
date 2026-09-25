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

- `src/renderer/app` — корневой компонент и orchestration state/actions приложения (`App.tsx`, `useAppController.ts`), навигация и типы страниц.
- `src/renderer/features` — UI по возможностям: авторизация, главная, библиотека, плеер, поиск, настройки и треки.
- `src/renderer/shared` — переиспользуемые UI-компоненты, не принадлежащие отдельной feature.
- `src/renderer/domain/models.ts` — UI-доменные модели, не зависящие от RPC или SoundCloud DTO.
- `src/renderer/application/appGateway.ts` — операции приложения и граница между renderer и desktop API.
- `src/renderer/application/mappers.ts` и `backendDtos.ts` — преобразование wire DTO ↔ domain и типы backend-протокола.
- `src/renderer/platform/desktop.ts` — запуск Tauri sidecar и JSON-RPC транспорт; `useSoundCloudAuth.ts` — события и команды авторизации Tauri.
- `src/renderer/styles` — глобальные стили приложения.
- `src-tauri/src/main.rs` — запускает Tauri и подключает shell plugin.
- `src-tauri/tauri.conf.json` — окно, CSP, frontend и sidecar bundle.
- `src-tauri/capabilities/default.json` — разрешает запуск только Go sidecar без аргументов и запись в его stdin.
- `backend/cmd/local-api/main.go` — тонкая точка входа; сохраняет команду `go build ./cmd/local-api` для сборочных скриптов.
- `backend/internal/localapi` — приложение, service и обработчики. Файлы `settings.go`, `auth.go`, `tracks.go`, `playlists.go`, `search.go`, `likes.go`, `history.go`, `playback.go` сгруппированы по доменным областям; `rpc_dispatch.go` и `rpc_discovery.go` обслуживают вызов и автоматическое обнаружение методов `RPC...`.
- `backend/internal/rpc/rpc.go` — JSON-lines transport: request/response и цикл stdin/stdout.
- `backend/internal/storage/storage.go` — общие атомарная запись и удаление локальных файлов; загрузка/сохранение состояний вызывается из `localapi`.
- `backend/internal/localapi/soundcloud_http.go` и `soundcloud_stream.go` — SoundCloud HTTP/URL операции и выбор transcoding.
- `backend/internal/localapi/dev_swagger.go` и `openapi.go` — dev-only loopback HTTP-мост и генерация OpenAPI схем.
- `backend/internal/localapi/*_test.go` — тесты по областям, с общими fixtures в `test_helpers_test.go`.

Обработчики пока остаются в одном Go-пакете `internal/localapi`: автоматический RPC discovery использует reflection по методам общего `service`, а в Go receiver-методы нельзя объявлять из другого пакета. Транспорт и файловые операции вынесены в отдельные пакеты без изменения RPC-контракта.
- `scripts/build-go.mjs` — кросс-компилирует Go sidecar и именует бинарник по Tauri target triple.
- `scripts/backend-console.mjs` — интерактивная JSON-RPC консоль sidecar для ручной проверки методов без Tauri.
- `scripts/test-backend-live.mjs` — запускает живой тест SoundCloud с токеном из `.env`.

## Локальный API

Каждый запрос и ответ занимает одну JSON-строку. Запрос: `{ "id": 1, "method": "settings.get", "params": {} }`. Ответ включает тот же `id`, а также `result` или `error`.

| Метод | Назначение |
| --- | --- |
| `app.info` | Имя, версия и тип локального backend |
| `settings.get` | Чтение настроек |
| `settings.update` | Проверка и запись части настроек |
| `settings.clear` | Удаление локальной сессии, настроек и истории |
| `auth.login` | Проверка access token в SoundCloud и сохранение сессии |
| `auth.status` | Признак входа и кэшированный профиль (без токена) |
| `auth.refresh` | Перепроверка сохранённого токена; отклонённый токен удаляется |
| `auth.logout` | Локальное удаление токена |
| `tracks.mine` | Лайкнутые треки аккаунта |
| `playlists.mine` | Плейлисты аккаунта |
| `playlist.tracks` | Треки выбранного плейлиста |
| `history.list` / `history.record` / `history.clear` | Локальная история воспроизведения |
| `search.tracks` | Поиск треков SoundCloud |
| `track.details` | Детали трека по ID |
| `track.related` | Похожие треки по ID |
| `mixed.selections` | Подборки SoundCloud для главной |
| `track.like` / `track.unlike` | Изменение лайка |
| `track.stream` | Получение доступных аудиопотоков трека |

Настройки: цвет акцента, компактный режим, начальная громкость и публичный SoundCloud Client ID. Go валидирует значения, пишет JSON во временный файл и атомарно заменяет `settings.json` в системном каталоге конфигурации пользователя. Access token задаётся отдельно через `auth.login`: backend проверяет его запросом профиля и хранит в отдельном локальном файле с ограниченными правами; токен не включается в `settings.get`.

Новые функции добавляются как узкие RPC-методы Go и операции в `src/renderer/platform/desktop.ts`. Их вызовы и преобразование данных подключаются в `src/renderer/application/appGateway.ts` и `mappers.ts`. UI использует только доменные модели и gateway: React-компоненты не импортируют backend DTO, не вызывают `window.desktop`, не формируют SoundCloud URL и не знают имена RPC. Не предоставлять renderer произвольный запуск процессов или системный доступ.

### Граница UI и backend

```mermaid
flowchart LR
  C[Feature components] --> A[app/useAppController]
  A --> G[application/appGateway]
  G -->|map DTO ↔ domain models| B[platform/desktop: JSON-RPC transport]
  B -->|stdin/stdout| GO[Go sidecar]
  G -.-> D[domain/models.ts]
  C -.-> D
```

Правила переноса или полной замены интерфейса:

1. Компоненты получают данные и действия через props, используют только типы из `domain/models.ts` и не обращаются к `window.desktop`.
2. `application/appGateway.ts` — единственное место UI, которое знает операции backend; `application/mappers.ts` преобразует wire DTO в стабильные domain-модели.
3. `platform/desktop.ts` отвечает за запуск sidecar и JSON-RPC. Он не содержит UI-логику и не импортирует React.
4. Go не знает о компонентах, страницах или дизайне. Изменения интерфейса не требуют изменений Go, пока имеющегося контракта достаточно.
5. Для новых backend-данных добавляется отдельный RPC и DTO, затем mapping в gateway. Существующий контракт не меняется несовместимо без необходимости.
6. Renderer передаёт только узкие параметры, например ID трека или поисковый запрос. Токен, произвольные URL и команды остаются на стороне sidecar.

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

Реализованы desktop-окно, настройки, ручная авторизация по access token, SoundCloud-библиотека и плейлисты, поиск, лайки, история прослушивания и воспроизведение через доступные потоки/виджет. Полный OAuth-вход и системный credential store для токенов пока не подключены.
