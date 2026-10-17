pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import Swiftify

// SoundCloud track detail page: ambient hero (no empty space), stats, tags, description, and related carousel
Flickable {
    id: root

    topMargin: Appearance.sizes.topBarHeight
    contentHeight: column.implicitHeight + Appearance.sizes.playerBarClearance
    boundsBehavior: Flickable.StopAtBounds

    ScrollBar.vertical: StyledScrollBar {
        topPadding: 3 + Appearance.sizes.topBarHeight
    }

    readonly property real margin: Appearance.sizes.pageMargin
    readonly property soundCloudTrackDetails details: SoundCloud.currentTrackDetails
    readonly property song track: Library.currentTrack
    readonly property bool loading: SoundCloud.loadingTrackDetails
    readonly property bool isCurrent: Player.currentSong.uri === root.track.uri

    function reaches(top: real, height: real, slack: real): bool {
        return top + height > root.contentY - slack && top < root.contentY + root.height + slack
    }

    Column {
        id: column
        width: root.width
        spacing: 0

        // ── Full-width ambient hero (no empty side spaces) ─────────────────────
        Item {
            id: heroContainer
            width: root.width
            height: heroContent.implicitHeight + 40

            // Ambient background banner stretching 100% width
            Rectangle {
                anchors.fill: parent
                color: Appearance.colors.surfaceContainerLowest
                clip: true

                ArtworkImage {
                    anchors.fill: parent
                    source: root.details.artworkUrl.toString().length > 0
                            ? root.details.artworkUrl : root.track.artworkUrl
                    opacity: 0.22
                }

                // Smooth gradient scrim blending into page
                Rectangle {
                    anchors.fill: parent
                    gradient: Gradient {
                        GradientStop { position: 0.0; color: "transparent" }
                        GradientStop { position: 0.65; color: Qt.alpha(Appearance.colors.surface, 0.88) }
                        GradientStop { position: 1.0; color: Appearance.colors.surface }
                    }
                }
            }

            // Foreground hero content: Side-by-side on wider screens, stacked on small
            Item {
                id: heroContent
                x: root.margin
                y: 20
                width: root.width - 2 * root.margin
                implicitHeight: root.width > 560
                                ? Math.max(artworkCard.height, infoColumn.implicitHeight)
                                : artworkCard.height + infoColumn.implicitHeight + 16

                // Sharp artwork card
                Item {
                    id: artworkCard
                    objectName: "heroArtwork"
                    x: 0
                    y: 0
                    width: root.width > 560 ? 210 : Math.min(210, heroContent.width)
                    height: width

                    Component.onCompleted: UiState.claimHero(artworkCard)

                    ArtworkGlow {
                        anchors.fill: parent
                        source: root.details.artworkUrl.toString().length > 0
                                ? root.details.artworkUrl : root.track.artworkUrl
                        intensity: 0.38
                        glowRadius: 32
                    }

                    ArtworkImage {
                        anchors.fill: parent
                        radius: 14
                        source: root.details.artworkUrl.toString().length > 0
                                ? root.details.artworkUrl : root.track.artworkUrl
                    }

                    // Playing badge
                    MaterialShape {
                        anchors.fill: parent
                        visible: root.isCurrent && Player.playing && !Appearance.performanceMode
                        shape: "sunny"
                        opacity: 0.22
                        color: Appearance.colors.primary
                        spinRate: 18
                    }
                }

                // Track info & controls next to the photo
                Column {
                    id: infoColumn
                    x: root.width > 560 ? artworkCard.width + 24 : 0
                    y: root.width > 560 ? 0 : artworkCard.height + 16
                    width: root.width > 560 ? heroContent.width - artworkCard.width - 24 : heroContent.width
                    spacing: 8

                    // Eyebrow badge
                    Row {
                        spacing: 6
                        Rectangle {
                            radius: 10
                            color: Appearance.colors.primaryContainer
                            implicitWidth: eyebrowRow.implicitWidth + 14
                            implicitHeight: 22

                            Row {
                                id: eyebrowRow
                                anchors.centerIn: parent
                                spacing: 4
                                MaterialSymbol {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: "graphic_eq"
                                    iconSize: 13
                                    color: Appearance.colors.onPrimaryContainer
                                }
                                StyledText {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: "SOUNDCLOUD ТРЕК"
                                    font.pixelSize: 10
                                    font.weight: Font.Bold
                                    color: Appearance.colors.onPrimaryContainer
                                }
                            }
                        }

                        StyledText {
                            visible: root.details.displayDate.length > 0
                            anchors.verticalCenter: parent.verticalCenter
                            text: root.details.displayDate
                            font.pixelSize: Appearance.fontSize.smaller
                            color: Appearance.colors.onSurfaceVariant
                        }
                    }

                    // Title
                    TitleText {
                        width: parent.width
                        text: root.details.title.length > 0 ? root.details.title : root.track.name
                        wrapMode: Text.WordWrap
                        font.pixelSize: root.width > 560 ? 28 : 22
                        font.weight: Font.Bold
                        color: Appearance.colors.onSurface
                        Reveal.shown: !root.loading
                        animateChange: true
                    }

                    // Clickable Artist row
                    Row {
                        spacing: 8
                        visible: root.details.artistName.length > 0 || root.track.artists.length > 0

                        ArtworkImage {
                            width: 26
                            height: 26
                            circular: true
                            radius: 13
                            source: root.details.artistAvatar
                        }

                        StyledText {
                            anchors.verticalCenter: parent.verticalCenter
                            text: root.details.artistName.length > 0
                                  ? root.details.artistName : root.track.artists
                            font.pixelSize: Appearance.fontSize.small
                            font.weight: Font.DemiBold
                            color: artistNameHover.hovered
                                   ? Appearance.colors.primary
                                   : Appearance.colors.onSurface

                            Behavior on color {
                                ColorAnimation { duration: Appearance.duration(120) }
                            }

                            HoverHandler { id: artistNameHover; cursorShape: Qt.PointingHandCursor }
                            TapHandler {
                                onTapped: UiState.goToArtist(root.track)
                            }
                        }

                        StyledText {
                            visible: root.details.artistFollowers > 0
                            anchors.verticalCenter: parent.verticalCenter
                            text: "• " + Format.compactCount(root.details.artistFollowers) + " подписчиков"
                            font.pixelSize: Appearance.fontSize.smaller
                            color: Appearance.colors.onSurfaceVariant
                        }
                    }

                    // Buttons row
                    Row {
                        spacing: 10
                        topPadding: 4

                        TextButton {
                            symbol: root.isCurrent && Player.playing ? "pause" : "play_arrow"
                            burst: root.isCurrent && Player.playing ? "" : "play"
                            text: root.isCurrent && Player.playing ? "Пауза" : "Слушать"
                            wavy: true
                            onClicked: {
                                if (root.isCurrent && Player.hasSong) {
                                    Player.playPause()
                                } else {
                                    Player.play(root.track)
                                }
                            }
                        }

                        TextButton {
                            symbol: "open_in_new"
                            text: "SoundCloud"
                            variant: TextButton.Tonal
                            visible: root.details.permalink.toString().length > 0
                            onClicked: Qt.openUrlExternally(root.details.permalink)
                        }
                    }
                }
            }
        }

        // ── Stats grid (2x2 or 4x1) ───────────────────────────────────────────
        Item {
            width: root.width
            height: statsGrid.implicitHeight + 20
            Reveal.shown: root.details.valid && !root.loading

            Grid {
                id: statsGrid
                x: root.margin
                y: 8
                width: root.width - 2 * root.margin
                columns: root.width > 680 ? 4 : 2
                rowSpacing: 10
                columnSpacing: 10

                Repeater {
                    model: [
                        { label: "Прослушиваний", value: root.details.playbackCount, icon: "headphones" },
                        { label: "Лайков",         value: root.details.likesCount,   icon: "favorite" },
                        { label: "Репостов",       value: root.details.repostsCount, icon: "repeat" },
                        { label: "Комментариев",   value: root.details.commentCount, icon: "comment" }
                    ]

                    delegate: Rectangle {
                        required property var modelData
                        radius: 14
                        color: Appearance.colors.surfaceContainerHigh
                        width: root.width > 680
                               ? (statsGrid.width - 3 * statsGrid.columnSpacing) / 4
                               : (statsGrid.width - statsGrid.columnSpacing) / 2
                        height: 58

                        Column {
                            anchors.centerIn: parent
                            spacing: 2

                            Row {
                                anchors.horizontalCenter: parent.horizontalCenter
                                spacing: 6

                                MaterialSymbol {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: modelData.icon
                                    iconSize: 15
                                    fill: 1
                                    color: Appearance.colors.primary
                                }
                                StyledText {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: Format.compactCount(modelData.value)
                                    font.pixelSize: Appearance.fontSize.body
                                    font.weight: Font.Bold
                                    color: Appearance.colors.onSurface
                                }
                            }

                            StyledText {
                                anchors.horizontalCenter: parent.horizontalCenter
                                text: modelData.label
                                font.pixelSize: 11
                                color: Appearance.colors.onSurfaceVariant
                            }
                        }
                    }
                }
            }
        }

        // ── Genre + tags ──────────────────────────────────────────────────────
        Item {
            width: root.width
            height: tagsRow.implicitHeight + 16
            visible: root.details.genre.length > 0 || root.details.tagList.length > 0

            Flow {
                id: tagsRow
                x: root.margin
                y: 4
                width: root.width - 2 * root.margin
                spacing: 8

                Repeater {
                    model: {
                        const tags = []
                        if (root.details.genre.length > 0) tags.push(root.details.genre)
                        const raw = root.details.tagList
                        if (raw.length > 0) {
                            raw.split(" ").forEach(t => {
                                const clean = t.replace(/^"|"$/g, "").trim()
                                if (clean.length > 0 && !tags.includes(clean)) tags.push(clean)
                            })
                        }
                        return tags
                    }

                    delegate: Rectangle {
                        required property string modelData
                        radius: 14
                        color: Appearance.colors.secondaryContainer
                        implicitWidth: tagLabel.implicitWidth + 20
                        implicitHeight: 28

                        StyledText {
                            id: tagLabel
                            anchors.centerIn: parent
                            text: modelData
                            font.pixelSize: Appearance.fontSize.smaller
                            color: Appearance.colors.onSecondaryContainer
                        }
                    }
                }
            }
        }

        // ── Description ────────────────────────────────────────────────────────
        Item {
            width: root.width
            height: descSection.implicitHeight + 8
            visible: root.details.description.length > 0

            Column {
                id: descSection
                x: root.margin
                y: 4
                width: root.width - 2 * root.margin
                spacing: 6

                StyledText {
                    font.pixelSize: Appearance.fontSize.small
                    font.weight: Font.DemiBold
                    text: "Описание"
                    color: Appearance.colors.onSurface
                }

                StyledText {
                    id: descText
                    width: parent.width
                    wrapMode: Text.WordWrap
                    font.pixelSize: Appearance.fontSize.smaller
                    color: Appearance.colors.onSurfaceVariant
                    maximumLineCount: descExpanded ? 999 : 4
                    elide: Text.ElideRight
                    text: root.details.description
                    property bool descExpanded: false
                }

                StyledText {
                    visible: descText.implicitHeight > descText.height || descText.descExpanded
                    text: descText.descExpanded ? "Скрыть" : "Показать больше"
                    font.pixelSize: Appearance.fontSize.smaller
                    color: Appearance.colors.primary
                    font.weight: Font.DemiBold

                    HoverHandler { cursorShape: Qt.PointingHandCursor }
                    TapHandler { onTapped: descText.descExpanded = !descText.descExpanded }
                }
            }
        }

        // ── Loading indicator ──────────────────────────────────────────────────
        Item {
            width: root.width
            height: 120
            Reveal.shown: root.loading

            Column {
                anchors.centerIn: parent
                spacing: 10

                LoadingSpinner { anchors.horizontalCenter: parent.horizontalCenter }
                StyledText {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: "Загрузка информации о треке…"
                    color: Appearance.colors.onSurfaceVariant
                }
            }
        }

        // ── Related tracks CAROUSEL (Красивая горизонтальная карусель) ─────────
        Item {
            id: relatedCarouselArea
            width: root.width
            height: carouselColumn.implicitHeight + 10
            visible: SoundCloud.relatedTracks.count > 0 || root.loading

            Column {
                id: carouselColumn
                width: root.width
                spacing: 12

                // Header with title and scroll controls
                Item {
                    x: root.margin
                    width: root.width - 2 * root.margin
                    height: 40

                    Row {
                        anchors.left: parent.left
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 8

                        MaterialSymbol {
                            anchors.verticalCenter: parent.verticalCenter
                            text: "auto_awesome"
                            iconSize: 20
                            color: Appearance.colors.primary
                        }

                        TitleText {
                            anchors.verticalCenter: parent.verticalCenter
                            text: "Похожие треки"
                            font.pixelSize: Appearance.fontSize.title
                            font.weight: Font.Bold
                        }

                        StyledText {
                            anchors.verticalCenter: parent.verticalCenter
                            text: "(" + SoundCloud.relatedTracks.count + ")"
                            font.pixelSize: Appearance.fontSize.small
                            color: Appearance.colors.onSurfaceVariant
                        }
                    }

                    // Carousel arrows
                    Row {
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 6

                        IconButton {
                            symbol: "chevron_left"
                            size: 32
                            iconSize: 18
                            enabled: carouselList.contentX > 0
                            onClicked: carouselList.contentX = Math.max(0, carouselList.contentX - 400)
                        }

                        IconButton {
                            symbol: "chevron_right"
                            size: 32
                            iconSize: 18
                            enabled: carouselList.contentX < carouselList.contentWidth - carouselList.width
                            onClicked: carouselList.contentX = Math.min(carouselList.contentWidth - carouselList.width, carouselList.contentX + 400)
                        }
                    }
                }

                // Horizontal Carousel ListView
                ListView {
                    id: carouselList
                    width: root.width
                    height: 230
                    orientation: ListView.Horizontal
                    spacing: 14
                    leftMargin: root.margin
                    rightMargin: root.margin
                    boundsBehavior: Flickable.StopAtBounds
                    clip: false
                    model: SoundCloud.relatedTracks

                    Behavior on contentX {
                        NumberAnimation { duration: Appearance.duration(300); easing.type: Easing.OutCubic }
                    }

                    delegate: Item {
                        id: cardDelegate
                        required property int index
                        readonly property song track: SoundCloud.relatedTracks.at(index)
                        readonly property song modelData: track

                        readonly property bool isCurrentTrack: Player.currentSong.uri === modelData.uri
                        readonly property bool isPlayingThis: isCurrentTrack && Player.playing

                        width: 154
                        height: 224

                        Rectangle {
                            id: cardBg
                            anchors.fill: parent
                            radius: 14
                            color: cardMouse.containsMouse
                                   ? Appearance.colors.surfaceContainerHighest
                                   : Appearance.colors.surfaceContainerHigh

                            Behavior on color {
                                ColorAnimation { duration: Appearance.duration(140) }
                            }

                            Column {
                                anchors.fill: parent
                                anchors.margins: 9
                                spacing: 8

                                // Artwork box
                                Item {
                                    width: parent.width
                                    height: width

                                    ArtworkImage {
                                        id: cardArt
                                        anchors.fill: parent
                                        radius: 10
                                        source: cardDelegate.modelData.artworkUrl.toString().length > 0
                                                ? cardDelegate.modelData.artworkUrl
                                                : (cardDelegate.modelData.artistItems.length > 0
                                                   ? cardDelegate.modelData.artistItems[0].artworkUrl
                                                   : "")
                                    }

                                    // Hover play button overlay
                                    Rectangle {
                                        anchors.centerIn: parent
                                        width: 44
                                        height: 44
                                        radius: 22
                                        color: Appearance.colors.primary
                                        opacity: cardDelegate.isPlayingThis || cardMouse.containsMouse ? 1 : 0
                                        scale: cardDelegate.isPlayingThis || cardMouse.containsMouse ? 1 : 0.6

                                        Behavior on opacity {
                                            NumberAnimation { duration: Appearance.duration(160) }
                                        }
                                        Behavior on scale {
                                            NumberAnimation { duration: Appearance.duration(200); easing.type: Easing.OutBack }
                                        }

                                        MaterialSymbol {
                                            anchors.centerIn: parent
                                            text: cardDelegate.isPlayingThis ? "pause" : "play_arrow"
                                            iconSize: 22
                                            color: Appearance.colors.onPrimary
                                            fill: 1
                                        }

                                        MouseArea {
                                            anchors.fill: parent
                                            cursorShape: Qt.PointingHandCursor
                                            onClicked: {
                                                if (cardDelegate.isCurrentTrack) {
                                                    Player.playPause()
                                                } else {
                                                    Player.playFromModel(SoundCloud.relatedTracks, cardDelegate.index)
                                                }
                                            }
                                        }
                                    }
                                }

                                // Title
                                StyledText {
                                    width: parent.width
                                    text: cardDelegate.modelData.name
                                    font.pixelSize: Appearance.fontSize.small
                                    font.weight: Font.DemiBold
                                    elide: Text.ElideRight
                                    maximumLineCount: 2
                                    wrapMode: Text.WordWrap
                                    color: cardDelegate.isCurrentTrack
                                           ? Appearance.colors.primary
                                           : Appearance.colors.onSurface
                                }

                                // Artist
                                StyledText {
                                    width: parent.width
                                    text: cardDelegate.modelData.artists
                                    font.pixelSize: Appearance.fontSize.smaller
                                    elide: Text.ElideRight
                                    color: Appearance.colors.onSurfaceVariant
                                }
                            }

                            MouseArea {
                                id: cardMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    Library.goToTrack(cardDelegate.modelData)
                                }
                            }
                        }
                    }
                }
            }
        }

        Item { width: 1; height: 16 }
    }
}
