#!/usr/bin/env node
/**
 * Запускает `tauri dev`, подставляя ключи из .env в окружение компиляции.
 *
 * Зачем это нужно. Ключи YouTube читаются в Rust через `option_env!`
 * (src-tauri/src/main.rs) — это макрос rustc, который подставляет значение на этапе сборки из
 * переменных окружения процесса. Cargo .env не читает, и vite тоже: .env там только для фронтенда.
 * Поэтому `npm run dev` без этой обёртки собирает бинарь без ключей, и вход в один клик молча
 * не работает — приложение просто предлагает ввести свои.
 *
 * Вторая причина, почему это обёртка, а не инструкция «экспортируй руками»: `option_env!`
 * запекает значение в бинарь, и любая последующая пересборка — новая вкладка терминала,
 * rust-analyzer, перезапуск tauri dev — пересобирает его уже без них, если переменных нет в
 * окружении. Читать их из одного места надёжнее.
 *
 * Пересборку при изменении .env cargo не делает: ключи не входят в ключ сборки крейта. Этот скрипт
 * трогает src/main.rs, когда набор ключей отличается от того, что зашит в последний бинарь,
 * иначе новые значения не попадут внутрь.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const markerPath = resolve(root, 'node_modules', '.bsc-youtube-env');

/** Минимальный разбор .env: KEY=VALUE, # комментарии, '' и "" вокруг значения. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const result = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    const value = line.slice(split + 1).trim().replace(/^["']|["']$/g, '');
    if (key) result[key] = value;
  }
  return result;
}

const fromFile = readEnvFile(envPath);
const keys = {
  BSC_YOUTUBE_CLIENT_ID: fromFile.BSC_YOUTUBE_CLIENT_ID ?? process.env.BSC_YOUTUBE_CLIENT_ID ?? '',
  BSC_YOUTUBE_CLIENT_SECRET: fromFile.BSC_YOUTUBE_CLIENT_SECRET ?? process.env.BSC_YOUTUBE_CLIENT_SECRET ?? '',
};

const configured = Boolean(keys.BSC_YOUTUBE_CLIENT_ID && keys.BSC_YOUTUBE_CLIENT_SECRET);

// Отпечаток набора ключей: только хеш, сами значения наружу не печатаются.
const fingerprint = createHash('sha256').update(`${keys.BSC_YOUTUBE_CLIENT_ID}\u0000${keys.BSC_YOUTUBE_CLIENT_SECRET}`).digest('hex').slice(0, 16);
const stampPath = resolve(root, 'src-tauri', 'src', 'main.rs');

// Cargo считает крейт свежим по исходникам, а option_env! в ключ сборки не входит. Меняем mtime
// main.rs, если отпечаток другой, чтобы новое значение реально попало в бинарь.
const previous = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : '';
if (configured && existsSync(stampPath) && previous !== fingerprint) {
  const now = new Date();
  utimesSync(stampPath, now, now);
  console.log(`[dev] набор ключей изменился (${previous || 'нет'} → ${fingerprint}), пересобираю Rust`);
}
try {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, fingerprint, 'utf8');
} catch {
  // Маркер — удобство, а не условие работы. Недоступный node_modules не должен ломать запуск.
}

if (configured) {
  console.log(`[dev] ключи YouTube из .env подставлены в сборку (отпечаток ${fingerprint})`);
} else {
  console.warn('[dev] BSC_YOUTUBE_CLIENT_ID / BSC_YOUTUBE_CLIENT_SECRET не заданы — вход в один клик будет недоступен.');
  console.warn('[dev] заполни .env по образцу .env.example');
}

void statSync;

const child = spawn('tauri', ['dev', '--config', 'src-tauri/tauri.dev.conf.json'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...keys },
});

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});