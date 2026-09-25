#!/usr/bin/env node
/**
 * Живой тест Go backend против настоящего SoundCloud.
 * Читает TOKEN=... из .env в корне проекта и запускает TestSoundCloudLiveProfile.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');

if (!existsSync(envPath)) {
  console.error('Нет .env с токеном. Создайте файл с содержимым TOKEN=<access token>.');
  process.exit(1);
}

const line = readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .find((entry) => entry.trim().startsWith('TOKEN='));
const token = line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
if (!token) {
  console.error('В .env не найдена строка TOKEN=<access token>.');
  process.exit(1);
}

const result = spawnSync('go', ['test', '-count=1', '-v', '-run', 'TestSoundCloudLiveProfile', './...'], {
  cwd: resolve(root, 'backend'),
  env: { ...process.env, BSC_TEST_TOKEN: token },
  stdio: 'inherit',
});

if (result.error) {
  console.error('Не найден Go. Установите Go 1.22+ и повторите.');
  process.exit(1);
}
process.exit(result.status ?? 1);
