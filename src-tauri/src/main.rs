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
/// Protected origin that owns the datadome cookie issued by the challenge.
const SOUNDCLOUD_ORIGIN: &str = "https://soundcloud.com";
/// How long the captcha window may take to hand out the cookie after the
/// challenge was reported as solved.
const CAPTCHA_COOKIE_GRACE_SECS: u64 = 20;

/// Observes the DataDome challenge inside the captcha webview.
///
/// DataDome picks its transport from the browser engine, so the very same
/// challenge is verified through fetch/XHR on WKWebView but through
/// navigator.sendBeacon on the Chromium based WebView2 runtime. All three
/// transports are patched, the script never gives up when the IPC bridge is not
/// ready yet, and a readable datadome cookie is used as a last resort.
const CAPTCHA_INIT_SCRIPT: &str = r#"
(() => {
  const LOG = '[bsc-captcha]';
  const nativeFetch = window.fetch;
  const nativeSendBeacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  const XHR = window.XMLHttpRequest;
  const initialUrl = String(window.location.href);
  let reported = false;
  let reportedAgent = false;
  let bridgeTries = 0;
  let queued = [];

  // The IPC bridge is not guaranteed to exist at document-start on every
  // platform, so resolve it lazily and replay whatever was buffered.
  function bridge() {
    const internals = window.__TAURI_INTERNALS__;
    return internals && typeof internals.invoke === 'function' ? internals : null;
  }

  function send(command, args) {
    const target = bridge();
    if (target) {
      target.invoke(command, args || {}).catch((error) => {
        console.warn(LOG, 'invoke failed', command, error);
      });
      return;
    }
    queued.push([command, args]);
    if (bridgeTries++ < 40) window.setTimeout(retry, 250);
  }

  function retry() {
    const target = bridge();
    if (!target) {
      if (bridgeTries++ < 40) window.setTimeout(retry, 250);
      else console.warn(LOG, 'IPC bridge never became available');
      return;
    }
    const pending = queued;
    queued = [];
    for (const [command, args] of pending) {
      target.invoke(command, args || {}).catch((error) => {
        console.warn(LOG, 'deferred invoke failed', command, error);
      });
    }
  }

  // The Go sidecar replays the like request with this agent, so the retry has
  // to present the same browser identity that solved the challenge.
  function reportUserAgent() {
    if (reportedAgent) return;
    reportedAgent = true;
    const agent = String(navigator.userAgent || '');
    console.log(LOG, 'agent', agent);
    send('save_captcha_user_agent', { userAgent: agent });
  }

  function isChallengeHost(host) {
    return host === 'captcha-delivery.com'
      || host.endsWith('.captcha-delivery.com')
      || host === 'soundcloud.com'
      || host.endsWith('.soundcloud.com');
  }

  // DataDome posts the solved challenge to a check endpoint whose exact shape
  // differs per engine, so the query string is inspected as well.
  function isCheckRequest(raw) {
    if (!raw) return false;
    let url;
    try {
      url = new URL(String(raw), window.location.href);
    } catch (error) {
      return false;
    }
    if (url.protocol !== 'https:' || !isChallengeHost(url.hostname.toLowerCase())) return false;
    if (String(raw) === initialUrl) return false;
    const haystack = (url.pathname + url.search).toLowerCase();
    return haystack.includes('/check') || haystack.includes('check?') || haystack.includes('challenge');
  }

  function reportCheck(raw, status, transport) {
    if (reported || !isCheckRequest(raw)) return;
    // DataDome itself treats any 2xx/3xx as a solved challenge: the check often
    // answers with a redirect to the protected origin, which is how the
    // datadome cookie gets set. Rejecting 3xx here meant the poll never saw the
    // challenge as finished.
    if (status != null && (status < 200 || status >= 400)) return;
    reported = true;
    console.log(LOG, 'challenge verified via', transport, String(raw), status);
    send('mark_captcha_challenge_completed');
  }

  // A verified challenge also makes the datadome cookie readable, which covers
  // transports that cannot be observed at all.
  function datadomeCookie() {
    try {
      const match = document.cookie.match(/(?:^|;\s*)datadome=([^;]*)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch (error) {
      return null;
    }
  }

  // DataDome answers a blocked address with a static "access limited" page
  // instead of a puzzle. There is nothing to solve there, so the window would
  // otherwise sit until the poll times out.
  function isBlockedPage() {
    if (document.querySelector('#captcha__element, .sliderContainer')) return false;
    const text = (document.body && document.body.innerText) || '';
    return /(\\u0434\\u043e\\u0441\\u0442\\u0443\\u043f \\u0432\\u0440\\u0435\\u043c\\u0435\\u043d\\u043d\\u043e \\u043e\\u0433\\u0440\\u0430\\u043d\\u0438\\u0447\\u0435\\u043d|\\u0432\\u0440\\u0435\\u043c\\u0435\\u043d\\u043d\\u043e \\u043e\\u0433\\u0440\\u0430\\u043d\\u0438\\u0447\\u0435\\u043d\\u043e|access (temporarily )?limited|\\u0440\\u0430\\u0431\\u043e\\u0442)/i.test(text);
  }

  function watchBlocked() {
    if (reported) return;
    if (!isBlockedPage()) return;
    reported = true;
    console.warn(LOG, 'challenge unavailable: the address is blocked by DataDome');
    send('mark_captcha_unavailable', { reason: 'blocked' });
  }

  function watchCookie() {
    if (reported || !datadomeCookie()) return;
    reported = true;
    console.log(LOG, 'challenge verified via datadome cookie');
    send('mark_captcha_challenge_completed');
  }

  if (typeof nativeFetch === 'function') {
    window.fetch = function (input) {
      const url = typeof input === 'string' ? input : input && input.url;
      return nativeFetch.apply(this, arguments).then((response) => {
        reportCheck(url, response.status, 'fetch');
        return response;
      }, (error) => {
        console.warn(LOG, 'fetch failed', url, error);
        throw error;
      });
    };
  }

  if (nativeSendBeacon) {
    navigator.sendBeacon = function (url) {
      try {
        reportCheck(typeof url === 'string' ? url : url && url.url, null, 'sendBeacon');
      } catch (error) { /* never break the page */ }
      return nativeSendBeacon.apply(navigator, arguments);
    };
  }

  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__bscCaptchaUrl = url;
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      this.addEventListener('loadend', () => reportCheck(this.__bscCaptchaUrl, this.status, 'xhr'), { once: true });
      return send.apply(this, arguments);
    };
  }

  reportUserAgent();
  window.setInterval(watchCookie, 1000);
  window.setInterval(watchBlocked, 1500);
  window.addEventListener('load', watchCookie);
  window.addEventListener('load', watchBlocked);
  window.addEventListener('pageshow', watchCookie);
  window.addEventListener('pageshow', watchBlocked);
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

/// Mutable captcha progress shared between the commands below.
#[derive(Default)]
struct CaptchaState {
    baseline_datadome_cookie: Mutex<Option<String>>,
    challenge_passed: Mutex<bool>,
    /// Set once the captcha window was sent to the protected origin, which is
    /// what makes the datadome cookie for soundcloud.com readable.
    cookie_visit_started: Mutex<Option<std::time::Instant>>,
    /// Browser identity that solved the challenge, replayed by the sidecar.
    user_agent: Mutex<Option<String>>,
    /// Set when the challenge page reports that it cannot be solved at all.
    unavailable: Mutex<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptchaChallengeStatus {
    completed: bool,
    closed: bool,
    datadome_cookie: Option<String>,
    user_agent: Option<String>,
    unavailable: Option<String>,
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
        return Err("SoundCloud вернул небезопасная ссылка проверки".to_owned());
    }

    // Reading cookies off the UI thread is unreliable on Windows, so a failure
    // here only costs the extra fallback signal, not the whole challenge flow.
    let baseline_cookie = match app.get_webview_window("main") {
        Some(window) => datadome_cookie_for(&window).unwrap_or_else(|error| {
            eprintln!("[captcha] baseline cookie unavailable: {error}");
            None
        }),
        None => None,
    };
    eprintln!(
        "[captcha] challenge opened host={host} baseline_datadome={}",
        baseline_cookie.is_some()
    );

    let state = app.state::<CaptchaState>();
    *state
        .baseline_datadome_cookie
        .lock()
        .map_err(|_| "не удалось проверить состояние капчи".to_owned())? = baseline_cookie;
    *state
        .challenge_passed
        .lock()
        .map_err(|_| "не удалось проверить состояние капчи".to_owned())? = false;
    *state
        .cookie_visit_started
        .lock()
        .map_err(|_| "не удалось проверить состояние капчи".to_owned())? = None;
    *state
        .user_agent
        .lock()
        .map_err(|_| "не удалось проверить состояние капчи".to_owned())? = None;
    *state
        .unavailable
        .lock()
        .map_err(|_| "не удалось проверить состояние капчи".to_owned())? = None;

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
        // WebView2 runs the DataDome check inside a cross-origin iframe, which a
        // main-frame-only script would never observe.
        .initialization_script_for_all_frames(CAPTCHA_INIT_SCRIPT)
        .build()
        .map(|_| ())
        .map_err(|error| format!("не удалось открыть проверку SoundCloud: {error}"))
}

/// Returns the updated DataDome cookie after the challenge is completed.
#[tauri::command]
async fn poll_captcha_challenge(app: AppHandle) -> Result<CaptchaChallengeStatus, String> {
    let state = app.state::<CaptchaState>();
    let user_agent = state
        .user_agent
        .lock()
        .map_err(|_| "не удалось прочитать состояние капчи".to_owned())?
        .clone();

    let unavailable = state
        .unavailable
        .lock()
        .map_err(|_| "не удалось прочитать состояние капчи".to_owned())?
        .clone();

    let Some(window) = app.get_webview_window(CAPTCHA_WINDOW_LABEL) else {
        return Ok(CaptchaChallengeStatus {
            completed: false,
            closed: true,
            datadome_cookie: None,
            user_agent,
            unavailable,
        });
    };

    if let Some(reason) = unavailable.as_deref() {
        // DataDome refused to serve a solvable challenge, so waiting longer
        // cannot help. Close the window and tell the caller why.
        eprintln!("[captcha] challenge unavailable: {reason}");
        window
            .close()
            .map_err(|error| format!("не удалось закрыть проверку SoundCloud: {error}"))?;
        return Ok(CaptchaChallengeStatus {
            completed: false,
            closed: false,
            datadome_cookie: None,
            user_agent,
            unavailable: Some(reason.to_owned()),
        });
    }

    let current_cookie = datadome_cookie_for(&window).unwrap_or_else(|error| {
        eprintln!("[captcha] cookie read failed: {error}");
        None
    });
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

    if challenge_passed {
        // DataDome only releases the datadome cookie for the protected origin, so
        // the window has to actually visit soundcloud.com before that cookie can
        // be read back. Keep polling until it appears or the grace expires.
        let mut started = state
            .cookie_visit_started
            .lock()
            .map_err(|_| "не удалось проверить состояние капчи".to_owned())?;
        if started.is_none() {
            eprintln!("[captcha] solved, visiting protected origin for the cookie");
            match SOUNDCLOUD_ORIGIN.parse::<tauri::Url>() {
                Ok(origin) => {
                    if let Err(error) = window.navigate(origin) {
                        eprintln!("[captcha] cookie visit failed to start: {error}");
                    }
                }
                Err(error) => eprintln!("[captcha] bad protected origin: {error}"),
            }
            *started = Some(std::time::Instant::now());
        } else if cookie_changed
            || started
                .as_ref()
                .is_some_and(|at| at.elapsed().as_secs() >= CAPTCHA_COOKIE_GRACE_SECS)
        {
            let cookie = current_cookie.or(baseline_cookie);
            eprintln!(
                "[captcha] completed datadome={} cookie_change={cookie_changed}",
                cookie.is_some()
            );
            *started = None;
            drop(started);
            window
                .close()
                .map_err(|error| format!("не удалось закрыть проверку SoundCloud: {error}"))?;
            return Ok(CaptchaChallengeStatus {
                completed: true,
                closed: false,
                datadome_cookie: cookie,
                user_agent,
                unavailable: None,
            });
        }

        return Ok(CaptchaChallengeStatus {
            completed: false,
            closed: false,
            datadome_cookie: None,
            user_agent,
            unavailable: None,
        });
    }

    if cookie_changed {
        eprintln!("[captcha] completed via datadome cookie change");
        window
            .close()
            .map_err(|error| format!("не удалось закрыть проверку SoundCloud: {error}"))?;
        return Ok(CaptchaChallengeStatus {
            completed: true,
            closed: false,
            datadome_cookie: current_cookie,
            user_agent,
            unavailable: None,
        });
    }

    Ok(CaptchaChallengeStatus {
        completed: false,
        closed: false,
        datadome_cookie: None,
        user_agent,
        unavailable: None,
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
    let mut passed = state
        .challenge_passed
        .lock()
        .map_err(|_| "не удалось сохранить результат проверки".to_owned())?;
    if !*passed {
        eprintln!("[captcha] webview reported a solved challenge");
    }
    *passed = true;
    Ok(())
}

/// Keeps the browser identity that solved the challenge so the Go sidecar can
/// replay the like request with a matching User-Agent.
#[tauri::command]
fn save_captcha_user_agent(
    window: WebviewWindow,
    state: State<'_, CaptchaState>,
    user_agent: String,
) -> Result<(), String> {
    if window.label() != CAPTCHA_WINDOW_LABEL {
        return Err("User-Agent прислан не из окна капчи".to_owned());
    }
    let agent = user_agent.trim();
    // A browser agent becomes a header value, so keep it printable, single-line
    // and bounded before it is handed to the sidecar.
    if agent.is_empty()
        || agent.len() > 512
        || agent.chars().any(|character| character.is_control())
    {
        return Err("SoundCloud вернул некорректный User-Agent".to_owned());
    }
    eprintln!("[captcha] user agent captured ({agent})");
    *state
        .user_agent
        .lock()
        .map_err(|_| "не удалось сохранить User-Agent проверки".to_owned())? =
        Some(agent.to_owned());
    Ok(())
}

/// Reads the DataDome cookie for the protected origin. Callers log the failure
/// so a platform specific cookie hiccup cannot abort the challenge.
fn datadome_cookie_for(window: &WebviewWindow) -> Result<Option<String>, String> {
    let url = SOUNDCLOUD_ORIGIN
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

/// Reports that the challenge page cannot be solved, for example because the
/// address is rate limited by DataDome. Polling stops instead of timing out.
#[tauri::command]
fn mark_captcha_unavailable(
    window: WebviewWindow,
    state: State<'_, CaptchaState>,
    reason: String,
) -> Result<(), String> {
    if window.label() != CAPTCHA_WINDOW_LABEL {
        return Err("сигнал недоступности получен не из окна капчи".to_owned());
    }
    let reason = reason.trim();
    if reason.is_empty() || reason.len() > 64 || reason.chars().any(|c| c.is_control()) {
        return Err("некорректная причина недоступности проверки".to_owned());
    }
    *state
        .unavailable
        .lock()
        .map_err(|_| "не удалось сохранить состояние проверки".to_owned())? = Some(reason.to_owned());
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(CaptchaState::default())
        .invoke_handler(tauri::generate_handler![
            start_auth_flow,
            show_auth_window,
            show_captcha_window,
            poll_captcha_challenge,
            mark_captcha_challenge_completed,
            save_captcha_user_agent,
            mark_captcha_unavailable,
            save_credentials,
            finish_auth_flow
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterSoundCloud");
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

