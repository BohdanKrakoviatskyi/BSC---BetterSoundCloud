#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Label of the webview used for SoundCloud authentication and session requests.
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

#[derive(Default)]
struct AuthState {
    token: Mutex<Option<String>>,
    client_id: Mutex<Option<String>>,
    user_id: Mutex<Option<i64>>,
    session_ready: Mutex<bool>,
}

#[derive(Default)]
struct LikeState {
    next_req_id: AtomicU32,
    pending: Mutex<HashMap<u32, tokio::sync::oneshot::Sender<TrackLikeResult>>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackLikeResult {
    liked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    captcha_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct LikeResultReport { req_id: u32,
    liked: bool,
    success: bool,
    captcha_url: Option<String>,
    error: Option<String>,
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
      }
    });
  }

  function inspectStoredCredentials() {
    const token = storageGet('oauth_token') || cookieValue('oauth_token');
    const clientId = storageGet(CLIENT_ID_CACHE_KEY);
    if (!lastSent && token && clientId) sendCredentials(token, clientId);
  }

  // Intercept XHR and fetch to snatch live credentials.
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = asUrl(input, window.location.href);
        if (url && url.hostname === API_HOST) {
          const clientId = url.searchParams.get('client_id') || storageGet(CLIENT_ID_CACHE_KEY);
          if (clientId) storageSet(CLIENT_ID_CACHE_KEY, clientId);
          const token = findToken(url, init, null);
          if (token && clientId) sendCredentials(token, clientId);
        }
      } catch (error) { /* ignore */ }
      return originalFetch.apply(this, arguments);
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    const originalSetRequestHeader = XHR.prototype.setRequestHeader;

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

  // Like / Unlike handler running inside soundcloud.com context
  window.__bscLikeTrack = async function (reqId, userId, trackId, clientId, token, liked) {
    try {
      const activeToken = token || storageGet('oauth_token') || cookieValue('oauth_token') || '';
      const activeClientId = clientId || storageGet(CLIENT_ID_CACHE_KEY) || 'pmagYZKQF6mRtNmtRzPkXSQJ76jYHLN8';
      const method = liked ? 'PUT' : 'DELETE';
      const url = 'https://api-v2.soundcloud.com/users/' + userId + '/track_likes/' + trackId + '?client_id=' + encodeURIComponent(activeClientId);
      const res = await window.fetch(url, {
        method: method,
        headers: {
          'Authorization': 'OAuth ' + activeToken,
          'Accept': 'application/json, text/javascript, */*; q=0.01'
        },
        credentials: 'include'
      });
      let captchaUrl = null;
      if (res.status === 403) {
        try {
          const data = await res.json();
          captchaUrl = data.url || data.blockScript || null;
        } catch (_) {}
      }
      const success = res.status >= 200 && res.status < 300;
      const errorText = success ? null : ('SoundCloud returned HTTP ' + res.status);
      invoke('report_like_result', {
        reqId: reqId,
        liked: success ? liked : !liked,
        success: success,
        captchaUrl: captchaUrl,
        error: errorText
      }).catch(() => {});
    } catch (err) {
      invoke('report_like_result', {
        reqId: reqId,
        liked: !liked,
        success: false,
        captchaUrl: null,
        error: String(err && err.message ? err.message : err)
      }).catch(() => {});
    }
  };


  // Give live API requests a chance to reveal the current token first; then
  // check the saved session too. Keep polling so a later sign-in is detected.
  window.setTimeout(() => {
    inspectStoredCredentials();
    window.setInterval(inspectStoredCredentials, POLL_INTERVAL_MS);
  }, 4000);
})();
"#;

fn resolve_credentials(app: &AppHandle) -> (Option<String>, Option<String>, Option<i64>) {
    let auth_state = app.state::<AuthState>();
    let mut token = auth_state.token.lock().unwrap().clone();
    let mut client_id = auth_state.client_id.lock().unwrap().clone();
    let mut user_id = *auth_state.user_id.lock().unwrap();

    let mut search_dirs = Vec::new();
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            search_dirs.push(PathBuf::from(appdata).join("BetterSoundCloud"));
        }
    }
    if let Ok(config_dir) = app.path().app_config_dir() {
        search_dirs.push(config_dir);
    }

    for dir in search_dirs {
        if token.is_none() || user_id.is_none() {
            let auth_file = dir.join("auth.json");
            if let Ok(content) = std::fs::read_to_string(&auth_file) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if token.is_none() {
                        if let Some(t) = json.get("token").and_then(|v| v.as_str()) {
                            token = Some(t.to_string());
                        }
                    }
                    if user_id.is_none() {
                        if let Some(id) = json.pointer("/profile/id").and_then(|v| v.as_i64()) {
                            user_id = Some(id);
                        }
                    }
                }
            }
        }
        if client_id.is_none() {
            let settings_file = dir.join("settings.json");
            if let Ok(content) = std::fs::read_to_string(&settings_file) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(cid) = json.get("clientId").and_then(|v| v.as_str()) {
                        client_id = Some(cid.to_string());
                    }
                }
            }
        }
    }

    (token, client_id, user_id)
}

fn ensure_session_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        return Ok(window);
    }

    let url = SOUNDCLOUD_URL
        .parse::<tauri::Url>()
        .map_err(|error| format!("некорректный URL SoundCloud: {error}"))?;

    let window = WebviewWindowBuilder::new(app, AUTH_WINDOW_LABEL, WebviewUrl::External(url))
        .title("SoundCloud — вход")
        .inner_size(800.0, 700.0)
        .min_inner_size(600.0, 500.0)
        .visible(false)
        .incognito(false)
        .initialization_script(AUTH_INIT_SCRIPT)
        .build()
        .map_err(|error| format!("не удалось открыть окно входа SoundCloud: {error}"))?;

    let win_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = win_clone.hide();
        }
    });

    Ok(window)
}

/// Opens the sign-in webview. A visible window avoids a permanently hidden
/// flow when the SoundCloud page changes or only part of a session is present.
#[tauri::command]
async fn start_auth_flow(app: AppHandle) -> Result<(), String> {
    let window = ensure_session_window(&app)?;
    show_window(&window)
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
    let cookie_changed = match (&current_cookie, &baseline_cookie) {
        (Some(current), Some(baseline)) => current != baseline,
        (Some(_), None) => true,
        _ => false,
    };

    if challenge_passed || cookie_changed {
        let _ = window.hide();
        return Ok(CaptchaChallengeStatus {
            completed: true,
            closed: false,
            datadome_cookie: current_cookie.or(baseline_cookie),
        });
    }

    let is_visible = window
        .is_visible()
        .map_err(|error| format!("не удалось проверить окно проверки: {error}"))?;
    if !is_visible {
        return Ok(CaptchaChallengeStatus {
            completed: false,
            closed: true,
            datadome_cookie: None,
        });
    }

    Ok(CaptchaChallengeStatus {
        completed: false,
        closed: false,
        datadome_cookie: current_cookie,
    })
}

#[tauri::command]
fn mark_captcha_challenge_completed(app: AppHandle) -> Result<(), String> {
    let state = app.state::<CaptchaState>();
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
    let window = ensure_session_window(&app)?;
    show_window(&window)
}

/// Forward captured credentials for validation; do not close the window until
/// the Go backend confirms that the token actually belongs to a user.
#[tauri::command]
fn save_credentials(app: AppHandle, token: String, client_id: String) -> Result<(), String> {
    let auth_state = app.state::<AuthState>();
    *auth_state.token.lock().unwrap() = Some(token.clone());
    *auth_state.client_id.lock().unwrap() = Some(client_id.clone());

    app.emit(
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
            .hide()
            .map_err(|error| format!("не удалось скрыть окно входа: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn report_session_ready(app: AppHandle) -> Result<(), String> {
    let auth_state = app.state::<AuthState>();
    *auth_state.session_ready.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
fn sync_session_window(
    app: AppHandle,
    user_id: Option<i64>,
    client_id: Option<String>,
) -> Result<(), String> {
    let auth_state = app.state::<AuthState>();
    if let Some(id) = user_id {
        *auth_state.user_id.lock().unwrap() = Some(id);
    }
    if let Some(cid) = client_id {
        *auth_state.client_id.lock().unwrap() = Some(cid);
    }
    let _ = ensure_session_window(&app);
    Ok(())
}

#[tauri::command]
fn report_like_result(app: AppHandle, result: LikeResultReport) -> Result<(), String> {
    let like_state = app.state::<LikeState>();
    let mut pending = like_state
        .pending
        .lock()
        .map_err(|_| "like state lock error".to_owned())?;
    if let Some(tx) = pending.remove(&result.req_id) {
        let _ = tx.send(TrackLikeResult {
            liked: result.liked,
            captcha_url: result.captcha_url,
        });
    }
    Ok(())
}

/// Performs track like/unlike requests directly within the authenticated soundcloud.com webview context.
#[tauri::command]
async fn like_track_webview(
    app: AppHandle,
    track_id: i64,
    user_id: Option<i64>,
    client_id: Option<String>,
    liked: bool,
) -> Result<TrackLikeResult, String> {
    let window = ensure_session_window(&app)?;

    let (saved_token, saved_client_id, saved_user_id) = resolve_credentials(&app);
    let resolved_user_id = user_id.or(saved_user_id).unwrap_or(0);
    if resolved_user_id <= 0 {
        return Err("не удалось определить ID пользователя для изменения лайка".to_owned());
    }
    let resolved_client_id = client_id
        .or(saved_client_id)
        .unwrap_or_else(|| "pmagYZKQF6mRtNmtRzPkXSQJ76jYHLN8".to_owned());
    let resolved_token = saved_token.unwrap_or_default();

    let like_state = app.state::<LikeState>();
    let req_id = like_state.next_req_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let mut pending = like_state
            .pending
            .lock()
            .map_err(|_| "like state lock error".to_owned())?;
        pending.insert(req_id, tx);
    }

    let script = format!(
        r#"
        if (typeof window.__bscLikeTrack === 'function') {{
            window.__bscLikeTrack({}, {}, {}, "{}", "{}", {});
        }} else {{
            (async () => {{
                try {{
                    const m = {} ? 'PUT' : 'DELETE';
                    const u = 'https://api-v2.soundcloud.com/users/{}/track_likes/{}?client_id=' + encodeURIComponent('{}');
                    const r = await window.fetch(u, {{
                        method: m,
                        headers: {{
                            'Authorization': 'OAuth {}',
                            'Accept': 'application/json, text/javascript, */*; q=0.01'
                        }},
                        credentials: 'include'
                    }});
                    let cUrl = null;
                    if (r.status === 403) {{
                        try {{ const d = await r.json(); cUrl = d.url || d.blockScript || null; }} catch(_) {{}}
                    }}
                    const s = r.status >= 200 && r.status < 300;
                    const err = s ? null : ('HTTP ' + r.status);
                    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                        window.__TAURI_INTERNALS__.invoke('report_like_result', {{
                            reqId: {},
                            liked: s ? {} : !{},
                            success: s,
                            captchaUrl: cUrl,
                            error: err
                        }});
                    }}
                }} catch(e) {{
                    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
                        window.__TAURI_INTERNALS__.invoke('report_like_result', {{
                            reqId: {},
                            liked: !{},
                            success: false,
                            captchaUrl: null,
                            error: String(e)
                        }});
                    }}
                }}
            }})();
        }}
        "#,
        req_id, resolved_user_id, track_id, resolved_client_id, resolved_token, liked,
        liked, resolved_user_id, track_id, resolved_client_id, resolved_token,
        req_id, liked, liked,
        req_id, liked
    );

    window
        .eval(&script)
        .map_err(|error| format!("не удалось выполнить запрос лайка в окне SoundCloud: {error}"))?;

    match tokio::time::timeout(tokio::time::Duration::from_secs(20), rx).await {
        Ok(Ok(res)) => Ok(res),
        Ok(Err(_)) => Err("канал ответа SoundCloud закрыт".to_owned()),
        Err(_) => {
            let mut pending = like_state
                .pending
                .lock()
                .map_err(|_| "like state lock error".to_owned())?;
            pending.remove(&req_id);
            Err("таймаут ожидания ответа SoundCloud (20c)".to_owned())
        }
    }
}

fn show_window(window: &WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(CaptchaState::default())
        .manage(AuthState::default())
        .manage(LikeState::default())
        .setup(|app| {
            let _ = ensure_session_window(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_auth_flow,
            show_auth_window,
            show_captcha_window,
            poll_captcha_challenge,
            mark_captcha_challenge_completed,
            save_credentials,
            finish_auth_flow,
            report_session_ready,
            sync_session_window,
            report_like_result,
            like_track_webview
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterSoundCloud");
}
