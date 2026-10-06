import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as esbuild from 'esbuild';

// credentialStore and the capability derivation, tested.
//
// credentialStore is the one place in the app where a secret sits in the webview, and it had no tests at
// all. The cases below are the ones that matter for it: malformed stored data, an entry whose service does
// not match the key it is under, storage that throws, and a remembered service that is not a service.
//
// serviceManager is loaded with the Tauri modules stubbed, because its adapters reach for invoke() at
// import time. The capability derivation is then checked against registered fakes — which is the part that
// can actually be wrong, since the whole point of it is that the interface and the adapters must not
// disagree about what a service can do.

const srcDir = new URL('../src/renderer/', import.meta.url);
const credentialStoreUrl = new URL('lib/credentialStore.ts', srcDir);
const serviceManagerUrl = new URL('lib/serviceManager.ts', srcDir);

// domain/models is imported for values, not only types: DEFAULT_SERVICE is what the manager starts on
// and isServiceProvider is what rejects a remembered service it does not know. Stubbing it keeps these
// tests about the store and the manager rather than about parsing a TypeScript file.
/**
 * A value built inside the vm has that realm's Array and Object prototypes, so a strict deep equal
 * rejects it as "same structure but not reference-equal" even when the contents are identical. A JSON
 * round-trip puts both sides in this realm, which is what the assertion is about.
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

const MODELS_STUB = {
  DEFAULT_SERVICE: 'soundcloud',
  SERVICE_PROVIDERS: ['soundcloud', 'spotify', 'youtube-music'],
  isServiceProvider: (value) => ['soundcloud', 'spotify', 'youtube-music'].includes(value),
};

const cache = new Map();

function requireShim(stubs) {
  return (specifier) => {
    if (specifier in stubs) return stubs[specifier];
    if (specifier === '../domain/models') return MODELS_STUB;
    throw new Error(`незаглушённый импорт ${specifier}`);
  };
}

async function loadTypescript(url, { stubs = {}, withLocalStorage = null } = {}) {
  if (cache.has(url.href)) return cache.get(url.href);

  const source = readFileSync(fileURLToPath(url), 'utf8');
  const compiled = await esbuild.transform(source, { loader: 'ts', format: 'cjs' });

  const moduleExports = {};
  const sandbox = {
    module: { exports: moduleExports },
    exports: moduleExports,
    console,
    require: requireShim(stubs),
  };
  if (withLocalStorage) sandbox.localStorage = withLocalStorage;
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(compiled.code, sandbox);
  cache.set(url.href, sandbox.module.exports);
  return sandbox.module.exports;
}

// ---- a localStorage that can be made to fail

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    _data: data,
  };
}

async function storeWith(storage) {
  // A fresh module each time, because the store reads localStorage on every call rather than caching it.
  const source = readFileSync(fileURLToPath(credentialStoreUrl), 'utf8');
  const compiled = await esbuild.transform(source, { loader: 'ts', format: 'cjs' });
  const moduleExports = {};
  const sandbox = {
    module: { exports: moduleExports },
    exports: moduleExports,
    console,
    localStorage: storage,
    require: requireShim({}),
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(compiled.code, sandbox);
  return sandbox.module.exports;
}

// ---- credentialStore

test('round-trips credentials for a service', async () => {
  const store = await storeWith(memoryStorage());
  assert.equal(store.saveCredentials('spotify', { clientId: 'cid', clientSecret: 'sec' }), true);
  const loaded = store.loadCredentials('spotify');
  assert.equal(loaded.clientId, 'cid');
  assert.equal(loaded.clientSecret, 'sec');
  assert.equal(loaded.service, 'spotify', 'the service is part of the record, not implied by the key');
});

test('returns null for a service that was never stored', async () => {
  const store = await storeWith(memoryStorage());
  assert.equal(store.loadCredentials('spotify'), null);
  assert.equal(store.loadCredentials('youtube-music'), null);
});

test('refuses a record whose service disagrees with its key', async () => {
  // Otherwise one service's credentials could be read back as another's, which is a confusing way to
  // send the wrong client secret to the wrong token endpoint.
  const storage = memoryStorage({ 'bsc.credentials.spotify': JSON.stringify({ service: 'youtube-music', clientId: 'x' }) });
  const store = await storeWith(storage);
  assert.equal(store.loadCredentials('spotify'), null);
});

test('survives stored data that is not an object', async () => {
  for (const raw of ['null', '[]', '"text"', '42', 'true']) {
    const store = await storeWith(memoryStorage({ 'bsc.credentials.spotify': raw }));
    assert.equal(store.loadCredentials('spotify'), null, `for ${raw}`);
  }
});

test('survives stored data that is not valid JSON', async () => {
  const store = await storeWith(memoryStorage({ 'bsc.credentials.spotify': '{not json' }));
  assert.equal(store.loadCredentials('spotify'), null);
});

test('survives storage that throws', async () => {
  // localStorage throws on a quota, in private mode, and when disabled outright. An exception here would
  // take the whole app down on start.
  const hostile = {
    get length() { throw new Error('denied'); },
    key() { throw new Error('denied'); },
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  const store = await storeWith(hostile);
  assert.equal(store.saveCredentials('spotify', { clientId: 'a' }), false);
  assert.equal(store.loadCredentials('spotify'), null);
  assert.deepEqual(plain(store.listStoredServices()), []);
  assert.equal(store.getLastActiveService(), 'soundcloud', 'an unreadable value falls back, it does not leave the app with no service');
  // These must not throw either.
  store.clearCredentials('spotify');
  store.setLastActiveService('spotify');
});

test('survives storage that is not there at all', async () => {
  const source = readFileSync(fileURLToPath(credentialStoreUrl), 'utf8');
  const compiled = await esbuild.transform(source, { loader: 'ts', format: 'cjs' });
  const moduleExports = {};
  const sandbox = {
    module: { exports: moduleExports },
    exports: moduleExports,
    console,
    require: requireShim({}),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(compiled.code, sandbox);
  const store = sandbox.module.exports;
  assert.equal(store.saveCredentials('spotify', { clientId: 'a' }), false);
  assert.equal(store.loadCredentials('spotify'), null);
  assert.equal(store.getLastActiveService(), 'soundcloud');
});

test('remembers the last active service', async () => {
  const store = await storeWith(memoryStorage());
  store.setLastActiveService('youtube-music');
  assert.equal(store.getLastActiveService(), 'youtube-music');
});

test('ignores a remembered service that is not one', async () => {
  // An unknown string must not leave the app with no service at all.
  for (const value of ['bandcamp', '', 'SPOTIFY', '{"service":"spotify"}', 'sound cloud']) {
    const store = await storeWith(memoryStorage({ 'bsc.lastService': value }));
    assert.equal(store.getLastActiveService(), 'soundcloud', `for ${JSON.stringify(value)}`);
  }
});

test('lists only services with a usable record', async () => {
  const storage = memoryStorage({
    'bsc.credentials.spotify': JSON.stringify({ service: 'spotify', clientId: 'a' }),
    // Wrong service for the key: stored, but must not be listed.
    'bsc.credentials.youtube-music': JSON.stringify({ service: 'spotify', clientId: 'b' }),
    'bsc.credentials.soundcloud': 'broken',
    'bsc.lastService': 'spotify',
  });
  const store = await storeWith(storage);
  assert.deepEqual(plain(store.listStoredServices()), ['spotify']);
});

test('clearing one service leaves the others', async () => {
  const store = await storeWith(memoryStorage());
  store.saveCredentials('spotify', { clientId: 'a' });
  store.saveCredentials('youtube-music', { clientId: 'b' });
  store.clearCredentials('spotify');
  assert.equal(store.loadCredentials('spotify'), null);
  assert.equal(store.loadCredentials('youtube-music').clientId, 'b');
});

// ---- service capabilities

const tauriStubs = {
  '@tauri-apps/api/core': { invoke: async () => undefined },
  '@tauri-apps/api/path': { appConfigDir: async () => '/tmp' },
  '@tauri-apps/plugin-shell': { Command: class {}, },
  // Empty objects on purpose. A realistic stub would register itself under a real service name, and then
  // the test asking about an unregistered service would be asking about a registered one.
  './adapters/soundcloudAdapter': { soundcloudAdapter: {} },
  './adapters/spotifyAdapter': { spotifyAdapter: {} },
  './adapters/youtubeMusicAdapter': { youtubeMusicAdapter: {} },
};

test('capabilities are read off the adapter, not a hand-written table', async () => {
  const manager = await loadTypescript(serviceManagerUrl, { stubs: tauriStubs });
  const { serviceManager, serviceCapabilities } = manager;

  // A stub with the social methods, and one without: the whole point is that the answer follows the
  // adapter rather than a list somewhere that can drift from it.
  const withArtists = { service: 'stub-rich', artistProfile: async () => null, likeTrack: async () => ({ liked: true }), unlikeTrack: async () => ({ liked: false }), historyList: async () => [] };
  const withoutArtists = { service: 'stub-poor', likeTrack: async () => ({ liked: true }), unlikeTrack: async () => ({ liked: false }) };
  serviceManager.register(withArtists);
  serviceManager.register(withoutArtists);

  assert.deepEqual(plain(serviceCapabilities('stub-rich')), { artists: true, likes: true, history: true });
  // The YouTube Music case: it can save nothing and has no artists, so both are false.
  assert.deepEqual(plain(serviceCapabilities('stub-poor')), { artists: false, likes: true, history: false });

  // Removing one capability must change the answer, which is what makes this a derivation.
  delete withArtists.artistProfile;
  assert.equal(serviceCapabilities('stub-rich').artists, false);
});

test('an unregistered service reports no capabilities instead of throwing', async () => {
  const manager = await loadTypescript(serviceManagerUrl, { stubs: tauriStubs });
  // The switcher renders a row for every known service before anything has been switched to, so asking
  // about one that is not connected has to answer rather than fail.
  assert.deepEqual(plain(manager.serviceCapabilities('soundcloud')), { artists: false, likes: false, history: false });
});
