// Guard: the four Tauri runtime pairs must share major.minor between npm and Cargo,
// or `tauri build` fails the release the way v0.2.0 learned. Run by `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(root + '/package.json');

const PAIRS = [
  ['@tauri-apps/api', 'tauri'],
  ['@tauri-apps/plugin-shell', 'tauri-plugin-shell'],
  ['@tauri-apps/plugin-updater', 'tauri-plugin-updater'],
  ['@tauri-apps/plugin-process', 'tauri-plugin-process'],
];

function minor(version) {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(version.trim());
  assert.match(version, /^(\d+)\.(\d+)\.\d+/, `unparseable version ${version}`);
  return `${match[1]}.${match[2]}`;
}

test('tauri npm/cargo minors match', () => {
  const lock = readFileSync(resolve(root, 'src-tauri/Cargo.lock'), 'utf8');
  for (const [npmName, crateName] of PAIRS) {
    const npmVersion = require(`./node_modules/${npmName}/package.json`).version;
    // \r? because Cargo.lock is CRLF on a Windows checkout and LF everywhere else.
    const block = new RegExp(`name = "${crateName}"\\r?\\nversion = "([^"]+)"`).exec(lock);
    assert.ok(block, `crate ${crateName} missing from Cargo.lock`);
    assert.equal(
      minor(npmVersion),
      minor(block[1]),
      `${npmName}@${npmVersion} vs ${crateName}@${block[1]}: bump both sides together`,
    );
  }
});
