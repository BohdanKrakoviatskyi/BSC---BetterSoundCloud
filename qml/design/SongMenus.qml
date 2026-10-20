pragma Singleton
pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// opens the one song options menu the window keeps, from any row or card.
QtObject {
    signal requested(song song, bool allowsPlaylistRemoval)

    function open(song: song, allowsPlaylistRemoval: bool) {
        requested(song, allowsPlaylistRemoval)
    }
}
