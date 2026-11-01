use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const SOUNDCLOUD_LOGIN_SCRIPT: &str = r#"(() => {
  let captured = false;
  let capturedClientId = '';
  let capturedToken = '';
  const inspect = (rawUrl, headers) => {
    if (captured) return;
    try {
      const url = new URL(rawUrl, location.href);
      if (url.hostname !== 'api-v2.soundcloud.com') return;
      capturedClientId ||= url.searchParams.get('client_id') || '';
      const auth = new Headers(headers).get('Authorization') || '';
      const match = auth.match(/^(?:OAuth|Bearer)\s+(.+)$/i);
      if (match) capturedToken ||= match[1];
      if (!capturedClientId || !capturedToken) return;
      captured = true;
      const callback = new URL('resonance://soundcloud-login');
      callback.searchParams.set('state', '__LOGIN_STATE__');
      callback.searchParams.set('client_id', capturedClientId);
      callback.searchParams.set('token', capturedToken);
      location.href = callback.toString();
    } catch (_) {}
  };
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const rawUrl = input instanceof Request ? input.url : input;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init && init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    inspect(rawUrl, headers);
    return originalFetch.apply(this, arguments);
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__soundcloudLoginUrl = url;
    this.__soundcloudLoginHeaders = new Headers();
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    try { this.__soundcloudLoginHeaders.set(name, value); } catch (_) {}
    inspect(this.__soundcloudLoginUrl, this.__soundcloudLoginHeaders);
    return originalSetHeader.apply(this, arguments);
  };
})();"#;

#[tauri::command]
fn start_soundcloud_login(app: AppHandle) -> Result<(), String> {
    let state = uuid::Uuid::new_v4().to_string();
    let login_script = SOUNDCLOUD_LOGIN_SCRIPT.replace("__LOGIN_STATE__", &state);
    let callback_app = app.clone();
    let callback_state = state.clone();
    WebviewWindowBuilder::new(
        &app,
        "soundcloud-login",
        WebviewUrl::External(
            "https://soundcloud.com/"
                .parse()
                .map_err(|error| format!("invalid SoundCloud URL: {error}"))?,
        ),
    )
    .title("Sign in to SoundCloud")
    .inner_size(1000.0, 760.0)
    .initialization_script(&login_script)
    .on_navigation(move |url| {
        if url.scheme() != "resonance" || url.host_str() != Some("soundcloud-login") {
            return true;
        }
        let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        if query.get("state") != Some(&callback_state) {
            return false;
        }
        let client_id = query.get("client_id").cloned().unwrap_or_default();
        let token = query.get("token").cloned().unwrap_or_default();
        if !client_id.is_empty() && !token.is_empty() {
            let _ = callback_app.emit(
                "soundcloud-auth-captured",
                serde_json::json!({ "clientId": client_id, "token": token }),
            );
        }
        if let Some(window) = callback_app.get_webview_window("soundcloud-login") {
            let _ = window.close();
        }
        false
    })
    .build()
    .map(|_| ())
    .map_err(|error| format!("could not open SoundCloud login: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| {
            if window.label() == "soundcloud-login"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                let _ = window.emit("soundcloud-login-cancelled", ());
            }
        })
        .invoke_handler(tauri::generate_handler![start_soundcloud_login])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
