import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const rustSource = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const script = rustSource.match(/const AUTH_INIT_SCRIPT: &str = r#"\n([\s\S]*?)\n"#;/)?.[1];
assert.ok(script, 'SoundCloud webview initialization script is present');

function createWebview() {
  const storage = new Map();
  const calls = [];
  const timeouts = [];
  let interval = null;

  class FakeXHR {
    open() {}
    setRequestHeader() {}
    send() {}
  }

  const window = {
    location: { href: 'https://soundcloud.com/' },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    __TAURI_INTERNALS__: { invoke: (command, args) => {
      calls.push({ command, args });
      return Promise.resolve();
    } },
    fetch: () => Promise.resolve({}),
    XMLHttpRequest: FakeXHR,
    setTimeout: (callback) => { timeouts.push(callback); },
    setInterval: (callback) => { interval = callback; },
  };
  vm.runInNewContext(script, { window, document: { cookie: '' }, URL, console });
  return { window, storage, calls, timeouts, tick: () => interval?.() };
}

test('captures a live SoundCloud API token and client ID once', () => {
  const page = createWebview();
  const url = 'https://api-v2.soundcloud.com/me?client_id=validClientId';
  const options = { headers: { Authorization: 'OAuth live-token' } };
  page.window.fetch(url, options);
  page.window.fetch(url, options);
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].command, 'save_credentials');
  assert.equal(page.calls[0].args.token, 'live-token');
  assert.equal(page.calls[0].args.clientId, 'validClientId');
});

test('prefers live authorization over a stale token in localStorage', () => {
  const page = createWebview();
  page.storage.set('oauth_token', 'expired-token');
  page.window.fetch('https://api-v2.soundcloud.com/me?client_id=validClientId', {
    headers: { authorization: 'Bearer current-token' },
  });
  assert.equal(page.calls[0].args.token, 'current-token');
  page.timeouts[0]();
  page.tick();
  assert.equal(page.calls.length, 1);
});

test('keeps watching for new credentials after an initial sign-in', () => {
  const page = createWebview();
  page.window.fetch('https://api-v2.soundcloud.com/me?client_id=validClientId', {
    headers: { authorization: 'OAuth first-token' },
  });
  const xhr = new page.window.XMLHttpRequest();
  xhr.open('GET', 'https://api-v2.soundcloud.com/me?client_id=validClientId');
  xhr.setRequestHeader('Authorization', 'OAuth second-token');
  xhr.send();
  assert.equal(page.calls.length, 2);
  assert.equal(page.calls[1].args.token, 'second-token');
});

test('retries when the Tauri bridge becomes available after the page starts', async () => {
  const page = createWebview();
  const bridge = page.window.__TAURI_INTERNALS__;
  delete page.window.__TAURI_INTERNALS__;
  page.window.fetch('https://api-v2.soundcloud.com/me?client_id=validClientId', {
    headers: { authorization: 'OAuth live-token' },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(page.calls.length, 0);
  page.window.__TAURI_INTERNALS__ = bridge;
  page.timeouts[1]();
  assert.equal(page.calls[0].args.token, 'live-token');
});

test('waits for client ID instead of failing on a partial saved session', () => {
  const page = createWebview();
  page.storage.set('oauth_token', 'saved-token');
  page.timeouts[0]();
  assert.equal(page.calls.length, 0);
  page.window.fetch('https://api-v2.soundcloud.com/me?client_id=validClientId');
  assert.equal(page.calls[0].args.token, 'saved-token');
});
