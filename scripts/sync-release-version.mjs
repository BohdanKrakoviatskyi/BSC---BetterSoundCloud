import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const tag = process.env.RELEASE_VERSION || process.argv[2];
const version = tag?.replace(/^v/, '');

if (!version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  console.error(`Invalid release version tag: ${tag ?? '(missing)'}`);
  process.exit(1);
}

// 1. Update CMakeLists.txt
const cmakePath = path.join(rootDir, 'CMakeLists.txt');
if (fs.existsSync(cmakePath)) {
  let cmakeContent = fs.readFileSync(cmakePath, 'utf8');
  cmakeContent = cmakeContent.replace(
    /(project\(\s*Swiftify\s+VERSION\s+)\d+\.\d+\.\d+(?:[-+][\w.-]+)?/i,
    `$1${version}`
  );
  fs.writeFileSync(cmakePath, cmakeContent, 'utf8');
  console.log(`Updated CMakeLists.txt -> ${version}`);
}

// 2. Update spotify-core/Cargo.toml
const cargoTomlPath = path.join(rootDir, 'spotify-core', 'Cargo.toml');
if (fs.existsSync(cargoTomlPath)) {
  let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
  cargoToml = cargoToml.replace(
    /^(version\s*=\s*)"[^"]+"/m,
    `$1"${version}"`
  );
  fs.writeFileSync(cargoTomlPath, cargoToml, 'utf8');
  console.log(`Updated spotify-core/Cargo.toml -> ${version}`);
}

// 3. Update spotify-core/Cargo.lock
const cargoLockPath = path.join(rootDir, 'spotify-core', 'Cargo.lock');
if (fs.existsSync(cargoLockPath)) {
  let cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
  cargoLock = cargoLock.replace(
    /(name = "spotify-core"\r?\nversion = )"[^"]+"/,
    `$1"${version}"`
  );
  fs.writeFileSync(cargoLockPath, cargoLock, 'utf8');
  console.log(`Updated spotify-core/Cargo.lock -> ${version}`);
}

// 4. Update package.json if present
const pkgJsonPath = path.join(rootDir, 'package.json');
if (fs.existsSync(pkgJsonPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`Updated package.json -> ${version}`);
}

console.log(`Successfully synchronized release version: ${version}`);
