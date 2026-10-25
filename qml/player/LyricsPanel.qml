pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import Resonance

// the lyrics column (LyricsPanel): the current line full size and bright, the
// rest smaller and faded, kept in the middle as the song moves. a line seeks
// when clicked, if the lyrics are synchronised.
Item {
    id: root

    /// under the immersive player: the lines change, nothing scrolls
    property bool suspended: false
    property MaterialScheme scheme: Appearance.colors

    TapHandler {
        acceptedButtons: Qt.RightButton
        onTapped: (point) => {
            sourceMenu.x = point.position.x
            sourceMenu.y = point.position.y
            sourceMenu.open()
        }
    }

    StyledMenu {
        id: sourceMenu
        width: 320
        StyledMenuItem { text: "Source: Auto"; checkmark: true; checked: Player.lyricsSource === 0; onTriggered: Player.setLyricsSource(0) }
        StyledMenuItem { text: "Source: LRCLIB"; checkmark: true; checked: Player.lyricsSource === 1; onTriggered: Player.setLyricsSource(1) }
        StyledMenuItem { text: "Source: Genius"; checkmark: true; checked: Player.lyricsSource === 2; onTriggered: Player.setLyricsSource(2) }

        StyledMenuItem {
            objectName: "lyricsTimingMenuItem"
            visible: Player.lyricsSynchronized && !Player.loadingLyrics
            height: visible ? implicitHeight : 0
            implicitWidth: 280
            implicitHeight: 62

            contentItem: Item {
                StyledText {
                    anchors.top: parent.top
                    anchors.left: parent.left
                    text: "Lyrics timing"
                    font.pixelSize: Appearance.fontSize.smaller
                    color: root.scheme.onSurfaceVariant
                }
                StyledText {
                    anchors.top: parent.top
                    anchors.right: parent.right
                    text: Player.lyricsOffsetMs === 0 ? "0.00 s"
                          : (Math.abs(Player.lyricsOffsetMs) / 1000).toFixed(2) + " s "
                            + (Player.lyricsOffsetMs > 0 ? "earlier" : "later")
                    font.pixelSize: Appearance.fontSize.smaller
                    color: root.scheme.onSurface
                }
                StyledSlider {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.bottomMargin: 4
                    scheme: root.scheme
                    trackThickness: 8
                    activeColor: root.scheme.secondaryContainer
                    inactiveColor: root.scheme.secondaryContainer
                    handleColor: root.scheme.primary
                    showStopIndicator: false
                    from: -10
                    to: 10
                    stepSize: 0.25
                    snapMode: Slider.SnapAlways
                    value: Player.lyricsOffsetMs / 1000
                    onMoved: Player.setLyricsOffsetMs(Math.round(value * 4) * 250)
                }
            }
        }
        StyledMenuItem {
            visible: Player.lyricsSynchronized && !Player.loadingLyrics
            height: visible ? implicitHeight : 0
            text: "Reset timing to 0"
            symbol: "restart_alt"
            enabled: Player.lyricsOffsetMs !== 0
            onTriggered: Player.setLyricsOffsetMs(0)
        }
        StyledMenuItem {
            visible: Player.lyricsSynchronized && !Player.loadingLyrics
            height: visible ? implicitHeight : 0
            text: Player.lyricsOffsetSaved ? "Saved for this song" : "Save timing for this song"
            checkmark: true
            checked: Player.lyricsOffsetSaved
            onTriggered: Player.saveLyricsOffset()
        }
    }

    IconButton {
        id: sourceBtn
        anchors.top: parent.top
        anchors.right: fullscreenBtn.left
        anchors.margins: 10
        z: 10
        scheme: root.scheme
        symbol: "more_vert"
        size: 32
        iconSize: 18
        tooltip: "Lyrics source and timing"
        onClicked: {
            sourceMenu.x = sourceBtn.x
            sourceMenu.y = sourceBtn.y + sourceBtn.height
            sourceMenu.open()
        }
    }

    IconButton {
        id: fullscreenBtn
        anchors.top: parent.top
        anchors.right: parent.right
        anchors.margins: 10
        z: 10
        scheme: root.scheme
        symbol: "open_in_full"
        size: 32
        iconSize: 18
        tooltip: "Full Screen Lyrics"
        visible: Player.hasLyrics && !Player.loadingLyrics
        onClicked: UiState.openFullscreenLyrics()
    }


    Column {
        anchors.centerIn: parent
        Reveal.shown: Player.loadingLyrics
        spacing: 12
        LoadingSpinner { anchors.horizontalCenter: parent.horizontalCenter }
        StyledText {
            text: "Loading lyrics…"
            color: root.scheme.onSurfaceVariant
        }
    }

    EmptyState {
        anchors.centerIn: parent
        width: parent.width - 32
        Reveal.shown: !Player.loadingLyrics && !Player.hasLyrics
        symbol: "lyrics"
        title: "Lyrics Unavailable"
        description: Player.lyricsMessage.length > 0 ? Player.lyricsMessage : "i guess bro"
    }

    ListView {
        id: list
        anchors.fill: parent
        Reveal.shown: !Player.loadingLyrics && Player.hasLyrics
        model: Player.lyrics
        spacing: 22
        topMargin: 18
        bottomMargin: 18
        leftMargin: 24
        rightMargin: 24
        clip: true
        // dragged past either end, it stretches and springs back
        boundsBehavior: Flickable.DragAndOvershootBounds
        cacheBuffer: 2000
        // a step moves every line at once; each then springs from where it
        // was to its new place, the ones nearest the sung line first, so the
        // column arrives as a wave rather than a block
        signal stepped(real delta)

        ScrollBar.vertical: StyledScrollBar {}

        function follow(animated: bool) {
            const index = Player.activeLyricIndex
            if (index < 0 || root.suspended) {
                return
            }
            const item = list.itemAtIndex(index)
            if (!item) {
                scroll.stop()
                list.positionViewAtIndex(index, ListView.Center)
                return
            }
            const target = Math.max(list.originY - list.topMargin,
                                    Math.min(item.y + item.height / 2 - list.height / 2,
                                             list.contentHeight + list.originY - list.height + list.bottomMargin))
            const delta = target - list.contentY
            scroll.stop()
            // with reduced motion the column scrolls there on a plain ease
            // out, every line together, rather than as a wave
            if (animated && Appearance.reduceMotion && !Appearance.performanceMode) {
                scroll.to = target
                scroll.start()
                return
            }
            list.contentY = target
            if (animated && !Appearance.reduceMotion) {
                list.stepped(delta)
            }
        }

        NumberAnimation {
            id: scroll
            target: list
            property: "contentY"
            duration: 420
            easing.type: Easing.OutCubic
        }

        Connections {
            target: Player
            function onActiveLyricIndexChanged() { list.follow(true) }
        }
        Connections {
            target: root
            function onSuspendedChanged() { if (!root.suspended) list.follow(false) }
        }

        delegate: Item {
            id: line

            required property int index
            required property string words
            required property int startTimeMs
            required property int endTimeMs
            readonly property bool active: !Player.lyricsSynchronized || Player.activeLyricIndex === index
            property real fillProgress: line.active ? 0.0 : (line.index < Player.activeLyricIndex ? 1.0 : 0.0)

            NumberAnimation {
                id: fillAnim
                target: line
                property: "fillProgress"
                easing.type: Easing.Linear
            }

            function startFillAnimation() {
                if (!Player.lyricsSynchronized) {
                    fillAnim.stop()
                    line.fillProgress = 1.0
                    return
                }

                const now = Player.livePositionMs + Player.lyricsOffsetMs
                const start = line.startTimeMs
                const end = line.endTimeMs > line.startTimeMs ? line.endTimeMs : (start + Math.max(1200, line.words.length * 75))
                const totalDuration = Math.max(400, end - start)
                const elapsed = Math.max(0, now - start)

                if (elapsed >= totalDuration) {
                    fillAnim.stop()
                    line.fillProgress = 1.0
                    return
                }

                const startProgress = Math.min(0.95, elapsed / totalDuration)
                const remainingDuration = Math.max(200, totalDuration - elapsed)

                fillAnim.stop()
                fillAnim.from = startProgress
                fillAnim.to = 1.0
                fillAnim.duration = remainingDuration
                if (Player.playing) {
                    fillAnim.start()
                } else {
                    line.fillProgress = startProgress
                }
            }

            onActiveChanged: {
                if (active) {
                    startFillAnimation()
                } else {
                    fillAnim.stop()
                    fillProgress = line.index < Player.activeLyricIndex ? 1.0 : 0.0
                }
            }

            Component.onCompleted: {
                if (line.active) {
                    line.startFillAnimation()
                } else {
                    line.fillProgress = line.index < Player.activeLyricIndex ? 1.0 : 0.0
                }
            }

            width: list.width - list.leftMargin - list.rightMargin
            height: baseText.implicitHeight

            property real lag: 0
            transform: Translate { y: line.lag }

            Connections {
                target: list
                function onStepped(delta: real) {
                    line.lag += delta
                    settle.restart()
                }
            }
            SequentialAnimation {
                id: settle
                // a gentle ripple: a short stagger and a small overshoot
                PauseAnimation { duration: Math.min(Math.abs(line.index - Player.activeLyricIndex), 8) * 16 }
                NumberAnimation { target: line; property: "lag"; to: 0; duration: 560; easing.type: Easing.OutBack; easing.overshoot: 0.6 }
            }

            Connections {
                target: Player
                function onActiveLyricIndexChanged() {
                    if (!line.active) {
                        fillAnim.stop()
                        line.fillProgress = line.index < Player.activeLyricIndex ? 1.0 : 0.0
                    }
                }
                function onLivePositionChanged() {
                    if (line.active && Player.lyricsSynchronized) {
                        const start = line.startTimeMs
                        const end = line.endTimeMs > start ? line.endTimeMs : (start + Math.max(1200, line.words.length * 75))
                        const total = Math.max(400, end - start)
                        const expectedProgress = Math.min(1.0, Math.max(0.0, (Player.livePositionMs + Player.lyricsOffsetMs - start) / total))
                        if (Math.abs(line.fillProgress - expectedProgress) > 0.18) {
                            line.startFillAnimation()
                        }
                    }
                }
                function onLyricsOffsetChanged() {
                    if (line.active && Player.lyricsSynchronized) line.startFillAnimation()
                }
                function onPlayingChanged() {
                    if (line.active && Player.lyricsSynchronized) {
                        if (Player.playing) {
                            if (fillAnim.paused) fillAnim.resume()
                            else if (!fillAnim.running && line.fillProgress < 1.0) line.startFillAnimation()
                        } else {
                            if (fillAnim.running) fillAnim.pause()
                        }
                    }
                }
            }

            Item {
                id: textContainer
                anchors.fill: parent

                StyledText {
                    id: baseText
                    width: parent.width
                    transformOrigin: Item.TopLeft
                    text: line.words.length > 0 ? line.words : "♪"
                    wrapMode: Text.Wrap
                    font.pixelSize: 22
                    font.weight: Font.Bold
                    color: root.scheme.onSurface
                    property real springing: line.active ? 1 : 19 / 22
                    property real eased: line.active ? 1 : 19 / 22
                    scale: Appearance.reduceMotion ? eased : springing
                    opacity: 0.34

                    Behavior on springing {
                        enabled: !root.suspended && !Appearance.reduceMotion
                        Bounce {}
                    }
                    Behavior on eased {
                        enabled: !root.suspended && Appearance.reduceMotion && !Appearance.performanceMode
                        NumberAnimation { duration: 420; easing.type: Easing.OutCubic }
                    }
                }

                Item {
                    id: activeClip
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    width: line.fillProgress >= 1.0
                           ? parent.width
                           : (line.fillProgress <= 0.001
                              ? 0
                              : Math.min(parent.width, Math.max(0, (baseText.contentWidth + 16) * line.fillProgress)))
                    clip: true
                    visible: width > 0

                    StyledText {
                        id: activeText
                        width: textContainer.width
                        height: textContainer.height
                        transformOrigin: Item.TopLeft
                        text: baseText.text
                        wrapMode: baseText.wrapMode
                        font.pixelSize: baseText.font.pixelSize
                        font.weight: Font.Bold
                        color: root.scheme.onSurface
                        scale: baseText.scale
                        opacity: line.active ? 1.0 : 0.34

                        Behavior on opacity {
                            enabled: !root.suspended
                            NumberAnimation { duration: Appearance.duration(280); easing.type: Easing.InOutQuad }
                        }
                    }
                }
            }

            MouseArea {
                anchors.fill: parent
                enabled: Player.lyricsSynchronized
                cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                onClicked: Player.seekToLyricLine(line.index)
            }
        }

        footer: StyledText {
            topPadding: 18
            text: "Lyrics provided by " + Player.lyricsProvider
            font.pixelSize: Appearance.fontSize.smaller
            color: root.scheme.outline
        }
    }
}
