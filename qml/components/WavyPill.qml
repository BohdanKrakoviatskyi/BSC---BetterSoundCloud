pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// a pill with a scalloped edge (wavy_pill.frag), for the buttons that play
// things: its scallops deepen and start running round the edge while hovered.
// with no shapes (Settings.noShapes) it is a plain pill.
ShaderEffect {
    id: root

    property color color: Appearance.colors.primary
    property bool hovered: false
    property bool pressed: false

    property size itemSize: Qt.size(width, height)
    property real cornerRadius: Math.min(width, height) / 2
    property real amplitude: Settings.noShapes ? 0 : (pressed ? 4 : (hovered ? 3.2 : 2.2))
    property real wavelength: 15
    readonly property real phase: drift.value

    Behavior on amplitude {
        enabled: !Appearance.performanceMode
        Bounce {}
    }

    // the scallops start running round on hover and slow to a stop where
    // they are when the pointer leaves
    Drift {
        id: drift
        active: root.hovered && root.visible && !Settings.noShapes
        speed: 2 * Math.PI / 1.6
    }

    fragmentShader: "qrc:/shaders/wavy_pill.frag.qsb"
}
