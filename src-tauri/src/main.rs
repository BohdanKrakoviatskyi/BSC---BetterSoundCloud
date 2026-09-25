#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Label of the webview used for SoundCloud authentication.
const AUTH_WINDOW_LABEL: &str = "soundcloud-auth";
const CAPTCHA_WINDOW_LABEL: &str = "soundcloud-captcha";
/// Event delivered to the React frontend once credentials are captured.
const CREDENTIALS_EVENT: &str = "soundcloud:credentials";
/// Open the dedicated sign-in route in the embedded webview so its requests
/// remain observable by AUTH_INIT_SCRIPT for automatic credential capture.
const SOUNDCLOUD_URL: &str = "https://soundcloud.com/signin";

const CAPTCHA_INIT_SCRIPT: &str = r#"
(() => {
  const bridge = window.__TAURI_INTERNALS__;
  if (!bridge || typeof bridge.invoke !== 'function') return;
  let reported = false;
  function reportCheck(url, status) {
    const path = String(url).split(/[?#]/, 1)[0].toLowerCase();
    if (reported || status < 200 || status >= 300 || !(path.endsWith('/check') || path.includes('/check/'))) return;
    reported = true;
    bridge.invoke('mark_captcha_challenge_completed').catch(() => {});
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input) {
      const url = typeof input === 'string' ? input : input && input.url;
      return nativeFetch.apply(this, arguments).then((response) => {
        reportCheck(url, response.status);
        return response;
      });
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__bscCaptchaUrl = url;
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      this.addEventListener('loadend', () => reportCheck(this.__bscCaptchaUrl, this.status), { once: true });
      return send.apply(this, arguments);
    };
  }
})();
"#;


/// Credentials captured from the SoundCloud web session.
///
/// Serialized as `{ "token": "...", "clientId": "..." }` for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SoundCloudCredentials {
    token: String,
    client_id: String,
}

#[derive(Default)]
struct CaptchaState {
    baseline_datadome_cookie: Mutex<Option<String>>,
    challenge_passed: Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptchaChallengeStatus {
    completed: bool,
    closed: bool,
    datadome_cookie: Option<String>,
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

/// Opens the SoundCloud anti-bot challenge in an interactive in-app webview.
#[tauri::command]
async fn show_captcha_window(app: AppHandle, url: String) -> Result<(), String> {
    let url = url
        .parse::<tauri::Url>()
        .map_err(|error| format!("некорректная ссылка проверки SoundCloud: {error}"))?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let allowed_host = host == "captcha-delivery.com"
        || host.ends_with(".captcha-delivery.com")
        || host == "soundcloud.com"
        || host.ends_with(".soundcloud.com");
    if url.scheme() != "https"
        || !allowed_host
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("SoundCloud вернул небезопасную ссылку проверки".to_owned());
    }

    let baseline_cookie = match app.get_webview_window("main") {
        Some(window) => datadome_cookie_for(&window)?,
        None => None,
    };
    let state = app.state::<CaptchaState>();
    *state
        .baseline_datadome_cookie
        .lock()
        .map_err(|_| "не удалось проверить состояние капчи".to_owned())? = baseline_cookie;
    *state
        .challenge_passed
        .lock()
        .map_err(|_| "не удалось проверить состояние капчи".to_owned())? = false;

    if let Some(window) = app.get_webview_window(CAPTCHA_WINDOW_LABEL) {
        window
            .navigate(url)
            .map_err(|error| format!("не удалось загрузить проверку SoundCloud: {error}"))?;
        return show_window(&window);
    }

    WebviewWindowBuilder::new(&app, CAPTCHA_WINDOW_LABEL, WebviewUrl::External(url))
        .title("Проверка SoundCloud")
        .inner_size(520.0, 720.0)
        .min_inner_size(400.0, 540.0)
        .visible(true)
        .incognito(false)
        .initialization_script(CAPTCHA_INIT_SCRIPT)
        .build()
        .map(|_| ())
        .map_err(|error| format!("не удалось открыть проверку SoundCloud: {error}"))
}

/// Returns the updated DataDome cookie after the challenge is completed.
#[tauri::command]
async fn poll_captcha_challenge(app: AppHandle) -> Result<CaptchaChallengeStatus, String> {
    let Some(window) = app.get_webview_window(CAPTCHA_WINDOW_LABEL) else {
        return Ok(CaptchaChallengeStatus {
            completed: false,
            closed: true,
            datadome_cookie: None,
        });
    };

    let current_cookie = datadome_cookie_for(&window)?;
    let state = app.state::<CaptchaState>();
    let baseline_cookie = state
        .baseline_datadome_cookie
        .lock()
        .map_err(|_| "не удалось проверить состояние капчи".to_owned())?
        .clone();
    let challenge_passed = *state
        .challenge_passed
        .lock()
        .map_err(|_| "не удалось проверить состояние капчи".to_owned())?;
    let cookie_changed = current_cookie
        .as_deref()
        .is_some_and(|cookie| baseline_cookie.as_deref() != Some(cookie));
    if challenge_passed || cookie_changed {
        window
            .close()
            .map_err(|error| format!("не удалось закрыть проверку SoundCloud: {error}"))?;
        return Ok(CaptchaChallengeStatus {
            completed: true,
            closed: false,
            datadome_cookie: current_cookie.or(baseline_cookie),
        });
    }

    Ok(CaptchaChallengeStatus {
        completed: false,
        closed: false,
        datadome_cookie: None,
    })
}

#[tauri::command]
fn mark_captcha_challenge_completed(
    window: WebviewWindow,
    state: State<'_, CaptchaState>,
) -> Result<(), String> {
    if window.label() != CAPTCHA_WINDOW_LABEL {
        return Err("сигнал проверки получен не из окна капчи".to_owned());
    }
    *state
        .challenge_passed
        .lock()
        .map_err(|_| "не удалось сохранить результат проверки".to_owned())? = true;
    Ok(())
}

fn datadome_cookie_for(window: &WebviewWindow) -> Result<Option<String>, String> {
    let url = "https://soundcloud.com"
        .parse::<tauri::Url>()
        .map_err(|error| format!("некорректный адрес SoundCloud: {error}"))?;
    let cookies = window
        .cookies_for_url(url)
        .map_err(|error| format!("не удалось прочитать cookie проверки SoundCloud: {error}"))?;
    Ok(cookies
        .into_iter()
        .find(|cookie| cookie.name() == "datadome")
        .map(|cookie| cookie.value().to_owned()))
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
        .manage(CaptchaState::default())
        .invoke_handler(tauri::generate_handler![
            start_auth_flow,
            show_auth_window,
            show_captcha_window,
            poll_captcha_challenge,
            mark_captcha_challenge_completed,
            save_credentials,
            finish_auth_flow
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterSoundCloud");
}
