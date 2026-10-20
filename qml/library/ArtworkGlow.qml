pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// two soft, offset shadows in a cover's own colours behind its artwork
// (ArtworkGlow.swift). sdf shadows: no layer, and nothing redraws while still.
Item {
    id: root

    property url source
    property real intensity: 0.22
    property real glowRadius: 24
    property real cornerRadius: Appearance.sizes.artworkRadius
    property bool circular: false
    /// the cover's own colours, unless the owner already has them
    property color primary: colors.primary
    property color secondary: colors.secondary

    ArtworkColors {
        id: colors
        source: root.source
    }

    SoftShadow {
        anchors.fill: parent
        radius: root.circular ? width / 2 : root.cornerRadius
        blur: root.glowRadius
        offset: Qt.vector2d(-0.22 * root.glowRadius, 0.12 * root.glowRadius)
        color: Qt.rgba(root.primary.r, root.primary.g, root.primary.b, root.intensity)
    }

    SoftShadow {
        anchors.fill: parent
        radius: root.circular ? width / 2 : root.cornerRadius
        blur: root.glowRadius * 0.82
        offset: Qt.vector2d(0.24 * root.glowRadius, -0.08 * root.glowRadius)
        color: Qt.rgba(root.secondary.r, root.secondary.g, root.secondary.b, root.intensity * 0.72)
    }
}
