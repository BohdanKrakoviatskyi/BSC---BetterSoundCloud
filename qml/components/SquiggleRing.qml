pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// a wavy ring that turns while music plays (material 3 expressive's wavy
// indicators), drawn by one shader. with `progress` under 1 it is a wavy
// progress ring over a plain track. with no shapes (Settings.noShapes) it
// is a plain ring.
ShaderEffect {
    id: root

    property color color: Appearance.colors.primary
    property color trackColor: Qt.rgba(color.r, color.g, color.b, 0.24)
    property real thickness: 2.5
    property real amplitude: 2
    /// one wave's length along the ring, in pixels
    property real wavelength: 16
    property real progress: 1
    /// turns of the waves round the ring per radian of the shared spin; 0
    /// keeps them still
    property real speed: 0.35

    property size itemSize: Qt.size(width, height)
    property real radius: Math.max(1, Math.min(width, height) / 2 - amplitude - thickness / 2 - 0.5)
    property real waves: Settings.noShapes ? 0 : Math.max(5, Math.round(2 * Math.PI * radius / wavelength))
    // the spin grows without end in double precision; the shader gets it
    // wrapped, so a long session never loses float precision
    property real phase: visible ? (waves * speed * UiState.spin) % (2 * Math.PI) : 0

    fragmentShader: "qrc:/shaders/squiggle_ring.frag.qsb"
}
