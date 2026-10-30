pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// SongOptionsContent: save, go to album or artist, queue, and add to
// or remove from a playlist. one instance per window, opened at the pointer.
// a file of the person's own is nothing spotify knows: it queues, shows
// where it is kept, and goes in playlists made on this computer.
StyledMenu {
    id: root

    property song song
    property bool allowsPlaylistRemoval: false
    readonly property bool saved: Library.savedRevision >= 0 && Library.isSaved(song.uri)
    property var editablePlaylists: []
    readonly property bool local: song ? song.isLocalFile : false
    readonly property bool soundcloud: song ? song.isSoundCloud : false
    readonly property bool youtubeMusic: song ? song.isYouTubeMusic : false

    function openFor(target: song, allowsRemoval: bool) {
        song = target
        allowsPlaylistRemoval = allowsRemoval
        editablePlaylists = target.isLocalFile ? LocalFiles.playlistChoices() : Library.editablePlaylists()
        popup()
    }

    StyledMenuItem {
        id: saveItem
        visible: !root.local && !root.soundcloud
        height: visible ? implicitHeight : 0
        text: root.saved ? "Remove from Songs" : "Save to Songs"
        symbol: root.saved ? "star" : "star"
        onTriggered: {
            if (!root.saved) {
                UiState.burst(saveItem, "hearts")
            }
            Library.toggleSaved(root.song)
        }
    }
    StyledMenuItem {
        visible: root.local
        height: visible ? implicitHeight : 0
        text: "Edit Info…"
        symbol: "edit_note"
        onTriggered: UiState.editLocalTrackRequested(root.song)
    }
    StyledMenuItem {
        visible: root.local
        height: visible ? implicitHeight : 0
        text: App.macOS ? "Show in Finder" : "Show in Folder"
        symbol: "folder_open"
        onTriggered: App.openUrl(root.song.uri.substring(0, root.song.uri.lastIndexOf("/")))
    }
    StyledMenuItem {
        visible: (root.soundcloud || root.youtubeMusic) && root.song.permalink.toString().length > 0
        height: visible ? implicitHeight : 0
        text: root.youtubeMusic ? "Open in YouTube" : "Open in SoundCloud"
        symbol: "open_in_new"
        onTriggered: App.openUrl(root.song.permalink.toString())
    }
    StyledMenuSeparator {
        visible: !root.local && !root.soundcloud && !root.youtubeMusic
        height: visible ? implicitHeight : 0
    }
    StyledMenuItem {
        visible: !root.local && !root.soundcloud && !root.youtubeMusic && root.song.albumName.length > 0
        height: visible ? implicitHeight : 0
        text: "Go to Album"
        symbol: "album"
        onTriggered: UiState.goToAlbum(root.song)
    }
    StyledMenuItem {
        visible: !root.local && root.song.artists.length > 0
        height: visible ? implicitHeight : 0
        text: "Go to Artist"
        symbol: "person"
        onTriggered: UiState.goToArtist(root.song)
    }
    StyledMenuItem {
        visible: root.soundcloud || root.youtubeMusic
        height: visible ? implicitHeight : 0
        text: "Track Details"
        symbol: "info"
        onTriggered: UiState.goToTrack(root.song)
    }
    StyledMenuSeparator {}
    StyledMenuItem {
        text: "Play Next"
        symbol: "queue_play_next"
        onTriggered: Player.playNext(root.song)
    }
    StyledMenuItem {
        text: "Play Last"
        symbol: "playlist_add"
        onTriggered: Player.playLast(root.song)
    }

    StyledMenu {
        id: addMenu
        title: "Add to Playlist"
        visible: !root.soundcloud && !root.youtubeMusic

        Instantiator {
            model: root.editablePlaylists

            StyledMenuItem {
                id: playlistItem
                required property var modelData
                text: modelData.name
                onTriggered: {
                    UiState.burst(playlistItem, "playlist")
                    Library.addToPlaylist(root.song, playlistItem.modelData)
                }
            }

            onObjectAdded: (index, object) => addMenu.insertItem(index, object as StyledMenuItem)
            onObjectRemoved: (index, object) => addMenu.removeItem(object as StyledMenuItem)
        }

        // spotify's playlists hold spotify's songs, and a file starts a
        // playlist of files
        StyledMenuSeparator {
            visible: root.local && root.editablePlaylists.length > 0
            height: visible ? implicitHeight : 0
        }
        StyledMenuItem {
            visible: root.local
            height: visible ? implicitHeight : 0
            text: "New Playlist…"
            symbol: "add"
            onTriggered: UiState.createLocalPlaylistRequested(root.song)
        }
    }

    StyledMenuSeparator {
        visible: root.allowsPlaylistRemoval
        height: visible ? implicitHeight : 0
    }
    StyledMenuItem {
        visible: root.allowsPlaylistRemoval
        height: visible ? implicitHeight : 0
        text: "Remove from Playlist"
        symbol: "delete"
        destructive: true
        onTriggered: Library.removeFromSelectedPlaylist(root.song)
    }
}
