#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Label of the background webview used for silent SoundCloud authentication.
const AUTH_WINDOW_LABEL: &str = "soundcloud-auth";
/// Event delivered to the React frontend once credentials are captured.
const CREDENTIALS_EVENT: &str = "soundcloud:credentials";
/// SoundCloud entry point. The whole login/session flow happens inside this webview.
const SOUNDCLOUD_URL: &str = "https://soundcloud.com";

/// Credentials captured from the SoundCloud web session.
///
/// Serialized as `{ "token": "...", "clientId": "..." }` for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SoundCloudCredentials {
    token: String,
    client_id: String,
}

/// JavaScript injected into every document of the auth webview.
///
/// It monkey-patches `fetch` (and `XMLHttpRequest` as a fallback for older
/// clients), extracts `client_id`/`oauth_token` and forwards them to
/// [`save_credentials`]. If the user is not signed in, it asks Rust to reveal
/// the window via [`show_auth_window`] so the login form becomes visible.
const AUTH_INIT_SCRIPT: &str = r#"
(() => {
  'use strict';

  const API_HOST = 'api-v2.soundcloud.com';
  const CLIENT_ID_CACHE_KEY = 'bsc_client_id';
  const SENT_FLAG = '__bscCredentialsSent';
  const POLL_INTERVAL_MS = 1500;

  const internals = window.__TAURI_INTERNALS__;

  function invoke(command, args) {
    if (!internals || typeof internals.invoke !== 'function') {
      return Promise.reject(new Error('Tauri IPC is not available'));
    }
    try {
      const result = internals.invoke(command, args || {});
      return result && typeof result.catch === 'function' ? result : Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* private mode */ }
  }

  function cookieValue(name) {
    try {
      const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch (error) { return null; }
  }

  function headerValue(headers, name) {
    if (!headers) return null;
    try {
      if (typeof headers.get === 'function') return headers.get(name);
      const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
      return key ? headers[key] : null;
    } catch (error) { return null; }
  }

  function tokenFromAuthorization(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^\s*(?:OAuth|Bearer)\s+(.+)$/i);
    return match ? match[1].trim() : null;
  }

  function asUrl(input, base) {
    try {
      if (input instanceof URL) return input;
      const raw = typeof input === 'string' ? input : input && input.url;
      return raw ? new URL(raw, base) : null;
    } catch (error) { return null; }
  }

  // Priority requested by the spec: URL query -> localStorage -> cookie -> Authorization header.
  function findToken(url, request, init) {
    const fromUrl = url && url.searchParams ? url.searchParams.get('oauth_token') : null;
    if (fromUrl) return fromUrl;
    const fromStorage = storageGet('oauth_token');
    if (fromStorage) return fromStorage;
    const fromCookie = cookieValue('oauth_token');
    if (fromCookie) return fromCookie;
    const headers = (init && init.headers) || (request && request.headers);
    return tokenFromAuthorization(headerValue(headers, 'authorization'));
  }

  function sendCredentials(token, clientId) {
    if (!token || !clientId || window[SENT_FLAG]) return;
    window[SENT_FLAG] = true;
    storageSet(CLIENT_ID_CACHE_KEY, clientId);
    invoke('save_credentials', { token: token, clientId: clientId }).catch((error) => {
      window[SENT_FLAG] = false;
      console.warn('[bsc-auth] save_credentials failed', error);
    });
  }

  function inspectStoredCredentials() {
    const token = storageGet('oauth_token') || cookieValue('oauth_token');
    const clientId = storageGet(CLIENT_ID_CACHE_KEY);
    if (token && clientId) sendCredentials(token, clientId);
    return Boolean(token);
  }

  function inspectRequest(input, init) {
    const url = asUrl(input, window.location.href);
    if (!url || url.hostname !== API_HOST) return;
    const clientId = url.searchParams.get('client_id') || storageGet(CLIENT_ID_CACHE_KEY);
    if (clientId) storageSet(CLIENT_ID_CACHE_KEY, clientId);
    const token = findToken(url, input instanceof Request ? input : null, init);
    if (token && clientId) sendCredentials(token, clientId);
  }

  // 1. Patch fetch: SoundCloud keeps client_id in the query string of every api-v2 call.
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      try { inspectRequest(input, init); } catch (error) { /* never break the page */ }
      return originalFetch.apply(this, arguments);
    };
  }

  // 2. Fallback for XHR-based clients.
  const XHR = window.XMLHttpRequest;
  if (typeof XHR === 'function' && XHR.prototype) {
    const originalOpen = XHR.prototype.open;
    const originalSetRequestHeader = XHR.prototype.setRequestHeader;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__bscRequestUrl = url;
      this.__bscAuthHeader = null;
      return originalOpen.apply(this, arguments);
    };
    XHR.prototype.setRequestHeader = function (name, value) {
      if (typeof name === 'string' && name.toLowerCase() === 'authorization') {
        this.__bscAuthHeader = value;
      }
      return originalSetRequestHeader.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      try {
        const url = asUrl(this.__bscRequestUrl, window.location.href);
        if (url && url.hostname === API_HOST) {
          const clientId = url.searchParams.get('client_id') || storageGet(CLIENT_ID_CACHE_KEY);
          if (clientId) storageSet(CLIENT_ID_CACHE_KEY, clientId);
          const token = findToken(url, null, { headers: { authorization: this.__bscAuthHeader } });
          if (token && clientId) sendCredentials(token, clientId);
        }
      } catch (error) { /* ignore */ }
      return originalSend.apply(this, arguments);
    };
  }

  // 3. If there is no session yet, show the window so the user can sign in.
  function onReady() {
    const hasToken = inspectStoredCredentials();
    if (!hasToken && !window[SENT_FLAG]) {
      invoke('show_auth_window').catch((error) => {
        console.warn('[bsc-auth] show_auth_window failed', error);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }

  // 4. SoundCloud is a SPA: the token may appear without a full page reload.
  const poller = window.setInterval(() => {
    inspectStoredCredentials();
    if (window[SENT_FLAG]) window.clearInterval(poller);
  }, POLL_INTERVAL_MS);
})();
"#;

/// Opens (or reveals) the background webview that performs the silent login.
///
/// The window is created hidden on purpose: the injected script decides whether
/// the user has an existing session or needs to type credentials manually.
#[tauri::command]
fn start_auth_flow(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        return show_window(&window);
    }

    let url = SOUNDCLOUD_URL
        .parse::<tauri::Url>()
        .map_err(|error| format!("некорректный URL SoundCloud: {error}"))?;

    WebviewWindowBuilder::new(&app, AUTH_WINDOW_LABEL, WebviewUrl::External(url))
        .title("SoundCloud — вход")
        .inner_size(800.0, 700.0)
        .min_inner_size(600.0, 500.0)
        .visible(false)
        .incognito(false) // keep cookies/session between launches
        .initialization_script(AUTH_INIT_SCRIPT)
        .build()
        .map(|_| ())
        .map_err(|error| format!("не удалось открыть окно входа SoundCloud: {error}"))
}

/// Makes the auth window visible when manual sign-in is required.
#[tauri::command]
fn show_auth_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(AUTH_WINDOW_LABEL)
        .ok_or_else(|| "окно входа SoundCloud ещё не создано".to_owned())?;

    show_window(&window)
}

/// Receives credentials from the injected script, hides the auth window and
/// forwards the payload to the React frontend through a Tauri event.
#[tauri::command]
fn save_credentials(app: AppHandle, token: String, client_id: String) -> Result<(), String> {
    let token = token.trim().to_owned();
    let client_id = client_id.trim().to_owned();

    if token.is_empty() || client_id.is_empty() {
        return Err("SoundCloud вернул пустые учётные данные".to_owned());
    }

    // Keep the webview (and its cookies) alive, just get it out of the way.
    // Swap `hide` for `close` if you prefer to release the page after capture.
    if let Some(window) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }

    app.emit(
        CREDENTIALS_EVENT,
        SoundCloudCredentials { token, client_id },
    )
    .map_err(|error| format!("не удалось передать учётные данные во фронтенд: {error}"))
}

fn show_window(window: &WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            start_auth_flow,
            show_auth_window,
            save_credentials
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterSoundCloud");
}
