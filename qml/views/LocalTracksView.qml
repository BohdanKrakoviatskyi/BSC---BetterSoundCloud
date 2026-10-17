pragma ComponentBehavior: Bound
import QtQuick
import Swiftify

// Local Tracks: every music file of the person's own, from the folders and
// files they added (LocalFiles), with what each file's own tags say about it.
// it opens from the Local Files grid, beside the playlists made of them
SongListPage {
    id: root

    songs: LocalFiles.songs
    loading: LocalFiles.scanning && LocalFiles.songs.count === 0
    loadingText: "Looking through your music…"
    showsEmpty: LocalFiles.songs.count === 0
    emptySymbol: "folder_open"
    emptyTitle: LocalFiles.sources.length === 0 ? "No Local Files Yet" : "No Music Found"
    emptyDescription: LocalFiles.sources.length === 0 ? "Add a folder of music, or drop files onto the window." : "The folders you added hold no music Resonance can play."

    MusicPicker {
        id: picker
    }

    hero: CollectionHero {
        kind: "LOCAL FILES"
        title: "Local Tracks"
        description: LocalFiles.sources.length === 1 ? LocalFiles.sources[0] : LocalFiles.sources.length > 1 ? LocalFiles.sources.length + " folders and files" : ""
        facts: Format.joined([Format.songCount(LocalFiles.songs.count), Format.totalDuration(LocalFiles.songs.totalDurationMs)], "  •  ")

        artwork: Rectangle {
            anchors.fill: parent
            radius: Appearance.sizes.artworkRadius
            gradient: Gradient {
                GradientStop {
                    position: 0
                    color: Appearance.colors.tertiaryContainer
                }
                GradientStop {
                    position: 1
                    color: Appearance.colors.primaryContainer
                }
            }

            MaterialSymbol {
                anchors.centerIn: parent
                text: "folder_open"
                iconSize: 96
                fill: 1
                color: Appearance.colors.onPrimaryContainer
            }
        }

        actions: [
            TextButton {
                id: playButton
                // a little wider than its words, and as wide as shuffle
                // beside it, whose words are longer
                width: iconOnly ? compactSize : Math.max(naturalWidth + 28, shuffleButton.naturalWidth)
                iconOnly: parent ? parent.compactActions : false
                compactSize: parent ? parent.actionSize : 48
                implicitHeight: iconOnly ? compactSize : 48
                wavy: true
                symbol: "play_arrow"
                burst: "play"
                text: "Play"
                enabled: LocalFiles.songs.count > 0
                onClicked: Player.playFromModel(LocalFiles.songs, 0)
            },
            // play's twin in the primary's softer tone
            TextButton {
                id: shuffleButton
                width: playButton.width
                iconOnly: parent ? parent.compactActions : false
                compactSize: parent ? parent.actionSize : 48
                implicitHeight: iconOnly ? compactSize : 48
                wavy: true
                symbol: "shuffle"
                burst: "play"
                text: "Shuffle"
                colBackground: shuffleButton.scheme.primaryContainer
                colBackgroundHover: shuffleButton.scheme.primaryContainerHover
                colRipple: shuffleButton.scheme.primaryContainerActive
                labelColor: shuffleButton.scheme.onPrimaryContainer
                enabled: LocalFiles.songs.count > 0
                onClicked: Player.shufflePlay(LocalFiles.songs)
            },
            TextButton {
                iconOnly: parent ? parent.compactActions : false
                compactSize: parent ? parent.actionSize : 48
                implicitHeight: iconOnly ? compactSize : 48
                variant: TextButton.Outlined
                symbol: "create_new_folder"
                text: "Add Folder"
                onClicked: picker.pickFolder()
            },
            IconButton {
                size: parent ? parent.actionSize : 36
                symbol: "refresh"
                enabled: LocalFiles.sources.length > 0 && !LocalFiles.scanning
                tooltip: "Look Again"
                onClicked: LocalFiles.rescan()
            }
        ]
    }
}
