pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import Resonance

// SoundCloud artist page: banner, avatar, stats, bio, tracks, likes, playlists
Flickable {
    id: root

    topMargin: Appearance.sizes.topBarHeight
    contentHeight: column.implicitHeight + Appearance.sizes.playerBarClearance
    boundsBehavior: Flickable.StopAtBounds

    ScrollBar.vertical: StyledScrollBar {
        topPadding: 3 + Appearance.sizes.topBarHeight
    }

    readonly property real margin: Appearance.sizes.pageMargin
    readonly property soundCloudArtistProfile artist: SoundCloud.currentArtist
    readonly property bool loading: SoundCloud.loadingArtist
    readonly property bool hasData: artist.valid

    /// whether something `top` down the page and `height` tall is in sight,
    /// or within `slack` of it
    function reaches(top: real, height: real, slack: real): bool {
        return top + height > root.contentY - slack && top < root.contentY + root.height + slack
    }

    Column {
        id: column
        width: root.width
        spacing: 0

        // ── Banner + Avatar hero ──────────────────────────────────────────────
        Item {
            id: heroArea
            width: root.width
            height: bannerHeight + avatarRadius + 20

            readonly property real bannerHeight: Math.max(130, root.width * 0.28)
            readonly property real avatarRadius: 52

            // Banner image
            Rectangle {
                id: bannerBg
                width: parent.width
                height: heroArea.bannerHeight
                color: Appearance.colors.surfaceContainerHigh

                ArtworkImage {
                    anchors.fill: parent
                    source: root.artist.bannerUrl
                    radius: 0
                }

                // Gradient overlay so avatar area looks good
                Rectangle {
                    anchors.bottom: parent.bottom
                    width: parent.width
                    height: 60
                    gradient: Gradient {
                        GradientStop { position: 0.0; color: "transparent" }
                        GradientStop { position: 1.0; color: Appearance.colors.surface }
                    }
                }
            }

            // Stickers behind avatar for personality
            Stickers {
                x: root.margin
                y: heroArea.bannerHeight - 20
                width: root.width - 2 * root.margin
                height: 80
                key: root.artist.username
                count: 4
                minimumSize: 40
                maximumSize: 90
                opacity: 0.25
            }

            // Avatar circle
            Item {
                id: avatarBox
                x: root.margin
                y: heroArea.bannerHeight - heroArea.avatarRadius
                width: heroArea.avatarRadius * 2
                height: heroArea.avatarRadius * 2

                objectName: "heroArtwork"

                Component.onCompleted: UiState.claimHero(avatarBox)

                ArtworkGlow {
                    anchors.fill: parent
                    source: root.artist.avatarUrl
                    circular: true
                    intensity: 0.3
                    glowRadius: 20
                }

                ArtworkImage {
                    anchors.fill: parent
                    source: root.artist.avatarUrl
                    circular: true
                }

                // Verified badge
                Rectangle {
                    visible: root.artist.verified
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.margins: 2
                    width: 22
                    height: 22
                    radius: 11
                    color: Appearance.colors.primary

                    MaterialSymbol {
                        anchors.centerIn: parent
                        text: "verified"
                        iconSize: 14
                        color: Appearance.colors.onPrimary
                        fill: 1
                    }
                }
            }
        }

        // ── Name, username, location ──────────────────────────────────────────
        Item {
            width: root.width
            height: nameCol.implicitHeight + 16

            Column {
                id: nameCol
                x: root.margin
                y: 8
                width: root.width - 2 * root.margin
                spacing: 3

                Row {
                    spacing: 8

                    TitleText {
                        text: root.artist.fullName.length > 0 ? root.artist.fullName : root.artist.username
                        font.pixelSize: Appearance.fontSize.title
                        font.weight: Font.Bold
                        color: Appearance.colors.onSurface
                        Reveal.shown: root.hasData
                    }
                }

                StyledText {
                    visible: root.artist.username.length > 0 && root.artist.fullName.length > 0
                    text: "@" + root.artist.username
                    font.pixelSize: Appearance.fontSize.smaller
                    color: Appearance.colors.primary
                }

                Row {
                    visible: root.artist.city.length > 0 || root.artist.country.length > 0
                    spacing: 4

                    MaterialSymbol {
                        anchors.verticalCenter: parent.verticalCenter
                        text: "location_on"
                        iconSize: 14
                        color: Appearance.colors.onSurfaceVariant
                        fill: 1
                    }
                    StyledText {
                        text: Format.joined([root.artist.city, root.artist.country], ", ")
                        font.pixelSize: Appearance.fontSize.smaller
                        color: Appearance.colors.onSurfaceVariant
                    }
                }
            }
        }

        // ── Stats chips ───────────────────────────────────────────────────────
        Item {
            width: root.width
            height: statsRow.implicitHeight + 20
            Reveal.shown: root.hasData

            Row {
                id: statsRow
                x: root.margin
                y: 2
                spacing: 8

                Repeater {
                    model: [
                        { label: "Followers", value: root.artist.followersCount, icon: "group" },
                        { label: "Following", value: root.artist.followingsCount, icon: "person_add" },
                        { label: "Tracks",    value: root.artist.trackCount,    icon: "music_note" },
                        { label: "Likes",     value: root.artist.likesCount,    icon: "favorite" }
                    ]

                    delegate: Rectangle {
                        required property var modelData
                        radius: 20
                        color: Appearance.colors.surfaceContainerHigh
                        implicitWidth: chipRow.implicitWidth + 16
                        implicitHeight: 34

                        Row {
                            id: chipRow
                            anchors.centerIn: parent
                            spacing: 4

                            MaterialSymbol {
                                anchors.verticalCenter: parent.verticalCenter
                                text: modelData.icon
                                iconSize: 14
                                fill: 1
                                color: Appearance.colors.primary
                            }
                            StyledText {
                                anchors.verticalCenter: parent.verticalCenter
                                text: Format.compactCount(modelData.value)
                                font.pixelSize: Appearance.fontSize.smaller
                                font.weight: Font.DemiBold
                                color: Appearance.colors.onSurface
                            }
                            StyledText {
                                anchors.verticalCenter: parent.verticalCenter
                                text: modelData.label
                                font.pixelSize: Appearance.fontSize.smaller
                                color: Appearance.colors.onSurfaceVariant
                            }
                        }
                    }
                }
            }
        }

        // ── Action buttons ────────────────────────────────────────────────────
        Item {
            width: root.width
            height: btnRow.implicitHeight + 16

            Row {
                id: btnRow
                x: root.margin
                y: 4
                spacing: 10

                TextButton {
                    symbol: "play_arrow"
                    burst: "play"
                    text: "Play"
                    wavy: true
                    enabled: SoundCloud.artistTracks.count > 0
                    onClicked: Player.playFromModel(SoundCloud.artistTracks, 0)
                }

                TextButton {
                    symbol: "open_in_new"
                    text: "SoundCloud"
                    variant: TextButton.Tonal
                    visible: root.artist.permalink.toString().length > 0
                    onClicked: Qt.openUrlExternally(root.artist.permalink)
                }
            }
        }

        // ── Bio / description ─────────────────────────────────────────────────
        Item {
            width: root.width
            height: bioSection.implicitHeight + 8
            visible: root.artist.description.length > 0
            Reveal.shown: root.hasData && root.artist.description.length > 0

            Column {
                id: bioSection
                x: root.margin
                y: 4
                width: root.width - 2 * root.margin
                spacing: 6

                StyledText {
                    font.pixelSize: Appearance.fontSize.small
                    font.weight: Font.DemiBold
                    text: "About the artist"
                    color: Appearance.colors.onSurface
                }

                StyledText {
                    id: bioText
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: Appearance.fontSize.smaller
                    color: Appearance.colors.onSurfaceVariant
                    maximumLineCount: bioExpanded ? 999 : 3
                    elide: Text.ElideRight
                    text: root.artist.description

                    property bool bioExpanded: false
                }

                StyledText {
                    visible: bioText.implicitHeight > bioText.height || bioText.bioExpanded
                    text: bioText.bioExpanded ? "Show less" : "Show more"
                    font.pixelSize: Appearance.fontSize.smaller
                    color: Appearance.colors.primary
                    font.weight: Font.DemiBold

                    HoverHandler { cursorShape: Qt.PointingHandCursor }
                    TapHandler { onTapped: bioText.bioExpanded = !bioText.bioExpanded }
                }
            }
        }

        // ── Loading state ─────────────────────────────────────────────────────
        Item {
            width: root.width
            height: visible ? 200 : 0
            visible: root.loading && !root.hasData

            Column {
                anchors.centerIn: parent
                spacing: 12

                LoadingSpinner {
                    anchors.horizontalCenter: parent.horizontalCenter
                }
                StyledText {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: "Loading profile…"
                    color: Appearance.colors.onSurfaceVariant
                }
            }
        }

        // ── Tracks section ────────────────────────────────────────────────────
        Item {
            x: root.margin
            width: root.width - 2 * root.margin
            height: visible ? tracksTitleRow.implicitHeight + 26 : 0
            visible: SoundCloud.artistTracks.count > 0

            Row {
                id: tracksTitleRow
                anchors.verticalCenter: parent.verticalCenter
                width: parent.width

                TitleText {
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Tracks"
                    font.pixelSize: Appearance.fontSize.title
                    font.weight: Font.Bold
                }

                Item {
                    width: Math.max(12, tracksTitleRow.width - 120 - 100)
                    height: 1
                }

                TextButton {
                    anchors.verticalCenter: parent.verticalCenter
                    variant: TextButton.Text
                    symbol: "arrow_forward"
                    text: "All"
                    visible: SoundCloud.artistTracks.count > 0
                    onClicked: UiState.goToArtistTracks(Library.currentArtist)
                }
            }
        }

        EmptyState {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: !root.loading && root.hasData && SoundCloud.artistTracks.count === 0
            height: visible ? implicitHeight : 0
            symbol: "music_note"
            title: "No tracks found"
        }

        Repeater {
            model: Math.min(20, SoundCloud.artistTracks.count)

            SongRow {
                x: root.margin
                width: root.width - 2 * root.margin
                songs: SoundCloud.artistTracks
                song: SoundCloud.artistTracks.at(index)
            }
        }

        // ── Playlists section ────────────────────────────────────────────────
        Item {
            width: root.width
            height: visible ? playlistsShelf.implicitHeight : 0
            visible: SoundCloud.artistPlaylists.count > 0

            Shelf {
                id: playlistsShelf
                width: root.width
                title: "Playlists"
                symbol: "playlist_play"
                iconShape: "cookie9"
                model: SoundCloud.artistPlaylists
                onScreen: root.reaches(column.y + y, height, root.height)
                nearScreen: root.reaches(column.y + y, height, root.height * 1.5)

                delegate: Component {
                    Item {
                        id: placeItem
                        required property playlist playlist

                        width: Appearance.sizes.cardSize
                        height: Appearance.sizes.cardSize + 64

                        Loader {
                            active: playlistsShelf.nearScreen
                            visible: playlistsShelf.onScreen
                            asynchronous: true
                            sourceComponent: MediaCard {
                                artworkUrl: placeItem.playlist.artworkUrl
                                title: placeItem.playlist.name
                                subtitle: Format.songCount(placeItem.playlist.trackCount)
                                placeholderSymbol: "playlist_play"
                                onClicked: Library.selectPlaylist(placeItem.playlist)
                            }
                        }
                    }
                }
            }
        }

        // ── Likes section ─────────────────────────────────────────────────────
        Item {
            x: root.margin
            width: root.width - 2 * root.margin
            height: visible ? likesTitleRow.implicitHeight + 26 : 0
            visible: SoundCloud.artistLikes.count > 0

            Row {
                id: likesTitleRow
                anchors.verticalCenter: parent.verticalCenter
                width: parent.width

                TitleText {
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Likes"
                    font.pixelSize: Appearance.fontSize.title
                    font.weight: Font.Bold
                }

                Item {
                    width: Math.max(12, likesTitleRow.width - 120 - 100)
                    height: 1
                }

                TextButton {
                    anchors.verticalCenter: parent.verticalCenter
                    variant: TextButton.Text
                    symbol: "arrow_forward"
                    text: "All"
                    onClicked: UiState.goToArtistLikes(Library.currentArtist)
                }
            }
        }

        Repeater {
            model: SoundCloud.artistLikes.count > 0 ? Math.min(20, SoundCloud.artistLikes.count) : 0

            SongRow {
                x: root.margin
                width: root.width - 2 * root.margin
                songs: SoundCloud.artistLikes
                song: SoundCloud.artistLikes.at(index)
            }
        }

        // bottom padding before player bar
        Item { width: 1; height: 8 }
    }
}
