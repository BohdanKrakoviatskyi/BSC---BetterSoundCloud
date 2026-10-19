use audio_core::{AudioPlayer, DspSettings, PlaybackSnapshot};
use library::{
    LocalLibrary, LocalPlaylist, LocalPlaylistStore, Song, TagEdits, read_local_tags_with_artwork,
    write_local_tags,
};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tauri::{Emitter, Manager, Runtime, WebviewWindow};

struct LibraryState {
    library: Arc<std::sync::Mutex<LocalLibrary>>,
    playlists: Arc<std::sync::Mutex<LocalPlaylistStore>>,
    artwork_dir: std::path::PathBuf,
    playlist_artwork_dir: std::path::PathBuf,
    scanning: Arc<AtomicUsize>,
}

fn run_library_scan<T>(
    scanning: &AtomicUsize,
    scan: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    struct ScanGuard<'a>(&'a AtomicUsize);
    impl Drop for ScanGuard<'_> {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::AcqRel);
        }
    }

    scanning.fetch_add(1, Ordering::AcqRel);
    let _guard = ScanGuard(scanning);
    scan()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSongView {
    #[serde(flatten)]
    song: Song,
    artwork_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPlaylistView {
    #[serde(flatten)]
    playlist: LocalPlaylist,
    artwork_url: Option<String>,
}

#[tauri::command]
fn local_playlists(
    state: tauri::State<'_, LibraryState>,
) -> Result<Vec<LocalPlaylistView>, String> {
    let artwork_dir = &state.inner().playlist_artwork_dir;
    let playlists = state
        .inner()
        .playlists
        .lock()
        .map_err(|_| "playlist lock poisoned")?;
    Ok(playlists
        .playlists()
        .iter()
        .cloned()
        .map(|playlist| {
            let artwork_url = playlist.artwork_path.as_ref().and_then(|path| {
                let directory = std::fs::canonicalize(artwork_dir).ok()?;
                let path = std::fs::canonicalize(path).ok()?;
                if !path.starts_with(directory) {
                    return None;
                }
                let bytes = std::fs::read(&path).ok()?;
                let mime = if path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
                {
                    "image/png"
                } else {
                    "image/jpeg"
                };
                Some(format!("data:{mime};base64,{}", base64_encode(&bytes)))
            });
            LocalPlaylistView {
                playlist,
                artwork_url,
            }
        })
        .collect())
}

#[tauri::command]
fn local_playlist_create(
    name: String,
    state: tauri::State<'_, LibraryState>,
) -> Result<LocalPlaylist, String> {
    let mut playlists = state
        .inner()
        .playlists
        .lock()
        .map_err(|_| "playlist lock poisoned")?;
    playlists
        .create(&name, "", &[])
        .cloned()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn local_playlist_update(
    id: String,
    name: String,
    description: String,
    artwork: Option<Vec<u8>>,
    state: tauri::State<'_, LibraryState>,
) -> Result<(), String> {
    state
        .inner()
        .playlists
        .lock()
        .map_err(|_| "playlist lock poisoned")?
        .update(&id, &name, &description, artwork.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn local_playlist_add_songs(
    id: String,
    songs: Vec<Song>,
    state: tauri::State<'_, LibraryState>,
) -> Result<usize, String> {
    state
        .inner()
        .playlists
        .lock()
        .map_err(|_| "playlist lock poisoned")?
        .add_songs(&id, &songs)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn local_playlist_delete(
    id: String,
    state: tauri::State<'_, LibraryState>,
) -> Result<bool, String> {
    state
        .inner()
        .playlists
        .lock()
        .map_err(|_| "playlist lock poisoned")?
        .delete(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn local_playlist_remove_song(
    id: String,
    uri: String,
    state: tauri::State<'_, LibraryState>,
) -> Result<usize, String> {
    state
        .inner()
        .playlists
        .lock()
        .map_err(|_| "playlist lock poisoned")?
        .remove_uri(&id, &uri)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn local_playlist_reorder(
    id: String,
    uris: Vec<String>,
    state: tauri::State<'_, LibraryState>,
) -> Result<(), String> {
    state
        .inner()
        .playlists
        .lock()
        .map_err(|_| "playlist lock poisoned")?
        .reorder(&id, &uris)
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLibraryStatus {
    sources: Vec<String>,
    song_count: usize,
    scanning: bool,
}

#[tauri::command]
fn local_library_sources(state: tauri::State<'_, LibraryState>) -> Result<Vec<String>, String> {
    let state = state
        .inner()
        .library
        .lock()
        .map_err(|_| "local library lock poisoned")?;
    Ok(state
        .sources()
        .iter()
        .map(|source| source.path().to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
fn local_library_songs(
    state: tauri::State<'_, LibraryState>,
) -> Result<Vec<LocalSongView>, String> {
    let app_state = state.inner();
    let library = app_state
        .library
        .lock()
        .map_err(|_| "local library lock poisoned")?;
    let artwork_dir = &app_state.artwork_dir;
    Ok(library
        .songs()
        .iter()
        .cloned()
        .map(|song| {
            let artwork_url = song.artwork_path.as_ref().and_then(|artwork_path| {
                let is_cached = artwork_path.starts_with(artwork_dir);
                let is_adjacent = artwork_path.parent() == song.path.parent();
                if !is_cached && !is_adjacent {
                    return None;
                }
                let bytes = std::fs::read(artwork_path).ok()?;
                let mime = match artwork_path
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase()
                    .as_str()
                {
                    "png" => "image/png",
                    "webp" => "image/webp",
                    "gif" => "image/gif",
                    "bmp" => "image/bmp",
                    _ => "image/jpeg",
                };
                Some(format!("data:{mime};base64,{}", base64_encode(&bytes)))
            });
            LocalSongView { song, artwork_url }
        })
        .collect())
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        output.push(TABLE[(first >> 2) as usize] as char);
        output.push(TABLE[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        output.push(if chunk.len() > 1 {
            TABLE[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            TABLE[(third & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    output
}

#[tauri::command]
fn local_library_status(
    state: tauri::State<'_, LibraryState>,
) -> Result<LocalLibraryStatus, String> {
    let scanning = state.inner().scanning.load(Ordering::Acquire) != 0;
    let library = state
        .inner()
        .library
        .lock()
        .map_err(|_| "local library lock poisoned")?;
    Ok(LocalLibraryStatus {
        sources: library
            .sources()
            .iter()
            .map(|source| source.path().to_string_lossy().into_owned())
            .collect(),
        song_count: library.songs().len(),
        scanning,
    })
}
#[tauri::command]
async fn local_library_set_sources(
    app: tauri::AppHandle,
    sources: Vec<String>,
    state: tauri::State<'_, LibraryState>,
) -> Result<(), String> {
    let library = Arc::clone(&state.inner().library);
    let scanning = Arc::clone(&state.inner().scanning);
    tauri::async_runtime::spawn_blocking(move || {
        let result = run_library_scan(&scanning, || {
            let mut library = library.lock().map_err(|_| "local library lock poisoned")?;
            library.set_sources(sources);
            library
                .persist_sources()
                .map_err(|error| error.to_string())?;
            let count = library
                .rescan_with_lofty()
                .map_err(|error| error.to_string())?
                .len();
            Ok::<_, String>(count)
        });
        if let Ok(count) = result {
            let _ = app.emit("local-library-scanned", count);
        }
        result.map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn local_library_add_sources(
    app: tauri::AppHandle,
    paths: Vec<String>,
    state: tauri::State<'_, LibraryState>,
) -> Result<usize, String> {
    let library_state = Arc::clone(&state.inner().library);
    let scanning = Arc::clone(&state.inner().scanning);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (added, count) = run_library_scan(&scanning, || {
            let mut library = library_state
                .lock()
                .map_err(|_| "local library lock poisoned")?;
            let mut all_sources = library
                .sources()
                .iter()
                .map(|source| source.path().to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            all_sources.extend(paths);
            let added = library.set_sources(all_sources);
            library
                .persist_sources()
                .map_err(|error| error.to_string())?;
            library
                .rescan_with_lofty()
                .map_err(|error| error.to_string())?;
            Ok::<_, String>((added, library.songs().len()))
        })?;
        let _ = app.emit("local-library-scanned", count);
        Ok::<_, String>(added)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn local_library_remove_source(
    app: tauri::AppHandle,
    path: String,
    state: tauri::State<'_, LibraryState>,
) -> Result<bool, String> {
    let library_state = Arc::clone(&state.inner().library);
    let scanning = Arc::clone(&state.inner().scanning);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (removed, count) = run_library_scan(&scanning, || {
            let mut library = library_state
                .lock()
                .map_err(|_| "local library lock poisoned")?;
            let removed = library
                .remove_source_persisted(&path)
                .map_err(|error| error.to_string())?;
            if removed {
                library
                    .rescan_with_lofty()
                    .map_err(|error| error.to_string())?;
            }
            Ok::<_, String>((removed, library.songs().len()))
        })?;
        if removed {
            let _ = app.emit("local-library-scanned", count);
        }
        Ok::<_, String>(removed)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn local_library_rescan(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryState>,
) -> Result<usize, String> {
    let library_state = Arc::clone(&state.inner().library);
    let scanning = Arc::clone(&state.inner().scanning);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let count = run_library_scan(&scanning, || {
            Ok::<_, String>(
                library_state
                    .lock()
                    .map_err(|_| "local library lock poisoned")?
                    .rescan_persisted()
                    .map_err(|error| error.to_string())?
                    .len(),
            )
        })?;
        let _ = app.emit("local-library-scanned", count);
        Ok::<_, String>(count)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn local_song_edit_tags(
    app: tauri::AppHandle,
    uri: String,
    edits: TagEdits,
    artwork: Option<Vec<u8>>,
    state: tauri::State<'_, LibraryState>,
) -> Result<(), String> {
    let app_state = state.inner();
    let indexed_path = {
        let library = app_state
            .library
            .lock()
            .map_err(|_| "local library lock poisoned")?;
        library
            .songs()
            .iter()
            .find(|song| song.uri == uri)
            .map(|song| song.path.clone())
    };
    let playlist_owned = indexed_path.is_none();
    let path = match indexed_path {
        Some(path) => path,
        None => app_state
            .playlists
            .lock()
            .map_err(|_| "playlist lock poisoned")?
            .song_path_for_uri(&uri)
            .ok_or_else(|| {
                "Only indexed local songs and local playlist copies can be edited.".to_owned()
            })?,
    };
    let library = Arc::clone(&app_state.library);
    let playlists = Arc::clone(&app_state.playlists);
    let artwork_dir = app_state.artwork_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        write_local_tags(&path, &edits, artwork.as_deref())?;
        if playlist_owned {
            let tags = read_local_tags_with_artwork(&path, &artwork_dir)?;
            playlists
                .lock()
                .map_err(|_| "playlist lock poisoned")?
                .refresh_song_tags(&uri, tags)
                .map_err(|error| error.to_string())?;
            let _ = app.emit("local-playlists-changed", ());
        } else {
            let mut library = library.lock().map_err(|_| "local library lock poisoned")?;
            let count = library
                .rescan_with_lofty()
                .map_err(|error| error.to_string())?
                .len();
            let _ = app.emit("local-library-scanned", count);
        }
        Ok::<_, String>(())
    })
    .await
    .map_err(|error| error.to_string())?
}

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
    let library_dir = dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Resonance");
    std::fs::create_dir_all(&library_dir).expect("could not create local library directory");
    let mut local_library = LocalLibrary::open(library_dir.join("local-files.json"))
        .expect("could not open local library cache");
    let playlist_store = LocalPlaylistStore::open(library_dir.join("local-playlists.json"))
        .expect("could not open local playlists");
    local_library
        .load_persisted_sources()
        .expect("could not load local library sources");
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
        .manage(LibraryState {
            library: Arc::new(std::sync::Mutex::new(local_library)),
            playlists: Arc::new(std::sync::Mutex::new(playlist_store)),
            artwork_dir: library_dir.join("local-artwork"),
            playlist_artwork_dir: library_dir.join("local-playlist-covers"),
            scanning: Arc::new(AtomicUsize::new(1)),
        })
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
            spectrum_levels,
            local_library_sources,
            local_library_songs,
            local_library_add_sources,
            local_library_set_sources,
            local_library_status,
            local_library_remove_source,
            local_library_rescan,
            local_song_edit_tags,
            local_playlists,
            local_playlist_create,
            local_playlist_update,
            local_playlist_add_songs,
            local_playlist_delete,
            local_playlist_remove_song,
            local_playlist_reorder,
        ])
        .setup(|app| {
            let state = Arc::clone(&app.state::<LibraryState>().library);
            let scanning = Arc::clone(&app.state::<LibraryState>().scanning);
            let handle = app.handle().clone();
            let _ = std::thread::Builder::new()
                .name("resonance-local-library-scan".into())
                .spawn(move || {
                    scanning.fetch_add(1, Ordering::AcqRel);
                    let result = state
                        .lock()
                        .map_err(|_| "local library lock poisoned".to_owned())
                        .and_then(|mut library| {
                            library
                                .rescan_with_lofty()
                                .map(|songs| songs.len())
                                .map_err(|error| error.to_string())
                        });
                    scanning.fetch_sub(1, Ordering::AcqRel);
                    match result {
                        Ok(count) => {
                            let _ = handle.emit("local-library-scanned", count);
                        }
                        Err(error) => {
                            let _ = handle.emit("app-error", error);
                        }
                    }
                });
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
    use super::{LaunchAction, parse_launch_action, run_library_scan};
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn library_scan_status_is_reset_after_success_and_failure() {
        let scanning = AtomicUsize::new(0);
        let result = run_library_scan(&scanning, || {
            assert_ne!(scanning.load(Ordering::Acquire), 0);
            Ok(7)
        });
        assert_eq!(result, Ok(7));
        assert_eq!(scanning.load(Ordering::Acquire), 0);

        let result = run_library_scan(&scanning, || {
            assert_ne!(scanning.load(Ordering::Acquire), 0);
            Err::<(), _>("scan failed".to_owned())
        });
        assert_eq!(result, Err("scan failed".to_owned()));
        assert_eq!(scanning.load(Ordering::Acquire), 0);

        let result = run_library_scan(&scanning, || {
            assert_eq!(scanning.load(Ordering::Acquire), 1);
            let nested = run_library_scan(&scanning, || {
                assert_eq!(scanning.load(Ordering::Acquire), 2);
                Ok(())
            });
            assert_eq!(nested, Ok(()));
            assert_eq!(scanning.load(Ordering::Acquire), 1);
            Ok(())
        });
        assert_eq!(result, Ok(()));
        assert_eq!(scanning.load(Ordering::Acquire), 0);
    }

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
