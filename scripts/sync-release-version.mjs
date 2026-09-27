import fs from 'node:fs';

const tag = process.env.RELEASE_VERSION;
const version = tag?.replace(/^v/, '');

if (!version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  throw new Error(`Invalid release version tag: ${tag ?? '(missing)'}`);
}

function writeJson(path, update) {
  const value = JSON.parse(fs.readFileSync(path, 'utf8'));
  update(value);
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

writeJson('package.json', (value) => {
  value.version = version;
});

writeJson('package-lock.json', (value) => {
  value.version = version;
  if (value.packages?.['']) value.packages[''].version = version;
});

writeJson('src-tauri/tauri.conf.json', (value) => {
  value.version = version;
});

const cargoToml = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
fs.writeFileSync(
  'src-tauri/Cargo.toml',
  cargoToml.replace(/^(version = )"[^"]+"$/m, `$1"${version}"`),
);

const cargoLock = fs.readFileSync('src-tauri/Cargo.lock', 'utf8');
fs.writeFileSync(
  'src-tauri/Cargo.lock',
  cargoLock.replace(
    /(name = "better-soundcloud"\nversion = )"[^"]+"/,
    `$1"${version}"`,
  ),
);

console.log(`Synchronized release version: ${version}`);
