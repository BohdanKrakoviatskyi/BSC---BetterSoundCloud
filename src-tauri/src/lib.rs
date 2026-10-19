use serde::Serialize;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial = parse_launch_action(std::env::args().skip(1));
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
        .invoke_handler(tauri::generate_handler![
            initial_action,
            report_error,
            minimize_window,
            toggle_maximize_window,
            close_window
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
