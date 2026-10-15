#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;

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
/// Spotify answers redirect_uri_mismatch and the flow never completes. The host is the IPv4 loopback
/// literal on purpose: Spotify stopped accepting "localhost" in April 2025 and allows loopback IPs only.
const SPOTIFY_REDIRECT_HOST: &str = "127.0.0.1";
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
/// Bundled OAuth credentials for one-click sign-in, baked at build time so the repository itself
/// stays secret-free:
///
///   BSC_YOUTUBE_CLIENT_ID / BSC_YOUTUBE_CLIENT_SECRET
///
/// Absent unless exported (dev builds included); release CI sets them from Actions secrets. A
/// Desktop-app client: Google documents installed apps as unable to keep secrets, so embedding is
/// the established pattern rather than a leak. The values are never logged and never persisted —
/// only held in memory for the exchange/refresh calls that need them.
///
/// Playback needs no YouTube scope at all: audio URLs are resolved locally through the bundled
/// yt-dlp sidecar. See YOUTUBE_SCOPES for what is asked for and why.
const YOUTUBE_BUNDLED_CLIENT_ID: Option<&str> = option_env!("BSC_YOUTUBE_CLIENT_ID");
const YOUTUBE_BUNDLED_CLIENT_SECRET: Option<&str> = option_env!("BSC_YOUTUBE_CLIENT_SECRET");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeBundledCredentials {
    client_id: String,
    client_secret: String,
    configured: bool,
}

/// Reports the bundled credentials without ever logging them. Empty strings when unconfigured —
/// the frontend then asks for user-provided keys instead of failing cryptically.
#[tauri::command]
fn youtube_bundled_credentials() -> YoutubeBundledCredentials {
    let client_id = YOUTUBE_BUNDLED_CLIENT_ID.unwrap_or("").trim().to_owned();
    let client_secret = YOUTUBE_BUNDLED_CLIENT_SECRET.unwrap_or("").trim().to_owned();
    let configured = !client_id.is_empty() && !client_secret.is_empty();
    YoutubeBundledCredentials { client_id, client_secret, configured }
}

/// Read plus rate.
///
/// force-ssl is here for one reason: videos.rate, the only write the app makes, needs it. It is a
/// narrower ask than youtube — no upload, no deletion — and it buys the heart button, which adds a
/// track to the liked playlist that the library is read from. Reading alone would leave the app able
/// to show a track and unable to keep it.
///
/// Adding a scope invalidates existing sessions: a user signed in before this will have to grant
/// it again, and the sidecar says so rather than returning an opaque 403 from the first like.
const YOUTUBE_SCOPES: &str =
    "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl \
openid email profile";

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

/// Resolves a direct audio URL for a YouTube video.
///
/// Two paths, fastest first. The primary one is a single Innertube player call with a VISIONOS
/// client (~0.2s): unlike the clients scrapers used to rely on, it answers direct audio URLs with
/// no signature deciphering. A pure-Rust extractor (rusty_ytdl 0.7.4) was tried and dropped — its
/// last release predates the current cipher, so every audio-only format comes back URL-less — and
/// the bundled yt-dlp sidecar stays as the fallback for whatever the fast path cannot do.
///
/// The URL is signed and expires after a few hours, so the frontend asks at play time and never
/// caches it past the current track.
#[tauri::command]
async fn youtube_audio_url(app: AppHandle, video_id: String) -> Result<String, String> {
    let video_id = video_id.trim().to_owned();
    if !is_youtube_video_id(&video_id) {
        return Err("некорректный идентификатор видео YouTube".to_owned());
    }
    let port = ensure_youtube_proxy(&app).await?;
    Ok(format!("http://127.0.0.1:{port}/audio?v={video_id}"))
}

/// Localhost audio proxy: the browser is served same-machine bytes while only Rust ever talks to
/// googlevideo.
///
/// Why: resolved googlevideo URLs work from curl and downloads, but the WebView gets 403 on them —
/// headers and cookies the extraction never had. Proxying removes the browser from that exchange
/// entirely. Localhost-only with a random port per launch, so nothing off-machine can use it; the
/// port itself is the token.
/// Disk cache for fixed audio files: keyed by video id, permanent until evicted. Unlike signed
/// URLs the content never expires, so a replayed track plays instantly — and the container is the
/// fixed progressive one, which is the actual root fix for the doubled timeline.
const YOUTUBE_CACHE_CAP_BYTES: u64 = 1024 * 1024 * 1024;

struct YoutubeProxy {
    port: u16,
    app: AppHandle,
    cache_dir: std::path::PathBuf,
}

static YOUTUBE_PROXY: tokio::sync::OnceCell<YoutubeProxy> = tokio::sync::OnceCell::const_new();

static YOUTUBE_DOWNLOADS: std::sync::LazyLock<
    tokio::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>,
> = std::sync::LazyLock::new(Default::default);

async fn ensure_youtube_proxy(app: &AppHandle) -> Result<u16, String> {
    let proxy = YOUTUBE_PROXY
        .get_or_try_init(|| async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|error| format!("аудио-прокси не стартовал: {error}"))?;
            let port = listener
                .local_addr()
                .map_err(|error| format!("аудио-прокси не стартовал: {error}"))?
                .port();
            tauri::async_runtime::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        break;
                    };
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = serve_youtube_audio(stream).await {
                            eprintln!("[youtube] proxy request failed: {error}");
                        }
                    });
                }
            });
            let cache_dir = app
                .path()
                .cache_dir()
                .map_err(|error| format!("кэш аудио недоступен: {error}"))?
                .join("youtube-audio");
            std::fs::create_dir_all(&cache_dir)
                .map_err(|error| format!("кэш аудио недоступен: {error}"))?;
            Ok::<_, String>(YoutubeProxy {
                port,
                app: app.clone(),
                cache_dir,
            })
        })
        .await?;
    Ok(proxy.port)
}

/// Returns the cached fixed file for a video, downloading it first when missing.
///
/// Concurrent requests for the same video share one download: the second one waits on the slot
/// and finds the file already there. The file outlives any signed URL by design — it is content,
/// so replays never re-resolve and never expire.
async fn ensure_audio_file(
    app: &AppHandle,
    cache_dir: &std::path::Path,
    video_id: &str,
) -> Result<std::path::PathBuf, String> {
    if let Some(path) = find_cached_audio(cache_dir, video_id) {
        return Ok(path);
    }
    let slot = {
        let mut slots = YOUTUBE_DOWNLOADS.lock().await;
        slots
            .entry(video_id.to_owned())
            .or_insert_with(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    };
    let result = async {
        let _guard = slot.lock().await;
        if let Some(path) = find_cached_audio(cache_dir, video_id) {
            return Ok(path);
        }
        download_youtube_audio(app, cache_dir, video_id).await?;
        prune_audio_cache(cache_dir);
        find_cached_audio(cache_dir, video_id).ok_or_else(|| "yt-dlp не сохранил файл".to_owned())
    }
    .await;
    // The slot served its purpose: waiters hold their own Arc, so dropping the map entry frees
    // the key without disturbing them.
    YOUTUBE_DOWNLOADS.lock().await.remove(video_id);
    result
}

/// Audio containers the downloader may leave behind. Anything else (notably `.part` fragments)
/// is ignored so a half-finished download never plays.
fn cached_audio_ext(name: &std::ffi::OsStr) -> Option<&str> {
    match name.to_str()?.rsplit('.').next()? {
        "m4a" | "mp4" => Some("m4a"),
        "webm" | "opus" => Some("webm"),
        "mp3" => Some("mp3"),
        _ => None,
    }
}

fn find_cached_audio(cache_dir: &std::path::Path, video_id: &str) -> Option<std::path::PathBuf> {
    let prefix = format!("{video_id}.");
    let mut best: Option<(bool, std::path::PathBuf)> = None;
    for entry in std::fs::read_dir(cache_dir).ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_str()?;
        if !name.starts_with(&prefix) {
            continue;
        }
        let path = entry.path();
        let ext = cached_audio_ext(path.extension()?)?;
        // m4a first: it is what the format selector asks for, and a stale webm from an older
        // selector must not shadow it.
        let candidate = (ext == "m4a", path);
        if best.as_ref().is_none_or(|current| candidate.0 && !current.0) {
            best = Some(candidate);
        }
    }
    best.map(|(_, path)| path)
}

/// Oldest-first eviction past the cap. Best-effort: a cache that cannot be pruned still plays.
fn prune_audio_cache(cache_dir: &std::path::Path) {
    let mut files: Vec<(u64, u64, std::path::PathBuf)> = Vec::new();
    for entry in std::fs::read_dir(cache_dir).into_iter().flatten().flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        files.push((mtime, meta.len(), entry.path()));
    }
    for victim in choose_evictions(files, YOUTUBE_CACHE_CAP_BYTES) {
        let _ = std::fs::remove_file(victim);
    }
}

/// Picks the eviction victims for tests and reviews: oldest paths whose sizes overflow the cap.
fn choose_evictions(
    mut files: Vec<(u64, u64, std::path::PathBuf)>,
    cap_bytes: u64,
) -> Vec<std::path::PathBuf> {
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let mut total: u64 = files.iter().map(|file| file.1).sum();
    let mut victims = Vec::new();
    for (_, size, path) in files {
        if total <= cap_bytes {
            break;
        }
        total = total.saturating_sub(size);
        victims.push(path);
    }
    victims
}

/// Serves one player request from the disk cache, downloading first when missing.
///
/// HTTP/1.1 with `Connection: close`: one request per connection is all an <audio> element needs.
/// Ranges are served from disk with 206s, so seeking works; long cache headers let the browser
/// reuse a preloaded head without revalidation.
async fn serve_youtube_audio(stream: tokio::net::TcpStream) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (mut reader, mut writer) = stream.into_split();

    let mut head = Vec::with_capacity(2048);
    let mut buf = [0u8; 1024];
    loop {
        if head.len() > 16384 {
            return respond_text(&mut writer, 431, "head too large").await;
        }
        let n = reader.read(&mut buf).await.map_err(|error| format!("read: {error}"))?;
        if n == 0 {
            return Err("connection closed".to_owned());
        }
        head.extend_from_slice(&buf[..n]);
        if head.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let head = String::from_utf8_lossy(&head);
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    if method != "GET" {
        return respond_text(&mut writer, 405, "method not allowed").await;
    }
    let Some(video_id) = audio_path_video_id(path) else {
        return respond_text(&mut writer, 404, "not found").await;
    };

    let range = lines
        .by_ref()
        .take_while(|line| !line.is_empty())
        .find_map(|line| {
            line.strip_prefix("Range:")
                .or_else(|| line.strip_prefix("range:"))
                .map(|value| value.trim().to_owned())
        });

    let proxy = YOUTUBE_PROXY.get().ok_or_else(|| "прокси не запущен".to_owned())?;
    let path = ensure_audio_file(&proxy.app, &proxy.cache_dir, &video_id).await?;
    let meta = tokio::fs::metadata(&path).await.map_err(|error| format!("файл: {error}"))?;
    let len = meta.len();
    if len == 0 {
        return respond_text(&mut writer, 502, "пустой файл").await;
    }
    let ext = path
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or("")
        .to_ascii_lowercase();

    // No Range: whole file. Bad Range: 416, as the spec wants — the element then retries sanely
    // instead of stalling on an answer it cannot use.
    let (status, content_range, body_range) = match range {
        None => (200, None, (0, len.saturating_sub(1))),
        Some(value) => match parse_range_header(&value, len) {
            Some((start, end)) => (
                206,
                Some(format!("bytes {start}-{end}/{len}")),
                (start, end),
            ),
            None => {
                return respond_range_unsatisfiable(&mut writer, len).await;
            }
        },
    };
    let reason = if status == 206 { "Partial Content" } else { "OK" };
    let body_len = body_range.1 - body_range.0 + 1;
    let etag = audio_etag(&meta);
    let mut response_head = format!("HTTP/1.1 {status} {reason}\r\n");
    response_head.push_str(&format!("Content-Type: {}\r\n", content_type_for_ext(&ext)));
    response_head.push_str(&format!("Content-Length: {body_len}\r\n"));
    if let Some(content_range) = content_range {
        response_head.push_str(&format!("Content-Range: {content_range}\r\n"));
    }
    response_head.push_str("Accept-Ranges: bytes\r\n");
    response_head.push_str("Cache-Control: public, max-age=31536000\r\n");
    response_head.push_str(&format!("ETag: \"{etag}\"\r\n"));
    response_head.push_str("Connection: close\r\n\r\n");
    writer
        .write_all(response_head.as_bytes())
        .await
        .map_err(|error| format!("write: {error}"))?;

    use tokio::io::AsyncSeekExt;
    let mut file = tokio::fs::File::open(&path).await.map_err(|error| format!("файл: {error}"))?;
    file.seek(std::io::SeekFrom::Start(body_range.0))
        .await
        .map_err(|error| format!("файл: {error}"))?;
    let mut remaining = body_len;
    let mut buf = vec![0u8; 262144];
    while remaining > 0 {
        let want = std::cmp::min(remaining, buf.len() as u64) as usize;
        let n = file.read(&mut buf[..want]).await.map_err(|error| format!("файл: {error}"))?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).await.map_err(|error| format!("write: {error}"))?;
        remaining -= n as u64;
    }
    writer.shutdown().await.map_err(|error| format!("write: {error}"))?;
    Ok(())
}

/// Parses a single `Range` header value against a known length. Returns the inclusive byte span.
/// Anything else (multiple ranges, suffix of zero, unsatisfiable) is None: the caller answers 200
/// or 416, never a multipart body an <audio> element would choke on.
fn parse_range_header(value: &str, len: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    if let Some(suffix) = spec.strip_prefix('-') {
        let count: u64 = suffix.trim().parse().ok()?;
        if count == 0 || len == 0 {
            return None;
        }
        let count = std::cmp::min(count, len);
        return Some((len - count, len - 1));
    }
    let (start_text, end_text) = spec.split_once('-')?;
    let start: u64 = start_text.trim().parse().ok()?;
    if start >= len {
        return None;
    }
    let end = if end_text.trim().is_empty() {
        len - 1
    } else {
        let end: u64 = end_text.trim().parse().ok()?;
        if end < start {
            return None;
        }
        std::cmp::min(end, len - 1)
    };
    Some((start, end))
}

fn content_type_for_ext(ext: &str) -> &'static str {
    match ext {
        "webm" | "opus" => "audio/webm",
        "mp3" => "audio/mpeg",
        "ogg" | "oga" => "audio/ogg",
        _ => "audio/mp4",
    }
}

fn audio_etag(meta: &std::fs::Metadata) -> String {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("{}-{mtime}", meta.len())
}

async fn respond_range_unsatisfiable(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    len: u64,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let response = format!(
        "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    writer.write_all(response.as_bytes()).await.map_err(|error| format!("write: {error}"))?;
    writer.shutdown().await.map_err(|error| format!("write: {error}"))?;
    Ok(())
}

/// Extracts and validates the video id from a proxy path (`/audio?v=XXXXXXXXXXX`, extra query
/// parameters tolerated). Anything else is not routable.
fn audio_path_video_id(path: &str) -> Option<String> {
    let (route, query) = path.split_once('?')?;
    if route != "/audio" {
        return None;
    }
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        if key == "v" && is_youtube_video_id(value) {
            return Some(value.to_owned());
        }
    }
    None
}

async fn respond_text(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    status: u16,
    body: &str,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let reason = match status {
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        431 => "Request Header Fields Too Large",
        502 => "Bad Gateway",
        _ => "",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    writer.write_all(response.as_bytes()).await.map_err(|error| format!("write: {error}"))?;
    writer.shutdown().await.map_err(|error| format!("write: {error}"))?;
    Ok(())
}



/// Downloads a video's audio into the cache with yt-dlp, which also fixes the container
/// (defragments the DASH MP4 into a progressive one with an honest moov).
///
/// m4a first: AAC in MP4 plays in every webview the app ships, opus-in-webm is the fallback.
/// `--no-overwrites` makes a repeated call for an existing file a no-op rather than a re-download.
async fn download_youtube_audio(
    app: &AppHandle,
    cache_dir: &std::path::Path,
    video_id: &str,
) -> Result<(), String> {
    let template = cache_dir.join(format!("{video_id}.%(ext)s"));
    let template = template.to_str().ok_or_else(|| "кэш аудио недоступен".to_owned())?.to_owned();
    let watch_url = format!("https://www.youtube.com/watch?v={video_id}");

    let args = [
        "--no-playlist",
        "--no-warnings",
        "--no-overwrites",
        "--socket-timeout",
        "15",
        "--retries",
        "2",
        "-f",
        "bestaudio[ext=m4a]/bestaudio",
        "-o",
        template.as_str(),
        &watch_url,
    ];
    let run = async {
        app.shell()
            .sidecar("yt-dlp")
            .map_err(|error| format!("не найден yt-dlp sidecar: {error}"))?
            .args(args)
            .output()
            .await
            .map_err(|error| format!("не удалось запустить yt-dlp: {error}"))
    };
    // A full media download takes longer than a URL resolve: extraction plus megabytes.
    let output = tokio::time::timeout(std::time::Duration::from_secs(300), run)
        .await
        .map_err(|_| "yt-dlp не ответил за 5 минут".to_owned())?
        .map_err(|error| error)?;

    if !output.status.success() {
        // yt-dlp names the cause itself (age gate, region block, removed video): surface its first
        // line rather than the whole log, and hint at the one fix the user controls — updating the
        // app refreshes the pinned yt-dlp when Google changes its player API. Partial fragments
        // are removed so they can never play.
        remove_partial_audio(cache_dir, video_id);
        let detail = String::from_utf8_lossy(&output.stderr);
        let first = detail.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or("неизвестная ошибка");
        return Err(format!("не удалось скачать аудио YouTube ({first}). Если ошибка повторяется, обновите приложение"));
    }
    Ok(())
}

fn remove_partial_audio(cache_dir: &std::path::Path, video_id: &str) {
    let prefix = format!("{video_id}.");
    for entry in std::fs::read_dir(cache_dir).into_iter().flatten().flatten() {
        let name = entry.file_name();
        if name.to_str().is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".part")) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// A YouTube video id is always 11 URL-safe characters. Anything else is a programming mistake on
/// the frontend — or an injection attempt through the sidecar args — and must not reach yt-dlp.
fn is_youtube_video_id(value: &str) -> bool {
    value.len() == 11 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
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
            youtube_audio_url,
            youtube_bundled_credentials,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterSoundCloud");
}

#[cfg(test)]
mod youtube_audio_tests {
    use super::*;

    #[test]
    fn video_id_validation() {
        assert!(is_youtube_video_id("h_D3VFfhvs4"));
        assert!(is_youtube_video_id("aqz-KE-bpKQ"));
        assert!(!is_youtube_video_id(""));
        assert!(!is_youtube_video_id("too-short"));
        assert!(!is_youtube_video_id("https://www.youtube.com/watch?v=h_D3VFfhvs4"));
        assert!(!is_youtube_video_id("h_D3VFfhvs4;rm -rf"));
    }

    #[test]
    fn proxy_path_parsing() {
        assert_eq!(audio_path_video_id("/audio?v=h_D3VFfhvs4").as_deref(), Some("h_D3VFfhvs4"));
        // Extra query parameters tolerated.
        assert_eq!(audio_path_video_id("/audio?v=h_D3VFfhvs4&x=1").as_deref(), Some("h_D3VFfhvs4"));
        assert_eq!(audio_path_video_id("/audio"), None);
        assert_eq!(audio_path_video_id("/video?v=h_D3VFfhvs4"), None);
        assert_eq!(audio_path_video_id("/audio?v=too-short"), None);
        assert_eq!(audio_path_video_id("/audio?v=h_D3VFfhvs4;rm"), None);
        assert_eq!(audio_path_video_id("/audio?x=1"), None);
    }

    #[test]
    fn range_parsing() {
        // Open, closed and suffix ranges against a 1000-byte file.
        assert_eq!(parse_range_header("bytes=0-499", 1000), Some((0, 499)));
        assert_eq!(parse_range_header("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range_header("bytes=-200", 1000), Some((800, 999)));
        // Clamped, not refused: the element asks past the end routinely.
        assert_eq!(parse_range_header("bytes=900-5000", 1000), Some((900, 999)));
        assert_eq!(parse_range_header("bytes=-5000", 1000), Some((0, 999)));
        // Refusals: past the end, reversed, empty suffix, multipart.
        assert_eq!(parse_range_header("bytes=1000-", 1000), None);
        assert_eq!(parse_range_header("bytes=500-100", 1000), None);
        assert_eq!(parse_range_header("bytes=-0", 1000), None);
        assert_eq!(parse_range_header("bytes=0-1,3-4", 1000), None);
        assert_eq!(parse_range_header("items=0-10", 1000), None);
    }

    #[test]
    fn content_types() {
        assert_eq!(content_type_for_ext("m4a"), "audio/mp4");
        assert_eq!(content_type_for_ext("mp4"), "audio/mp4");
        assert_eq!(content_type_for_ext("webm"), "audio/webm");
        assert_eq!(content_type_for_ext("opus"), "audio/webm");
        assert_eq!(content_type_for_ext("mp3"), "audio/mpeg");
        assert_eq!(content_type_for_ext("weird"), "audio/mp4");
    }

    #[test]
    fn eviction_picks_oldest_past_cap() {
        let files = vec![
            (10u64, 400u64, std::path::PathBuf::from("new")),
            (1u64, 400u64, std::path::PathBuf::from("old")),
            (5u64, 400u64, std::path::PathBuf::from("mid")),
        ];
        // 1200 bytes against a 1000 cap: only the oldest goes.
        assert_eq!(
            choose_evictions(files, 1000),
            vec![std::path::PathBuf::from("old")]
        );
        let files = vec![
            (10u64, 400u64, std::path::PathBuf::from("new")),
            (1u64, 400u64, std::path::PathBuf::from("old")),
        ];
        // Under the cap: nobody goes.
        assert!(choose_evictions(files, 1000).is_empty());
    }
}

#[cfg(test)]
mod youtube_bundled_tests {
    use super::*;

    #[test]
    fn bundled_credentials_shape_is_consistent() {
        // No values asserted: they depend on the build environment. The invariant is that
        // `configured` tells the truth, so the frontend never offers a one-click sign-in that
        // fails on empty keys — and secrets never reach any log (this command has no logging at
        // all by construction).
        let bundled = youtube_bundled_credentials();
        assert_eq!(
            bundled.configured,
            !bundled.client_id.trim().is_empty() && !bundled.client_secret.trim().is_empty()
        );
    }
}
