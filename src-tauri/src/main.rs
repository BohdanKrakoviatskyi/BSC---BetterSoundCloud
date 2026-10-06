#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::collections::HashMap;
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

/// Label of the webview used for the Spotify authorization flow.
const SPOTIFY_WINDOW_LABEL: &str = "spotify-auth";
const SPOTIFY_AUTHORIZE_URL: &str = "https://accounts.spotify.com/authorize";
/// The redirect must match the value registered in the Spotify dashboard character for character, or
/// Spotify answers redirect_uri_mismatch and the flow never completes.
const SPOTIFY_REDIRECT_HOST: &str = "localhost";
const SPOTIFY_REDIRECT_PORT: u16 = 8888;
const SPOTIFY_REDIRECT_PATH: &str = "/callback";
/// Exactly the scopes the sidecar's calls need, and no more.
///
///   user-read-private, user-read-email          /v1/me
///   user-library-read                           /v1/me/tracks
///   user-library-modify                         PUT and DELETE /v1/me/tracks
///   playlist-read-private, playlist-read-collaborative
///                                               /v1/me/playlists, /v1/playlists/{id}/tracks
///
/// Search, track details and recommendations are public endpoints and need nothing added.
/// No playback scope: the app plays preview_url through its own audio element, so the Web Playback
/// SDK scopes would buy nothing.
const SPOTIFY_SCOPES: &str = "user-read-private user-read-email user-library-read user-library-modify playlist-read-private playlist-read-collaborative";

/// Label of the webview used for the YouTube Music authorization flow.
const YOUTUBE_WINDOW_LABEL: &str = "youtube-auth";
const YOUTUBE_AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
/// A different port from Spotify's on purpose: two windows both deciding to claim a callback on one
/// port would break each other, and one service would take the other down with it.
const YOUTUBE_REDIRECT_HOST: &str = "localhost";
/// Google may answer on the numeric form of the same address. Accepting it costs nothing.
const YOUTUBE_REDIRECT_LOOPBACK: &str = "127.0.0.1";
const YOUTUBE_REDIRECT_PORT: u16 = 8889;
const YOUTUBE_REDIRECT_PATH: &str = "/callback";
/// youtube.readonly is what the library and playlists need. openid, email and profile are for the
/// account name, which is the only piece of identity the app shows.
///
/// force-ssl is deliberately absent. It is what a rating write would need, and the app cannot play a
/// YouTube track's audio anyway, so asking for write access to someone's YouTube account would be a bad
/// trade for a feature that does not exist.
const YOUTUBE_SCOPES: &str = "https://www.googleapis.com/auth/youtube.readonly openid email profile";

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

/// The authorization code, captured from the redirect, waiting for the frontend to exchange it.
#[derive(Default)]
struct YoutubeOAuthState {
    code: Mutex<Option<String>>,
    error: Mutex<Option<String>>,
    done: Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeOAuthStatus {
    completed: bool,
    closed: bool,
    code: Option<String>,
    error: Option<String>,
}

#[derive(Default)]
struct SpotifyOAuthState {
    code: Mutex<Option<String>>,
    error: Mutex<Option<String>>,
    done: Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpotifyOAuthStatus {
    completed: bool,
    closed: bool,
    code: Option<String>,
    error: Option<String>,
}


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
    // The port is checked too: the host allowlist above says nothing about
    // `https://soundcloud.com:8443`, which is a different origin serving a different page.
    if url.scheme() != "https"
        || !allowed_host
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
    {
        return Err("SoundCloud вернул небезопасную ссылку проверки".to_owned());
    }

    // The session lives in the auth webview, not in main: main never loads
    // soundcloud.com, so reading its cookie store always came up empty.
    let baseline_cookie = match app
        .get_webview_window(AUTH_WINDOW_LABEL)
        .or_else(|| app.get_webview_window("main"))
    {
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
fn save_credentials(
    app: AppHandle,
    window: tauri::Window,
    token: String,
    client_id: String,
) -> Result<(), String> {
    // `mark_captcha_challenge_completed` right above this already checks its label; this one
    // did not, so any *.soundcloud.com page the window navigated to could hand over a token.
    if window.label() != AUTH_WINDOW_LABEL {
        return Err("сигнал входа получен не из окна авторизации".to_owned());
    }
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

/// Ends the embedded SoundCloud session on logout.
///
/// The auth webview runs with `incognito(false)` so sign-in can persist across launches.
/// That also means `soundcloud_session` outlives a logout, and the auth init script keeps
/// polling localStorage, so the next launch is signed back in with no user action. This
/// closes the window and deletes the cookies for the SoundCloud hosts.
#[tauri::command]
fn end_soundcloud_session(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        window
            .close()
            .map_err(|error| format!("не удалось закрыть окно SoundCloud: {error}"))?;
    }
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    // The session cookie and the anonymous id are the two that let the auth init script
    // recognise a signed-in page. Both are set on .soundcloud.com, so both are addressed
    // by domain rather than by host.
    //
    // Failures are logged and ignored on purpose: the Go side already dropped the token, and
    // refusing to sign out because a cookie could not be removed is the worse outcome.
    match window.cookies() {
        Ok(cookies) => {
            for cookie in cookies {
                let host = cookie.domain().unwrap_or_default().to_ascii_lowercase();
                if !(host == "soundcloud.com" || host.ends_with(".soundcloud.com")) {
                    continue;
                }
                let name = cookie.name().to_owned();
                if let Err(error) = window.delete_cookie(cookie) {
                    eprintln!("[session] delete {name} failed: {error}");
                }
            }
        }
        Err(error) => eprintln!("[session] could not read cookies: {error}"),
    }
    Ok(())
}

fn show_window(window: &WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

/// Whether a URL is the callback Google was told to redirect to.
fn is_youtube_redirect(url: &tauri::Url) -> bool {
    // Google sends loopback redirects as http://localhost:PORT or http://127.0.0.1:PORT, and which of
    // the two arrives is not something to rely on — accepting both costs nothing and refusing the
    // wrong one leaves the user staring at an error page.
    let host_matches = matches!(url.host_str(), Some(YOUTUBE_REDIRECT_HOST) | Some(YOUTUBE_REDIRECT_LOOPBACK));
    host_matches
        && url.port() == Some(YOUTUBE_REDIRECT_PORT)
        && url.path() == YOUTUBE_REDIRECT_PATH
}

/// Records what the redirect carried, or why it did not carry a code.
///
/// Google reports a declined consent screen as error=access_denied, the same as Spotify, and it is
/// reported as its own outcome so the panel can say the user cancelled rather than look stuck.
fn capture_youtube_redirect(app: &AppHandle, url: &tauri::Url) {
    let state = app.state::<YoutubeOAuthState>();
    let Ok(mut code) = state.code.lock() else { return };
    let Ok(mut error) = state.error.lock() else { return };
    let Ok(mut done) = state.done.lock() else { return };

    let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if let Some(reason) = params.get("error") {
        let detail = params
            .get("error_description")
            .cloned()
            .unwrap_or_else(|| reason.clone());
        *error = Some(detail);
    } else if let Some(value) = params.get("code") {
        if value.trim().is_empty() {
            *error = Some("Google вернул пустой код авторизации".to_owned());
        } else {
            *code = Some(value.clone());
        }
    } else {
        *error = Some("Google вернул перенаправление без кода и без ошибки".to_owned());
    }
    *done = true;
}

/// Opens Google's authorization page in its own webview.
#[tauri::command]
async fn start_youtube_auth(
    app: AppHandle,
    client_id: String,
    redirect_uri: String,
) -> Result<(), String> {
    let client_id = client_id.trim().to_owned();
    if client_id.is_empty() {
        return Err("не передан Client ID Google".to_owned());
    }
    if redirect_uri.trim().is_empty() {
        return Err("не передан Redirect URI Google".to_owned());
    }

    let mut url = YOUTUBE_AUTHORIZE_URL
        .parse::<tauri::Url>()
        .map_err(|error| format!("некорректный адрес авторизации Google: {error}"))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("client_id", &client_id);
        query.append_pair("response_type", "code");
        query.append_pair("redirect_uri", redirect_uri.trim());
        query.append_pair("scope", YOUTUBE_SCOPES);
        // Offline access is what produces a refresh token at all; without it Google hands over an
        // access token that dies in an hour and the user consents again every hour.
        query.append_pair("access_type", "offline");
        // Also needed on a repeat sign-in: Google will not re-issue a refresh token unless asked, so
        // signing out and back in would quietly leave the app unable to recover the session.
        query.append_pair("prompt", "consent");
        query.append_pair("include_granted_scopes", "true");
    }

    {
        let state = app.state::<YoutubeOAuthState>();
        let failure = "не удалось подготовить вход YouTube".to_owned();
        *state.code.lock().map_err(|_| failure.clone())? = None;
        *state.error.lock().map_err(|_| failure.clone())? = None;
        *state.done.lock().map_err(|_| failure)? = false;
    }

    if let Some(window) = app.get_webview_window(YOUTUBE_WINDOW_LABEL) {
        window
            .navigate(url)
            .map_err(|error| format!("не удалось загрузить страницу входа YouTube: {error}"))?;
        return show_window(&window);
    }

    // Async because creating a window deadlocks on Windows from a synchronous command.
    let handle = app.clone();
    let window = WebviewWindowBuilder::new(&app, YOUTUBE_WINDOW_LABEL, WebviewUrl::External(url))
        .title("YouTube Music — вход")
        .inner_size(560.0, 760.0)
        .min_inner_size(440.0, 560.0)
        .visible(true)
        .on_navigation(move |target| {
            if !is_youtube_redirect(target) {
                return true;
            }
            capture_youtube_redirect(&handle, target);
            // Cancelled: nothing is listening on the port, and loading it would flash a connection
            // error over the window moments before it closes.
            false
        })
        .build()
        .map_err(|error| format!("не удалось открыть окно входа YouTube: {error}"))?;
    show_window(&window)
}

/// Reports what the authorization window produced, and puts the window away once it has.
#[tauri::command]
async fn poll_youtube_auth(app: AppHandle) -> Result<YoutubeOAuthStatus, String> {
    let state = app.state::<YoutubeOAuthState>();
    let done = *state
        .done
        .lock()
        .map_err(|_| "не удалось прочитать состояние входа YouTube".to_owned())?;

    if !done {
        return Ok(YoutubeOAuthStatus {
            completed: false,
            closed: app.get_webview_window(YOUTUBE_WINDOW_LABEL).is_none(),
            code: None,
            error: None,
        });
    }

    let code = state
        .code
        .lock()
        .map_err(|_| "не удалось прочитать состояние входа YouTube".to_owned())?
        .take();
    let error = state
        .error
        .lock()
        .map_err(|_| "не удалось прочитать состояние входа YouTube".to_owned())?
        .take();

    // Hidden from here rather than from inside on_navigation, for the same reason as the Spotify window.
    if let Some(window) = app.get_webview_window(YOUTUBE_WINDOW_LABEL) {
        let _ = window.hide();
    }
    let failure = "не удалось сохранить результат входа YouTube".to_owned();
    *state.done.lock().map_err(|_| failure.clone())? = false;

    Ok(YoutubeOAuthStatus {
        completed: true,
        closed: true,
        code,
        error,
    })
}

/// Whether a URL is the callback Spotify was told to redirect to.
///
/// The port is part of the test, not an accident: the app has other localhost traffic, and blocking a
/// navigation to a different port would break it for no reason. A wrong port here also means the
/// dashboard and the app disagree, and that should fail loudly rather than hang.
fn is_spotify_redirect(url: &tauri::Url) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some(SPOTIFY_REDIRECT_HOST)
        && url.port() == Some(SPOTIFY_REDIRECT_PORT)
        && url.path() == SPOTIFY_REDIRECT_PATH
}

/// Records what the redirect carried, or why it did not carry a code.
///
/// Declining the consent screen is not a failure to hide: Spotify sends error=access_denied, and
/// reporting that as its own outcome is what lets the settings panel say the user cancelled rather
/// than sitting there looking like the flow is still running.
fn capture_spotify_redirect(app: &AppHandle, url: &tauri::Url) {
    let state = app.state::<SpotifyOAuthState>();
    let Ok(mut code) = state.code.lock() else { return };
    let Ok(mut error) = state.error.lock() else { return };
    let Ok(mut done) = state.done.lock() else { return };

    let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if let Some(reason) = params.get("error") {
        let detail = params
            .get("error_description")
            .cloned()
            .unwrap_or_else(|| reason.clone());
        *error = Some(detail);
    } else if let Some(value) = params.get("code") {
        if value.trim().is_empty() {
            *error = Some("Spotify вернул пустой код авторизации".to_owned());
        } else {
            *code = Some(value.clone());
        }
    } else {
        *error = Some("Spotify вернул перенаправление без кода и без ошибки".to_owned());
    }
    *done = true;
}

/// Opens Spotify's authorization page in its own webview.
#[tauri::command]
async fn start_spotify_auth(
    app: AppHandle,
    client_id: String,
    redirect_uri: String,
) -> Result<(), String> {
    let client_id = client_id.trim().to_owned();
    if client_id.is_empty() {
        return Err("не передан Client ID Spotify".to_owned());
    }
    let redirect_uri = redirect_uri.trim();
    if redirect_uri.is_empty() {
        return Err("не передан Redirect URI Spotify".to_owned());
    }

    // Built with the URL parser rather than by gluing strings together, so a client id holding an
    // unexpected character comes out escaped instead of producing a URL Spotify rejects with a
    // complaint about something else entirely.
    let mut url = SPOTIFY_AUTHORIZE_URL
        .parse::<tauri::Url>()
        .map_err(|error| format!("некорректный адрес авторизации Spotify: {error}"))?;
    url.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", SPOTIFY_SCOPES)
        .append_pair("show_dialog", "true");

    {
        let state = app.state::<SpotifyOAuthState>();
        let failure = "не удалось подготовить вход Spotify".to_owned();
        *state.code.lock().map_err(|_| failure.clone())? = None;
        *state.error.lock().map_err(|_| failure.clone())? = None;
        *state.done.lock().map_err(|_| failure)? = false;
    }

    if let Some(window) = app.get_webview_window(SPOTIFY_WINDOW_LABEL) {
        window
            .navigate(url)
            .map_err(|error| format!("не удалось загрузить страницу входа Spotify: {error}"))?;
        return show_window(&window);
    }

    // Creating a window deadlocks on Windows from a synchronous command, which is why this one is
    // async; the existing auth and captcha windows are async for the same reason.
    let handle = app.clone();
    let window = WebviewWindowBuilder::new(&app, SPOTIFY_WINDOW_LABEL, WebviewUrl::External(url))
        .title("Spotify — вход")
        .inner_size(520.0, 720.0)
        .min_inner_size(420.0, 560.0)
        .visible(true)
        .on_navigation(move |target| {
            if !is_spotify_redirect(target) {
                return true;
            }
            capture_spotify_redirect(&handle, target);
            // Cancelled on purpose. Nothing is listening on the port, and letting it through would
            // put a connection error page over the window moments before it closes.
            false
        })
        .build()
        .map_err(|error| format!("не удалось открыть окно входа Spotify: {error}"))?;
    show_window(&window)
}

/// Reports what the authorization window has produced, and puts the window away once it has.
///
/// The code is handed out once and then cleared. It is a single-use credential and it is about to be
/// exchanged in the sidecar; leaving it in memory for a second poll would hand the same code out
/// twice.
#[tauri::command]
async fn poll_spotify_auth(app: AppHandle) -> Result<SpotifyOAuthStatus, String> {
    let state = app.state::<SpotifyOAuthState>();
    let done = *state
        .done
        .lock()
        .map_err(|_| "не удалось прочитать состояние входа Spotify".to_owned())?;

    if !done {
        return Ok(SpotifyOAuthStatus {
            completed: false,
            closed: app.get_webview_window(SPOTIFY_WINDOW_LABEL).is_none(),
            code: None,
            error: None,
        });
    }

    let code = state
        .code
        .lock()
        .map_err(|_| "не удалось прочитать состояние входа Spotify".to_owned())?
        .take();
    let error = state
        .error
        .lock()
        .map_err(|_| "не удалось прочитать состояние входа Spotify".to_owned())?
        .take();

    // Hiding from here rather than from inside on_navigation: touching the window while it is
    // deciding whether to navigate is how the captcha window got its own separate poll command.
    if let Some(window) = app.get_webview_window(SPOTIFY_WINDOW_LABEL) {
        let _ = window.hide();
    }
    let failure = "не удалось сохранить результат входа Spotify".to_owned();
    *state.done.lock().map_err(|_| failure.clone())? = false;

    Ok(SpotifyOAuthStatus {
        completed: true,
        closed: true,
        code,
        error,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(CaptchaState::default())
        .manage(SpotifyOAuthState::default())
        .manage(YoutubeOAuthState::default())
        .invoke_handler(tauri::generate_handler![
            start_auth_flow,
            show_auth_window,
            show_captcha_window,
            poll_captcha_challenge,
            mark_captcha_challenge_completed,
            save_credentials,
            finish_auth_flow,
            end_soundcloud_session,
            start_spotify_auth,
            poll_spotify_auth,
            start_youtube_auth,
            poll_youtube_auth,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterSoundCloud");
}
