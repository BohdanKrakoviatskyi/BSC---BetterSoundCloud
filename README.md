# BetterSoundCloud

Локальное desktop-приложение на **Tauri 2 + React + TypeScript** с небольшим локальным Go sidecar для настроек и авторизации SoundCloud. Полный OAuth-вход пока не подключён: аккаунт подключается вставкой access token.

Архитектура и протокол локального backend описаны в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Структура интерфейса

React-интерфейс находится в `src/renderer`: точка входа — `src/renderer/main.tsx`, страницы и компоненты — в `src/renderer/ui`. Desktop-оболочка Tauri находится в `src-tauri`, исходники локального Go backend — в `backend/cmd/local-api`.

## Требования

- Node.js и npm
- Rust toolchain, включая Cargo
- Go 1.22+
- Системные зависимости Tauri для вашей ОС: [официальное руководство Tauri](https://v2.tauri.app/start/prerequisites/)

## Запуск

```bash
npm install
npm run dev
```

`npm run dev` запускает отдельную dev-версию (`BetterSoundCloud Dev`) с собственным идентификатором и каталогом данных. Она может работать одновременно с установленной production-версией; настройки, авторизация и cookies SoundCloud между ними не общие.

Tauri CLI собирает Go sidecar, запускает Vite и открывает desktop-окно. При первом запуске приложение попросит access token SoundCloud: скопируйте его из заголовка `Authorization: OAuth …` любого запроса к SoundCloud и вставьте в поле входа. Go sidecar проверит токен через `GET /me`, сохранит его локально с правами `0600` и покажет профиль. Настройки цветовой темы, компактного режима и громкости сохраняются локально.

Путь к хранилищу на время разработки можно переопределить через `BSC_DATA_DIR`, хост SoundCloud — через `BSC_SOUNDCLOUD_API_BASE`.

## Тестирование backend отдельно от UI

Go sidecar общается с frontend построчным JSON-RPC через stdin/stdout, поэтому его можно гонять без Tauri.

Юнит-тесты на подставном SoundCloud-сервере (без сети):

```bash
npm run test:go                              # или: cd backend && go test ./...
```

Swagger UI для локального Go JSON-RPC sidecar доступен в режиме разработки:

```bash
BSC_SWAGGER=1 npm run dev
```

Откройте адрес `Swagger UI:` из stderr backend в браузере. Сервер слушает только loopback на случайном порту и запускается только при `BSC_SWAGGER=1`; его HTTP-маршрут `/rpc` описывает тот же протокол `method`/`params`, который desktop использует через stdin/stdout. OpenAPI JSON автоматически находит экспортированные методы `RPC...` у Go service и строит схемы запросов и результатов из их сигнатур, структур и JSON-тегов. Чтобы добавить метод, реализуйте `RPC<Имя>` на `service` с сигнатурой `(params Тип) (result Тип, error)` — отдельная регистрация не нужна. Swagger UI загружается с unpkg CDN.

Живой тест против настоящего SoundCloud (читает `TOKEN=...` из `.env`, проверяет `GET /me` и восстановление сессии из `auth.json`):

```bash
npm run test:go:live
```

Интерактивная консоль backend — удобно вручную дёргать методы и смотреть ответы:

```bash
npm run backend
```

Доступные команды: `status`, `login <access token>`, `refresh`, `logout`, `info`, `settings`, `help`, а также произвольный JSON, например `{"method":"settings.update","params":{"volume":40}}`. Одиночный запрос без REPL: `npm run backend -- status`. Данные пишутся в `build/backend/data` и не пересекаются с desktop-приложением (у него свой каталог в системной конфигурации).

То же самое сырым способом, без обёрток:

```bash
cd backend
go build -o /tmp/local-api ./cmd/local-api
printf '%s\n' '{"id":1,"method":"app.info","params":{}}' | BSC_DATA_DIR=/tmp/bsc /tmp/local-api
```

## Сборка

```bash
npm run build
npm run package
```

`build` проверяет и собирает React frontend. `package` собирает Go sidecar для текущей платформы и создаёт Tauri bundle. Для production-пакетов используйте отдельную команду на машине с соответствующей ОС:

```bash
npm run package:mac # macOS: .app и .dmg
npm run package:win # Windows: .exe (NSIS) и .msi
```

Tauri собирает нативный пакет для ОС, на которой запущена команда: macOS-пакет нужно собирать на macOS, Windows-пакет — на Windows. Установщики и приложение находятся в `src-tauri/target/release/bundle/`. Для сборки под другую архитектуру нужны соответствующие Go target и Tauri target triple.

Приложение включает обзор, поиск, медиатеку с лайками и плейлистами, воспроизведение треков, настройки и подключение аккаунта SoundCloud по access token.
