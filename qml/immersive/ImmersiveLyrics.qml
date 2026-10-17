pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Effects
import Swiftify

// the immersive lyrics (FullscreenLyrics): large bold lines, the sung one
// bright and glowing in the cover's first colour, kept in the middle, the
// column fading out at its edges. clicking a synchronised line flashes it and
// seeks there.
Item {
    id: root

    property MaterialScheme scheme: PlayerStyle.darkScheme
    readonly property color glow: Qt.rgba(PlayerStyle.primary.r, PlayerStyle.primary.g, PlayerStyle.primary.b, 0.5)

    Column {
        anchors.centerIn: parent
        Reveal.shown: Player.loadingLyrics
        spacing: 14

        LoadingSpinner {
            anchors.horizontalCenter: parent.horizontalCenter
            width: 36
            height: 36
            color: root.scheme.primary
            trackColor: Qt.rgba(1, 1, 1, 0.12)
        }
        StyledText {
            text: "Loading lyrics…"
            color: Qt.rgba(1, 1, 1, 0.7)
        }
    }

    EmptyState {
        anchors.centerIn: parent
        Reveal.shown: !Player.loadingLyrics && !Player.hasLyrics
        scheme: root.scheme
        symbol: "lyrics"
        title: "Lyrics Unavailable"
        description: Player.lyricsMessage.length > 0 ? Player.lyricsMessage : UiState.catchphrase
    }

    ListView {
        id: list
        objectName: "immersiveLyricsList"
        anchors.fill: parent
        Reveal.shown: !Player.loadingLyrics && Player.hasLyrics
        model: Player.lyrics
        spacing: 28
        topMargin: 40
        bottomMargin: 40
        leftMargin: 8
        rightMargin: 8
        // dragged past either end, it stretches and springs back
        boundsBehavior: Flickable.DragAndOvershootBounds
        cacheBuffer: 1200
        // a step moves every line at once; each then springs from where it
        // was to its new place, the ones nearest the sung line first, so the
        // column arrives as a wave rather than a block
        signal stepped(real delta)


        layer.enabled: true
        layer.effect: ShaderEffect {
            property variant source
            property real edge: 0.08
            fragmentShader: "qrc:/shaders/edge_fade.frag.qsb"
        }

        function follow(animated: bool) {
            const index = Player.activeLyricIndex
            if (index < 0) {
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
        Component.onCompleted: Qt.callLater(list.follow, false)

        delegate: Item {
            id: line

            required property int index
            required property string words
            required property int startTimeMs
            required property int endTimeMs
            readonly property bool active: !Player.lyricsSynchronized || Player.activeLyricIndex === index
            property bool highlighted: false
            property real glowStrength: active ? 1 : 0
            property real fillProgress: line.active ? 0.0 : (line.index < Player.activeLyricIndex ? 1.0 : 0.0)

            Behavior on glowStrength {
                NumberAnimation { duration: Appearance.duration(320); easing.type: Easing.InOutQuad }
            }

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

                const now = Player.livePositionMs
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
            height: baseLabel.implicitHeight + 16

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
                        const expectedProgress = Math.min(1.0, Math.max(0.0, (Player.livePositionMs - start) / total))
                        if (Math.abs(line.fillProgress - expectedProgress) > 0.18) {
                            line.startFillAnimation()
                        }
                    }
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

            // the sung line swells a touch, on a spring, or with reduced
            // motion on the plain ease out the column scrolls with
            property real springing: active ? 1.0 : 0.94
            property real eased: active ? 1.0 : 0.94
            scale: Appearance.reduceMotion ? eased : springing
            transformOrigin: Item.Left

            Behavior on springing {
                enabled: !Appearance.reduceMotion
                Bounce {}
            }
            Behavior on eased {
                enabled: Appearance.reduceMotion && !Appearance.performanceMode
                NumberAnimation { duration: 420; easing.type: Easing.OutCubic }
            }

            Rectangle {
                anchors.fill: parent
                radius: 14
                color: Qt.rgba(1, 1, 1, line.highlighted ? 0.08 : 0)

                Behavior on color {
                    ColorAnimation { duration: Appearance.duration(180); easing.type: Easing.OutQuad }
                }
            }

            Item {
                id: textContainer
                anchors.fill: parent

                // Base text: letters are physically already rendered in soft muted tone
                StyledText {
                    id: baseLabel
                    objectName: "lyricBaseText"
                    anchors.fill: parent
                    leftPadding: 16
                    rightPadding: 16
                    topPadding: 10
                    bottomPadding: 10
                    text: line.words.length > 0 ? line.words : "♪"
                    wrapMode: Text.Wrap
                    font.pixelSize: 34
                    font.weight: line.active ? Font.Bold : Font.DemiBold
                    color: "white"
                    opacity: 0.36
                }

                // Active text layer: sweeps across from left to right revealing glowing white
                Item {
                    id: activeClip
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    width: line.fillProgress >= 1.0
                           ? parent.width
                           : (line.fillProgress <= 0.001
                              ? 0
                              : Math.min(parent.width, Math.max(0, baseLabel.leftPadding + (baseLabel.contentWidth + 24) * line.fillProgress)))
                    clip: true
                    visible: width > 0

                    StyledText {
                        id: activeLabel
                        objectName: "lyricActiveText"
                        width: textContainer.width
                        height: textContainer.height
                        leftPadding: baseLabel.leftPadding
                        rightPadding: baseLabel.rightPadding
                        topPadding: baseLabel.topPadding
                        bottomPadding: baseLabel.bottomPadding
                        text: baseLabel.text
                        wrapMode: baseLabel.wrapMode
                        font.pixelSize: baseLabel.font.pixelSize
                        font.weight: Font.Bold
                        color: "white"
                        opacity: line.active ? 1.0 : 0.36

                        layer.enabled: line.active && line.glowStrength > 0.01
                        layer.effect: MultiEffect {
                            shadowEnabled: true
                            shadowColor: Qt.rgba(1, 1, 1, 0.45)
                            shadowOpacity: line.glowStrength * 0.7
                            shadowBlur: 0.9
                            blurMax: 20
                            shadowHorizontalOffset: 0
                            shadowVerticalOffset: 0
                        }
                    }
                }
            }

            Timer {
                id: flash
                interval: 80
                onTriggered: line.highlighted = false
            }

            MouseArea {
                anchors.fill: parent
                enabled: Player.lyricsSynchronized
                cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                onClicked: {
                    line.highlighted = true
                    flash.restart()
                    Player.seekToLyricLine(line.index)
                }
            }
        }

        footer: StyledText {
            leftPadding: 18
            topPadding: 46
            text: "Lyrics provided by " + Player.lyricsProvider
            font.pixelSize: Appearance.fontSize.smaller
            color: Qt.rgba(1, 1, 1, 0.4)
        }
    }
}
