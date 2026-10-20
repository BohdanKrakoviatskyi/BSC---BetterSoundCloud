pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// the macos playback menu, which on linux lives behind the top bar's overflow
// button. labels follow the player's state, as the menu bar's did.
StyledMenu {
    id: root

    StyledMenuItem {
        text: Player.playing ? "Pause" : "Play"
        symbol: Player.playing ? "pause" : "play_arrow"
        enabled: Player.hasSong
        onTriggered: Player.togglePlayback()
    }
    StyledMenuItem {
        text: "Next Song"
        symbol: "skip_next"
        enabled: Player.canSkipForward
        onTriggered: Player.skipForward()
    }
    StyledMenuItem {
        text: "Previous Song"
        symbol: "skip_previous"
        enabled: Player.canSkipBackward
        onTriggered: Player.skipBackward()
    }
    StyledMenuSeparator {}
    StyledMenuItem {
        text: "Skip Forward 10 Seconds"
        symbol: "forward_10"
        enabled: Player.hasSong
        onTriggered: Player.seekBy(10000)
    }
    StyledMenuItem {
        text: "Skip Back 10 Seconds"
        symbol: "replay_10"
        enabled: Player.hasSong
        onTriggered: Player.seekBy(-10000)
    }
    StyledMenuSeparator {}
    StyledMenuItem {
        text: "Increase Volume"
        symbol: "volume_up"
        enabled: Session.connected
        onTriggered: Player.adjustVolume(0.05)
    }
    StyledMenuItem {
        text: "Decrease Volume"
        symbol: "volume_down"
        enabled: Session.connected
        onTriggered: Player.adjustVolume(-0.05)
    }
    StyledMenuItem {
        text: Player.volume <= 0.01 ? "Unmute" : "Mute"
        symbol: Player.volume <= 0.01 ? "volume_up" : "volume_off"
        enabled: Session.connected
        onTriggered: Player.toggleMute()
    }
    StyledMenuSeparator {}
    StyledMenuItem {
        text: Player.shuffle ? "Shuffle Off" : "Shuffle On"
        symbol: "shuffle"
        enabled: Player.hasSong
        onTriggered: Player.toggleShuffle()
    }
    StyledMenuItem {
        text: Player.repeatMode === Player.RepeatMode.One ? "Repeat song" : (Player.repeatMode === Player.RepeatMode.All ? "Repeat queue" : "Repeat off")
        symbol: Player.repeatMode === Player.RepeatMode.One ? "repeat_one" : "repeat"
        enabled: Player.hasSong
        onTriggered: Player.cycleRepeatMode()
    }
    StyledMenuSeparator {}
    StyledMenuItem {
        text: "Settings…"
        symbol: "settings"
        onTriggered: UiState.settingsRequested()
    }
}
