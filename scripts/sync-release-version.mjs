import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const tag = process.env.RELEASE_VERSION || process.argv[2];
const version = tag?.replace(/^v/, '');

if (!version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  throw new Error(`Invalid release version tag: ${tag ?? '(missing)'}`);
}

// Every file that carries the version is rewritten from the tag, and every
// rewrite is checked against what it found: a pattern that no longer matches
// used to leave the file untouched and still print success, which is how a
// release could ship carrying the previous version in one of them. Failing here
// is the point — the tag is the one version every build has to agree on.
function rewrite(relativePath, pattern, replacement) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing ${relativePath}`);
  }
  const before = fs.readFileSync(absolutePath, 'utf8');
  if (!pattern.test(before)) {
    throw new Error(`No version to replace in ${relativePath}`);
  }
  const after = before.replace(pattern, replacement);
  fs.writeFileSync(absolutePath, after, 'utf8');
  console.log(`Updated ${relativePath} -> ${version}`);
}

// the number the app reports as its own: RESONANCE_VERSION comes from here
rewrite('CMakeLists.txt',
  /(project\(\s*Resonance\s+VERSION\s+)\d+\.\d+\.\d+(?:[-+][\w.-]+)?/i,
  `$1${version}`);

// the rust core, and the same version in its lock file. \r? because the lock is
// CRLF on a Windows checkout and LF everywhere else
rewrite('spotify-core/Cargo.toml',
  /^(version\s*=\s*)"[^"]+"/m,
  `$1"${version}"`);

rewrite('spotify-core/Cargo.lock',
  /(name = "spotify-core"\r?\nversion = )"[^"]+"/,
  `$1"${version}"`);

// the package.json version is not part of any build, but the release script
// reads it to pick the next patch tag, so it has to follow the tag too
rewrite('package.json',
  /"version"\s*:\s*"[^"]+"/,
  `"version": "${version}"`);

console.log(`Synchronized release version: ${version}`);
