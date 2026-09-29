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

Swagger UI и HTTP-мост для sidecar удалены. Тот же протокол `method`/`params` доступен через REPL-консоль без Tauri:

```bash
npm run backend                              # REPL поверх stdin/stdout sidecar
npm run backend -- status                    # одна команда и выход
```

Чтобы добавить метод, реализуйте `RPC<Имя>` на `service` с сигнатурой `(params Тип) (result Тип, error)` — диспетчер находит такие методы рефлексией, отдельная регистрация не нужна.

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

## Публикация обновлений

Подписанные обновления для Windows, macOS и Linux публикуются GitHub Actions при push тега версии, например `v0.1.0`. Перед первым релизом добавьте в Settings → Secrets and variables → Actions секрет `TAURI_PRIVATE_KEY` со всем содержимым локального файла `~/.tauri/bettersoundcloud-updater.key`. Ключ не добавляйте в репозиторий. Пароль не задан, поэтому `TAURI_KEY_PASSWORD` добавлять не нужно.

После push тега workflow соберёт приложение и Go sidecar для каждой ОС, создаст GitHub Release и загрузит установщики, подписи и `latest.json`. Пользователи увидят предложение установить обновление при запуске приложения. Версию тега нужно предварительно синхронизировать в `package.json`, `src-tauri/Cargo.toml` и `src-tauri/tauri.conf.json`.

`npm run release` автоматически выбирает следующий patch-тег по максимальной версии в GitHub-тегах, локальных тегах и `package.json` (например, `v0.1.14` → `v0.1.15`) и запускает публикацию. Чтобы запустить workflow для конкретного тега, передайте его явно: `npm run release -- v0.1.15`.

Приложение включает обзор, поиск, медиатеку с лайками и плейлистами, воспроизведение треков, настройки и подключение аккаунта SoundCloud по access token.
