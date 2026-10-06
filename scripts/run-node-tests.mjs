import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs the tests in scripts/, so `npm run test:node` picks them all up.
//
// Every *.test.mjs in this directory is run, which means a test added later is run without anyone
// having to remember to register it.
//
// Two of them are skipped on Windows rather than failed. auth-init.test.mjs asserts that the sidecar's
// token file comes out with POSIX 0600 permissions; Windows has no such bits and Go's Chmod does not
// restrict access there, so the assertion cannot hold and its failure says nothing about the code. It
// still runs everywhere else. Skipping a check on a platform that cannot express it is not the same
// as deleting it, and the Go test that makes the same check skips for the same reason.

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const testFiles = readdirSync(scriptsDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

if (testFiles.length === 0) {
  console.error('В scripts/ нет файлов *.test.mjs');
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const skipped = isWindows ? ['auth-init.test.mjs'] : [];

let failed = 0;

for (const name of testFiles) {
  if (skipped.includes(name)) {
    console.log(`\n── ${name}: пропущен на ${process.platform}`);
    console.log('   причина: проверка прав POSIX, которых в Windows нет');
    continue;
  }

  console.log(`\n── ${name}`);
  const result = spawnSync('node', ['--test', join(scriptsDir, name)], {
    stdio: 'inherit',
    cwd: resolve(scriptsDir, '..'),
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`   ${name}: упал (код ${result.status})`);
  }
}

console.log('');
if (failed > 0) {
  console.error(`Провалено файлов: ${failed} из ${testFiles.length - skipped.length}`);
  process.exit(1);
}
console.log(`Пройдено файлов: ${testFiles.length - skipped.length} из ${testFiles.length}` + (skipped.length ? `, пропущено на ${process.platform}: ${skipped.length}` : ''));
