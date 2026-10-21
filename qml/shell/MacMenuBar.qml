pragma ComponentBehavior: Bound
import QtQuick
import Qt.labs.platform as Platform
import Resonance

// the mac's menu bar for the main window. its key equivalents are the app's
// shortcuts, so on macos the window's own Shortcuts for these stand down
// (Main.qml); space stays the window's, since a menu would take it from text
// fields. qt moves About, Settings and Quit into the app's own menu.
Platform.MenuBar {
    id: root

    signal findRequested()
    signal closeWindowRequested()
    signal minimizeRequested()
    signal zoomRequested()
    signal showWindowRequested()

    Platform.Menu {
        title: "File"

        Platform.MenuItem {
            text: "About Resonance"
            role: Platform.MenuItem.AboutRole
            onTriggered: UiState.settingsRequested()
        }
        Platform.MenuItem {
            text: "Settings…"
            role: Platform.MenuItem.PreferencesRole
            shortcut: "Ctrl+,"
            onTriggered: UiState.settingsRequested()
        }
        Platform.MenuItem {
            text: "Quit Resonance"
            role: Platform.MenuItem.QuitRole
            shortcut: StandardKey.Quit
            onTriggered: App.quit()
        }

        Platform.MenuItem {
            text: "New Playlist…"
            shortcut: StandardKey.New
            enabled: Session.libraryConnected
            onTriggered: UiState.beginCreatePlaylist()
        }
        Platform.MenuSeparator {}
        Platform.MenuItem {
            text: "Close Window"
            shortcut: StandardKey.Close
            onTriggered: root.closeWindowRequested()
        }
    }

    Platform.Menu {
        title: "Edit"

        Platform.MenuItem {
            text: "Find"
            shortcut: StandardKey.Find
            onTriggered: root.findRequested()
        }
    }

    Platform.Menu {
        title: "View"

        Platform.MenuItem {
            text: "Home"
            shortcut: "Ctrl+1"
            checkable: true
            checked: Library.page === Library.Page.Home
            onTriggered: Library.showHome()
        }
        Platform.MenuItem {
            text: "Search"
            shortcut: "Ctrl+2"
            checkable: true
            checked: Library.page === Library.Page.Search
            onTriggered: Library.showSearch()
        }
        Platform.MenuItem {
            text: "Favourite Songs"
            shortcut: "Ctrl+3"
            checkable: true
            checked: Library.page === Library.Page.Songs
            onTriggered: Library.showSavedSongs()
        }
        Platform.MenuItem {
            text: "Playlists"
            shortcut: "Ctrl+4"
            checkable: true
            checked: Library.page === Library.Page.Playlists
            onTriggered: Library.showPlaylists()
        }
        Platform.MenuItem {
            text: "Local Files"
            shortcut: "Ctrl+5"
            checkable: true
            checked: Library.page === Library.Page.LocalFiles || Library.page === Library.Page.LocalTracks
            onTriggered: Library.showLocalFiles()
        }
        Platform.MenuSeparator {}
        Platform.MenuItem {
            text: "Back"
            shortcut: StandardKey.Back
            enabled: Library.canGoBack
            onTriggered: Library.goBack()
        }
        Platform.MenuSeparator {}
        Platform.MenuItem {
            text: "Lyrics"
            shortcut: "Ctrl+Alt+L"
            checkable: true
            checked: Player.showingLyrics
            enabled: Player.hasSong
            onTriggered: Player.toggleLyricsPanel()
        }
        Platform.MenuItem {
            text: "Playing Next"
            shortcut: "Ctrl+Alt+Q"
            checkable: true
            checked: Player.showingQueue
            onTriggered: Player.toggleQueuePanel()
        }
        Platform.MenuSeparator {}
        Platform.MenuItem {
            text: UiState.immersiveOpen ? "Close Immersive Player" : "Immersive Player"
            shortcut: "Ctrl+Shift+F"
            enabled: Player.hasSong || UiState.immersiveOpen
            onTriggered: UiState.immersiveOpen = !UiState.immersiveOpen
        }
    }

    Platform.Menu {
        title: "Controls"

        Platform.MenuItem {
            text: Player.playing ? "Pause" : "Play"
            enabled: Player.hasSong
            onTriggered: Player.togglePlayback()
        }
        Platform.MenuItem {
            text: "Next"
            shortcut: "Ctrl+Right"
            enabled: Player.canSkipForward
            onTriggered: Player.skipForward()
        }
        Platform.MenuItem {
            text: "Previous"
            shortcut: "Ctrl+Left"
            enabled: Player.canSkipBackward
            onTriggered: Player.skipBackward()
        }
        Platform.MenuSeparator {}
        Platform.MenuItem {
            text: "Forward 10 Seconds"
            shortcut: "Ctrl+Alt+Right"
            enabled: Player.hasSong
            onTriggered: Player.seekBy(10000)
        }
        Platform.MenuItem {
            text: "Back 10 Seconds"
            shortcut: "Ctrl+Alt+Left"
            enabled: Player.hasSong
            onTriggered: Player.seekBy(-10000)
        }
        Platform.MenuSeparator {}
        Platform.MenuItem {
            text: "Volume Up"
            shortcut: "Ctrl+Up"
            enabled: Session.connected
            onTriggered: Player.adjustVolume(0.05)
        }
        Platform.MenuItem {
            text: "Volume Down"
            shortcut: "Ctrl+Down"
            enabled: Session.connected
            onTriggered: Player.adjustVolume(-0.05)
        }
        Platform.MenuItem {
            text: Player.volume <= 0.01 ? "Unmute" : "Mute"
            shortcut: "Ctrl+Alt+M"
            enabled: Session.connected
            onTriggered: Player.toggleMute()
        }
        Platform.MenuSeparator {}
        Platform.MenuItem {
            text: "Shuffle"
            shortcut: "Ctrl+Alt+S"
            checkable: true
            checked: Player.shuffle
            enabled: Player.hasSong
            onTriggered: Player.toggleShuffle()
        }
        Platform.MenuItem {
            text: Player.repeatMode === Player.RepeatMode.One ? "Repeat: Song"
                : Player.repeatMode === Player.RepeatMode.All ? "Repeat: Queue" : "Repeat: Off"
            shortcut: "Ctrl+Alt+R"
            enabled: Player.hasSong
            onTriggered: Player.cycleRepeatMode()
        }
    }

    Platform.Menu {
        title: "Window"

        Platform.MenuItem {
            text: "Minimize"
            shortcut: "Ctrl+M"
            onTriggered: root.minimizeRequested()
        }
        Platform.MenuItem {
            text: "Zoom"
            onTriggered: root.zoomRequested()
        }
        Platform.MenuSeparator {}
        Platform.MenuItem {
            text: "Resonance"
            onTriggered: root.showWindowRequested()
        }
    }
}
