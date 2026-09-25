#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Label of the webview used for SoundCloud authentication.
const AUTH_WINDOW_LABEL: &str = "soundcloud-auth";
/// Event delivered to the React frontend once credentials are captured.
const CREDENTIALS_EVENT: &str = "soundcloud:credentials";
/// Open the dedicated sign-in route in the embedded webview so its requests
/// remain observable by AUTH_INIT_SCRIPT for automatic credential capture.
const SOUNDCLOUD_URL: &str = "https://soundcloud.com/signin";

/// Credentials captured from the SoundCloud web session.
///
/// Serialized as `{ "token": "...", "clientId": "..." }` for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SoundCloudCredentials {
    token: String,
    client_id: String,
}

/// Inspect SoundCloud's own API requests inside the sign-in webview. The webview
/// does not share cookies with an arbitrary external browser.
const AUTH_INIT_SCRIPT: &str = r#"
(() => {
  'use strict';

  const API_HOST = 'api-v2.soundcloud.com';
  const CLIENT_ID_CACHE_KEY = 'bsc_client_id';
  const POLL_INTERVAL_MS = 1500;
  let lastSent = null;
  let bridgeRetries = 0;

  function invoke(command, args) {
    const internals = window.__TAURI_INTERNALS__;
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

  // Prefer the live request: saved cookies may contain an expired token.
  function findToken(url, request, init) {
    const fromUrl = url && url.searchParams ? url.searchParams.get('oauth_token') : null;
    if (fromUrl) return fromUrl;
    const headers = (init && init.headers) || (request && request.headers);
    const fromHeader = tokenFromAuthorization(headerValue(headers, 'authorization'));
    return fromHeader || storageGet('oauth_token') || cookieValue('oauth_token');
  }

  function sendCredentials(token, clientId) {
    if (!token || !clientId || (lastSent && lastSent.token === token && lastSent.clientId === clientId)) return;
    lastSent = { token, clientId };
    storageSet(CLIENT_ID_CACHE_KEY, clientId);
    invoke('save_credentials', { token, clientId }).then(() => {
      bridgeRetries = 0;
    }).catch((error) => {
      lastSent = null;
      if (String(error).includes('Tauri IPC is not available') && bridgeRetries++ < 8) {
        window.setTimeout(() => sendCredentials(token, clientId), 500);
      } else {
        console.warn('[bsc-auth] save_credentials failed', error);
      }
    });
  }

  function inspectStoredCredentials() {
    const token = storageGet('oauth_token') || cookieValue('oauth_token');
    const clientId = storageGet(CLIENT_ID_CACHE_KEY);
    if (!lastSent && token && clientId) sendCredentials(token, clientId);
  }

  function inspectRequest(input, init) {
    const url = asUrl(input, window.location.href);
    if (!url || url.hostname !== API_HOST) return;
    const clientId = url.searchParams.get('client_id') || storageGet(CLIENT_ID_CACHE_KEY);
    if (clientId) storageSet(CLIENT_ID_CACHE_KEY, clientId);
    const token = findToken(url, typeof Request !== 'undefined' && input instanceof Request ? input : null, init);
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

  // Give live API requests a chance to reveal the current token first; then
  // check the saved session too. Keep polling so a later sign-in is detected.
  window.setTimeout(() => {
    inspectStoredCredentials();
    window.setInterval(inspectStoredCredentials, POLL_INTERVAL_MS);
  }, 4000);
})();
"#;

/// Opens the sign-in webview. A visible window avoids a permanently hidden
/// flow when the SoundCloud page changes or only part of a session is present.
#[tauri::command]
async fn start_auth_flow(app: AppHandle) -> Result<(), String> {
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
        .visible(true)
        .incognito(false) // keep the embedded webview's cookies between launches
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

/// Forward captured credentials for validation; do not close the window until
/// the Go backend confirms that the token actually belongs to a user.
#[tauri::command]
fn save_credentials(app: AppHandle, token: String, client_id: String) -> Result<(), String> {
    let token = token.trim().to_owned();
    let client_id = client_id.trim().to_owned();

    if token.is_empty()
        || token.len() > 4096
        || token.chars().any(char::is_control)
        || client_id.len() < 8
        || client_id.len() > 128
        || !client_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("SoundCloud вернул некорректные учётные данные".to_owned());
    }

    app.emit_to(
        "main",
        CREDENTIALS_EVENT,
        SoundCloudCredentials { token, client_id },
    )
    .map_err(|error| format!("не удалось передать учётные данные во фронтенд: {error}"))
}

/// Called only by the local main window after the Go backend validates the token.
#[tauri::command]
fn finish_auth_flow(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        window
            .close()
            .map_err(|error| format!("не удалось закрыть окно входа: {error}"))?;
    }
    Ok(())
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
            save_credentials,
            finish_auth_flow
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterSoundCloud");
}
