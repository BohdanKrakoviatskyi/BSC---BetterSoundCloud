pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import Resonance

// SoundCloud Playlist page: displays playlist capacity, duration, author, and aesthetic card grid layout
Flickable {
    id: root

    topMargin: Appearance.sizes.topBarHeight
    contentHeight: column.implicitHeight + Appearance.sizes.playerBarClearance
    boundsBehavior: Flickable.StopAtBounds

    ScrollBar.vertical: StyledScrollBar {
        topPadding: 3 + Appearance.sizes.topBarHeight
    }

    readonly property real margin: Appearance.sizes.pageMargin
    property playlist playlist

    Binding {
        target: root
        property: "playlist"
        value: Library.selectedPlaylist
        when: root.visible
        restoreMode: Binding.RestoreNone
    }

    readonly property bool loading: Library.loadingSongs
    readonly property int songCount: Library.displayedPlaylistSongs.count > 0
                                     ? Library.displayedPlaylistSongs.count
                                     : root.playlist.songCount

    Column {
        id: column
        width: root.width
        spacing: 0

        // ── Hero header with playlist capacity ────────────────────────────────
        Item {
            width: root.width
            height: heroWrap.implicitHeight + 36

            // Subtle background glow
            Stickers {
                anchors.fill: parent
                key: root.playlist.name
                count: 4
                minimumSize: 70
                maximumSize: 180
                opacity: 0.2
            }

            Item {
                id: heroWrap
                x: root.margin
                y: 18
                width: root.width - 2 * root.margin
                implicitHeight: root.width > 560
                                ? Math.max(coverBox.height, heroDetails.implicitHeight)
                                : coverBox.height + heroDetails.implicitHeight + 16

                // Playlist cover artwork
                Item {
                    id: coverBox
                    objectName: "heroArtwork"
                    width: root.width > 560 ? 190 : Math.min(190, heroWrap.width)
                    height: width

                    Component.onCompleted: UiState.claimHero(coverBox)

                    ArtworkGlow {
                        anchors.fill: parent
                        source: root.playlist.artworkUrl
                        intensity: 0.32
                        glowRadius: 28
                    }

                    ArtworkImage {
                        anchors.fill: parent
                        radius: 14
                        source: root.playlist.artworkUrl
                    }

                    // Fallback when no artwork
                    Rectangle {
                        anchors.fill: parent
                        visible: root.playlist.artworkUrl.toString().length === 0
                        radius: 14
                        color: Appearance.colors.surfaceContainerHighest

                        MaterialSymbol {
                            anchors.centerIn: parent
                            text: "playlist_play"
                            iconSize: 64
                            color: Appearance.colors.onSurfaceVariant
                        }
                    }
                }

                // Details & Capacity
                Column {
                    id: heroDetails
                    x: root.width > 560 ? coverBox.width + 24 : 0
                    y: root.width > 560 ? 0 : coverBox.height + 16
                    width: root.width > 560 ? heroWrap.width - coverBox.width - 24 : heroWrap.width
                    spacing: 8

                    // Eyebrow tag
                    Rectangle {
                        radius: 10
                        color: Appearance.colors.secondaryContainer
                        implicitWidth: tagRow.implicitWidth + 14
                        implicitHeight: 22

                        Row {
                            id: tagRow
                            anchors.centerIn: parent
                            spacing: 4
                            MaterialSymbol {
                                anchors.verticalCenter: parent.verticalCenter
                                text: "queue_music"
                                iconSize: 13
                                color: Appearance.colors.onSecondaryContainer
                            }
                            StyledText {
                                anchors.verticalCenter: parent.verticalCenter
                                text: "SOUNDCLOUD PLAYLIST"
                                font.pixelSize: 10
                                font.weight: Font.Bold
                                color: Appearance.colors.onSecondaryContainer
                            }
                        }
                    }

                    // Title
                    TitleText {
                        width: parent.width
                        text: root.playlist.name
                        wrapMode: Text.WordWrap
                        font.pixelSize: root.width > 560 ? 30 : 22
                        font.weight: Font.Bold
                        color: Appearance.colors.onSurface
                    }

                    // Capacity & author line
                    Row {
                        spacing: 8

                        MaterialSymbol {
                            anchors.verticalCenter: parent.verticalCenter
                            text: "person"
                            iconSize: 15
                            color: Appearance.colors.primary
                        }

                        StyledText {
                            anchors.verticalCenter: parent.verticalCenter
                            text: root.playlist.ownerDisplayName.length > 0 ? root.playlist.ownerDisplayName : "SoundCloud"
                            font.pixelSize: Appearance.fontSize.small
                            font.weight: Font.DemiBold
                            color: Appearance.colors.onSurface
                        }

                        StyledText {
                            anchors.verticalCenter: parent.verticalCenter
                            text: "•"
                            color: Appearance.colors.onSurfaceVariant
                        }

                        MaterialSymbol {
                            anchors.verticalCenter: parent.verticalCenter
                            text: "music_note"
                            iconSize: 14
                            color: Appearance.colors.onSurfaceVariant
                        }

                        // Track count capacity
                        StyledText {
                            anchors.verticalCenter: parent.verticalCenter
                            text: Format.songCount(root.songCount)
                            font.pixelSize: Appearance.fontSize.small
                            font.weight: Font.DemiBold
                            color: Appearance.colors.primary
                        }

                        StyledText {
                            visible: Library.playlistSongs.totalDurationMs > 0
                            anchors.verticalCenter: parent.verticalCenter
                            text: "•  " + Format.totalDuration(Library.playlistSongs.totalDurationMs)
                            font.pixelSize: Appearance.fontSize.smaller
                            color: Appearance.colors.onSurfaceVariant
                        }
                    }

                    // Description if available
                    StyledText {
                        visible: root.playlist.description.length > 0
                        width: parent.width
                        text: root.playlist.description
                        font.pixelSize: Appearance.fontSize.smaller
                        color: Appearance.colors.onSurfaceVariant
                        elide: Text.ElideRight
                        maximumLineCount: 2
                    }

                    // Play & Shuffle actions
                    Row {
                        spacing: 10
                        topPadding: 6

                        TextButton {
                            symbol: "play_arrow"
                            burst: "play"
                            text: "Play playlist"
                            wavy: true
                            enabled: Library.playlistSongs.count > 0
                            onClicked: Player.playFromModel(Library.playlistSongs, 0)
                        }

                        TextButton {
                            symbol: "shuffle"
                            burst: "play"
                            text: "Shuffle"
                            variant: TextButton.Tonal
                            enabled: Library.playlistSongs.count > 0
                            onClicked: Player.shufflePlay(Library.playlistSongs)
                        }
                    }
                }
            }
        }

        // Divider
        Rectangle {
            x: root.margin
            width: root.width - 2 * root.margin
            height: 1
            color: Appearance.colors.outlineVariant
        }

        Item { width: 1; height: 16 }

        // ── Loading state ─────────────────────────────────────────────────────
        Item {
            width: root.width
            height: 180
            Reveal.shown: root.loading

            Column {
                anchors.centerIn: parent
                spacing: 12

                LoadingSpinner { anchors.horizontalCenter: parent.horizontalCenter }
                StyledText {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: "Loading playlist tracks…"
                    color: Appearance.colors.onSurfaceVariant
                }
            }
        }

        // ── Empty state ───────────────────────────────────────────────────────
        Item {
            width: root.width
            height: 200
            Reveal.shown: !root.loading && Library.displayedPlaylistSongs.count === 0

            EmptyState {
                anchors.centerIn: parent
                symbol: "music_note"
                title: "No playable tracks in this playlist"
            }
        }

        // ── Aesthetic 2-column / responsive card grid of tracks ───────────────
        Item {
            id: gridContainer
            x: root.margin
            width: root.width - 2 * root.margin
            height: trackGrid.implicitHeight
            visible: !root.loading && Library.displayedPlaylistSongs.count > 0

            readonly property int numColumns: root.width > 720 ? 2 : 1
            readonly property real cardWidth: numColumns === 2
                                              ? (gridContainer.width - 12) / 2
                                              : gridContainer.width

            Grid {
                id: trackGrid
                width: parent.width
                columns: gridContainer.numColumns
                rowSpacing: 10
                columnSpacing: 12

                Repeater {
                    model: Library.displayedPlaylistSongs.count

                    delegate: Rectangle {
                        id: trackCard
                        required property int index
                        readonly property song track: Library.displayedPlaylistSongs.at(index)
                        readonly property song modelData: track

                        readonly property bool isCurrent: Player.currentSong.uri === modelData.uri
                        readonly property bool isPlayingThis: isCurrent && Player.playing

                        width: gridContainer.cardWidth
                        height: 68
                        radius: 12
                        color: cardHover.containsMouse || isCurrent
                               ? Appearance.colors.surfaceContainerHighest
                               : Appearance.colors.surfaceContainerHigh

                        Behavior on color {
                            ColorAnimation { duration: Appearance.duration(120) }
                        }

                        Row {
                            anchors.fill: parent
                            anchors.margins: 8
                            spacing: 10

                            // Track index or playing indicator
                            Item {
                                width: 24
                                height: parent.height
                                anchors.verticalCenter: parent.verticalCenter

                                StyledText {
                                    anchors.centerIn: parent
                                    visible: !trackCard.isPlayingThis
                                    text: trackCard.index + 1
                                    font.pixelSize: Appearance.fontSize.smaller
                                    font.weight: Font.DemiBold
                                    color: trackCard.isCurrent
                                           ? Appearance.colors.primary
                                           : Appearance.colors.onSurfaceVariant
                                }

                                MaterialSymbol {
                                    anchors.centerIn: parent
                                    visible: trackCard.isPlayingThis
                                    text: "volume_up"
                                    iconSize: 16
                                    fill: 1
                                    color: Appearance.colors.primary
                                }
                            }

                            // Artwork thumbnail
                            Item {
                                width: 52
                                height: 52
                                anchors.verticalCenter: parent.verticalCenter

                                ArtworkImage {
                                    anchors.fill: parent
                                    radius: 8
                                    source: trackCard.modelData.artworkUrl.toString().length > 0
                                            ? trackCard.modelData.artworkUrl
                                            : (trackCard.modelData.artistItems.length > 0
                                               ? trackCard.modelData.artistItems[0].artworkUrl
                                               : "")
                                }

                                // Quick Play overlay
                                Rectangle {
                                    anchors.fill: parent
                                    radius: 8
                                    color: Qt.rgba(0, 0, 0, 0.45)
                                    opacity: cardHover.containsMouse ? 1 : 0

                                    Behavior on opacity {
                                        NumberAnimation { duration: 120 }
                                    }

                                    MaterialSymbol {
                                        anchors.centerIn: parent
                                        text: trackCard.isPlayingThis ? "pause" : "play_arrow"
                                        iconSize: 22
                                        color: "white"
                                        fill: 1
                                    }
                                }
                            }

                            // Title & Artist
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                width: parent.width - 24 - 52 - durationPill.width - 34
                                spacing: 3

                                StyledText {
                                    width: parent.width
                                    text: trackCard.modelData.name
                                    font.pixelSize: Appearance.fontSize.small
                                    font.weight: trackCard.isCurrent ? Font.Bold : Font.DemiBold
                                    elide: Text.ElideRight
                                    color: trackCard.isCurrent
                                           ? Appearance.colors.primary
                                           : Appearance.colors.onSurface
                                }

                                StyledText {
                                    id: artLabel
                                    width: parent.width
                                    text: trackCard.modelData.artists
                                    font.pixelSize: Appearance.fontSize.smaller
                                    elide: Text.ElideRight
                                    color: artHover.hovered
                                           ? Appearance.colors.primary
                                           : Appearance.colors.onSurfaceVariant

                                    Behavior on color {
                                        ColorAnimation { duration: 100 }
                                    }

                                    HoverHandler { id: artHover; cursorShape: Qt.PointingHandCursor }
                                    TapHandler {
                                        onTapped: UiState.goToArtist(trackCard.modelData)
                                    }
                                }
                            }

                            // Duration pill
                            Rectangle {
                                id: durationPill
                                anchors.verticalCenter: parent.verticalCenter
                                radius: 8
                                color: Appearance.colors.surfaceContainerLowest
                                implicitWidth: durText.implicitWidth + 14
                                implicitHeight: 24

                                StyledText {
                                    id: durText
                                    anchors.centerIn: parent
                                    text: Format.playbackTime(trackCard.modelData.durationMs)
                                    font.pixelSize: 11
                                    color: Appearance.colors.onSurfaceVariant
                                }
                            }

                            // Options menu button
                            IconButton {
                                anchors.verticalCenter: parent.verticalCenter
                                symbol: "more_horiz"
                                size: 28
                                iconSize: 16
                                onClicked: SongMenus.open(trackCard.modelData, false)
                            }
                        }

                        MouseArea {
                            id: cardMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            z: -1
                            onClicked: {
                                Player.playFromModel(Library.displayedPlaylistSongs, trackCard.index)
                            }
                        }

                        HoverHandler { id: cardHover }
                    }
                }
            }
        }

        Item { width: 1; height: 20 }
    }
}
