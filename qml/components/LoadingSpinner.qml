pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// material 3 expressive's loading indicator: a shape that morphs through
// the shape library with a spring, kicking round a quarter turn each time,
// while it slowly turns. with a `trackColor` it sits in a round container,
// as the contained indicator does. nothing animates while it is hidden.
Item {
    id: root

    property bool running: true
    property color color: Appearance.colors.primary
    /// the container behind the shape; transparent for none
    property color trackColor: "transparent"

    readonly property list<string> sequence: ["softBurst", "heart", "cookie9", "ghostish", "flower", "bun", "sunny",
                                              "clover4", "pixelCircle"]
    property int step: 0
    property real morph: 0
    property real turn: 0
    property real kick: 0
    readonly property bool animating: running && visible && !Appearance.reduceMotion && !Settings.noShapes
    /// with reduced motion it stays one shape, and breathes in and out; so
    /// it does with no shapes, where every shape it morphs through is a circle
    readonly property bool pulsing: running && visible && (Appearance.reduceMotion || Settings.noShapes)
                                    && !Appearance.performanceMode

    implicitWidth: 40
    implicitHeight: 40

    Behavior on kick {
        SpringAnimation { spring: 3; damping: 0.3; epsilon: 0.05 }
    }

    Rectangle {
        anchors.fill: parent
        radius: width / 2
        visible: root.trackColor.a > 0
        color: root.trackColor
    }

    MaterialShape {
        id: body
        anchors.centerIn: parent
        width: parent.width * (root.trackColor.a > 0 ? 0.62 : 0.86)
        height: width
        shape: root.sequence[root.step]
        morphTo: root.sequence[(root.step + 1) % root.sequence.length]
        morph: root.morph
        color: root.color
        spinAngle: (root.turn + root.kick) % 360
        opacity: 1

        SequentialAnimation on opacity {
            running: root.pulsing
            loops: Animation.Infinite
            onRunningChanged: if (!running) body.opacity = 1
            NumberAnimation { to: 0.35; duration: 700; easing.type: Easing.InOutSine }
            NumberAnimation { to: 1; duration: 700; easing.type: Easing.InOutSine }
        }
    }

    NumberAnimation on turn {
        running: root.animating
        from: 0
        to: 360
        duration: 4800
        loops: Animation.Infinite
    }

    SequentialAnimation {
        running: root.animating
        loops: Animation.Infinite

        ScriptAction { script: root.kick += 90 }
        NumberAnimation {
            target: root
            property: "morph"
            from: 0
            to: 1
            duration: 650
            easing.type: Easing.OutBack
            easing.overshoot: 2
        }
        ScriptAction {
            script: {
                root.step = (root.step + 1) % root.sequence.length
                root.morph = 0
            }
        }
    }
}
