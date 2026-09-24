#!/usr/bin/env node
/**
 * Интерактивная консоль локального Go backend без Tauri.
 *
 * Запуск:
 *   npm run backend                      — REPL, запросы JSON-RPC или короткие команды
 *   npm run backend -- status            — одна команда и выход
 *   npm run backend -- login <token>     — проверить токен у SoundCloud
 *
 * Данные пишутся в build/backend/data и не пересекаются с настройками
 * desktop-приложения в системном каталоге конфигурации.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = resolve(root, 'backend');
const binDir = resolve(root, 'build', 'backend');
const dataDir = resolve(binDir, 'data');
const binary = resolve(binDir, process.platform === 'win32' ? 'local-api.exe' : 'local-api');
mkdirSync(dataDir, { recursive: true });

const build = spawnSync('go', ['build', '-o', binary, './cmd/local-api'], { cwd: backendDir, stdio: 'inherit' });
if (build.error) {
  console.error('Не найден Go. Установите Go 1.22+ и повторите.');
  process.exit(1);
}
if (build.status !== 0) process.exit(build.status ?? 1);

const child = spawn(binary, [], {
  env: { ...process.env, BSC_DATA_DIR: process.env.BSC_DATA_DIR ?? dataDir },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let nextId = 1;
let buffer = '';
const pending = new Map();

child.stdout.on('data', (chunk) => {
  buffer += String(chunk);
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.log('<не JSON от backend>', line);
      continue;
    }
    const finish = pending.get(message.id);
    if (finish) {
      pending.delete(message.id);
      finish(message);
    } else {
      console.log('<=', JSON.stringify(message));
    }
  }
});

child.on('close', ({ code }) => {
  for (const finish of pending.values()) finish({ error: `backend завершился (${code ?? 'signal'})` });
  pending.clear();
  if (!stopping) {
    console.error(`\nBackend завершился неожиданно (код ${code ?? 'signal'}).`);
    process.exit(code ?? 1);
  }
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  child.stdin.end();
  child.kill();
  process.exit(code);
}

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolvePromise) => {
    pending.set(id, resolvePromise);
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

function print(message) {
  if (message.error) {
    console.log(`\n[ОШИБКА] ${message.error}`);
  } else {
    console.log('\n[OK]');
    console.log(JSON.stringify(message.result, null, 2));
  }
}

function printHelp() {
  console.log(`
Команды:
  status                 — auth.status: есть ли сохранённая сессия
  login <access token>   — auth.login: проверить токен и сохранить сессию
  refresh                — auth.refresh: перепроверить сохранённый токен
  logout                 — auth.logout: удалить сессию
  info                   — app.info
  settings               — settings.get
  {json}                 — произвольный запрос, например {"method":"settings.update","params":{"volume":40}}
  help, exit

Хранилище: ${process.env.BSC_DATA_DIR ?? dataDir}
`);
}

async function handle(input) {
  const [command, ...rest] = input.split(/\s+/);
  switch (command) {
    case 'help':
      printHelp();
      return null;
    case 'exit':
    case 'quit':
      return null;
    case 'status':
      return request('auth.status');
    case 'refresh':
      return request('auth.refresh');
    case 'logout':
      return request('auth.logout');
    case 'info':
      return request('app.info');
    case 'settings':
      return request('settings.get');
    case 'login': {
      const token = rest.join(' ').trim();
      if (!token) {
        console.log('Использование: login <access token>');
        return null;
      }
      return request('auth.login', { token });
    }
    default:
      if (input.startsWith('{')) {
        let parsed;
        try {
          parsed = JSON.parse(input);
        } catch {
          console.log('Не удалось разобрать JSON.');
          return null;
        }
        if (typeof parsed.method !== 'string') {
          console.log('В JSON отсутствует поле "method".');
          return null;
        }
        return request(parsed.method, parsed.params ?? {});
      }
      console.log(`Неизвестная команда: ${command}. Введите help.`);
      return null;
  }
}

const cliArgs = process.argv.slice(2).filter((arg) => arg !== '--');
if (cliArgs.length > 0) {
  const message = await handle(cliArgs.join(' '));
  if (message) print(message);
  shutdown(message?.error ? 1 : 0);
} else {
  console.log('BetterSoundCloud local-api — тестовая консоль backend');
  printHelp();
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'bsc> ' });
  rl.prompt();
  let queue = Promise.resolve();
  rl.on('line', (line) => {
    queue = queue.then(async () => {
      const input = line.trim();
      if (input === 'exit' || input === 'quit') {
        rl.close();
        return;
      }
      if (input) {
        const message = await handle(input);
        if (message) print(message);
      }
      if (!rl.closed) rl.prompt();
    });
  });
  // При piped stdin 'close' наступает сразу: ждём, пока обработаются все строки,
  // иначе ответы backend будут потеряны.
  rl.on('close', () => queue.then(() => shutdown(0)));
}
