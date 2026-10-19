use audio_core::{AudioPlayer, DspSettings, PlaybackSnapshot};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::{Emitter, Manager, Runtime, WebviewWindow};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum LaunchAction {
    ToggleImmersive,
    CloseImmersive,
    PlayPause,
    Next,
    Previous,
    Navigate { route: String },
    FocusWindow,
}

pub fn parse_launch_action<I, S>(arguments: I) -> Option<LaunchAction>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    arguments
        .into_iter()
        .find_map(|argument| match argument.as_ref() {
            "--immersive" => Some(LaunchAction::ToggleImmersive),
            "--close-immersive" => Some(LaunchAction::CloseImmersive),
            "--play-pause" => Some(LaunchAction::PlayPause),
            "--next" => Some(LaunchAction::Next),
            "--previous" => Some(LaunchAction::Previous),
            "home" | "playlists" | "songs" => Some(LaunchAction::Navigate {
                route: argument.as_ref().to_owned(),
            }),
            _ => None,
        })
}

#[tauri::command]
fn initial_action(action: tauri::State<'_, Option<LaunchAction>>) -> Option<LaunchAction> {
    action.inner().clone()
}

#[tauri::command]
fn report_error<R: Runtime>(app: tauri::AppHandle<R>, message: String) -> Result<(), String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Error message must not be empty".into());
    }
    app.emit("app-error", message.to_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
async fn play_local_file(
    path: String,
    player: tauri::State<'_, AudioPlayer>,
) -> Result<(), String> {
    let player = player.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        player
            .play_file(path, DspSettings::default())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn spectrum_set_enabled(enabled: bool, player: tauri::State<'_, AudioPlayer>) {
    player.set_spectrum_enabled(enabled);
}

#[tauri::command]
fn spectrum_enable(player: tauri::State<'_, AudioPlayer>) {
    player.set_spectrum_enabled(true);
}

#[tauri::command]
fn spectrum_levels(player: tauri::State<'_, AudioPlayer>) -> Vec<f32> {
    player.spectrum().levels()
}

#[tauri::command]
async fn crossfade_local_file(
    path: String,
    crossfade_ms: u64,
    player: tauri::State<'_, AudioPlayer>,
) -> Result<(), String> {
    let player = player.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        player
            .crossfade_to(
                path,
                DspSettings::default(),
                std::time::Duration::from_millis(crossfade_ms),
            )
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn preload_next_local(player: tauri::State<'_, AudioPlayer>) -> Result<bool, String> {
    let player = player.inner().clone();
    tauri::async_runtime::spawn_blocking(move || player.preload_next().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn playback_snapshot(player: tauri::State<'_, AudioPlayer>) -> PlaybackSnapshot {
    player.snapshot()
}

#[tauri::command]
fn playback_pause(player: tauri::State<'_, AudioPlayer>) {
    player.pause();
}

#[tauri::command]
fn playback_resume(player: tauri::State<'_, AudioPlayer>) {
    player.resume();
}

#[tauri::command]
fn playback_next(player: tauri::State<'_, AudioPlayer>) {
    let player = player.inner().clone();
    let app = player.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match player.next_queued(
            DspSettings::default(),
            std::time::Duration::from_millis(500),
        ) {
            Ok(true) => Ok(()),
            Ok(false) => {
                app.next_track();
                Ok(())
            }
            Err(error) => Err(error.to_string()),
        }
    });
}

#[tauri::command]
fn queue_local_files(paths: Vec<String>, player: tauri::State<'_, AudioPlayer>) {
    for path in paths {
        player.enqueue(path);
    }
}

#[tauri::command]
fn local_queue(player: tauri::State<'_, AudioPlayer>) -> Vec<String> {
    player.queue()
}

#[tauri::command]
fn playback_stop(player: tauri::State<'_, AudioPlayer>) {
    player.stop();
}

#[tauri::command]
fn playback_seek(position_ms: u64, player: tauri::State<'_, AudioPlayer>) -> Result<(), String> {
    player.seek(position_ms)
}

#[tauri::command]
fn playback_set_volume(volume: f32, player: tauri::State<'_, AudioPlayer>) -> Result<(), String> {
    player.set_volume(volume)
}

#[tauri::command]
fn playback_set_speed(tempo: f32, player: tauri::State<'_, AudioPlayer>) -> Result<(), String> {
    player.set_dsp_settings(DspSettings {
        tempo,
        ..DspSettings::default()
    })
}

#[tauri::command]
fn playback_set_equalizer(
    gains: [f32; audio_core::EQ_BAND_COUNT],
    player: tauri::State<'_, AudioPlayer>,
) -> Result<(), String> {
    player.set_equalizer(DspSettings {
        gains_db: gains,
        ..DspSettings::default()
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial = parse_launch_action(std::env::args().skip(1));
    let playback = AudioPlayer::new();
    let playback_worker = playback.clone();
    let shutdown = Arc::new(AtomicBool::new(false));
    let worker_shutdown = Arc::clone(&shutdown);
    let _ = std::thread::Builder::new()
        .name("resonance-playback-queue".into())
        .spawn(move || {
            while !worker_shutdown.load(Ordering::Acquire) {
                let _ = playback_worker.advance_if_finished(
                    DspSettings::default(),
                    std::time::Duration::from_millis(500),
                );
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        });
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let action =
                parse_launch_action(argv.iter().skip(1)).unwrap_or(LaunchAction::FocusWindow);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit("launch-action", action);
        }))
        .manage(initial)
        .manage(playback)
        .invoke_handler(tauri::generate_handler![
            initial_action,
            report_error,
            minimize_window,
            toggle_maximize_window,
            close_window,
            play_local_file,
            crossfade_local_file,
            playback_snapshot,
            playback_pause,
            playback_resume,
            playback_next,
            queue_local_files,
            local_queue,
            preload_next_local,
            playback_stop,
            playback_seek,
            playback_set_volume,
            playback_set_speed,
            playback_set_equalizer,
            spectrum_set_enabled,
            spectrum_enable,
            spectrum_levels
        ])
        .setup(|app| {
            let config = app.path().app_config_dir()?;
            std::fs::create_dir_all(config)?;
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, SubmenuBuilder};
                let app_menu = SubmenuBuilder::new(app, "Resonance")
                    .about(None)
                    .separator()
                    .text("settings", "Settings...")
                    .separator()
                    .quit()
                    .build()?;
                let menu = MenuBuilder::new(app).item(&app_menu).build()?;
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    if event.id() == "settings" {
                        let _ = app.emit("open-settings", ());
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Resonance");
}

#[cfg(test)]
mod tests {
    use super::{LaunchAction, parse_launch_action};

    #[test]
    fn parses_legacy_cli_actions_and_routes() {
        assert_eq!(
            parse_launch_action(["--immersive"]),
            Some(LaunchAction::ToggleImmersive)
        );
        assert_eq!(
            parse_launch_action(["--close-immersive"]),
            Some(LaunchAction::CloseImmersive)
        );
        assert_eq!(
            parse_launch_action(["--play-pause"]),
            Some(LaunchAction::PlayPause)
        );
        assert_eq!(parse_launch_action(["--next"]), Some(LaunchAction::Next));
        assert_eq!(
            parse_launch_action(["--previous"]),
            Some(LaunchAction::Previous)
        );
        assert_eq!(
            parse_launch_action(["home"]),
            Some(LaunchAction::Navigate {
                route: "home".into()
            })
        );
        assert_eq!(
            parse_launch_action(["playlists"]),
            Some(LaunchAction::Navigate {
                route: "playlists".into()
            })
        );
        assert_eq!(
            parse_launch_action(["songs"]),
            Some(LaunchAction::Navigate {
                route: "songs".into()
            })
        );
        assert_eq!(parse_launch_action(["--unknown"]), None);
    }
}
