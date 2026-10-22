pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// ten seconds into a song from one particular soundtrack, a figure pops up
// from the window's bottom-right corner, gives a thumbs up for five seconds,
// and pops back down. once each time a song plays.
Item {
    id: root

    /// how far up it is: 0 out of sight below the corner, 1 all the way up
    property real lift: 0
    /// the song it last came up for, so a song brings it once
    property real seenInstance: -1
    readonly property bool due: Player.hasSong && isItsSoundtrack(Player.currentSong.albumName)

    /// the soundtracks it comes up for, by their english, japanese or romaji names
    function isItsSoundtrack(album: string): bool {
        const name = album.toLowerCase()
        return name.includes("hero academia") || name.includes("boku no hero") || album.includes("僕のヒーローアカデミア")
    }

    function pop() {
        appearance.restart()
    }

    function check() {
        if (!due || Player.positionMs < 10000 || Player.currentSong.instanceId === seenInstance) {
            return
        }
        seenInstance = Player.currentSong.instanceId
        pop()
    }

    Connections {
        target: Player
        function onPositionChanged() { root.check() }
    }

    SequentialAnimation {
        id: appearance
        NumberAnimation {
            target: root
            property: "lift"
            to: 1
            duration: Appearance.motion(560)
            easing.type: Easing.OutBack
            easing.overshoot: 1.7
        }
        PauseAnimation { duration: 5000 }
        NumberAnimation {
            target: root
            property: "lift"
            to: 0
            duration: Appearance.motion(420)
            easing.type: Easing.InBack
            easing.overshoot: 1.4
        }
    }

    Image {
        id: figure
        // a good size, whatever the window's
        height: Math.min(root.height * 0.55, 440)
        width: height * 534 / 909
        x: root.width - width - 28
        y: root.height - root.lift * height
        visible: root.lift > 0
        // it leans in as it rises, and straightens up
        rotation: (1 - Math.min(root.lift, 1)) * 14
        transformOrigin: Item.Bottom
        // loaded only for the songs it comes up for: decoded, it is two
        // megabytes, kept for the whole session
        source: root.due ? "qrc:/qt/qml/Resonance/resources/cameo.png" : ""
        // in points: qt loads it at the screen's pixels a point itself
        sourceSize: Qt.size(Math.ceil(width), Math.ceil(height))
        fillMode: Image.PreserveAspectFit
        smooth: true
        mipmap: true
    }
}
