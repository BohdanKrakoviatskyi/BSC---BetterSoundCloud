import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platformMap = {
  'darwin-arm64': ['aarch64-apple-darwin', 'darwin', 'arm64'],
  'darwin-x64': ['x86_64-apple-darwin', 'darwin', 'amd64'],
  'win32-x64': ['x86_64-pc-windows-msvc', 'windows', 'amd64'],
  'win32-arm64': ['aarch64-pc-windows-msvc', 'windows', 'arm64'],
  'linux-x64': ['x86_64-unknown-linux-gnu', 'linux', 'amd64'],
  'linux-arm64': ['aarch64-unknown-linux-gnu', 'linux', 'arm64'],
};
const tripleMap = {
  'aarch64-apple-darwin': ['darwin', 'arm64'],
  'x86_64-apple-darwin': ['darwin', 'amd64'],
  'x86_64-pc-windows-msvc': ['windows', 'amd64'],
  'aarch64-pc-windows-msvc': ['windows', 'arm64'],
  'x86_64-unknown-linux-gnu': ['linux', 'amd64'],
  'aarch64-unknown-linux-gnu': ['linux', 'arm64'],
};
/**
 * Reads an environment value, treating blank as absent.
 *
 * This started as a fix for the release build. The workflow passed the target triple as
 * `env: TAURI_ENV_TARGET_TRIPLE: ${{ matrix.target }}` while matrix.target was only declared for
 * the macOS runners, so on ubuntu and windows GitHub Actions set the variable to an empty string
 * rather than leaving it unset. `??` falls through only on null and undefined, so the empty string
 * won the coalesce, was rejected as an unknown triple, and the build exited before Go ran.
 *
 * The workflow no longer passes a triple at all, so the bug cannot come back that way. This stays
 * because the hazard is not the workflow, it is the assumption: a variable that a template renders
 * as nothing is an empty string, and reading one with `??` looks correct until it is not.
 */
const fromEnv = (name) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

const [hostTriple] = platformMap[`${process.platform}-${process.arch}`] ?? [];
const targetTriple = fromEnv('TAURI_ENV_TARGET_TRIPLE') ?? fromEnv('TARGET') ?? hostTriple;
const [goos, goarch] = tripleMap[targetTriple] ?? [];

if (!targetTriple || !goos || !goarch) {
  console.error(`Не поддерживается сборка Go sidecar для ${process.platform}-${process.arch}`);
  process.exit(1);
}

const extension = goos === 'windows' ? '.exe' : '';
const output = resolve(root, 'src-tauri', 'binaries', `local-api-${targetTriple}${extension}`);
const backend = resolve(root, 'backend');
mkdirSync(dirname(output), { recursive: true });
const result = spawnSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', output, './cmd/local-api'], {
  cwd: backend,
  stdio: 'inherit',
  env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
});

if (result.error) {
  console.error('Не найден Go. Установите Go 1.22+ и повторите сборку.');
  process.exit(1);
}
process.exit(result.status ?? 1);
