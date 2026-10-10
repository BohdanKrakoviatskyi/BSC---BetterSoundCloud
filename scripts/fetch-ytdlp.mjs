import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Pinned so builds are reproducible. Bump deliberately after checking the release notes:
// a stale yt-dlp is how YouTube playback silently breaks when Google changes its player API.
// YTDLP_VERSION=latest (or any tag) overrides for a one-off refresh.
const fromEnv = (name) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};
const PINNED_VERSION = '2026.08.19';
const version = fromEnv('YTDLP_VERSION') ?? PINNED_VERSION;
const force = fromEnv('YTDLP_FORCE') === '1';

// Release asset per Tauri target triple. macOS Intel uses the legacy build; Windows ARM64 has no
// native asset and runs the x64 binary emulated — same tradeoff as most Electron apps ship.
const assetMap = {
  'aarch64-apple-darwin': 'yt-dlp_macos',
  'x86_64-apple-darwin': 'yt-dlp_macos_legacy',
  'x86_64-pc-windows-msvc': 'yt-dlp.exe',
  'aarch64-pc-windows-msvc': 'yt-dlp.exe',
  'x86_64-unknown-linux-gnu': 'yt-dlp_linux',
  'aarch64-unknown-linux-gnu': 'yt-dlp_linux_aarch64',
};
// Same triple resolution as scripts/build-go.mjs: explicit target wins, otherwise the host.
const platformMap = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};
const targetTriple = fromEnv('TAURI_ENV_TARGET_TRIPLE') ?? fromEnv('TARGET') ?? platformMap[`${process.platform}-${process.arch}`];
const asset = targetTriple ? assetMap[targetTriple] : undefined;

if (!targetTriple || !asset) {
  console.error(`Не поддерживается загрузка yt-dlp для ${process.platform}-${process.arch}`);
  process.exit(1);
}

const extension = targetTriple.includes('windows') ? '.exe' : '';
const output = resolve(root, 'src-tauri', 'binaries', `yt-dlp-${targetTriple}${extension}`);

if (existsSync(output) && !force) {
  console.info(`[fetch:ytdlp] уже есть: ${output}`);
  process.exit(0);
}

const tag = version === 'latest' ? 'latest/download' : `download/${version}`;
const url = `https://github.com/yt-dlp/yt-dlp/releases/${tag}/${asset}`;
console.info(`[fetch:ytdlp] ${url} -> ${output}`);
mkdirSync(dirname(output), { recursive: true });

const curl = spawnSync('curl', ['-fSL', '--retry', '3', '--max-time', '300', '-o', output, url], { stdio: 'inherit' });
if (curl.error || curl.status !== 0) {
  console.error('[fetch:ytdlp] не удалось скачать. Нет сети? Повтори позже или укажи YTDLP_VERSION.');
  process.exit(1);
}
if (!targetTriple.includes('windows')) chmodSync(output, 0o755);

// Smoke test: a binary that cannot even print its version is not worth bundling.
const check = spawnSync(output, ['--version'], { encoding: 'utf8' });
if (check.error || check.status !== 0) {
  console.error('[fetch:ytdlp] скачанный файл не запускается.');
  process.exit(1);
}
console.info(`[fetch:ytdlp] готово: yt-dlp ${String(check.stdout).trim()} для ${targetTriple}`);
